import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { FacturXPdfError } from './errors.js';

/** Nom de fichier normalisé de la pièce jointe Factur-X. */
export const FACTURX_FILENAME = 'factur-x.xml';

/** Noms reconnus à l'extraction, par ordre de priorité (comparaison insensible à la casse). */
export const KNOWN_FILENAMES: readonly string[] = [
  FACTURX_FILENAME,
  'zugferd-invoice.xml',
  'xrechnung.xml',
];

export function isKnownFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return KNOWN_FILENAMES.includes(lower);
}

export interface EmbeddedFileEntry {
  /** Nom (clé de l'arbre de noms), décodé. */
  name: string;
  /** Clé d'origine dans l'arbre (conservée telle quelle lors d'une réécriture). */
  key: PDFObject;
  /** Valeur d'origine (référence ou dictionnaire direct). */
  value: PDFObject;
  /** Dictionnaire Filespec résolu. */
  spec: PDFDict;
}

function decodeName(obj: PDFObject): string {
  if (obj instanceof PDFHexString || obj instanceof PDFString) return obj.decodeText();
  return obj.toString();
}

/** Nom d'un Filespec : `UF` de préférence, sinon `F`. */
export function filespecName(spec: PDFDict): string | undefined {
  const uf = spec.get(PDFName.of('UF'));
  if (uf instanceof PDFHexString || uf instanceof PDFString) return uf.decodeText();
  const f = spec.get(PDFName.of('F'));
  if (f instanceof PDFHexString || f instanceof PDFString) return f.decodeText();
  return undefined;
}

/** Parcourt l'arbre de noms `Names/EmbeddedFiles` (feuilles `Names` et nœuds `Kids`). */
export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFileEntry[] {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const root = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!root) return [];
  const out: EmbeddedFileEntry[] = [];
  const visit = (node: PDFDict, depth: number): void => {
    if (depth > 64)
      throw new FacturXPdfError('UNSUPPORTED', 'Arbre de noms EmbeddedFiles trop profond.');
    const leaf = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (leaf) {
      const items = leaf.asArray();
      for (let i = 0; i + 1 < items.length; i += 2) {
        const key = items[i] as PDFObject;
        const value = items[i + 1] as PDFObject;
        const spec = value instanceof PDFRef ? doc.context.lookupMaybe(value, PDFDict) : value;
        if (spec instanceof PDFDict) out.push({ name: decodeName(key), key, value, spec });
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) {
      for (const kid of kids.asArray()) {
        const kidDict = kid instanceof PDFRef ? doc.context.lookupMaybe(kid, PDFDict) : kid;
        if (kidDict instanceof PDFDict) visit(kidDict, depth + 1);
      }
    }
  };
  visit(root, 0);
  return out;
}
