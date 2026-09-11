/**
 * @geekles/facturx/pdf — embarquement et extraction Factur-X dans un PDF/A-3 (dépend de pdf-lib).
 */
export {
  type EmbedOptions,
  embedFacturX,
  type FacturXSource,
  loadPdf,
  type OutputIntentOptions,
} from './embed.js';
export { FacturXPdfError, type FacturXPdfErrorCode } from './errors.js';
export { type ExtractedFacturX, extractFacturX, readXmp } from './extract.js';
export { FACTURX_FILENAME, KNOWN_FILENAMES } from './names.js';
export { buildXmp, FACTURX_XMP_NAMESPACE, readXmpProperty, type XmpMetadata } from './xmp.js';
