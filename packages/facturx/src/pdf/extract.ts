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
export async function extractFacturX(
  pdf: Uint8Array | ArrayBuffer,
): Promise<ExtractedFacturX | undefined> {
  const doc = await loadPdf(pdf);
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
