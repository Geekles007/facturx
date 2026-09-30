/**
 * facturx-sdk/pdf — embarquement et extraction Factur-X dans un PDF/A-3 (dépend de pdf-lib).
 */
export {
  type EmbedOptions,
  embedFacturX,
  type FacturXSource,
  loadPdf,
  type OutputIntentOptions,
} from './embed.js';
export { FacturXPdfError, type FacturXPdfErrorCode } from './errors.js';
export {
  type ExtractedFacturX,
  type ExtractedInvoice,
  type ExtractOptions,
  extractFacturX,
  extractInvoice,
  readXmp,
} from './extract.js';
export { FONT_FEATURES } from './fonts.js';
export type { RenderLocale } from './format.js';
export type { FullRenderLabels } from './labels.js';
export {
  DEFAULT_DISPLAY,
  type InvoiceLayout,
  type LayoutArea,
  type LayoutFont,
  type LayoutImage,
  type LayoutLine,
  type LayoutOp,
  type LayoutPage,
  type LayoutRect,
  type LayoutText,
  type MissingGlyph,
  type PrintedMention,
  type RenderDisplay,
} from './layout.js';
export { FACTURX_FILENAME, KNOWN_FILENAMES } from './names.js';
export {
  type LayoutInvoiceOptions,
  layoutInvoice,
  RENDER_LABELS,
  type RenderInvoicePdfOptions,
  type RenderLabels,
  renderInvoicePdf,
} from './render.js';
export {
  buildPalette,
  contrastRatio,
  PAGE_SIZES,
  type Palette,
  parseHexColor,
  RENDER_TEMPLATES,
  type RenderStyle,
  type RenderTemplate,
  type RenderTheme,
} from './theme.js';
export { buildXmp, FACTURX_XMP_NAMESPACE, readXmpProperty, type XmpMetadata } from './xmp.js';
