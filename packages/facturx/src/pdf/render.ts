/**
 * Rendu d'une facture lisible, à partir du modèle typé.
 *
 * Jusqu'ici `embedFacturX` exigeait un PDF déjà fabriqué : le SDK savait produire le XML mais pas
 * la page que lit un humain. C'était le trou le plus visible pour qui part de données.
 *
 * **Les polices sont à fournir.** Les quatorze polices standard du PDF ne sont pas embarquables ;
 * un document qui s'y appuie est rejeté par veraPDF, donc le Factur-X produit ensuite ne serait pas
 * conforme. Plutôt que de livrer un PDF qui a l'air bon et casse au contrôle, cette fonction réclame
 * une police à embarquer — et la vôtre vaut mieux que la nôtre pour une facture à votre en-tête.
 *
 * Les mentions légales viennent de `resolveNotes`, la même source que le XML : la page lisible et
 * les données structurées disent rigoureusement la même chose, par construction.
 */

import { PDFDocument, type PDFFont, type PDFImage, rgb } from 'pdf-lib';
import {
  type Cents,
  cents,
  centsToString,
  e4ToString,
  type Quantity,
  rateToString,
  type UnitPrice,
} from '../money.js';
import { hasStructuredTerms, resolveNotes, resolvePaymentTermsText } from '../payment-terms.js';
import type { Address } from '../types/address.js';
import type { Invoice } from '../types/invoice.js';
import type { Line } from '../types/line.js';
import type { Party } from '../types/party.js';
import { FacturXPdfError } from './errors.js';

// ---------- libellés ----------

export interface RenderLabels {
  invoice: Record<string, string>;
  seller: string;
  buyer: string;
  delivery: string;
  issueDate: string;
  dueDate: string;
  reference: string;
  designation: string;
  quantity: string;
  unitPrice: string;
  vat: string;
  netAmount: string;
  lineTotal: string;
  allowances: string;
  charges: string;
  taxExclusive: string;
  taxBase: string;
  taxRate: string;
  taxAmount: string;
  taxInclusive: string;
  prepaid: string;
  rounding: string;
  amountDue: string;
  paymentTerms: string;
  page: (current: number, total: number) => string;
}

const FR: RenderLabels = {
  invoice: {
    '380': 'Facture',
    '381': 'Avoir',
    '384': 'Facture rectificative',
    '386': "Facture d'acompte",
    '389': 'Facture auto-facturée',
    '393': 'Facture affacturée',
    '261': 'Avoir auto-facturé',
    '262': 'Avoir pour remise globale',
    '396': 'Avoir affacturé',
  },
  seller: 'Vendeur',
  buyer: 'Acheteur',
  delivery: 'Livraison',
  issueDate: 'Date',
  dueDate: 'Échéance',
  reference: 'Référence acheteur',
  designation: 'Désignation',
  quantity: 'Qté',
  unitPrice: 'P.U. HT',
  vat: 'TVA',
  netAmount: 'Montant HT',
  lineTotal: 'Total des lignes',
  allowances: 'Remises',
  charges: 'Frais',
  taxExclusive: 'Total HT',
  taxBase: 'Base HT',
  taxRate: 'Taux',
  taxAmount: 'TVA',
  taxInclusive: 'Total TTC',
  prepaid: 'Acomptes versés',
  rounding: 'Arrondi',
  amountDue: 'Net à payer',
  paymentTerms: 'Conditions de règlement',
  page: (c, t) => `Page ${c} / ${t}`,
};

const EN: RenderLabels = {
  invoice: {
    '380': 'Invoice',
    '381': 'Credit note',
    '384': 'Corrected invoice',
    '386': 'Prepayment invoice',
    '389': 'Self-billed invoice',
    '393': 'Factored invoice',
    '261': 'Self-billed credit note',
    '262': 'Credit note for global discount',
    '396': 'Factored credit note',
  },
  seller: 'Seller',
  buyer: 'Buyer',
  delivery: 'Delivery',
  issueDate: 'Date',
  dueDate: 'Due',
  reference: 'Buyer reference',
  designation: 'Description',
  quantity: 'Qty',
  unitPrice: 'Unit price',
  vat: 'VAT',
  netAmount: 'Net amount',
  lineTotal: 'Sum of lines',
  allowances: 'Allowances',
  charges: 'Charges',
  taxExclusive: 'Total excl. VAT',
  taxBase: 'Taxable',
  taxRate: 'Rate',
  taxAmount: 'VAT',
  taxInclusive: 'Total incl. VAT',
  prepaid: 'Prepaid',
  rounding: 'Rounding',
  amountDue: 'Amount due',
  paymentTerms: 'Payment terms',
  page: (c, t) => `Page ${c} of ${t}`,
};

export const RENDER_LABELS = { fr: FR, en: EN } as const;

// ---------- options ----------

export interface RenderInvoicePdfOptions {
  /**
   * Police à embarquer, en TTF ou OTF. `bold` est facultative : sans elle, le gras est simulé par
   * la même police, ce qui reste lisible mais moins net.
   *
   * Requise parce que les polices standard du PDF ne s'embarquent pas, et qu'un PDF/A doit
   * embarquer tout ce qu'il affiche.
   */
  fonts: { regular: Uint8Array; bold?: Uint8Array };
  /** Logo en PNG ou JPEG, placé en tête. Hauteur bornée à 48 points. */
  logo?: { bytes: Uint8Array; type: 'png' | 'jpeg' };
  /** Langue des libellés, ou table complète pour un rendu sur mesure. Défaut : français. */
  labels?: 'fr' | 'en' | RenderLabels;
  /** Mention libre en pied de page — numéro RCS, capital social, code APE… */
  footer?: string;
  /**
   * Réduire la police embarquée aux seuls caractères employés. Allège le PDF, mais **désactivé par
   * défaut** : le sous-ensembleur de `@pdf-lib/fontkit` échoue sur les polices **variables**, et son
   * échec survient dans une file d'attente asynchrone — il n'est pas rattrapable et emporte le
   * processus. Un défaut sûr vaut mieux qu'un défaut léger qui arrête un serveur.
   *
   * À activer avec une police statique, en l'ayant éprouvée.
   */
  subset?: boolean;
}

// ---------- géométrie ----------

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;
const CONTENT = A4.width - 2 * MARGIN;
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.85, 0.85, 0.85);

/** Colonnes du tableau des lignes, en points depuis la marge gauche. */
const COL = { qty: 250, unit: 320, vat: 400, amount: CONTENT } as const;

interface Ctx {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  labels: RenderLabels;
  invoice: Invoice;
  logo?: PDFImage;
  footer?: string;
  pages: ReturnType<PDFDocument['addPage']>[];
  page: ReturnType<PDFDocument['addPage']>;
  y: number;
}

const money = (value: Cents, currency: string): string => `${centsToString(value)} ${currency}`;

/**
 * Quantités et prix sont portés sur quatre décimales, mais `2.0000 DAY` sur une facture donne
 * l'impression d'un montant mal formaté. On retire les zéros inutiles, sans descendre sous deux
 * décimales — la convention du dépôt pour ces valeurs (voir decisions.md, D17).
 */
function trimE4(value: Quantity | UnitPrice): string {
  const text = e4ToString(value);
  return text.includes('.') ? text.replace(/(\.\d\d)0+$/, '$1') : text;
}

/** ISO `AAAA-MM-JJ` → `JJ/MM/AAAA`. Pas d'`Intl` : le rendu doit être identique partout. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function addressLines(party: Party): string[] {
  const a: Address = party.address;
  return [
    party.tradingName && party.tradingName !== party.name ? party.tradingName : undefined,
    a.line1,
    a.line2,
    a.line3,
    [a.postCode, a.city].filter(Boolean).join(' ') || undefined,
    a.countryCode,
  ].filter((v): v is string => Boolean(v));
}

/** Identifiants légaux d'une partie, sur une ligne chacun. */
function identityLines(party: Party): string[] {
  return [
    party.siret ? `SIRET ${party.siret}` : party.siren ? `SIREN ${party.siren}` : undefined,
    party.vatId ? `TVA ${party.vatId}` : undefined,
    party.legalInfo,
  ].filter((v): v is string => Boolean(v));
}

// ---------- primitives de mise en page ----------

/** Découpe un texte pour qu'aucune ligne ne dépasse `maxWidth`. Coupe un mot trop long. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // Un mot plus large que la colonne : on le coupe plutôt que de déborder.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

function draw(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'right' } = {},
): void {
  const size = options.size ?? 9;
  const font = options.bold ? ctx.bold : ctx.regular;
  const width = options.align === 'right' ? font.widthOfTextAtSize(text, size) : 0;
  ctx.page.drawText(text, {
    x: MARGIN + x - width,
    y,
    size,
    font,
    color: options.color ?? INK,
  });
}

function line(ctx: Ctx, y: number, from = 0, to = CONTENT): void {
  ctx.page.drawLine({
    start: { x: MARGIN + from, y },
    end: { x: MARGIN + to, y },
    thickness: 0.5,
    color: RULE,
  });
}

/** Ouvre une page et y replace le curseur. Le pied de page est écrit à la fin, quand on sait combien. */
function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([A4.width, A4.height]);
  ctx.pages.push(ctx.page);
  ctx.y = A4.height - MARGIN;
}

/** Garantit `needed` points disponibles ; ouvre une page et redessine l'en-tête du tableau sinon. */
function ensure(ctx: Ctx, needed: number, tableHeader = false): void {
  if (ctx.y - needed >= MARGIN + 28) return;
  newPage(ctx);
  if (tableHeader) drawTableHeader(ctx);
}

// ---------- blocs ----------

function drawHeader(ctx: Ctx): void {
  const { invoice, labels } = ctx;
  const title = labels.invoice[invoice.typeCode] ?? labels.invoice['380'] ?? 'Facture';

  if (ctx.logo) {
    const scale = Math.min(48 / ctx.logo.height, 160 / ctx.logo.width, 1);
    ctx.page.drawImage(ctx.logo, {
      x: MARGIN,
      y: ctx.y - ctx.logo.height * scale,
      width: ctx.logo.width * scale,
      height: ctx.logo.height * scale,
    });
    ctx.y -= ctx.logo.height * scale + 16;
  }

  const top = ctx.y;
  draw(ctx, title, 0, top - 18, { size: 20, bold: true });
  draw(ctx, invoice.id, 0, top - 36, { size: 11, bold: true });

  // Colonne de droite : dates et références, alignées sur le bord du contenu.
  let right = top - 16;
  const pair = (label: string, value: string) => {
    draw(ctx, label, COL.amount - 96, right, { size: 8, color: MUTED, align: 'right' });
    draw(ctx, value, COL.amount, right, { size: 9, align: 'right' });
    right -= 13;
  };
  pair(ctx.labels.issueDate, formatDate(invoice.issueDate));
  if (invoice.paymentTerms.dueDate)
    pair(ctx.labels.dueDate, formatDate(invoice.paymentTerms.dueDate));
  if (invoice.delivery?.date) pair(ctx.labels.delivery, formatDate(invoice.delivery.date));
  if (invoice.buyerReference) pair(ctx.labels.reference, invoice.buyerReference);

  ctx.y = Math.min(top - 52, right) - 14;
}

function drawParties(ctx: Ctx): void {
  const half = CONTENT / 2 - 12;
  const blocks: [string, Party][] = [
    [ctx.labels.seller, ctx.invoice.seller],
    [ctx.labels.buyer, ctx.invoice.buyer],
  ];
  const top = ctx.y;
  let lowest = top;

  for (const [index, [label, party]] of blocks.entries()) {
    const x = index === 0 ? 0 : CONTENT / 2 + 12;
    let y = top;
    draw(ctx, label.toUpperCase(), x, y, { size: 7, bold: true, color: MUTED });
    y -= 14;
    draw(ctx, party.name, x, y, { size: 10, bold: true });
    y -= 13;
    for (const l of [...addressLines(party), ...identityLines(party)]) {
      for (const piece of wrap(l, ctx.regular, 8.5, half)) {
        draw(ctx, piece, x, y, { size: 8.5, color: MUTED });
        y -= 11;
      }
    }
    lowest = Math.min(lowest, y);
  }
  ctx.y = lowest - 12;
}

function drawTableHeader(ctx: Ctx): void {
  const { labels } = ctx;
  const y = ctx.y;
  draw(ctx, labels.designation.toUpperCase(), 0, y, { size: 7, bold: true, color: MUTED });
  draw(ctx, labels.quantity.toUpperCase(), COL.qty, y, {
    size: 7,
    bold: true,
    color: MUTED,
    align: 'right',
  });
  draw(ctx, labels.unitPrice.toUpperCase(), COL.unit, y, {
    size: 7,
    bold: true,
    color: MUTED,
    align: 'right',
  });
  draw(ctx, labels.vat.toUpperCase(), COL.vat, y, {
    size: 7,
    bold: true,
    color: MUTED,
    align: 'right',
  });
  draw(ctx, labels.netAmount.toUpperCase(), COL.amount, y, {
    size: 7,
    bold: true,
    color: MUTED,
    align: 'right',
  });
  line(ctx, y - 6);
  ctx.y = y - 18;
}

function drawLine(ctx: Ctx, item: Line): void {
  const currency = ctx.invoice.currency;
  const details = [item.description, item.sellerItemId ? `Réf. ${item.sellerItemId}` : undefined]
    .filter((v): v is string => Boolean(v))
    .flatMap((t) => wrap(t, ctx.regular, 8, COL.qty - 12));
  const names = wrap(item.name, ctx.bold, 9, COL.qty - 12);

  ensure(ctx, (names.length + details.length) * 11 + 10, true);
  const y = ctx.y;

  let ny = y;
  for (const l of names) {
    draw(ctx, l, 0, ny, { size: 9, bold: true });
    ny -= 11;
  }
  for (const l of details) {
    draw(ctx, l, 0, ny, { size: 8, color: MUTED });
    ny -= 10;
  }

  draw(ctx, `${trimE4(item.quantity)} ${item.unitCode}`, COL.qty, y, {
    size: 9,
    align: 'right',
  });
  draw(ctx, trimE4(item.unitPrice), COL.unit, y, { size: 9, align: 'right' });
  draw(
    ctx,
    item.tax.rate === undefined ? item.tax.category : `${rateToString(item.tax.rate)} %`,
    COL.vat,
    y,
    {
      size: 9,
      align: 'right',
    },
  );
  draw(ctx, money(item.netAmount, currency), COL.amount, y, { size: 9, align: 'right' });

  ctx.y = Math.min(ny, y - 11) - 4;
  line(ctx, ctx.y + 6);
}

function drawTotals(ctx: Ctx): void {
  const { invoice, labels } = ctx;
  const { totals, currency } = invoice;
  const rows: [string, Cents, boolean?][] = [[labels.lineTotal, totals.lineTotalAmount]];
  if (totals.allowanceTotalAmount)
    rows.push([labels.allowances, cents(-totals.allowanceTotalAmount)]);
  if (totals.chargeTotalAmount) rows.push([labels.charges, totals.chargeTotalAmount]);
  rows.push([labels.taxExclusive, totals.taxExclusiveAmount]);
  for (const t of invoice.taxBreakdown) {
    const rate = t.rate === undefined ? t.category : `${rateToString(t.rate)} %`;
    rows.push([
      `${labels.taxAmount} ${rate} — ${labels.taxBase} ${centsToString(t.taxableAmount)}`,
      t.taxAmount,
    ]);
  }
  rows.push([labels.taxInclusive, totals.taxInclusiveAmount, true]);
  if (totals.prepaidAmount) rows.push([labels.prepaid, cents(-totals.prepaidAmount)]);
  if (totals.roundingAmount) rows.push([labels.rounding, totals.roundingAmount]);

  ensure(ctx, rows.length * 14 + 40);
  ctx.y -= 10;
  const left = CONTENT / 2;

  for (const [label, value, strong] of rows) {
    const emphase = strong === true;
    draw(ctx, label, left, ctx.y, {
      size: emphase ? 9.5 : 9,
      bold: emphase,
      color: emphase ? INK : MUTED,
    });
    draw(ctx, money(value, currency), COL.amount, ctx.y, {
      size: emphase ? 9.5 : 9,
      bold: emphase,
      align: 'right',
    });
    ctx.y -= 14;
  }

  line(ctx, ctx.y + 5, left, CONTENT);
  ctx.y -= 6;
  draw(ctx, labels.amountDue, left, ctx.y, { size: 12, bold: true });
  draw(ctx, money(totals.amountDueForPayment, currency), COL.amount, ctx.y, {
    size: 12,
    bold: true,
    align: 'right',
  });
  ctx.y -= 24;
}

function drawNotes(ctx: Ctx): void {
  const { invoice, labels } = ctx;
  const terms = resolvePaymentTermsText(invoice.paymentTerms);
  // Même source que le XML : la page et les données ne peuvent pas diverger.
  //
  // Quand les conditions sont structurées, le paragraphe ci-dessus contient déjà les trois mentions
  // légales (PMD, PMT, AAB) : les répéter ferait dire deux fois la même chose à la facture.
  const genere =
    hasStructuredTerms(invoice.paymentTerms) && invoice.paymentTerms.text === undefined;
  const notes = resolveNotes(invoice)
    .filter(
      (n) =>
        !(
          genere &&
          (n.subjectCode === 'PMD' || n.subjectCode === 'PMT' || n.subjectCode === 'AAB')
        ),
    )
    .map((n) => n.text);
  const blocks = [terms, ...notes].filter((v): v is string => Boolean(v));
  if (blocks.length === 0) return;

  ensure(ctx, 30);
  draw(ctx, labels.paymentTerms.toUpperCase(), 0, ctx.y, { size: 7, bold: true, color: MUTED });
  ctx.y -= 13;
  for (const block of blocks) {
    for (const l of wrap(block, ctx.regular, 8, CONTENT)) {
      ensure(ctx, 11);
      draw(ctx, l, 0, ctx.y, { size: 8, color: MUTED });
      ctx.y -= 10;
    }
    ctx.y -= 3;
  }
}

/** Pied de page : numéro de page et mention libre, une fois le nombre de pages connu. */
function drawFooters(ctx: Ctx): void {
  const total = ctx.pages.length;
  ctx.pages.forEach((page, index) => {
    const y = MARGIN - 14;
    if (ctx.footer) {
      page.drawText(ctx.footer, { x: MARGIN, y, size: 7, font: ctx.regular, color: MUTED });
    }
    const label = ctx.labels.page(index + 1, total);
    page.drawText(label, {
      x: MARGIN + CONTENT - ctx.regular.widthOfTextAtSize(label, 7),
      y,
      size: 7,
      font: ctx.regular,
      color: MUTED,
    });
  });
}

/**
 * Embarque une police en refusant les **polices variables**.
 *
 * Elles se chargent sans broncher, mais le document obtenu est rejeté par veraPDF —
 * « the font programs for all fonts used for rendering shall be embedded ». L'erreur n'apparaîtrait
 * donc qu'au contrôle de conformité, voire au dépôt sur une plateforme : autant la lever ici.
 *
 * La plupart des familles publient une version statique à côté de la variable (`Geist-Regular.ttf`
 * plutôt que `Geist-Variable.woff2`) ; c'est celle-là qu'il faut.
 */
async function embedStatic(
  doc: PDFDocument,
  bytes: Uint8Array,
  subset: boolean,
  field: string,
): Promise<PDFFont> {
  const font = await doc.embedFont(bytes, { subset });
  const axes = (font as unknown as { embedder?: { font?: { variationAxes?: object } } }).embedder
    ?.font?.variationAxes;
  if (axes && Object.keys(axes).length > 0) {
    throw new FacturXPdfError(
      'FONT_VARIABLE',
      `La police fournie en ${field} est une police variable (axes : ${Object.keys(axes).join(', ')}). Le PDF produit serait refusé comme PDF/A, faute de programme de police embarquable : fournissez la version statique de cette famille.`,
    );
  }
  return font;
}

// ---------- entrée ----------

/**
 * Produit la page lisible d'une facture, prête à recevoir le XML par `embedFacturX`.
 *
 * Le document n'est pas encore un PDF/A : il lui manque l'`OutputIntent` et les métadonnées XMP,
 * qu'`embedFacturX` ajoute. C'est la chaîne complète — rendu puis embarquement — qui passe veraPDF.
 */
export async function renderInvoicePdf(
  invoice: Invoice,
  options: RenderInvoicePdfOptions,
): Promise<Uint8Array> {
  if (!options.fonts?.regular?.byteLength) {
    throw new FacturXPdfError(
      'FONT_REQUIRED',
      "Une police à embarquer est requise (options.fonts.regular, TTF ou OTF) : les polices standard du PDF ne s'embarquent pas, et un PDF/A doit embarquer tout ce qu'il affiche.",
    );
  }

  const { default: fontkit } = await import('@pdf-lib/fontkit').catch(() => {
    throw new FacturXPdfError(
      'FONTKIT_REQUIRED',
      'Le rendu embarque une police, ce qui requiert « @pdf-lib/fontkit ». Installez-le : npm add @pdf-lib/fontkit',
    );
  });

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);

  const subset = options.subset ?? false;
  const regular = await embedStatic(doc, options.fonts.regular, subset, 'fonts.regular');
  const bold = options.fonts.bold
    ? await embedStatic(doc, options.fonts.bold, subset, 'fonts.bold')
    : regular;

  const labels =
    typeof options.labels === 'object' ? options.labels : RENDER_LABELS[options.labels ?? 'fr'];

  const ctx: Ctx = {
    doc,
    regular,
    bold,
    labels,
    invoice,
    ...(options.footer ? { footer: options.footer } : {}),
    pages: [],
    page: undefined as never,
    y: 0,
  };
  if (options.logo) {
    ctx.logo =
      options.logo.type === 'png'
        ? await doc.embedPng(options.logo.bytes)
        : await doc.embedJpg(options.logo.bytes);
  }

  newPage(ctx);
  drawHeader(ctx);
  drawParties(ctx);
  drawTableHeader(ctx);
  for (const item of invoice.lines) drawLine(ctx, item);
  drawTotals(ctx);
  drawNotes(ctx);
  drawFooters(ctx);

  doc.setTitle(`${labels.invoice[invoice.typeCode] ?? ''} ${invoice.id}`.trim());
  doc.setAuthor(invoice.seller.name);
  doc.setCreator('facturx-sdk');
  doc.setProducer('facturx-sdk');

  return doc.save({ updateFieldAppearances: false });
}
