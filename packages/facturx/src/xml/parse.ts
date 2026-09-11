/**
 * Mini-parseur XML sans dépendance, suffisant pour CII : déclaration, commentaires, instructions de
 * traitement, CDATA, entités prédéfinies et numériques, attributs, namespaces.
 * Refuse tout DOCTYPE (XXE, expansion d'entités) et borne la profondeur.
 */

/** Élément XML parsé. `ns` est l'URI de namespace résolue, `local` le nom local. */
export interface XmlNode {
  readonly ns: string;
  readonly local: string;
  /** Nom qualifié tel qu'écrit (`ram:ID`). */
  readonly name: string;
  /** Attributs par nom tel qu'écrit (`schemeID`, `xml:lang`…), entités décodées. */
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  /** Texte direct concaténé (hors éléments enfants), entités décodées. */
  readonly text: string;
}

export class XmlParseError extends Error {
  override readonly name = 'XmlParseError';
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (ligne ${line}, colonne ${column})`);
    this.line = line;
    this.column = column;
  }
}

export interface ParseXmlOptions {
  /** Profondeur d'imbrication maximale (défaut : 256). */
  maxDepth?: number;
}

interface MutableNode {
  ns: string;
  local: string;
  name: string;
  attrs: Record<string, string>;
  children: MutableNode[];
  text: string;
}

const NAME_START = /[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR = /[A-Za-z0-9_:.·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�-]/;
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

class Parser {
  private pos = 0;
  private readonly src: string;
  private readonly maxDepth: number;

  constructor(src: string, maxDepth: number) {
    this.src = src;
    this.maxDepth = maxDepth;
  }

  private fail(message: string, at = this.pos): never {
    let line = 1;
    let lastBreak = -1;
    for (let i = 0; i < at && i < this.src.length; i++) {
      if (this.src.charCodeAt(i) === 10) {
        line++;
        lastBreak = i;
      }
    }
    throw new XmlParseError(message, line, at - lastBreak);
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++;
  }

  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private readName(): string {
    const start = this.pos;
    if (this.pos >= this.src.length || !NAME_START.test(this.src[this.pos] as string))
      this.fail('Nom attendu');
    this.pos++;
    while (this.pos < this.src.length && NAME_CHAR.test(this.src[this.pos] as string)) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private decode(raw: string, at: number): string {
    if (!raw.includes('&')) return raw;
    return raw.replace(
      /&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);|&/g,
      (match, body: string | undefined, offset: number) => {
        if (body === undefined) this.fail('Esperluette non échappée', at + offset);
        switch (body) {
          case 'amp':
            return '&';
          case 'lt':
            return '<';
          case 'gt':
            return '>';
          case 'quot':
            return '"';
          case 'apos':
            return "'";
          default: {
            if (body.startsWith('#')) {
              const code =
                body[1] === 'x'
                  ? Number.parseInt(body.slice(2), 16)
                  : Number.parseInt(body.slice(1), 10);
              if (!Number.isFinite(code) || code < 0 || code > 0x10ffff)
                this.fail(`Référence de caractère invalide « ${match} »`, at + offset);
              return String.fromCodePoint(code);
            }
            return this.fail(
              `Entité inconnue « ${match} » (aucune DTD n'est acceptée)`,
              at + offset,
            );
          }
        }
      },
    );
  }

  /** Parse le prologue puis l'unique élément racine. */
  parse(): XmlNode {
    if (this.src.charCodeAt(0) === 0xfeff) this.pos = 1;
    let root: MutableNode | undefined;
    while (this.pos < this.src.length) {
      this.skipWs();
      if (this.pos >= this.src.length) break;
      if (this.startsWith('<?')) {
        this.skipPast('?>', 'Instruction de traitement non terminée');
      } else if (this.startsWith('<!--')) {
        this.skipPast('-->', 'Commentaire non terminé');
      } else if (this.startsWith('<!DOCTYPE') || this.startsWith('<!doctype')) {
        this.fail('DOCTYPE refusé (aucune DTD, ni entité externe, n’est acceptée)');
      } else if (this.startsWith('<')) {
        if (root) this.fail('Un seul élément racine est autorisé');
        root = this.parseElement([{ '': '', xml: XML_NS }], 0);
      } else {
        this.fail('Texte hors de l’élément racine');
      }
    }
    if (!root) this.fail('Document vide : aucun élément racine', 0);
    return root;
  }

  private skipPast(terminator: string, message: string): void {
    const end = this.src.indexOf(terminator, this.pos);
    if (end < 0) this.fail(message);
    this.pos = end + terminator.length;
  }

  private parseElement(scope: Record<string, string>[], depth: number): MutableNode {
    if (depth > this.maxDepth) this.fail(`Profondeur maximale dépassée (${this.maxDepth})`);
    const start = this.pos;
    this.pos++; // '<'
    const name = this.readName();
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      this.skipWs();
      if (this.startsWith('/>')) {
        selfClosing = true;
        this.pos += 2;
        break;
      }
      if (this.startsWith('>')) {
        this.pos++;
        break;
      }
      const attrName = this.readName();
      this.skipWs();
      if (this.src[this.pos] !== '=') this.fail(`« = » attendu après l'attribut ${attrName}`);
      this.pos++;
      this.skipWs();
      const quote = this.src[this.pos];
      if (quote !== '"' && quote !== "'")
        this.fail(`Valeur d'attribut non délimitée pour ${attrName}`);
      const valueStart = this.pos + 1;
      const valueEnd = this.src.indexOf(quote, valueStart);
      if (valueEnd < 0) this.fail(`Valeur d'attribut non terminée pour ${attrName}`);
      const raw = this.src.slice(valueStart, valueEnd);
      if (raw.includes('<'))
        this.fail(`« < » interdit dans la valeur de l'attribut ${attrName}`, valueStart);
      if (attrName in attrs) this.fail(`Attribut ${attrName} dupliqué`);
      attrs[attrName] = this.decode(raw, valueStart);
      this.pos = valueEnd + 1;
    }

    // Namespaces déclarés sur cet élément
    const parentScope = scope[scope.length - 1] as Record<string, string>;
    let localScope = parentScope;
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'xmlns') {
        localScope = localScope === parentScope ? { ...parentScope } : localScope;
        localScope[''] = value;
      } else if (key.startsWith('xmlns:')) {
        localScope = localScope === parentScope ? { ...parentScope } : localScope;
        localScope[key.slice(6)] = value;
      }
    }
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const local = colon < 0 ? name : name.slice(colon + 1);
    const ns = localScope[prefix];
    if (ns === undefined) this.fail(`Préfixe de namespace non déclaré « ${prefix} »`, start);

    const node: MutableNode = { ns, local, name, attrs, children: [], text: '' };
    if (selfClosing) return node;

    const nextScope = localScope === parentScope ? scope : [...scope, localScope];
    for (;;) {
      if (this.pos >= this.src.length) this.fail(`Élément <${name}> non fermé`, start);
      if (this.startsWith('</')) {
        const closeStart = this.pos;
        this.pos += 2;
        const closing = this.readName();
        if (closing !== name)
          this.fail(`Balise fermante </${closing}> inattendue, </${name}> attendue`, closeStart);
        this.skipWs();
        if (this.src[this.pos] !== '>') this.fail('« > » attendu');
        this.pos++;
        return node;
      }
      if (this.startsWith('<!--')) {
        this.skipPast('-->', 'Commentaire non terminé');
      } else if (this.startsWith('<![CDATA[')) {
        const end = this.src.indexOf(']]>', this.pos);
        if (end < 0) this.fail('Section CDATA non terminée');
        node.text += this.src.slice(this.pos + 9, end);
        this.pos = end + 3;
      } else if (this.startsWith('<?')) {
        this.skipPast('?>', 'Instruction de traitement non terminée');
      } else if (this.startsWith('<!')) {
        this.fail('Déclaration interdite dans le contenu');
      } else if (this.startsWith('<')) {
        node.children.push(this.parseElement(nextScope, depth + 1));
      } else {
        const end = this.src.indexOf('<', this.pos);
        const stop = end < 0 ? this.src.length : end;
        node.text += this.decode(this.src.slice(this.pos, stop), this.pos);
        this.pos = stop;
      }
    }
  }
}

/** Parse un document XML (chaîne ou octets UTF-8) en arbre d'éléments. */
export function parseXml(input: string | Uint8Array, options: ParseXmlOptions = {}): XmlNode {
  const src = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  return new Parser(src, options.maxDepth ?? 256).parse();
}
