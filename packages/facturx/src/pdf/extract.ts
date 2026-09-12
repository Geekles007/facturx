import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib';
import { type Limits, resolveLimits } from '../limits.js';
import type { Invoice } from '../types/invoice.js';
import { type FromCiiXmlOptions, fromCiiXml } from '../xml/cii-read.js';
import { loadPdf } from './embed.js';
import { FacturXPdfError } from './errors.js';
import { filespecName, KNOWN_FILENAMES, listEmbeddedFiles } from './names.js';
import { readXmpProperty } from './xmp.js';

export interface ExtractedFacturX {
  /** XML décodé (UTF-8, BOM retiré). */
  xml: string;
  /** Octets bruts de la pièce jointe. */
  bytes: Uint8Array;
  /** Nom de la pièce jointe tel qu'enregistré (`factur-x.xml`, ou un nom de repli ZUGFeRD/XRechnung). */
  filename: string;
  /** `fx:ConformanceLevel` lu dans le XMP, s'il est présent (ex. `EN 16931`). */
  conformanceLevel?: string;
  /** `fx:DocumentType` lu dans le XMP, s'il est présent (ex. `INVOICE`). */
  documentType?: string;
}

const decoder = new TextDecoder('utf-8');

function streamBytes(doc: PDFDocument, ref: PDFRef | PDFStream): Uint8Array | undefined {
  const stream = ref instanceof PDFRef ? doc.context.lookupMaybe(ref, PDFStream) : ref;
  if (!stream) return undefined;
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return stream.getContents();
}

function embeddedStream(doc: PDFDocument, spec: PDFDict): Uint8Array | undefined {
  const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
  if (!ef) return undefined;
  const target = ef.get(PDFName.of('UF')) ?? ef.get(PDFName.of('F'));
  if (target instanceof PDFRef || target instanceof PDFStream) return streamBytes(doc, target);
  return undefined;
}

/** Métadonnées XMP du document, décodées, si présentes. */
export function readXmp(doc: PDFDocument): string | undefined {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  if (!(ref instanceof PDFRef) && !(ref instanceof PDFStream)) return undefined;
  const bytes = streamBytes(doc, ref);
  return bytes === undefined ? undefined : decoder.decode(bytes);
}

/**
 * Extrait le XML Factur-X d'un PDF : cherche `factur-x.xml` (puis les noms de repli connus) dans
 * l'arbre de noms `EmbeddedFiles` et dans `/AF`. Renvoie `undefined` si aucune pièce n'est trouvée.
 */
export interface ExtractOptions {
  /** Limites de taille (défaut : `DEFAULT_LIMITS`). */
  limits?: Partial<Limits>;
}

export async function extractFacturX(
  pdf: Uint8Array | ArrayBuffer,
  options: ExtractOptions = {},
): Promise<ExtractedFacturX | undefined> {
  const limits = resolveLimits(options.limits);
  const doc = await loadPdf(pdf, limits);
  try {
    return readFacturX(doc, limits);
  } catch (error) {
    // pdf-lib accepte des documents tronqués que `loadPdf` ne peut pas rejeter : toute erreur
    // de structure rencontrée ensuite reste une erreur typée, jamais une exception brute.
    if (error instanceof FacturXPdfError) throw error;
    throw new FacturXPdfError('INVALID_PDF', 'Structure PDF inattendue : document illisible.', {
      cause: error,
    });
  }
}

function readFacturX(doc: PDFDocument, limits: Limits): ExtractedFacturX | undefined {
  const candidates: { name: string; spec: PDFDict }[] = listEmbeddedFiles(doc).map(
    ({ name, spec }) => ({ name, spec }),
  );
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af) {
    for (const item of af.asArray()) {
      const spec = item instanceof PDFRef ? doc.context.lookupMaybe(item, PDFDict) : item;
      if (!(spec instanceof PDFDict)) continue;
      const name = filespecName(spec);
      if (name !== undefined) candidates.push({ name, spec });
    }
  }

  for (const known of KNOWN_FILENAMES) {
    const match = candidates.find((c) => c.name.toLowerCase() === known);
    if (!match) continue;
    const bytes = embeddedStream(doc, match.spec);
    if (bytes !== undefined && bytes.byteLength > limits.xmlBytes) {
      throw new FacturXPdfError(
        'TOO_LARGE',
        `XML embarqué de ${bytes.byteLength} octets au-delà de la limite \`xmlBytes\` (${limits.xmlBytes}).`,
      );
    }
    if (bytes === undefined) {
      throw new FacturXPdfError(
        'UNSUPPORTED',
        `La pièce jointe « ${match.name} » n'a pas de flux lisible.`,
      );
    }
    const xmp = readXmp(doc);
    const result: ExtractedFacturX = { xml: decoder.decode(bytes), bytes, filename: match.name };
    const level = xmp === undefined ? undefined : readXmpProperty(xmp, 'fx:ConformanceLevel');
    const type = xmp === undefined ? undefined : readXmpProperty(xmp, 'fx:DocumentType');
    if (level !== undefined) result.conformanceLevel = level;
    if (type !== undefined) result.documentType = type;
    return result;
  }

  return undefined;
}

export interface ExtractedInvoice extends ExtractedFacturX {
  /** Facture typée lue depuis le XML (validée par défaut, voir `FromCiiXmlOptions`). */
  invoice: Invoice;
}

/**
 * `extractFacturX` + `fromCiiXml` en un appel : renvoie la facture typée, ou `undefined` si le PDF
 * ne contient pas de pièce Factur-X. Lève `FacturXParseError` / `FacturXValidationError` selon le cas.
 */
export async function extractInvoice(
  pdf: Uint8Array | ArrayBuffer,
  options: FromCiiXmlOptions = {},
): Promise<ExtractedInvoice | undefined> {
  const extracted = await extractFacturX(pdf, options);
  if (!extracted) return undefined;
  return { ...extracted, invoice: fromCiiXml(extracted.bytes, options) };
}
