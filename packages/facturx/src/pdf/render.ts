/**
 * Rendu d'une facture lisible, à partir du modèle typé.
 *
 * Jusqu'à la 1.5, `embedFacturX` exigeait un PDF déjà fabriqué : le SDK savait produire le XML mais
 * pas la page que lit un humain. `renderInvoicePdf` la dessine ; `layoutInvoice` en donne la mise
 * en page sans produire de PDF, pour un aperçu qui ne peut pas diverger du document final.
 *
 * **Les polices sont à fournir.** Les quatorze polices standard du PDF ne sont pas embarquables ;
 * un document qui s'y appuie est rejeté par veraPDF, donc le Factur-X produit ensuite ne serait pas
 * conforme. Plutôt que de livrer un PDF qui a l'air bon et casse au contrôle, le rendu réclame
 * une police à embarquer — et la vôtre vaut mieux que la nôtre pour une facture à votre en-tête.
 *
 * Les mentions légales viennent de `resolveNotes`, la même source que le XML : la page lisible et
 * les données structurées disent rigoureusement la même chose, par construction.
 */

import { PDFDocument } from 'pdf-lib';
import type { Invoice } from '../types/invoice.js';
import { FacturXPdfError } from './errors.js';
import {
  FONT_FEATURES,
  type Fontkit,
  imageSize,
  loadFontkit,
  metricsOf,
  openFont,
} from './fonts.js';
import type { RenderLocale } from './format.js';
import { type RenderLabels, resolveLabels } from './labels.js';
import {
  composeInvoice,
  DEFAULT_DISPLAY,
  type InvoiceLayout,
  type MissingGlyph,
  type RenderDisplay,
} from './layout.js';
import { paintLayout } from './paint.js';
import { type RenderTheme, resolveTheme } from './theme.js';

export { RENDER_LABELS, type RenderLabels } from './labels.js';

export interface RenderInvoicePdfOptions {
  /**
   * Police à embarquer, en TTF ou OTF **statique**. `bold` est facultative : sans elle, le gras est
   * simulé par la même police, ce qui reste lisible mais moins net.
   *
   * Requise parce que les polices standard du PDF ne s'embarquent pas, et qu'un PDF/A doit
   * embarquer tout ce qu'il affiche.
   */
  fonts: { regular: Uint8Array; bold?: Uint8Array };
  /** Logo en PNG ou JPEG, placé selon le thème (hauteur de 44 points par défaut). */
  logo?: { bytes: Uint8Array; type: 'png' | 'jpeg' };
  /** Langue des libellés, ou table sur mesure (complétée par la langue de `locale`). Défaut : français. */
  labels?: 'fr' | 'en' | RenderLabels;
  /**
   * Écriture des nombres et des dates : `2 880,00 €` et `11/09/2026` en français, `€2,880.00` et
   * `11 Sep 2026` en anglais. Défaut : `en` si `labels` vaut `'en'`, sinon `fr`.
   */
  locale?: RenderLocale;
  /** Mention libre en pied de page — numéro RCS, capital social, code APE… (deux lignes au plus). */
  footer?: string;
  /** Modèle de mise en page, couleur d'accent, logo, format de page. Défaut : modèle `classic`. */
  theme?: RenderTheme;
  /** Informations facultatives à afficher ; les mentions obligatoires, elles, le sont toujours. */
  display?: RenderDisplay;
  /**
   * Réduire la police embarquée aux seuls caractères employés. Allège le PDF, mais **désactivé par
   * défaut** : le sous-ensembleur de `@pdf-lib/fontkit` échoue sur les polices **variables**, dans
   * une file d'attente asynchrone — l'échec n'est pas rattrapable et emporte le processus —, et le
   * sous-ensemble qu'il produit garde une référence au glyphe `.notdef`, que veraPDF refuse.
   */
  subset?: boolean;
}

/** Options de `layoutInvoice` : celles du rendu, moins ce qui ne concerne que le fichier PDF. */
export type LayoutInvoiceOptions = Omit<RenderInvoicePdfOptions, 'subset'>;

interface Prepared {
  layout: InvoiceLayout;
  fontkit: Fontkit;
  regular: Uint8Array;
  bold: Uint8Array | undefined;
}

async function prepare(invoice: Invoice, options: LayoutInvoiceOptions): Promise<Prepared> {
  if (!options.fonts?.regular?.byteLength) {
    throw new FacturXPdfError(
      'FONT_REQUIRED',
      "Une police à embarquer est requise (options.fonts.regular, TTF ou OTF) : les polices standard du PDF ne s'embarquent pas, et un PDF/A doit embarquer tout ce qu'il affiche.",
    );
  }
  const fontkit = await loadFontkit();
  const regular = metricsOf(openFont(fontkit, options.fonts.regular, 'fonts.regular'));
  const bold = options.fonts.bold?.byteLength
    ? metricsOf(openFont(fontkit, options.fonts.bold, 'fonts.bold'))
    : regular;

  let logo: { width: number; height: number } | undefined;
  if (options.logo) {
    logo = imageSize(options.logo.bytes, options.logo.type);
    if (!logo) {
      throw new FacturXPdfError(
        'INVALID_IMAGE',
        `Le logo n'est pas un ${options.logo.type === 'png' ? 'PNG' : 'JPEG'} lisible.`,
      );
    }
  }

  const locale: RenderLocale = options.locale ?? (options.labels === 'en' ? 'en' : 'fr');
  const theme = resolveTheme(options.theme);
  const input: Parameters<typeof composeInvoice>[0] = {
    invoice,
    fonts: { regular, bold },
    labels: resolveLabels(options.labels, locale),
    locale,
    theme,
    display: { ...DEFAULT_DISPLAY, ...definedOnly(options.display ?? {}) },
  };
  if (options.footer) input.footer = options.footer;
  if (logo) input.logo = logo;
  return {
    layout: composeInvoice(input),
    fontkit,
    regular: options.fonts.regular,
    bold: options.fonts.bold?.byteLength ? options.fonts.bold : undefined,
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Message d'erreur listant les caractères absents de la police, et où ils se trouvent. */
function describeMissing(missing: readonly MissingGlyph[]): string {
  const chars = new Map<string, Set<string>>();
  for (const m of missing) {
    const where = chars.get(m.char) ?? new Set<string>();
    where.add(m.ref ?? m.text);
    chars.set(m.char, where);
  }
  const list = [...chars]
    .slice(0, 8)
    .map(([char, where]) => {
      const code = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
      return `« ${char} » (U+${code}) dans ${[...where].slice(0, 3).join(', ')}`;
    })
    .join(' ; ');
  const more = chars.size > 8 ? ` et ${chars.size - 8} autre(s)` : '';
  return `La police ne contient pas ${chars.size > 1 ? 'ces caractères' : 'ce caractère'} : ${list}${more}. Un caractère absent deviendrait un glyphe .notdef, refusé par PDF/A : remplacez-le, ou fournissez une police qui le contient.`;
}

/**
 * Mise en page de la facture, sans produire de PDF : pages, instructions de dessin avec le champ
 * que chacune représente, caractères absents de la police, mentions légales écrites.
 *
 * Même calcul que `renderInvoicePdf`, mêmes mesures : un aperçu peint depuis ce résultat (en SVG,
 * sur un canvas) montre le document tel qu'il sera. Ne lève pas pour un caractère absent de la
 * police — il est listé dans `missingGlyphs`, pour qu'un éditeur le signale au bon endroit.
 */
export async function layoutInvoice(
  invoice: Invoice,
  options: LayoutInvoiceOptions,
): Promise<InvoiceLayout> {
  return (await prepare(invoice, options)).layout;
}

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
  const { layout, fontkit, regular, bold } = await prepare(invoice, options);
  if (layout.missingGlyphs.length > 0) {
    throw new FacturXPdfError('GLYPH_MISSING', describeMissing(layout.missingGlyphs));
  }

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
  const subset = options.subset ?? false;
  const regularFont = await doc.embedFont(regular, { subset, features: FONT_FEATURES });
  const boldFont = bold
    ? await doc.embedFont(bold, { subset, features: FONT_FEATURES })
    : regularFont;
  let logo: Awaited<ReturnType<PDFDocument['embedPng']>> | undefined;
  if (options.logo) {
    try {
      logo =
        options.logo.type === 'png'
          ? await doc.embedPng(options.logo.bytes)
          : await doc.embedJpg(options.logo.bytes);
    } catch (error) {
      throw new FacturXPdfError(
        'INVALID_IMAGE',
        `Le logo n'a pas pu être lu : ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
  }

  paintLayout(doc, layout, { regular: regularFont, bold: boldFont }, logo);

  doc.setTitle(`${layout.title} ${invoice.id}`.trim());
  doc.setAuthor(invoice.seller.name);
  doc.setCreator('facturx-sdk');
  doc.setProducer('facturx-sdk');

  return doc.save({ updateFieldAppearances: false });
}
