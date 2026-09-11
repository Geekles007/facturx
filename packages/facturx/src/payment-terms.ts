import {
  type Cents,
  centsFromDecimal,
  centsToString,
  percent,
  type Rate,
  rateToString,
} from './money.js';
import {
  isProcessingCode,
  LEGAL_NOTE_CODES,
  type LegalNoteCode,
  type ProcessingCode,
} from './types/codes.js';
import type { InvoiceNote } from './types/invoice.js';
import type { EarlyPaymentDiscount, PaymentTerms } from './types/payment.js';

/** Formate un décimal "12.34" en notation française "12,34". */
function fr(decimal: string): string {
  return decimal.replace('.', ',');
}

type StructuredTerms = Required<
  Pick<PaymentTerms, 'latePenaltyRate' | 'recoveryIndemnity' | 'earlyPaymentDiscount'>
>;

/** Vrai si les trois mentions FR structurées sont présentes. */
export function hasStructuredTerms(terms: PaymentTerms): terms is PaymentTerms & StructuredTerms {
  return (
    terms.latePenaltyRate !== undefined &&
    terms.recoveryIndemnity !== undefined &&
    terms.earlyPaymentDiscount !== undefined
  );
}

/** Vrai si les mentions structurées sont présentes ET exploitables (entiers sûrs). */
export function canBuildLegalNotes(terms: PaymentTerms): terms is PaymentTerms & StructuredTerms {
  if (!hasStructuredTerms(terms)) return false;
  const d = terms.earlyPaymentDiscount;
  return (
    Number.isSafeInteger(terms.latePenaltyRate) &&
    Number.isSafeInteger(terms.recoveryIndemnity) &&
    (d === 'none' || (Number.isSafeInteger(d.rate) && Number.isSafeInteger(d.withinDays)))
  );
}

// ---------- phrases (source unique pour BT-20, les notes BG-1 et la relecture) ----------

const sentences = {
  PMD: (rate: Rate) =>
    `Pénalités de retard : ${fr(rateToString(rate))} % l'an, exigibles sans rappel dès le lendemain de l'échéance (art. L441-10 C. com.).`,
  PMT: (amount: Cents) =>
    `Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : ${fr(centsToString(amount))} € (art. D441-5 C. com.).`,
  AAB: (discount: EarlyPaymentDiscount | 'none') =>
    discount === 'none'
      ? "Pas d'escompte pour paiement anticipé."
      : `Escompte pour paiement anticipé : ${fr(rateToString(discount.rate))} % si règlement sous ${discount.withinDays} jours.`,
};

const patterns = {
  PMD: /^Pénalités de retard : (\d+,\d{2}) % l'an, exigibles sans rappel dès le lendemain de l'échéance \(art\. L441-10 C\. com\.\)\.$/,
  PMT: /^Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : (\d+,\d{2}) € \(art\. D441-5 C\. com\.\)\.$/,
  AAB_NONE: /^Pas d'escompte pour paiement anticipé\.$/,
  AAB: /^Escompte pour paiement anticipé : (\d+,\d{2}) % si règlement sous (\d+) jours\.$/,
};

function requireStructured(
  terms: PaymentTerms,
  fn: string,
): asserts terms is PaymentTerms & StructuredTerms {
  if (!hasStructuredTerms(terms)) {
    throw new TypeError(
      `${fn} : latePenaltyRate, recoveryIndemnity et earlyPaymentDiscount sont requis.`,
    );
  }
}

/**
 * Notes légales obligatoires (BR-FR-05) générées depuis les champs structurés :
 * `PMD` pénalités de retard, `PMT` indemnité forfaitaire, `AAB` escompte.
 */
export function buildLegalNotes(terms: PaymentTerms): InvoiceNote[] {
  requireStructured(terms, 'buildLegalNotes');
  return [
    { text: sentences.PMD(terms.latePenaltyRate), subjectCode: 'PMD' },
    { text: sentences.PMT(terms.recoveryIndemnity), subjectCode: 'PMT' },
    { text: sentences.AAB(terms.earlyPaymentDiscount), subjectCode: 'AAB' },
  ];
}

/**
 * Texte des conditions de paiement (BT-20) : échéance puis les trois mentions légales.
 * Les mentions elles-mêmes sont portées par les notes BG-1 (BR-FR-05) ; BT-20 reste le texte lisible complet.
 */
export function buildPaymentTermsText(terms: PaymentTerms): string {
  requireStructured(terms, 'buildPaymentTermsText');
  const parts: string[] = [];
  if (terms.dueDate) parts.push(`Paiement à réception, au plus tard le ${terms.dueDate}.`);
  parts.push(
    sentences.PMD(terms.latePenaltyRate),
    sentences.PMT(terms.recoveryIndemnity),
    sentences.AAB(terms.earlyPaymentDiscount),
  );
  return parts.join(' ');
}

/** Texte BT-20 effectif : `terms.text` s'il est fourni, sinon le texte généré depuis les champs structurés, sinon rien. */
export function resolvePaymentTermsText(terms: PaymentTerms): string | undefined {
  if (terms.text !== undefined) return terms.text;
  return canBuildLegalNotes(terms) ? buildPaymentTermsText(terms) : undefined;
}

/**
 * Notes effectives d'une facture : celles fournies par l'appelant, complétées par les notes légales
 * (`PMD`, `PMT`, `AAB`) générées depuis `paymentTerms` pour chaque code absent, et par la note `BAR`
 * (traitement attendu, BR-FR-20) si `processing` est renseigné. Ne modifie rien.
 */
export function resolveNotes(invoice: {
  notes?: InvoiceNote[];
  paymentTerms: PaymentTerms;
  processing?: ProcessingCode;
}): InvoiceNote[] {
  const given = invoice.notes ?? [];
  const present = new Set(given.map((n) => n.subjectCode));
  const generated: InvoiceNote[] = [];
  if (canBuildLegalNotes(invoice.paymentTerms)) {
    generated.push(
      ...buildLegalNotes(invoice.paymentTerms).filter(
        (n) => !present.has(n.subjectCode as LegalNoteCode),
      ),
    );
  }
  if (invoice.processing !== undefined && !present.has('BAR')) {
    generated.push({ text: invoice.processing, subjectCode: 'BAR' });
  }
  return [...given, ...generated];
}

/**
 * Relecture de la note `BAR` (BR-FR-20) : si une seule note BAR porte un code de traitement connu,
 * la retire (régénérée à l'identique) et renvoie le code.
 */
export function parseProcessingNote(notes: readonly InvoiceNote[]): {
  processing: ProcessingCode | undefined;
  remaining: InvoiceNote[];
} {
  const bar = notes.filter((n) => n.subjectCode === 'BAR');
  const value = bar[0]?.text.trim();
  if (bar.length !== 1 || !isProcessingCode(value))
    return { processing: undefined, remaining: [...notes] };
  return { processing: value, remaining: notes.filter((n) => n !== bar[0]) };
}

export interface ParsedLegalNotes {
  /** Champs structurés reconstitués si les trois notes suivent exactement le format du SDK. */
  terms: StructuredTerms | undefined;
  /** Notes restantes (toutes si la reconstitution a échoué). */
  remaining: InvoiceNote[];
}

/**
 * Relecture des notes légales : si `PMD`, `PMT` et `AAB` sont présentes une fois chacune et suivent le
 * format généré par le SDK, reconstitue les champs structurés et retire ces notes (elles seront régénérées
 * à l'identique). Sinon, laisse les notes telles quelles.
 */
export function parseLegalNotes(notes: readonly InvoiceNote[]): ParsedLegalNotes {
  const byCode = new Map<LegalNoteCode, InvoiceNote[]>();
  for (const note of notes) {
    if ((LEGAL_NOTE_CODES as readonly string[]).includes(note.subjectCode ?? '')) {
      const code = note.subjectCode as LegalNoteCode;
      byCode.set(code, [...(byCode.get(code) ?? []), note]);
    }
  }
  const single = (code: LegalNoteCode) =>
    byCode.get(code)?.length === 1 ? byCode.get(code)?.[0] : undefined;
  const pmd = single('PMD');
  const pmt = single('PMT');
  const aab = single('AAB');
  if (!pmd || !pmt || !aab) return { terms: undefined, remaining: [...notes] };

  const mPmd = patterns.PMD.exec(pmd.text.trim());
  const mPmt = patterns.PMT.exec(pmt.text.trim());
  const aabText = aab.text.trim();
  const mAab = patterns.AAB.exec(aabText);
  const none = patterns.AAB_NONE.test(aabText);
  if (!mPmd || !mPmt || (!mAab && !none)) return { terms: undefined, remaining: [...notes] };

  const terms: StructuredTerms = {
    latePenaltyRate: percent(mPmd[1] as string),
    recoveryIndemnity: centsFromDecimal(mPmt[1] as string),
    earlyPaymentDiscount: none
      ? 'none'
      : { rate: percent(mAab?.[1] as string), withinDays: Number(mAab?.[2]) },
  };
  const consumed = new Set<InvoiceNote>([pmd, pmt, aab]);
  return { terms, remaining: notes.filter((n) => !consumed.has(n)) };
}
