import { escapeXmlAttr, escapeXmlText, XmlError } from './escape.js';

/** Élément XML immuable : nom qualifié, attributs, enfants (éléments ou texte). */
export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ReadonlyArray<XmlElement | string>;
}

/**
 * Enfant accepté par `el()` : élément, texte, ou valeur « vide » (`undefined`, `null`, `false`)
 * ignorée — ce qui permet d'écrire des templates conditionnels sans branches.
 * Les tableaux sont aplatis.
 */
export type XmlChild = XmlElement | string | undefined | null | false | readonly XmlChild[];

const NAME_PATTERN = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

function flatten(children: readonly XmlChild[], out: (XmlElement | string)[]): void {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) {
      flatten(child, out);
    } else {
      out.push(child as XmlElement | string);
    }
  }
}

/** Crée un élément sans attribut. */
export function el(name: string, ...children: XmlChild[]): XmlElement {
  return elA(name, {}, ...children);
}

/** Crée un élément avec attributs (les attributs `undefined` sont omis). */
export function elA(
  name: string,
  attrs: Readonly<Record<string, string | undefined>>,
  ...children: XmlChild[]
): XmlElement {
  if (!NAME_PATTERN.test(name)) throw new XmlError(`Nom d'élément invalide : "${name}".`);
  const cleanAttrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (!NAME_PATTERN.test(key)) throw new XmlError(`Nom d'attribut invalide : "${key}".`);
    cleanAttrs[key] = value;
  }
  const flat: (XmlElement | string)[] = [];
  flatten(children, flat);
  return { name, attrs: cleanAttrs, children: flat };
}

export interface SerializeOptions {
  /** Indentation sur 2 espaces, un élément par ligne (défaut : compact). */
  pretty?: boolean;
  /** Préfixer par `<?xml version="1.0" encoding="UTF-8"?>` (défaut : oui). */
  declaration?: boolean;
}

function openTag(node: XmlElement): string {
  let s = `<${node.name}`;
  for (const [key, value] of Object.entries(node.attrs)) s += ` ${key}="${escapeXmlAttr(value)}"`;
  return s;
}

function write(node: XmlElement, pretty: boolean, depth: number, out: string[]): void {
  const indent = pretty ? '  '.repeat(depth) : '';
  const eol = pretty ? '\n' : '';
  const open = openTag(node);
  if (node.children.length === 0) {
    out.push(`${indent}${open}/>${eol}`);
    return;
  }
  const textOnly = node.children.every((c) => typeof c === 'string');
  if (textOnly) {
    const text = node.children.map((c) => escapeXmlText(c as string)).join('');
    out.push(`${indent}${open}>${text}</${node.name}>${eol}`);
    return;
  }
  out.push(`${indent}${open}>${eol}`);
  for (const child of node.children) {
    if (typeof child === 'string') {
      out.push(`${pretty ? '  '.repeat(depth + 1) : ''}${escapeXmlText(child)}${eol}`);
    } else {
      write(child, pretty, depth + 1, out);
    }
  }
  out.push(`${indent}</${node.name}>${eol}`);
}

/** Sérialise un arbre en chaîne XML, de façon déterministe. */
export function serializeXml(root: XmlElement, options: SerializeOptions = {}): string {
  const pretty = options.pretty ?? false;
  const out: string[] = [];
  if (options.declaration ?? true)
    out.push(`<?xml version="1.0" encoding="UTF-8"?>${pretty ? '\n' : ''}`);
  write(root, pretty, 0, out);
  return out.join('');
}
