/**
 * Mise en page de la facture lisible, indépendante du PDF.
 *
 * Le résultat est une liste d'instructions de dessin par page — texte, filet, aplat, image — que
 * `renderInvoicePdf` peint avec pdf-lib, et qu'un aperçu peut peindre ailleurs (SVG, canvas) avec
 * les mêmes coordonnées : les mesures sont celles de la police qui sera embarquée, l'aperçu et le
 * PDF ne peuvent donc pas diverger. Chaque instruction porte le chemin du champ qu'elle représente
 * (`seller`, `lines[2].quantity`, `paymentTerms.dueDate`…), dans la syntaxe des chemins d'anomalie
 * de `validateInvoice` : un éditeur peut relier un clic sur l'aperçu au champ à corriger.
 *
 * Repère : celui du PDF — origine en bas à gauche, ordonnées croissantes vers le haut ; le `y`
 * d'un texte est sa ligne de base.
 *
 * Ce que le thème ne change jamais : les mentions obligatoires. Numéro, dates, identités et
 * identifiants des parties, nature de l'opération, date ou période de livraison, bon de commande,
 * facture d'origine, détail et taux de TVA, mentions d'exonération, option sur les débits,
 * autofacturation, échéance, pénalités, indemnité et escompte sont écrits quel que soit le modèle.
 */

import { type Cents, cents, type Rate } from '../money.js';
import { resolveNotes } from '../payment-terms.js';
import { isCreditNoteType, isSelfBilledType } from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import type { Line } from '../types/line.js';
import type { Party } from '../types/party.js';
import type { FontMetrics } from './fonts.js';
import { Formatter, type RenderLocale } from './format.js';
import type { FullRenderLabels } from './labels.js';
import type { Palette, RenderStyle, resolveTheme } from './theme.js';

// ---------- instructions ----------

export type LayoutFont = 'regular' | 'bold';

export interface LayoutText {
  kind: 'text';
  /** Abscisse du début du texte, alignement déjà appliqué. */
  x: number;
  /** Ligne de base, en points depuis le bas de la page. */
  y: number;
  text: string;
  size: number;
  font: LayoutFont;
  /** `#rrggbb`. */
  color: string;
  /** Largeur mesurée avec la police embarquée. */
  width: number;
  ref?: string;
}

export interface LayoutLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  ref?: string;
}

export interface LayoutRect {
  kind: 'rect';
  /** Coin inférieur gauche. */
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Rayon des angles ; absent : angles droits. */
  radius?: number;
  ref?: string;
}

export interface LayoutImage {
  kind: 'image';
  /** Coin inférieur gauche. */
  x: number;
  y: number;
  width: number;
  height: number;
  ref?: string;
}

/** Zone d'un bloc : rien n'est dessiné, elle sert aux aperçus interactifs. */
export interface LayoutArea {
  kind: 'area';
  /** Coin inférieur gauche. */
  x: number;
  y: number;
  width: number;
  height: number;
  ref: string;
}

export type LayoutOp = LayoutText | LayoutLine | LayoutRect | LayoutImage | LayoutArea;

export interface LayoutPage {
  width: number;
  height: number;
  ops: LayoutOp[];
}

/** Caractère que la police ne sait pas dessiner. */
export interface MissingGlyph {
  char: string;
  codePoint: number;
  /** Le texte où il apparaît. */
  text: string;
  /** Le champ d'où vient ce texte, quand il est connu. */
  ref?: string;
  font: LayoutFont;
}

/**
 * Mentions légales effectivement écrites sur la page. Une mention absente de la liste n'avait
 * pas lieu d'être (pas de bon de commande, pas d'exonération…) : l'absence d'une mention
 * obligatoire dans les données relève de `validateInvoice`, pas du rendu.
 */
export type PrintedMention =
  | 'title'
  | 'number'
  | 'issueDate'
  | 'seller'
  | 'sellerId'
  | 'sellerVatId'
  | 'sellerLegalInfo'
  | 'buyer'
  | 'buyerId'
  | 'buyerVatId'
  | 'deliveryDate'
  | 'deliveryAddress'
  | 'operationCategory'
  | 'purchaseOrder'
  | 'precedingInvoices'
  | 'selfBilling'
  | 'lines'
  | 'vatBreakdown'
  | 'vatExemption'
  | 'vatOnDebits'
  | 'taxPointDate'
  | 'totals'
  | 'prepaid'
  | 'dueDate'
  | 'latePenalty'
  | 'recoveryIndemnity'
  | 'earlyPaymentDiscount'
  | 'paymentTerms'
  | 'paymentMeans';

export interface InvoiceLayout {
  pages: LayoutPage[];
  /** Titre du document, repris dans les métadonnées du PDF. */
  title: string;
  /** Caractères absents de la police : le PDF serait refusé comme PDF/A. Vide si tout s'écrit. */
  missingGlyphs: MissingGlyph[];
  /** Mentions légales écrites, dans l'ordre de la page. */
  mentions: PrintedMention[];
}

/** Ce que l'appelant choisit d'afficher en plus des mentions obligatoires. */
export interface RenderDisplay {
  /** Numéro de ligne en première colonne. Défaut : non. */
  lineNumbers?: boolean;
  /** Références d'article (vendeur, acheteur, EAN, origine…) sous la désignation. Défaut : oui. */
  itemDetails?: boolean;
  /** Contacts des parties : nom, téléphone, e-mail. Défaut : oui. */
  contacts?: boolean;
  /** Adresses électroniques de routage des parties (schéma 0225…). Défaut : non. */
  electronicAddresses?: boolean;
  /** Coordonnées de paiement : IBAN, BIC, mandat de prélèvement. Défaut : oui. */
  paymentDetails?: boolean;
  /**
   * Références facultatives : contrat, projet, commande vendeur, avis, lot… Le bon de commande et
   * la facture d'origine, mentions obligatoires, sont écrits dans tous les cas. Défaut : oui.
   */
  references?: boolean;
  /** Mention « Facture électronique Factur-X » en fin de document. Défaut : non. */
  facturxNotice?: boolean;
}

export const DEFAULT_DISPLAY: Readonly<Required<RenderDisplay>> = {
  lineNumbers: false,
  itemDetails: true,
  contacts: true,
  electronicAddresses: false,
  paymentDetails: true,
  references: true,
  facturxNotice: false,
};

export interface LayoutInput {
  invoice: Invoice;
  fonts: { regular: FontMetrics; bold: FontMetrics };
  labels: FullRenderLabels;
  locale: RenderLocale;
  theme: ReturnType<typeof resolveTheme>;
  display: Required<RenderDisplay>;
  footer?: string;
  /** Dimensions intrinsèques du logo, s'il y en a un. */
  logo?: { width: number; height: number };
}

// ---------- gabarits ----------

interface Sizes {
  margin: number;
  body: number;
  small: number;
  tiny: number;
  name: number;
  title: number;
  number: number;
  due: number;
  /** Interlignage, en proportion du corps. */
  lead: number;
  gap: number;
  rowPad: number;
}

const SIZES: Record<RenderStyle['density'], Sizes> = {
  comfortable: {
    margin: 48,
    body: 9,
    small: 8,
    tiny: 6.8,
    name: 10.5,
    title: 22,
    number: 11,
    due: 12.5,
    lead: 1.38,
    gap: 20,
    rowPad: 6,
  },
  compact: {
    margin: 36,
    body: 8.3,
    small: 7.4,
    tiny: 6.3,
    name: 9.5,
    title: 18,
    number: 10,
    due: 11.5,
    lead: 1.3,
    gap: 13,
    rowPad: 3.5,
  },
};

/** Distance entre le haut d'une ligne de texte et sa ligne de base, en proportion du corps. */
const CAP = 0.8;
/** Place laissée sous la ligne de base de la dernière ligne, en proportion du corps. */
const DESCENT = 0.28;
const COLUMN_GAP = 14;

/** Caractères de contrôle, jamais dessinés ; sauts de ligne et tabulations sont traités avant. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: c'est précisément leur rôle.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * Retire les caractères de contrôle ; tabulation et retour chariot deviennent espace et saut, comme
 * les séparateurs de ligne et de paragraphe Unicode (que pdf-lib remplacerait sinon par des espaces,
 * faussant la mesure).
 */
function clean(text: string): string {
  return text
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '');
}

/**
 * Replis typographiques : un signe que la police ne dessine pas est remplacé par son équivalent
 * simple — apostrophe courbe par apostrophe droite, tiret long par tiret, espace fine par espace.
 * Le sens ne change pas, et une police sobre (sans `’` ni `€`) reste utilisable. Un caractère sans
 * repli (emoji, idéogramme…) est relevé dans `missingGlyphs`, jamais remplacé en silence.
 */
const FALLBACK = new Map<string, string>(
  (
    [
      [0x202f, 0x00a0], // espace fine insécable → insécable
      [0x00a0, 0x20], // insécable → espace
      [0x2009, 0x20], // espace fine
      [0x2007, 0x20], // espace tabulaire
      [0x2019, 0x27], // ’
      [0x2018, 0x27], // ‘
      [0x201c, 0x22], // “
      [0x201d, 0x22], // ”
      [0x00ab, 0x22], // «
      [0x00bb, 0x22], // »
      [0x2013, 0x2d], // –
      [0x2014, 0x2d], // —
      [0x2212, 0x2d], // − (moins)
      [0x2011, 0x2d], // trait d'union insécable
      [0x00b7, 0x2d], // ·
      [0x2022, 0x2d], // •
      [0x00d7, 0x78], // ×
      [0x00b2, 0x32], // ²
      [0x00b3, 0x33], // ³
      [0x2026, '...'], // …
      [0x20ac, 'EUR'], // €
    ] as [number, number | string][]
  ).map(([from, to]) => [
    String.fromCodePoint(from),
    typeof to === 'number' ? String.fromCodePoint(to) : to,
  ]),
);

/** Applique les replis typographiques pour une police donnée. */
function typeset(text: string, metrics: FontMetrics): string {
  let out = '';
  for (const char of text) {
    let current = char;
    // Deux sauts au plus : espace fine → insécable → espace.
    for (let hop = 0; hop < 2 && current.length === 1 && !metrics.has(current); hop++) {
      const next = FALLBACK.get(current);
      if (next === undefined) break;
      current = next;
    }
    out += current;
  }
  return out;
}

interface TextStyle {
  size: number;
  font?: LayoutFont;
  color?: string;
  align?: 'left' | 'right' | 'center';
  ref?: string | undefined;
}

// ---------- composition ----------

class Composer {
  readonly pages: LayoutPage[] = [];
  readonly missing: MissingGlyph[] = [];
  readonly mentions: PrintedMention[] = [];
  /** Page où s'écrivent les instructions. */
  page!: LayoutPage;
  /** Haut de l'espace libre sur la page courante. */
  y = 0;
  /** Redessine l'en-tête du tableau quand une ligne passe à la page suivante. */
  onBreak: (() => void) | undefined;
  readonly s: Sizes;
  readonly p: Palette;
  readonly style: RenderStyle;
  readonly fmt: Formatter;
  readonly W: number;
  readonly H: number;
  readonly M: number;
  /** Largeur utile. */
  readonly CW: number;
  readonly title: string;
  private readonly seen = new Set<string>();

  constructor(readonly input: LayoutInput) {
    const { theme, locale, fonts, labels, invoice } = input;
    this.s = SIZES[theme.style.density];
    this.p = theme.palette;
    this.style = theme.style;
    this.W = theme.page.width;
    this.H = theme.page.height;
    this.M = this.s.margin;
    this.CW = this.W - 2 * this.M;
    const both = (c: string) => fonts.regular.has(c) && fonts.bold.has(c);
    // Séparateur de milliers : espace fine insécable si la police l'a, sinon insécable, sinon espace.
    const group = ['\u202F', '\u00A0', ' '].find(both) ?? ' ';
    this.fmt = new Formatter(locale, { group }, both);
    this.title = labels.invoice[invoice.typeCode] ?? labels.invoice['380'] ?? 'Facture';
  }

  // ----- pages -----

  /** Limite basse du contenu : le pied de page vit en dessous. */
  get bottom(): number {
    return this.M + 18;
  }

  newPage(): void {
    this.page = { width: this.W, height: this.H, ops: [] };
    this.pages.push(this.page);
    this.y = this.H - this.M;
    if (this.pages.length > 1) this.drawContinuation();
  }

  /** Garantit `needed` points libres ; sinon page suivante, et en-tête de tableau s'il y a lieu. */
  ensure(needed: number): void {
    if (this.y - needed >= this.bottom) return;
    this.newPage();
    this.onBreak?.();
  }

  /** Hauteur utile d'une page de suite. */
  get pageCapacity(): number {
    return this.H - this.M - this.bottom - 40;
  }

  /** Écrit sur une autre page que la page courante (pieds de page, une fois le total connu). */
  onPage(page: LayoutPage, draw: () => void): void {
    const current = this.page;
    this.page = page;
    draw();
    this.page = current;
  }

  private drawContinuation(): void {
    const { labels, invoice } = this.input;
    this.text(labels.continued(this.title, invoice.id), this.M, this.y - this.s.small * CAP, {
      size: this.s.small,
      color: this.p.muted,
      ref: 'id',
    });
    this.y -= this.s.small * 1.2 + 6;
    this.rule(this.M, this.M + this.CW, this.y);
    this.y -= this.s.gap * 0.7;
  }

  // ----- primitives -----

  mention(id: PrintedMention): void {
    if (!this.mentions.includes(id)) this.mentions.push(id);
  }

  fontOf(font: LayoutFont): FontMetrics {
    return font === 'bold' ? this.input.fonts.bold : this.input.fonts.regular;
  }

  width(text: string, size: number, font: LayoutFont = 'regular'): number {
    const metrics = this.fontOf(font);
    return metrics.width(typeset(clean(text).replace(/\n/g, ' '), metrics), size);
  }

  /** Écrit une ligne de texte ; relève les caractères que la police ne sait pas dessiner. */
  text(raw: string, x: number, y: number, style: TextStyle): number {
    const font = style.font ?? 'regular';
    const metrics = this.fontOf(font);
    const text = typeset(clean(raw).replace(/\n/g, ' '), metrics);
    if (text === '') return 0;
    for (const char of new Set(text)) {
      if (metrics.has(char)) continue;
      const key = `${char}\u0000${style.ref ?? ''}\u0000${font}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const entry: MissingGlyph = { char, codePoint: char.codePointAt(0) ?? 0, text, font };
      if (style.ref !== undefined) entry.ref = style.ref;
      this.missing.push(entry);
    }
    const width = metrics.width(text, style.size);
    const left = style.align === 'right' ? x - width : style.align === 'center' ? x - width / 2 : x;
    const op: LayoutText = {
      kind: 'text',
      x: left,
      y,
      text,
      size: style.size,
      font,
      color: style.color ?? this.p.ink,
      width,
    };
    if (style.ref !== undefined) op.ref = style.ref;
    this.page.ops.push(op);
    return width;
  }

  rule(x1: number, x2: number, y: number, color = this.p.rule, width = 0.5): void {
    this.page.ops.push({ kind: 'line', x1, y1: y, x2, y2: y, width, color });
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    paint: { fill?: string; stroke?: string; ref?: string; rounded?: boolean },
  ): void {
    const op: LayoutRect = { kind: 'rect', x, y, width, height };
    if (paint.fill) op.fill = paint.fill;
    if (paint.stroke) {
      op.stroke = paint.stroke;
      op.strokeWidth = 0.75;
    }
    if (paint.rounded !== false && this.style.corners === 'rounded') {
      op.radius = Math.min(5, height / 2, width / 2);
    }
    if (paint.ref !== undefined) op.ref = paint.ref;
    this.page.ops.push(op);
  }

  image(x: number, y: number, width: number, height: number): void {
    this.page.ops.push({ kind: 'image', x, y, width, height, ref: 'logo' });
  }

  /** Zone d'un bloc, de `top` à `bottom`. */
  area(x: number, top: number, width: number, bottom: number, ref: string): void {
    if (top - bottom <= 0 || width <= 0) return;
    this.page.ops.push({ kind: 'area', x, y: bottom, width, height: top - bottom, ref });
  }

  /** Découpe un texte pour qu'aucune ligne ne dépasse `maxWidth`. Coupe un mot trop long. */
  wrap(raw: string, size: number, maxWidth: number, font: LayoutFont = 'regular'): string[] {
    const metrics = this.fontOf(font);
    const lines: string[] = [];
    for (const paragraph of typeset(clean(raw), metrics).split('\n')) {
      let current = '';
      for (const word of paragraph.split(/ +/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (metrics.width(candidate, size) <= maxWidth) {
          current = candidate;
          continue;
        }
        if (current) lines.push(current);
        // Un mot plus large que la colonne est coupé, par caractère entier (jamais au milieu
        // d'une paire de substitution UTF-16).
        let rest = [...word];
        while (rest.length > 1 && metrics.width(rest.join(''), size) > maxWidth) {
          let cut = rest.length;
          while (cut > 1 && metrics.width(rest.slice(0, cut).join(''), size) > maxWidth) cut--;
          lines.push(rest.slice(0, cut).join(''));
          rest = rest.slice(cut);
        }
        current = rest.join('');
      }
      lines.push(current);
    }
    // Un paragraphe vide au milieu reste une ligne blanche ; en fin de texte, il ne sert à rien.
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /** Hauteur d'un paragraphe de `n` lignes. */
  blockHeight(n: number, size: number): number {
    return n <= 0 ? 0 : size * CAP + (n - 1) * size * this.s.lead + size * DESCENT;
  }

  /** Écrit des lignes à partir de `top` ; renvoie le bas du bloc. */
  lines(lines: readonly string[], x: number, top: number, style: TextStyle): number {
    const lead = style.size * this.s.lead;
    lines.forEach((l, i) => {
      this.text(l, x, top - style.size * CAP - i * lead, style);
    });
    return top - this.blockHeight(lines.length, style.size);
  }

  /** Petite étiquette en capitales au-dessus d'un bloc ; renvoie le haut du contenu qui suit. */
  caption(
    text: string,
    x: number,
    top: number,
    color: string,
    align: TextStyle['align'] = 'left',
  ): number {
    this.text(text.toLocaleUpperCase(this.input.locale), x, top - this.s.tiny * CAP, {
      size: this.s.tiny,
      font: 'bold',
      color,
      align,
    });
    return top - this.captionHeight;
  }

  get captionHeight(): number {
    return this.s.tiny * 1.25 + 5;
  }
}

// ---------- parties ----------

/** Une ligne d'adresse ou d'identité, avec le champ qu'elle représente. */
interface InfoLine {
  text: string;
  ref: string;
  mention?: PrintedMention;
}

function partyLines(c: Composer, party: Party, path: 'seller' | 'buyer'): InfoLine[] {
  const { labels, display } = c.input;
  const fmt = c.fmt;
  const out: InfoLine[] = [];
  if (party.tradingName && party.tradingName !== party.name) {
    out.push({ text: party.tradingName, ref: `${path}.tradingName` });
  }
  out.push(...addressLines(c, party.address, `${path}.address`));
  const idMention: PrintedMention = path === 'seller' ? 'sellerId' : 'buyerId';
  if (party.siret) {
    out.push({
      text: `${labels.ids.siret} ${fmt.registration(party.siret)}`,
      ref: `${path}.siret`,
      mention: idMention,
    });
  } else if (party.siren) {
    out.push({
      text: `${labels.ids.siren} ${fmt.registration(party.siren)}`,
      ref: `${path}.siren`,
      mention: idMention,
    });
  }
  if (party.vatId) {
    out.push({
      text: `${labels.ids.vat} ${party.vatId}`,
      ref: `${path}.vatId`,
      mention: path === 'seller' ? 'sellerVatId' : 'buyerVatId',
    });
  }
  if (path === 'seller' && party.taxRegistrationId) {
    out.push({
      text: `${labels.ids.taxRegistration} ${party.taxRegistrationId}`,
      ref: 'seller.taxRegistrationId',
    });
  }
  if (path === 'seller' && party.legalInfo) {
    out.push({ text: party.legalInfo, ref: 'seller.legalInfo', mention: 'sellerLegalInfo' });
  }
  if (display.contacts && party.contact) {
    const contact = [party.contact.name, party.contact.phone, party.contact.email]
      .filter(Boolean)
      .join(' · ');
    if (contact) out.push({ text: contact, ref: `${path}.contact` });
  }
  if (display.electronicAddresses && party.electronicAddress?.value) {
    const ea = party.electronicAddress;
    out.push({
      text: `${labels.ids.electronicAddress} ${ea.value} (${ea.scheme})`,
      ref: `${path}.electronicAddress`,
    });
  }
  return out;
}

function addressLines(c: Composer, a: Party['address'] | undefined, path: string): InfoLine[] {
  if (!a) return [];
  const out: InfoLine[] = [];
  for (const key of ['line1', 'line2', 'line3'] as const) {
    const value = a[key];
    if (value) out.push({ text: value, ref: `${path}.${key}` });
  }
  const city = [a.postCode, a.city].filter(Boolean).join(' ');
  if (city) out.push({ text: city, ref: `${path}.city` });
  if (a.countrySubdivision)
    out.push({ text: a.countrySubdivision, ref: `${path}.countrySubdivision` });
  // Le pays s'écrit quand il n'est pas la France : c'est l'usage d'une facture française.
  if (a.countryCode && a.countryCode !== 'FR') {
    out.push({
      text: c.input.labels.countries[a.countryCode] ?? a.countryCode,
      ref: `${path}.countryCode`,
    });
  }
  return out;
}

interface Block {
  caption: string;
  name?: string;
  nameRef?: string;
  lines: InfoLine[];
  ref: string;
  mention?: PrintedMention;
}

function partyBlock(c: Composer, party: Party, path: 'seller' | 'buyer'): Block {
  const { labels } = c.input;
  return {
    caption: path === 'seller' ? labels.seller : labels.buyer,
    name: party.name,
    nameRef: `${path}.name`,
    lines: partyLines(c, party, path),
    ref: path,
    mention: path,
  };
}

function deliveryBlock(c: Composer): Block | undefined {
  const { invoice, labels } = c.input;
  const d = invoice.delivery;
  if (!d?.address && !d?.partyName) return undefined;
  const lines = addressLines(c, d.address, 'delivery.address');
  if (d.locationId) lines.push({ text: d.locationId, ref: 'delivery.locationId' });
  const block: Block = {
    caption: d.address ? labels.deliveryAddress : labels.delivery,
    lines,
    ref: 'delivery',
  };
  if (d.address) block.mention = 'deliveryAddress';
  if (d.partyName) {
    block.name = d.partyName;
    block.nameRef = 'delivery.partyName';
  }
  return block;
}

function payeeBlock(c: Composer): Block | undefined {
  const { invoice, labels } = c.input;
  const payee = invoice.payee;
  if (!payee?.name) return undefined;
  const lines: InfoLine[] = [];
  if (payee.id) {
    // BT-60 porte le plus souvent un SIRET : on le nomme quand il en a la forme.
    const text = /^\d{14}$/.test(payee.id)
      ? `${labels.ids.siret} ${c.fmt.registration(payee.id)}`
      : payee.id;
    lines.push({ text, ref: 'payee.id' });
  }
  if (payee.legalId) {
    lines.push({
      text: `${labels.ids.siren} ${c.fmt.registration(payee.legalId)}`,
      ref: 'payee.legalId',
    });
  }
  return { caption: labels.payee, name: payee.name, nameRef: 'payee.name', lines, ref: 'payee' };
}

/** Hauteur d'un bloc posé dans une colonne de largeur `width`. */
function measureBlock(c: Composer, block: Block, width: number): number {
  let h = c.captionHeight;
  if (block.name)
    h += c.blockHeight(c.wrap(block.name, c.s.name, width, 'bold').length, c.s.name) + 2;
  for (const l of block.lines) h += c.wrap(l.text, c.s.body, width).length * c.s.body * c.s.lead;
  return h;
}

/** Dessine un bloc à partir de `top` ; renvoie son bas. */
function drawBlock(
  c: Composer,
  block: Block,
  x: number,
  top: number,
  width: number,
  captionColor: string,
): number {
  let y = c.caption(block.caption, x, top, captionColor);
  if (block.name) {
    y = c.lines(c.wrap(block.name, c.s.name, width, 'bold'), x, y, {
      size: c.s.name,
      font: 'bold',
      ref: block.nameRef,
    });
    y -= 2;
  }
  for (const l of block.lines) {
    const pieces = c.wrap(l.text, c.s.body, width);
    pieces.forEach((piece, i) => {
      c.text(piece, x, y - c.s.body * CAP - i * c.s.body * c.s.lead, {
        size: c.s.body,
        color: c.p.muted,
        ref: l.ref,
      });
    });
    y -= pieces.length * c.s.body * c.s.lead;
    if (l.mention) c.mention(l.mention);
  }
  if (block.mention) c.mention(block.mention);
  return y;
}

/** Pose une rangée de blocs côte à côte ; en cartes teintées de même hauteur si le style le veut. */
function drawBlockRow(c: Composer, blocks: Block[], x0: number, totalWidth: number): void {
  if (blocks.length === 0) return;
  const boxed = c.style.parties === 'boxed';
  const pad = boxed ? 10 : 0;
  const gutter = 24;
  const colWidth = (totalWidth - gutter * (blocks.length - 1)) / blocks.length;
  const inner = colWidth - 2 * pad;
  const height = Math.max(...blocks.map((b) => measureBlock(c, b, inner))) + 2 * pad;
  c.ensure(height);
  const top = c.y;
  blocks.forEach((block, i) => {
    const x = x0 + i * (colWidth + gutter);
    if (boxed) c.rect(x, top - height, colWidth, height, { fill: c.p.tint });
    drawBlock(c, block, x + pad, top - pad, inner, boxed ? c.p.accentOnTint : c.p.muted);
    c.area(x, top, colWidth, top - height, block.ref);
  });
  c.y = top - height;
}

/** Livraison et bénéficiaire du paiement, sous les parties, quand ils existent. */
function drawSecondaryBlocks(c: Composer): void {
  const blocks = [deliveryBlock(c), payeeBlock(c)].filter((b): b is Block => b !== undefined);
  if (blocks.length === 0) return;
  c.y -= c.s.gap * 0.7;
  drawBlockRow(c, blocks, c.M, blocks.length === 1 ? c.CW / 2 - 12 : c.CW);
}

// ---------- en-tête ----------

interface KeyValue {
  label: string;
  value: string;
  ref: string;
  mention?: PrintedMention;
}

/** Dates et référence de tête : émission, échéance, livraison ou période, référence acheteur. */
function headerPairs(c: Composer): KeyValue[] {
  const { invoice, labels } = c.input;
  const fmt = c.fmt;
  const out: KeyValue[] = [
    {
      label: labels.issueDate,
      value: fmt.date(invoice.issueDate ?? ''),
      ref: 'issueDate',
      mention: 'issueDate',
    },
  ];
  if (invoice.paymentTerms?.dueDate) {
    out.push({
      label: labels.dueDate,
      value: fmt.date(invoice.paymentTerms.dueDate),
      ref: 'paymentTerms.dueDate',
      mention: 'dueDate',
    });
  }
  const d = invoice.delivery;
  if (d?.date) {
    out.push({
      label: labels.delivery,
      value: fmt.date(d.date),
      ref: 'delivery.date',
      mention: 'deliveryDate',
    });
  }
  const start = d?.period?.start;
  const end = d?.period?.end;
  if (start || end) {
    const value =
      start && end ? `${fmt.date(start)} – ${fmt.date(end)}` : fmt.date((start ?? end) as string);
    out.push({ label: labels.period, value, ref: 'delivery.period', mention: 'deliveryDate' });
  }
  if (invoice.buyerReference) {
    out.push({ label: labels.reference, value: invoice.buyerReference, ref: 'buyerReference' });
  }
  return out;
}

/** Titre et numéro, alignés à gauche ou à droite ; renvoie le bas du bloc. */
function drawTitle(
  c: Composer,
  x: number,
  top: number,
  align: 'left' | 'right',
  color: string,
  numberColor: string,
): number {
  const { invoice, labels } = c.input;
  const title = c.style.titleCase === 'upper' ? c.title.toLocaleUpperCase(c.input.locale) : c.title;
  let y = top;
  c.text(title, x, y - c.s.title * CAP, {
    size: c.s.title,
    font: 'bold',
    color,
    align,
    ref: 'typeCode',
  });
  c.mention('title');
  y -= c.s.title * 1.12;
  c.text(`${labels.number} ${invoice.id}`, x, y - c.s.number * CAP, {
    size: c.s.number,
    font: 'bold',
    color: numberColor,
    align,
    ref: 'id',
  });
  c.mention('number');
  y -= c.s.number * 1.3;
  if (isSelfBilledType(invoice.typeCode)) {
    y -= 2;
    c.text(labels.selfBilling, x, y - c.s.body * CAP, {
      size: c.s.body,
      font: 'bold',
      color,
      align,
      ref: 'typeCode',
    });
    c.mention('selfBilling');
    y -= c.s.body * 1.3;
  }
  return y;
}

function titleHeight(c: Composer): number {
  return (
    c.s.title * 1.12 +
    c.s.number * 1.3 +
    (isSelfBilledType(c.input.invoice.typeCode) ? c.s.body * 1.3 + 2 : 0)
  );
}

/** Paires libellé / valeur alignées sur le bord droit ; renvoie le bas du bloc. */
function drawPairsRight(c: Composer, pairs: KeyValue[], right: number, top: number): number {
  const valueWidth = Math.max(0, ...pairs.map((p) => c.width(p.value, c.s.body)));
  const labelWidth = Math.max(0, ...pairs.map((p) => c.width(p.label, c.s.small)));
  const lead = c.s.body * 1.55;
  let y = top;
  for (const pair of pairs) {
    const base = y - c.s.body * CAP;
    c.text(pair.label, right - valueWidth - 12, base, {
      size: c.s.small,
      color: c.p.muted,
      align: 'right',
      ref: pair.ref,
    });
    c.text(pair.value, right, base, { size: c.s.body, align: 'right', ref: pair.ref });
    c.area(
      right - valueWidth - 12 - labelWidth,
      y,
      valueWidth + 12 + labelWidth,
      y - lead,
      pair.ref,
    );
    if (pair.mention) c.mention(pair.mention);
    y -= lead;
  }
  return y;
}

/** Dimensions du logo à l'échelle : hauteur du thème, largeur bornée à 200 points. */
function logoBox(c: Composer): { width: number; height: number } | undefined {
  const logo = c.input.logo;
  if (!logo || logo.width <= 0 || logo.height <= 0) return undefined;
  const ratio = logo.width / logo.height;
  const width = Math.min(ratio * c.input.theme.logo.height, 200);
  return { width, height: width / ratio };
}

function drawHeaderPlain(c: Composer): void {
  const { invoice } = c.input;
  const top = c.y;
  const logo = logoBox(c);
  let leftTop = top;
  let rightTop = top;
  if (logo) {
    if (c.input.theme.logo.position === 'right') {
      c.image(c.M + c.CW - logo.width, top - logo.height, logo.width, logo.height);
      rightTop = top - logo.height - 14;
    } else {
      c.image(c.M, top - logo.height, logo.width, logo.height);
      leftTop = top - logo.height - 16;
    }
  }
  const leftBottom = drawTitle(c, c.M, leftTop, 'left', c.p.accentText, c.p.ink);
  c.area(c.M, leftTop, c.CW / 2, leftBottom, 'id');
  const rightBottom = drawPairsRight(c, headerPairs(c), c.M + c.CW, rightTop - 2);
  c.y = Math.min(leftBottom, rightBottom) - c.s.gap;
  drawBlockRow(
    c,
    [partyBlock(c, invoice.seller, 'seller'), partyBlock(c, invoice.buyer, 'buyer')],
    c.M,
    c.CW,
  );
  drawSecondaryBlocks(c);
}

function drawHeaderBand(c: Composer): void {
  const { invoice } = c.input;
  const logo = logoBox(c);
  const bandHeight = Math.max(
    c.style.density === 'compact' ? 80 : 98,
    logo ? logo.height + 40 : 0,
    titleHeight(c) + 36,
  );
  const bandBottom = c.H - bandHeight;
  c.rect(0, bandBottom, c.W, bandHeight, { fill: c.p.accent, rounded: false });
  const middle = bandBottom + bandHeight / 2;

  // À gauche : le logo sur une pastille blanche (un logo sombre disparaîtrait sur l'accent), puis l'émetteur.
  let x = c.M;
  if (logo) {
    const chip = 6;
    c.rect(
      x - chip,
      middle - logo.height / 2 - chip,
      logo.width + 2 * chip,
      logo.height + 2 * chip,
      {
        fill: '#ffffff',
      },
    );
    c.image(x, middle - logo.height / 2, logo.width, logo.height);
    x += logo.width + chip + 14;
  }
  const nameSize = c.s.name + 2;
  const names = c
    .wrap(invoice.seller.name, nameSize, Math.max(80, c.W / 2 - x), 'bold')
    .slice(0, 3);
  c.lines(names, x, middle + c.blockHeight(names.length, nameSize) / 2, {
    size: nameSize,
    font: 'bold',
    color: c.p.onAccent,
    ref: 'seller.name',
  });

  // À droite : le titre et le numéro.
  drawTitle(c, c.M + c.CW, middle + titleHeight(c) / 2, 'right', c.p.onAccent, c.p.onAccent);
  c.area(c.W / 2, c.H, c.W / 2, bandBottom, 'id');
  c.y = bandBottom - c.s.gap * 0.9;

  // Les dates, en rangée sous l'aplat : chaque cellule prend la largeur de son contenu, l'espace
  // restant est réparti, et une rangée trop pleine continue sur la suivante.
  const pairs = headerPairs(c);
  const natural = pairs.map(
    (p) =>
      Math.max(
        c.width(p.label.toLocaleUpperCase(c.input.locale), c.s.tiny, 'bold'),
        c.width(p.value, c.s.body, 'bold'),
      ) +
      COLUMN_GAP * 1.5,
  );
  const rows: number[][] = [[]];
  let used = 0;
  natural.forEach((w, i) => {
    const row = rows[rows.length - 1] as number[];
    if (row.length > 0 && used + w > c.CW) {
      rows.push([i]);
      used = w;
    } else {
      row.push(i);
      used += w;
    }
  });
  const rowHeight = c.captionHeight + c.s.body * 1.3 + 6;
  for (const row of rows) {
    const top = c.y;
    const spare = Math.max(0, c.CW - row.reduce((sum, i) => sum + (natural[i] as number), 0));
    const extra = rows.length === 1 && row.length < 3 ? 0 : spare / row.length;
    let cx = c.M;
    for (const i of row) {
      const pair = pairs[i] as KeyValue;
      const width = (natural[i] as number) + extra;
      const y = c.caption(pair.label, cx, top, c.p.accentText);
      c.text(pair.value, cx, y - c.s.body * CAP, { size: c.s.body, font: 'bold', ref: pair.ref });
      c.area(cx, top, width, top - rowHeight, pair.ref);
      if (pair.mention) c.mention(pair.mention);
      cx += width;
    }
    c.y = top - rowHeight;
  }
  c.y -= 2;
  c.rule(c.M, c.M + c.CW, c.y);
  c.y -= c.s.gap;
  drawBlockRow(
    c,
    [partyBlock(c, invoice.seller, 'seller'), partyBlock(c, invoice.buyer, 'buyer')],
    c.M,
    c.CW,
  );
  drawSecondaryBlocks(c);
}

function drawHeaderLetterhead(c: Composer): void {
  const { invoice } = c.input;
  const top = c.y;
  const logo = logoBox(c);
  const half = c.CW / 2 - 12;
  let leftTop = top;
  let rightTop = top;
  if (logo) {
    if (c.input.theme.logo.position === 'right') {
      c.image(c.M + c.CW - logo.width, top - logo.height, logo.width, logo.height);
      rightTop = top - logo.height - 14;
    } else {
      c.image(c.M, top - logo.height, logo.width, logo.height);
      leftTop = top - logo.height - 12;
    }
  }

  // L'émetteur en papier à en-tête : son nom dans la couleur, puis adresse et identifiants.
  const nameSize = c.s.name + 2;
  let y = c.lines(c.wrap(invoice.seller.name, nameSize, half, 'bold'), c.M, leftTop, {
    size: nameSize,
    font: 'bold',
    color: c.p.accentText,
    ref: 'seller.name',
  });
  y -= 3;
  for (const l of partyLines(c, invoice.seller, 'seller')) {
    const pieces = c.wrap(l.text, c.s.small, half);
    pieces.forEach((piece, i) => {
      c.text(piece, c.M, y - c.s.small * CAP - i * c.s.small * c.s.lead, {
        size: c.s.small,
        color: c.p.muted,
        ref: l.ref,
      });
    });
    y -= pieces.length * c.s.small * c.s.lead;
    if (l.mention) c.mention(l.mention);
  }
  c.mention('seller');
  c.area(c.M, leftTop, half, y, 'seller');

  const titleBottom = drawTitle(c, c.M + c.CW, rightTop, 'right', c.p.accentText, c.p.ink);
  c.area(c.M + c.CW - half, rightTop, half, titleBottom, 'id');
  const pairsBottom = drawPairsRight(c, headerPairs(c), c.M + c.CW, titleBottom - 6);
  c.y = Math.min(y, pairsBottom) - c.s.gap;

  // Le client à droite, là où l'on attend la fenêtre d'une enveloppe ; livraison et bénéficiaire en regard.
  const boxed = c.style.parties === 'boxed';
  const pad = boxed ? 10 : 0;
  const colWidth = c.CW / 2 - 12;
  const inner = colWidth - 2 * pad;
  const buyer = partyBlock(c, invoice.buyer, 'buyer');
  const others = [deliveryBlock(c), payeeBlock(c)].filter((b): b is Block => b !== undefined);
  const buyerHeight = measureBlock(c, buyer, inner) + 2 * pad;
  const othersHeight = others.reduce((h, b) => h + measureBlock(c, b, inner) + 2 * pad + 10, 0);
  c.ensure(Math.max(buyerHeight, othersHeight));
  const rowTop = c.y;
  const bx = c.M + c.CW - colWidth;
  if (boxed) c.rect(bx, rowTop - buyerHeight, colWidth, buyerHeight, { fill: c.p.tint });
  drawBlock(c, buyer, bx + pad, rowTop - pad, inner, boxed ? c.p.accentOnTint : c.p.muted);
  c.area(bx, rowTop, colWidth, rowTop - buyerHeight, 'buyer');
  let ly = rowTop;
  for (const block of others) {
    const h = measureBlock(c, block, inner) + 2 * pad;
    if (boxed) c.rect(c.M, ly - h, colWidth, h, { fill: c.p.tint });
    drawBlock(c, block, c.M + pad, ly - pad, inner, boxed ? c.p.accentOnTint : c.p.muted);
    c.area(c.M, ly, colWidth, ly - h, block.ref);
    ly -= h + 10;
  }
  c.y = Math.min(rowTop - buyerHeight, others.length ? ly + 10 : rowTop);
}

// ---------- références ----------

function infoCells(c: Composer): KeyValue[] {
  const { invoice, labels, display } = c.input;
  const out: KeyValue[] = [];
  if (invoice.operationCategory) {
    out.push({
      label: labels.operation,
      value: labels.operations[invoice.operationCategory] ?? invoice.operationCategory,
      ref: 'operationCategory',
      mention: 'operationCategory',
    });
  }
  const refs = invoice.references ?? {};
  if (refs.purchaseOrder) {
    out.push({
      label: labels.references.purchaseOrder,
      value: refs.purchaseOrder,
      ref: 'references.purchaseOrder',
      mention: 'purchaseOrder',
    });
  }
  if (refs.precedingInvoices?.length) {
    out.push({
      label: labels.precedingInvoices,
      value: refs.precedingInvoices
        .map((p) => labels.invoiceRef(p.id, p.issueDate ? c.fmt.date(p.issueDate) : undefined))
        .join(', '),
      ref: 'references.precedingInvoices',
      mention: 'precedingInvoices',
    });
  }
  if (display.references) {
    for (const key of [
      'contract',
      'project',
      'salesOrder',
      'despatchAdvice',
      'receivingAdvice',
      'tenderOrLot',
      'invoicedObject',
      'buyerAccountingReference',
    ] as const) {
      const value = refs[key];
      if (value) out.push({ label: labels.references[key], value, ref: `references.${key}` });
    }
  }
  return out;
}

function drawInfo(c: Composer): void {
  const cells = infoCells(c);
  if (cells.length === 0) return;
  c.y -= c.s.gap * 0.8;
  const perRow = 3;
  const cell = (c.CW - COLUMN_GAP * (perRow - 1)) / perRow;
  for (let start = 0; start < cells.length; start += perRow) {
    const row = cells.slice(start, start + perRow);
    const wrapped = row.map((kv) => c.wrap(kv.value, c.s.body, cell));
    const height =
      c.captionHeight + Math.max(...wrapped.map((w) => c.blockHeight(w.length, c.s.body)));
    c.ensure(height);
    const top = c.y;
    row.forEach((kv, i) => {
      const x = c.M + i * (cell + COLUMN_GAP);
      const y = c.caption(kv.label, x, top, c.p.muted);
      c.lines(wrapped[i] ?? [], x, y, { size: c.s.body, ref: kv.ref });
      c.area(x, top, cell, top - height, kv.ref);
      if (kv.mention) c.mention(kv.mention);
    });
    c.y = top - height - 8;
  }
}

// ---------- lignes ----------

interface Columns {
  number: number;
  designation: number;
  quantity: number;
  price: number;
  vat: number;
  amount: number;
}

interface Cells {
  quantity: string;
  price: string;
  per?: string;
  vat: string;
  amount: string;
}

function unitLabel(c: Composer, code: string): string {
  return c.input.labels.units[code] ?? code;
}

/** « 20 % » pour un taux, libellé court pour une catégorie sans taux applicable. */
function vatLabel(c: Composer, tax: { category: string; rate?: Rate | undefined }): string {
  if (tax.category === 'S' || tax.category === 'L' || tax.category === 'M') {
    return tax.rate === undefined ? tax.category : c.fmt.percent(tax.rate);
  }
  return c.input.labels.taxCategories[tax.category] ?? tax.category;
}

function lineCells(c: Composer, line: Line): Cells {
  const { invoice, labels } = c.input;
  const cells: Cells = {
    quantity: `${c.fmt.quantity(line.quantity)} ${unitLabel(c, line.unitCode)}`,
    price: c.fmt.unitPrice(line.unitPrice, invoice.currency),
    vat: vatLabel(c, line.tax ?? { category: '' }),
    amount: c.fmt.money(line.netAmount, invoice.currency),
  };
  const base = line.baseQuantity;
  if (base !== undefined && base !== 10_000) {
    cells.per = `${labels.line.per} ${c.fmt.quantity(base)} ${unitLabel(c, line.baseQuantityUnitCode ?? line.unitCode)}`;
  }
  return cells;
}

/** Détails d'une ligne sous sa désignation : description, références, période, prix brut, remises, frais. */
function lineDetails(c: Composer, line: Line, index: number): InfoLine[] {
  const { invoice, labels, display } = c.input;
  const fmt = c.fmt;
  const path = `lines[${index}]`;
  const out: InfoLine[] = [];
  if (line.description) out.push({ text: line.description, ref: `${path}.description` });
  if (display.itemDetails) {
    const refs = [
      line.sellerItemId ? `${labels.line.sellerItemId} ${line.sellerItemId}` : undefined,
      line.buyerItemId ? `${labels.line.buyerItemId} ${line.buyerItemId}` : undefined,
      line.standardItemId
        ? `${labels.line.standardItemId} ${line.standardItemId.value}`
        : undefined,
      line.originCountry
        ? `${labels.line.origin} ${labels.countries[line.originCountry] ?? line.originCountry}`
        : undefined,
      line.orderLineReference ? `${labels.line.orderLine} ${line.orderLineReference}` : undefined,
      line.buyerAccountingReference
        ? `${labels.line.accounting} ${line.buyerAccountingReference}`
        : undefined,
    ].filter((v): v is string => Boolean(v));
    if (refs.length) out.push({ text: refs.join(' · '), ref: `${path}.sellerItemId` });
  }
  const start = line.period?.start;
  const end = line.period?.end;
  if (start || end) {
    const value =
      start && end
        ? labels.fromTo(fmt.date(start), fmt.date(end))
        : fmt.date((start ?? end) as string);
    out.push({ text: `${labels.period} ${value}`, ref: `${path}.period` });
  }
  if (line.grossUnitPrice !== undefined) {
    const discount =
      line.priceDiscount !== undefined && line.priceDiscount !== 0
        ? `, ${labels.line.priceDiscount} ${fmt.unitPrice(line.priceDiscount, invoice.currency)}`
        : '';
    out.push({
      text: `${labels.line.grossPrice} ${fmt.unitPrice(line.grossUnitPrice, invoice.currency)}${discount}`,
      ref: `${path}.grossUnitPrice`,
    });
  }
  (line.allowances ?? []).forEach((a, i) => {
    const pct = a.percentage !== undefined ? ` (${fmt.percent(a.percentage)})` : '';
    out.push({
      text: fmt.pair(
        `${a.reason ?? labels.line.allowance}${pct}`,
        `−${fmt.money(a.amount, invoice.currency)}`,
      ),
      ref: `${path}.allowances[${i}]`,
    });
  });
  (line.charges ?? []).forEach((ch, i) => {
    const pct = ch.percentage !== undefined ? ` (${fmt.percent(ch.percentage)})` : '';
    out.push({
      text: fmt.pair(
        `${ch.reason ?? labels.line.charge}${pct}`,
        `+${fmt.money(ch.amount, invoice.currency)}`,
      ),
      ref: `${path}.charges[${i}]`,
    });
  });
  if (line.note) out.push({ text: line.note, ref: `${path}.note` });
  return out;
}

function computeColumns(c: Composer): Columns {
  const { invoice, labels, display } = c.input;
  const header = (text: string) =>
    c.width(text.toLocaleUpperCase(c.input.locale), c.s.tiny, 'bold');
  let quantity = header(labels.quantity);
  let price = header(labels.unitPrice);
  let vat = header(labels.vat);
  let amount = header(labels.netAmount);
  for (const line of invoice.lines ?? []) {
    const cells = lineCells(c, line);
    quantity = Math.max(quantity, c.width(cells.quantity, c.s.body));
    price = Math.max(
      price,
      c.width(cells.price, c.s.body),
      cells.per ? c.width(cells.per, c.s.small) : 0,
    );
    vat = Math.max(vat, c.width(cells.vat, c.s.body));
    amount = Math.max(amount, c.width(cells.amount, c.s.body));
  }
  const number = display.lineNumbers
    ? Math.max(header(labels.lineNumber), c.width(String((invoice.lines ?? []).length), c.s.body)) +
      4
    : 0;
  const numeric =
    quantity + price + vat + amount + COLUMN_GAP * 4 + (number ? number + COLUMN_GAP * 0.6 : 0);
  return { number, designation: Math.max(120, c.CW - numeric), quantity, price, vat, amount };
}

/** Bord droit de chaque colonne numérique, bord gauche de la désignation. */
function columnEdges(c: Composer, cols: Columns) {
  const amount = c.M + c.CW;
  const vat = amount - cols.amount - COLUMN_GAP;
  const price = vat - cols.vat - COLUMN_GAP;
  const quantity = price - cols.price - COLUMN_GAP;
  const designation = c.M + (cols.number ? cols.number + COLUMN_GAP * 0.6 : 0);
  return { number: c.M, designation, quantity, price, vat, amount };
}

function tableHeaderHeight(c: Composer): number {
  return c.s.tiny * 2.9;
}

function drawTableHeader(c: Composer, cols: Columns): void {
  const { labels } = c.input;
  const edges = columnEdges(c, cols);
  const style = c.style.tableHeader;
  const height = tableHeaderHeight(c);
  const top = c.y;
  let color = c.p.muted;
  if (style === 'filled') {
    c.rect(c.M - 6, top - height, c.CW + 12, height, { fill: c.p.accent });
    color = c.p.onAccent;
  } else if (style === 'tinted') {
    c.rect(c.M - 6, top - height, c.CW + 12, height, { fill: c.p.tintStrong });
    color = c.p.accentOnTint;
  }
  const base = top - height / 2 - c.s.tiny * 0.35;
  const cap = (text: string, x: number, align: 'left' | 'right') =>
    c.text(text.toLocaleUpperCase(c.input.locale), x, base, {
      size: c.s.tiny,
      font: 'bold',
      color,
      align,
    });
  if (cols.number) cap(labels.lineNumber, edges.number, 'left');
  cap(labels.designation, edges.designation, 'left');
  cap(labels.quantity, edges.quantity, 'right');
  cap(labels.unitPrice, edges.price, 'right');
  cap(labels.vat, edges.vat, 'right');
  cap(labels.netAmount, edges.amount, 'right');
  if (style === 'rule') c.rule(c.M, c.M + c.CW, top - height, c.p.rule, 0.75);
  c.y = top - height - (style === 'rule' ? 4 : 6);
}

function drawLines(c: Composer): void {
  const { invoice } = c.input;
  const cols = computeColumns(c);
  const edges = columnEdges(c, cols);
  c.y -= c.s.gap;
  c.ensure(tableHeaderHeight(c) + 40);
  drawTableHeader(c, cols);
  c.mention('lines');
  c.onBreak = () => drawTableHeader(c, cols);
  const detailLead = c.s.small * c.s.lead;
  (invoice.lines ?? []).forEach((line, index) => {
    const ref = `lines[${index}]`;
    const pad = c.s.rowPad;
    const names = c.wrap(line.name ?? '', c.s.body, cols.designation, 'bold');
    const details = lineDetails(c, line, index).map((d) => ({
      ...d,
      lines: c.wrap(d.text, c.s.small, cols.designation),
    }));
    const cells = lineCells(c, line);
    const detailCount = details.reduce((n, d) => n + d.lines.length, 0);
    const textHeight =
      c.blockHeight(names.length, c.s.body) + (detailCount ? detailCount * detailLead + 1 : 0);
    const priceHeight = cells.per ? c.s.body * c.s.lead + c.blockHeight(1, c.s.small) : 0;
    const height = Math.max(textHeight, priceHeight) + 2 * pad;
    const oversized = height > c.pageCapacity;
    c.ensure(oversized ? c.blockHeight(names.length, c.s.body) + 2 * pad : height);
    const top = c.y;
    if (!oversized && c.style.rows === 'zebra' && index % 2 === 1) {
      c.rect(c.M - 6, top - height, c.CW + 12, height, { fill: c.p.tint, rounded: false });
    }

    // Colonnes chiffrées, alignées sur la première ligne de la désignation.
    const base = top - pad - c.s.body * CAP;
    if (cols.number)
      c.text(String(index + 1), edges.number, base, { size: c.s.body, color: c.p.muted, ref });
    c.text(cells.quantity, edges.quantity, base, {
      size: c.s.body,
      align: 'right',
      ref: `${ref}.quantity`,
    });
    c.text(cells.price, edges.price, base, {
      size: c.s.body,
      align: 'right',
      ref: `${ref}.unitPrice`,
    });
    if (cells.per) {
      c.text(cells.per, edges.price, base - c.s.body * c.s.lead, {
        size: c.s.small,
        color: c.p.muted,
        align: 'right',
        ref: `${ref}.baseQuantity`,
      });
    }
    c.text(cells.vat, edges.vat, base, { size: c.s.body, align: 'right', ref: `${ref}.tax` });
    c.text(cells.amount, edges.amount, base, {
      size: c.s.body,
      align: 'right',
      ref: `${ref}.netAmount`,
    });

    // Désignation, puis détails ; une ligne plus haute qu'une page se poursuit sur la suivante.
    let y =
      c.lines(names, edges.designation, top - pad, {
        size: c.s.body,
        font: 'bold',
        ref: `${ref}.name`,
      }) - 1;
    let areaTop = top;
    for (const d of details) {
      for (const l of d.lines) {
        if (oversized && y - detailLead < c.bottom) {
          c.area(c.M, areaTop, c.CW, y, ref);
          c.newPage();
          c.onBreak?.();
          y = c.y;
          areaTop = c.y;
        }
        c.text(l, edges.designation, y - c.s.small * CAP, {
          size: c.s.small,
          color: c.p.muted,
          ref: d.ref,
        });
        y -= detailLead;
      }
    }
    const bottom = oversized ? y - pad : top - height;
    c.area(c.M, areaTop, c.CW, bottom, ref);
    c.y = bottom;
    if (c.style.rows === 'rules') c.rule(c.M, c.M + c.CW, c.y);
  });
  if (c.style.rows !== 'rules') c.rule(c.M, c.M + c.CW, c.y, c.p.rule, 0.75);
  c.onBreak = undefined;
}

// ---------- totaux et TVA ----------

interface TotalRow {
  label: string;
  value: string;
  ref: string;
  strong?: boolean;
  detail?: string;
}

function totalRows(c: Composer): TotalRow[] {
  const { invoice, labels } = c.input;
  const { totals, currency } = invoice;
  const fmt = c.fmt;
  const money = (v: Cents) => fmt.money(v, currency);
  const rows: TotalRow[] = [];
  const adjusted = Boolean(invoice.allowances?.length || invoice.charges?.length);
  if (adjusted)
    rows.push({
      label: labels.lineTotal,
      value: money(totals.lineTotalAmount),
      ref: 'totals.lineTotalAmount',
    });
  const detail = (tax: { category: string; rate?: Rate | undefined }, pct: Rate | undefined) =>
    `${labels.vat} ${vatLabel(c, tax)}${pct !== undefined ? ` · ${fmt.percent(pct)}` : ''}`;
  (invoice.allowances ?? []).forEach((a, i) => {
    rows.push({
      label: a.reason ?? labels.line.allowance,
      value: money(cents(-a.amount)),
      ref: `allowances[${i}]`,
      detail: detail(a.tax, a.percentage),
    });
  });
  (invoice.charges ?? []).forEach((ch, i) => {
    rows.push({
      label: ch.reason ?? labels.line.charge,
      value: money(ch.amount),
      ref: `charges[${i}]`,
      detail: detail(ch.tax, ch.percentage),
    });
  });
  rows.push({
    label: labels.taxExclusive,
    value: money(totals.taxExclusiveAmount),
    ref: 'totals.taxExclusiveAmount',
    strong: adjusted,
  });
  rows.push({
    label: labels.taxTotal,
    value: money(totals.taxTotalAmount),
    ref: 'totals.taxTotalAmount',
  });
  rows.push({
    label: labels.taxInclusive,
    value: money(totals.taxInclusiveAmount),
    ref: 'totals.taxInclusiveAmount',
    strong: true,
  });
  if (totals.prepaidAmount) {
    rows.push({
      label: labels.prepaid,
      value: money(cents(-totals.prepaidAmount)),
      ref: 'totals.prepaidAmount',
    });
  }
  if (totals.roundingAmount) {
    rows.push({
      label: labels.rounding,
      value: money(totals.roundingAmount),
      ref: 'totals.roundingAmount',
    });
  }
  return rows;
}

interface Mention {
  text: string;
  ref: string;
  mention: PrintedMention;
  strong?: boolean;
}

/** Mentions fiscales : exonérations (texte BT-120, sinon libellé du code VATEX), débits, exigibilité. */
function taxMentions(c: Composer): Mention[] {
  const { invoice, labels } = c.input;
  const out: Mention[] = [];
  const seen = new Set<string>();
  (invoice.taxBreakdown ?? []).forEach((tb, i) => {
    const text =
      tb.exemptionReason ??
      (tb.exemptionReasonCode
        ? (labels.exemptions[tb.exemptionReasonCode] ?? tb.exemptionReasonCode)
        : undefined);
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push({ text, ref: `taxBreakdown[${i}]`, mention: 'vatExemption', strong: true });
    }
  });
  if (invoice.vatOnDebits)
    out.push({
      text: labels.vatOnDebits,
      ref: 'vatOnDebits',
      mention: 'vatOnDebits',
      strong: true,
    });
  if (invoice.taxPointDate) {
    out.push({
      text: c.fmt.pair(labels.taxPointDate, c.fmt.date(invoice.taxPointDate)),
      ref: 'taxPointDate',
      mention: 'taxPointDate',
    });
  }
  return out;
}

function drawTotals(c: Composer): void {
  const { invoice, labels } = c.input;
  if (!invoice.totals) return;
  const fmt = c.fmt;
  const gutter = 28;
  const leftWidth = c.CW * 0.5 - gutter / 2;
  const rightWidth = c.CW - leftWidth - gutter;
  const rightX = c.M + leftWidth + gutter;
  const boxed = c.style.totals === 'boxed';
  const pad = boxed ? 10 : 0;
  const rows = totalRows(c);
  const rowLead = c.s.body * 1.75;
  const detailLead = c.s.small * 1.2;
  const vatLead = c.s.body * 1.6;
  const breakdown = invoice.taxBreakdown ?? [];
  const mentions = taxMentions(c).map((m) => ({
    ...m,
    lines: c.wrap(m.text, c.s.small, leftWidth, m.strong ? 'bold' : 'regular'),
  }));
  const leftHeight =
    c.captionHeight +
    c.s.tiny * 1.6 +
    4 +
    breakdown.length * vatLead +
    mentions.reduce(
      (h, m) => h + c.blockHeight(m.lines.length, c.s.small) + 4,
      mentions.length ? 6 : 0,
    );
  const rowsHeight = rows.reduce((h, r) => h + rowLead + (r.detail ? detailLead : 0), 0);
  const dueHeight = c.s.due * 1.3 + 12;
  const rightHeight = rowsHeight + 2 * pad + 6 + dueHeight;

  c.y -= c.s.gap;
  c.ensure(Math.max(leftHeight, rightHeight));
  const top = c.y;

  // --- à gauche : détail de la TVA, puis mentions fiscales
  let y = c.caption(labels.vatBreakdown, c.M, top, c.p.muted);
  const colBase = c.M + leftWidth * 0.62;
  const colAmount = c.M + leftWidth;
  const head = (text: string, x: number, align: 'left' | 'right') =>
    c.text(text, x, y - c.s.tiny * CAP, { size: c.s.tiny, color: c.p.muted, align });
  head(labels.taxRate, c.M, 'left');
  head(labels.taxBase, colBase, 'right');
  head(labels.taxAmount, colAmount, 'right');
  y -= c.s.tiny * 1.6;
  c.rule(c.M, c.M + leftWidth, y);
  y -= 4;
  breakdown.forEach((tb, i) => {
    const base = y - c.s.body * CAP - 2;
    const ref = `taxBreakdown[${i}]`;
    c.text(vatLabel(c, tb), c.M, base, { size: c.s.body, ref });
    c.text(fmt.money(tb.taxableAmount, invoice.currency), colBase, base, {
      size: c.s.body,
      align: 'right',
      ref,
    });
    c.text(fmt.money(tb.taxAmount, invoice.currency), colAmount, base, {
      size: c.s.body,
      align: 'right',
      ref,
    });
    y -= vatLead;
  });
  if (breakdown.length) c.mention('vatBreakdown');
  c.area(c.M, top, leftWidth, y, 'taxBreakdown');
  if (mentions.length) y -= 6;
  for (const m of mentions) {
    y = c.lines(m.lines, c.M, y, {
      size: c.s.small,
      font: m.strong ? 'bold' : 'regular',
      color: m.strong ? c.p.ink : c.p.muted,
      ref: m.ref,
    });
    y -= 4;
    c.mention(m.mention);
  }

  // --- à droite : totaux
  if (boxed)
    c.rect(rightX, top - rowsHeight - 2 * pad, rightWidth, rowsHeight + 2 * pad, {
      fill: c.p.tint,
    });
  let ry = top - pad;
  const innerLeft = rightX + pad;
  const innerRight = rightX + rightWidth - pad;
  for (const row of rows) {
    const base = ry - c.s.body * CAP - 3;
    c.text(row.label, innerLeft, base, {
      size: c.s.body,
      font: row.strong ? 'bold' : 'regular',
      color: row.strong ? c.p.ink : c.p.muted,
      ref: row.ref,
    });
    c.text(row.value, innerRight, base, {
      size: c.s.body,
      font: row.strong ? 'bold' : 'regular',
      align: 'right',
      ref: row.ref,
    });
    let h = rowLead;
    if (row.detail) {
      c.text(row.detail, innerLeft, base - detailLead - 1, {
        size: c.s.small - 0.5,
        color: c.p.muted,
        ref: row.ref,
      });
      h += detailLead;
    }
    c.area(rightX, ry, rightWidth, ry - h, row.ref);
    ry -= h;
  }
  c.mention('totals');
  if (invoice.totals.prepaidAmount) c.mention('prepaid');
  ry -= pad + 6;

  // Net à payer, ou montant de l'avoir.
  const dueLabel = isCreditNoteType(invoice.typeCode) ? labels.creditAmount : labels.amountDue;
  const dueValue = fmt.money(invoice.totals.amountDueForPayment, invoice.currency);
  const dueRef = 'totals.amountDueForPayment';
  if (c.style.amountDue === 'filled') {
    const h = c.s.due * 1.3 + 12;
    c.rect(rightX, ry - h, rightWidth, h, { fill: c.p.accent });
    const base = ry - h / 2 - c.s.due * 0.35;
    const style = { size: c.s.due, font: 'bold' as const, color: c.p.onAccent, ref: dueRef };
    c.text(dueLabel, rightX + 10, base, style);
    c.text(dueValue, rightX + rightWidth - 10, base, { ...style, align: 'right' });
    ry -= h;
  } else {
    if (!boxed) c.rule(rightX, rightX + rightWidth, ry + 3, c.p.ink, 0.75);
    const base = ry - c.s.due * CAP - 5;
    const style = { size: c.s.due, font: 'bold' as const, color: c.p.accentText, ref: dueRef };
    c.text(dueLabel, innerLeft, base, style);
    c.text(dueValue, innerRight, base, { ...style, align: 'right' });
    ry -= c.s.due * 1.3 + 8;
  }
  c.area(rightX, top, rightWidth, ry, 'totals');
  c.y = Math.min(y, ry);
}

// ---------- règlement, conditions, notes ----------

interface Paragraph {
  text: string;
  ref: string;
  strong?: boolean;
  mention?: PrintedMention;
}

function paymentParagraphs(c: Composer): Paragraph[] {
  const { invoice, labels, display } = c.input;
  const fmt = c.fmt;
  const out: Paragraph[] = [];
  if (display.paymentDetails) {
    (invoice.paymentMeans ?? []).forEach((pm, i) => {
      const name = pm.text ?? labels.paymentMeans[pm.typeCode] ?? pm.typeCode;
      const parts: string[] = [];
      const ct = pm.creditTransfer;
      if (ct?.iban) parts.push(`${labels.bank.iban} ${fmt.iban(ct.iban)}`);
      if (ct?.bic) parts.push(`${labels.bank.bic} ${ct.bic}`);
      if (ct?.accountName) parts.push(`${labels.bank.accountName} ${ct.accountName}`);
      const dd = pm.directDebit;
      if (dd?.mandateReference) parts.push(`${labels.bank.mandate} ${dd.mandateReference}`);
      if (dd?.creditorId) parts.push(`${labels.bank.creditorId} ${dd.creditorId}`);
      if (dd?.debitedIban) parts.push(`${labels.bank.debitedAccount} ${fmt.iban(dd.debitedIban)}`);
      out.push({
        text: parts.length ? `${name} — ${parts.join(' · ')}` : name,
        ref: `paymentMeans[${i}]`,
        mention: 'paymentMeans',
      });
    });
  }
  if (invoice.remittanceInformation) {
    out.push({
      text: fmt.pair(labels.remittance, invoice.remittanceInformation),
      ref: 'remittanceInformation',
    });
  }
  return out;
}

/** Paragraphes précédés d'une étiquette, qui ne reste jamais seule en bas de page. */
function drawParagraphs(c: Composer, caption: string, paragraphs: Paragraph[], size: number): void {
  if (paragraphs.length === 0) return;
  const wrapped = paragraphs.map((p) => ({
    ...p,
    lines: c.wrap(p.text, size, c.CW, p.strong ? 'bold' : 'regular'),
  }));
  const lead = size * c.s.lead;
  c.y -= c.s.gap;
  // Un bloc court reste d'un seul tenant : trois mentions coupées deux-une se lisent mal.
  const total = c.captionHeight + wrapped.reduce((h, p) => h + p.lines.length * lead + 3, 0);
  const keep =
    total <= c.pageCapacity / 3
      ? total
      : c.captionHeight + c.blockHeight(Math.min(2, wrapped[0]?.lines.length ?? 1), size);
  c.ensure(keep);
  c.y = c.caption(caption, c.M, c.y, c.p.muted);
  for (const p of wrapped) {
    let top = c.y;
    for (const l of p.lines) {
      if (c.y - lead < c.bottom) {
        c.area(c.M, top, c.CW, c.y, p.ref);
        c.ensure(lead);
        top = c.y;
      }
      c.text(l, c.M, c.y - size * CAP, {
        size,
        font: p.strong ? 'bold' : 'regular',
        color: p.strong ? c.p.ink : c.p.muted,
        ref: p.ref,
      });
      c.y -= lead;
    }
    c.area(c.M, top, c.CW, c.y, p.ref);
    c.y -= 3;
    if (p.mention) c.mention(p.mention);
  }
}

function drawConditions(c: Composer): void {
  const { invoice, labels } = c.input;
  const terms = invoice.paymentTerms;
  if (!terms) return;
  const paragraphs: Paragraph[] = [];
  if (terms.text !== undefined && terms.text.trim() !== '') {
    paragraphs.push({ text: terms.text, ref: 'paymentTerms.text', mention: 'paymentTerms' });
  }
  // Même source que le XML : les notes PMD, PMT et AAB, fournies ou générées depuis les champs structurés.
  const legal: Record<string, { mention: PrintedMention; ref: string }> = {
    PMD: { mention: 'latePenalty', ref: 'paymentTerms.latePenaltyRate' },
    PMT: { mention: 'recoveryIndemnity', ref: 'paymentTerms.recoveryIndemnity' },
    AAB: { mention: 'earlyPaymentDiscount', ref: 'paymentTerms.earlyPaymentDiscount' },
  };
  const given = invoice.notes ?? [];
  const seen = new Set(paragraphs.map((p) => p.text));
  for (const note of resolveNotes(invoice)) {
    const target = legal[note.subjectCode ?? ''];
    if (!target || seen.has(note.text)) continue;
    seen.add(note.text);
    const index = given.indexOf(note);
    paragraphs.push({
      text: note.text,
      ref: index >= 0 ? `notes[${index}]` : target.ref,
      mention: target.mention,
    });
  }
  drawParagraphs(c, labels.paymentTerms, paragraphs, c.s.small);
}

function drawNotes(c: Composer): void {
  const { invoice, labels } = c.input;
  const paragraphs = (invoice.notes ?? [])
    .map((note, index) => ({ note, index }))
    // BAR est une consigne de traitement pour la plateforme, pas une mention pour le lecteur.
    .filter(
      ({ note }) =>
        !['PMD', 'PMT', 'AAB', 'BAR'].includes(note.subjectCode ?? '') && note.text.trim() !== '',
    )
    .map(({ note, index }) => ({ text: note.text, ref: `notes[${index}]` }));
  drawParagraphs(c, labels.notes, paragraphs, c.s.small);
}

/**
 * Mention Factur-X : dans la marge basse de la dernière page, au-dessus du pied de page. Elle ne
 * prend jamais la place du contenu, et ne peut donc pas ouvrir à elle seule une page de plus.
 */
function drawNotice(c: Composer): void {
  if (!c.input.display.facturxNotice) return;
  const last = c.pages[c.pages.length - 1];
  if (!last) return;
  const size = c.s.tiny;
  const lines = c.wrap(c.input.labels.facturxNotice, size, c.CW).slice(0, 2);
  c.onPage(last, () => {
    lines.forEach((l, i) => {
      c.text(l, c.M, c.M + 3 + (lines.length - 1 - i) * size * 1.3, { size, color: c.p.muted });
    });
  });
}

/** Pied de page : mention libre et numéro de page, une fois le nombre de pages connu. */
function drawFooters(c: Composer): void {
  const { labels, footer } = c.input;
  const total = c.pages.length;
  const size = c.s.tiny;
  const y = c.M - 20;
  c.pages.forEach((page, index) => {
    c.onPage(page, () => {
      const label = labels.page(index + 1, total);
      const labelWidth = c.width(label, size);
      c.text(label, c.M + c.CW, y, { size, color: c.p.muted, align: 'right' });
      if (!footer) return;
      const width = c.CW - labelWidth - 24;
      const lines = c.wrap(footer, size, width).slice(0, 2);
      lines.forEach((l, i) => {
        c.text(l, c.M, y + (lines.length - 1 - i) * size * 1.3, {
          size,
          color: c.p.muted,
          ref: 'footer',
        });
      });
      c.area(c.M, y + lines.length * size * 1.3, width, y - 3, 'footer');
    });
  });
}

// ---------- entrée ----------

/** Compose la facture. Pure : aucune police n'est embarquée, aucun PDF n'est produit. */
export function composeInvoice(input: LayoutInput): InvoiceLayout {
  const c = new Composer(input);
  c.newPage();
  if (c.style.header === 'band') drawHeaderBand(c);
  else if (c.style.header === 'letterhead') drawHeaderLetterhead(c);
  else drawHeaderPlain(c);
  drawInfo(c);
  drawLines(c);
  drawTotals(c);
  drawParagraphs(c, input.labels.payment, paymentParagraphs(c), c.s.small + 0.5);
  drawConditions(c);
  drawNotes(c);
  drawNotice(c);
  drawFooters(c);
  return { pages: c.pages, title: c.title, missingGlyphs: c.missing, mentions: c.mentions };
}
