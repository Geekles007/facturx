import { centsToString, rateToString } from './money.js';
import type { PaymentTerms } from './types/payment.js';

/** Formate un décimal "12.34" en notation française "12,34". */
function fr(decimal: string): string {
  return decimal.replace('.', ',');
}

/**
 * Compose le texte des conditions de paiement (BT-20) attendu par le droit français
 * (art. L441-9 / L441-10 C. com.) : pénalités de retard, indemnité forfaitaire, escompte.
 */
export function buildPaymentTermsText(terms: PaymentTerms): string {
  if (!hasStructuredTerms(terms)) {
    throw new TypeError(
      'buildPaymentTermsText : latePenaltyRate, recoveryIndemnity et earlyPaymentDiscount sont requis.',
    );
  }
  const parts: string[] = [];
  if (terms.dueDate) parts.push(`Paiement à réception, au plus tard le ${terms.dueDate}.`);
  parts.push(
    `Pénalités de retard : ${fr(rateToString(terms.latePenaltyRate))} % l'an, exigibles sans rappel dès le lendemain de l'échéance.`,
  );
  parts.push(
    `Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : ${fr(centsToString(terms.recoveryIndemnity))} €.`,
  );
  const disc = terms.earlyPaymentDiscount;
  parts.push(
    disc === 'none'
      ? "Pas d'escompte pour paiement anticipé."
      : `Escompte pour paiement anticipé : ${fr(rateToString(disc.rate))} % si règlement sous ${disc.withinDays} jours.`,
  );
  return parts.join(' ');
}

/** Vrai si les trois mentions FR structurées sont présentes. */
export function hasStructuredTerms(
  terms: PaymentTerms,
): terms is PaymentTerms &
  Required<Pick<PaymentTerms, 'latePenaltyRate' | 'recoveryIndemnity' | 'earlyPaymentDiscount'>> {
  return (
    terms.latePenaltyRate !== undefined &&
    terms.recoveryIndemnity !== undefined &&
    terms.earlyPaymentDiscount !== undefined
  );
}

/** Texte BT-20 effectif : `terms.text` s'il est fourni, sinon le texte généré depuis les champs structurés, sinon rien. */
export function resolvePaymentTermsText(terms: PaymentTerms): string | undefined {
  if (terms.text !== undefined) return terms.text;
  return hasStructuredTerms(terms) ? buildPaymentTermsText(terms) : undefined;
}
