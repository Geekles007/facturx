/**
 * QR code de paiement SEPA (EPC069-12, dit « GiroCode ») : les données d'un virement qu'une
 * application bancaire lit d'un coup d'appareil photo — bénéficiaire, IBAN, BIC, montant,
 * référence —, pour un paiement sans rien saisir et sans faute de frappe.
 *
 * Tout découle de la facture, et rien d'autre : le compte du premier virement dont l'IBAN est
 * valide, le montant à payer (BT-115), la référence de paiement (BT-83) ou, à défaut, le numéro de
 * facture. Le QR code redit ce que la page imprime ; il ne peut pas le contredire.
 */

import { centsToString } from './money.js';
import { isCreditNoteType } from './types/codes.js';
import type { Invoice } from './types/invoice.js';
import { isValidBic, isValidCreditorReference, isValidIban } from './validate/formats.js';

/** Pourquoi une facture ne peut pas porter de QR code de paiement SEPA. */
export type SepaQrUnavailableReason =
  | 'credit-note' // un avoir ne se paie pas : c'est le vendeur qui rembourse
  | 'currency' // un virement SEPA ne transfère que des euros
  | 'amount' // rien à payer (acomptes déduits, montant nul), ou plus que 999 999 999,99 €
  | 'no-transfer' // aucun virement (BT-81 = 30, 42 ou 58) avec un compte
  | 'invalid-iban' // le compte du virement n'est pas un IBAN valide
  | 'no-name' // ni titulaire du compte, ni bénéficiaire, ni vendeur
  | 'too-long'; // plus de 331 octets, la limite du format

export type SepaQrPayload =
  | {
      available: true;
      /**
       * Contenu du QR code : lignes séparées par un saut de ligne (LF), à encoder en UTF-8 au
       * niveau de correction M, comme le demande le format.
       */
      payload: string;
      /** Le virement retenu, par sa position dans `invoice.paymentMeans`. */
      paymentMeansIndex: number;
    }
  | { available: false; reason: SepaQrUnavailableReason };

/** Moyens de paiement qui désignent un virement vers le compte du vendeur (UNTDID 4461). */
const TRANSFER_CODES = new Set(['30', '42', '58']);

/** Montant maximal du format : 999 999 999,99 €. */
const MAX_AMOUNT = 99_999_999_999;

/** Longueur maximale du contenu, en octets. */
const MAX_BYTES = 331;

/** Une seule ligne : les sauts de ligne séparent les champs ; les caractères de contrôle disparaissent. */
function oneLine(text: string | undefined): string {
  let out = '';
  for (const char of text ?? '') {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code < 0xa0) ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Coupe à `max` caractères (jamais au milieu d'une paire de substitution). */
function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('').trim();
}

/**
 * Contenu du QR code de paiement SEPA d'une facture, ou la raison pour laquelle elle ne peut pas
 * en porter.
 *
 * - **Bénéficiaire** : le titulaire du compte (BT-85), sinon le bénéficiaire (BT-59), sinon le
 *   vendeur (BT-27) — 70 caractères au plus. Depuis la vérification du bénéficiaire (VoP), la
 *   banque du payeur compare ce nom à celui du compte.
 * - **Compte** : le premier virement (BT-81 = 30, 42 ou 58) dont l'IBAN (BT-84) est valide, et son
 *   BIC (BT-86) s'il en est un, facultatif en version 002 du format.
 * - **Montant** : le montant à payer (BT-115), en euros uniquement.
 * - **Référence** : la référence de paiement (BT-83) — structurée si c'est une référence ISO 11649
 *   (`RF…`), libre sinon, 140 caractères au plus —, à défaut le numéro de facture (BT-1).
 */
export function sepaQrPayload(invoice: Invoice): SepaQrPayload {
  if (isCreditNoteType(invoice.typeCode)) return { available: false, reason: 'credit-note' };
  if (invoice.currency !== 'EUR') return { available: false, reason: 'currency' };
  // Jamais d'exception, même sur une facture en cours de saisie : un montant illisible n'a rien à payer.
  const due = invoice.totals?.amountDueForPayment;
  if (due === undefined || !Number.isSafeInteger(due) || due <= 0 || due > MAX_AMOUNT) {
    return { available: false, reason: 'amount' };
  }

  const transfers = (invoice.paymentMeans ?? [])
    .map((means, index) => ({ means, index }))
    .filter(
      ({ means }) => TRANSFER_CODES.has(means.typeCode) && oneLine(means.creditTransfer?.iban),
    );
  if (transfers.length === 0) return { available: false, reason: 'no-transfer' };
  const chosen = transfers.find(({ means }) => isValidIban(means.creditTransfer?.iban ?? ''));
  const account = chosen?.means.creditTransfer;
  if (!chosen || !account) return { available: false, reason: 'invalid-iban' };

  const name = truncate(
    [account.accountName, invoice.payee?.name, invoice.seller?.name].map(oneLine).find(Boolean) ??
      '',
    70,
  );
  if (!name) return { available: false, reason: 'no-name' };

  const bic = oneLine(account.bic).replace(/ /g, '').toUpperCase();
  const reference = oneLine(invoice.remittanceInformation);
  const structured = isValidCreditorReference(reference)
    ? reference.replace(/ /g, '').toUpperCase()
    : '';
  const unstructured = structured ? '' : truncate(reference || oneLine(invoice.id), 140);

  const fields = [
    'BCD', // étiquette du service
    '002', // version : BIC facultatif
    '1', // jeu de caractères : UTF-8
    'SCT', // virement SEPA
    isValidBic(bic) ? bic : '',
    name,
    account.iban.replace(/\s+/g, '').toUpperCase(),
    `EUR${centsToString(due)}`,
    '', // code motif, non renseigné
    structured,
    unstructured,
  ];
  // Les champs vides de fin ne s'écrivent pas.
  while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  const payload = fields.join('\n');
  if (new TextEncoder().encode(payload).length > MAX_BYTES) {
    return { available: false, reason: 'too-long' };
  }
  return { available: true, payload, paymentMeansIndex: chosen.index };
}
