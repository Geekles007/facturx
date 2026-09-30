/**
 * Reprendre une facture existante dans le Studio : un PDF Factur-X, un XML CII ou UBL, ou un
 * document enregistré par le Studio lui-même.
 *
 * La lecture passe par le SDK, sans validation (`parseCiiDocument`, `parseUblDocument`) : une
 * facture imparfaite doit pouvoir s'ouvrir pour être corrigée. Le fichier ne quitte pas le
 * navigateur.
 */

import { FacturXParseError, type Invoice, parseCiiDocument, parseUblDocument } from 'facturx-sdk';
import { type Appearance, fromPortableJson, toPortableJson } from './library.js';
import { type InvoiceForm, invoiceToForm } from './model.js';

export interface StudioDocument {
  format: 'facturx-studio';
  version: 1;
  form: InvoiceForm;
  appearance: Appearance;
}

export type ImportSource = 'pdf' | 'cii' | 'ubl' | 'studio';

export interface Imported {
  form: InvoiceForm;
  appearance?: Appearance;
  source: ImportSource;
  /** Profil lu dans le XML (BT-24), quand il y en a un. */
  profile?: string;
}

export class ImportError extends Error {
  override readonly name = 'ImportError';
  constructor(
    readonly code: 'NO_FACTURX' | 'UNSUPPORTED' | 'UNREADABLE',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const isPdf = (bytes: Uint8Array) =>
  bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

function fromXml(xml: string | Uint8Array): {
  invoice: Invoice;
  source: ImportSource;
  profile?: string;
} {
  const head = (
    typeof xml === 'string' ? xml : new TextDecoder().decode(xml.subarray(0, 4096))
  ).slice(0, 4096);
  if (/CrossIndustryInvoice/.test(head)) {
    const { invoice, guidelineId } = parseCiiDocument(xml);
    return { invoice, source: 'cii', profile: guidelineId };
  }
  if (/<(\w+:)?(Invoice|CreditNote)\b/.test(head)) {
    const parsed = parseUblDocument(xml);
    return { invoice: parsed.invoice, source: 'ubl', profile: parsed.guidelineId };
  }
  throw new ImportError(
    'UNSUPPORTED',
    'Ni CII (Factur-X) ni UBL : le Studio ne sait pas lire ce document.',
  );
}

export async function importBytes(bytes: Uint8Array, filename: string): Promise<Imported> {
  try {
    if (isPdf(bytes)) {
      const { extractFacturX } = await import('facturx-sdk/pdf');
      const extracted = await extractFacturX(bytes);
      if (!extracted) {
        throw new ImportError(
          'NO_FACTURX',
          "Ce PDF ne contient pas de données Factur-X : c'est une image de facture, pas une facture électronique.",
        );
      }
      const { invoice, profile } = fromXml(extracted.bytes);
      const result: Imported = { form: invoiceToForm(invoice), source: 'pdf' };
      if (profile) result.profile = profile;
      return result;
    }
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '');
    if (/\.json$/i.test(filename) || text.trimStart().startsWith('{')) {
      const doc = fromPortableJson<StudioDocument>(text);
      if (doc?.format !== 'facturx-studio' || !doc.form) {
        throw new ImportError(
          'UNSUPPORTED',
          "Ce JSON n'est pas un document enregistré par le Studio.",
        );
      }
      return { form: doc.form, appearance: doc.appearance, source: 'studio' };
    }
    const { invoice, source, profile } = fromXml(text);
    const result: Imported = { form: invoiceToForm(invoice), source };
    if (profile) result.profile = profile;
    return result;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof FacturXParseError) {
      throw new ImportError(
        'UNREADABLE',
        `${error.message}${error.path ? ` (${error.path})` : ''}`,
        { cause: error },
      );
    }
    throw new ImportError('UNREADABLE', (error as Error).message, { cause: error });
  }
}

/** Document du Studio : formulaire et apparence, pièces jointes comprises. */
export function exportStudioDocument(form: InvoiceForm, appearance: Appearance): string {
  const doc: StudioDocument = { format: 'facturx-studio', version: 1, form, appearance };
  return toPortableJson(doc);
}
