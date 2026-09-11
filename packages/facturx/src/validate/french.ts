import type { Invoice } from '../types/invoice.js';
import type { Party } from '../types/party.js';
import { isNonEmptyString, isSafeInteger, isValidSiren, isValidSiret } from './formats.js';
import type { IssueCode, IssueCollector } from './issues.js';

function checkPartyIds(
  party: Party | undefined,
  path: string,
  codes: { siren: IssueCode; siret: IssueCode },
  sirenRequired: boolean,
  c: IssueCollector,
): void {
  if (!party) return;
  if (party.siren === undefined) {
    if (sirenRequired) {
      c.add(
        codes.siren,
        `${path}.siren`,
        'Le SIREN (BT-30, schéma 0002) est obligatoire pour un vendeur établi en France.',
      );
    }
  } else if (!isValidSiren(party.siren)) {
    c.add(codes.siren, `${path}.siren`, 'SIREN invalide : 9 chiffres avec clé de Luhn attendus.', {
      actual: party.siren,
    });
  }
  if (party.siret !== undefined) {
    if (!isValidSiret(party.siret)) {
      c.add(
        codes.siret,
        `${path}.siret`,
        'SIRET invalide : 14 chiffres avec clé de Luhn attendus.',
        {
          actual: party.siret,
        },
      );
    } else if (party.siren !== undefined && !party.siret.startsWith(party.siren)) {
      c.add(codes.siret, `${path}.siret`, 'Le SIRET doit commencer par le SIREN de la partie.', {
        expected: `${party.siren}…`,
        actual: party.siret,
      });
    }
  }
  if (
    party.vatId !== undefined &&
    party.siren !== undefined &&
    party.vatId.startsWith('FR') &&
    party.vatId.length === 13 &&
    party.vatId.slice(4) !== party.siren
  ) {
    c.add(
      'FR-VAT-ID',
      `${path}.vatId`,
      'Le numéro de TVA FR doit se terminer par le SIREN de la partie.',
      {
        expected: `FR…${party.siren}`,
        actual: party.vatId,
      },
    );
  }
}

/**
 * Règles françaises (Code de commerce art. L441-9, L441-10, D441-5 ; CGI art. 242 nonies A).
 * Appliquées uniquement si le vendeur est établi en France (BT-40 = FR).
 */
export function checkFrenchRules(inv: Invoice, c: IssueCollector): void {
  if (inv.seller?.address?.countryCode !== 'FR') return;

  checkPartyIds(
    inv.seller,
    'seller',
    { siren: 'FR-SELLER-SIREN', siret: 'FR-SELLER-SIRET' },
    true,
    c,
  );
  checkPartyIds(inv.buyer, 'buyer', { siren: 'FR-BUYER-SIREN', siret: 'FR-BUYER-SIRET' }, false, c);

  // Date de la vente / prestation : date de livraison OU période (L441-9)
  const d = inv.delivery;
  const hasDate = d?.date !== undefined;
  const hasPeriod = d?.period?.start !== undefined || d?.period?.end !== undefined;
  if (!hasDate && !hasPeriod) {
    c.add(
      'FR-DELIVERY',
      'delivery',
      'La date de livraison (BT-72) ou la période de facturation (BT-73/BT-74) est obligatoire (art. L441-9 C. com.).',
    );
  }

  // Mentions de paiement (L441-9, L441-10, D441-5) : texte BT-20 fourni OU champs structurés complets
  const pt = inv.paymentTerms;
  if (!pt) return;
  const hasText = isNonEmptyString(pt.text);
  if (pt.text !== undefined && !hasText) {
    c.add(
      'FR-PAYMENT-TERMS-TEXT',
      'paymentTerms.text',
      'Le texte des conditions de paiement (BT-20) ne peut pas être vide.',
    );
  }
  if (pt.latePenaltyRate === undefined) {
    if (!hasText) {
      c.add(
        'FR-LATE-PENALTY',
        'paymentTerms.latePenaltyRate',
        'Le taux des pénalités de retard est obligatoire, sauf si un texte BT-20 est fourni (art. L441-10 C. com.).',
      );
    }
  } else if (!isSafeInteger(pt.latePenaltyRate) || pt.latePenaltyRate <= 0) {
    c.add(
      'FR-LATE-PENALTY',
      'paymentTerms.latePenaltyRate',
      'Le taux des pénalités de retard doit être > 0 (art. L441-10 C. com.).',
      {
        expected: '> 0',
        actual: pt.latePenaltyRate,
      },
    );
  }
  if (pt.recoveryIndemnity === undefined) {
    if (!hasText) {
      c.add(
        'FR-RECOVERY-INDEMNITY',
        'paymentTerms.recoveryIndemnity',
        'L’indemnité forfaitaire pour frais de recouvrement est obligatoire, sauf si un texte BT-20 est fourni (40 €, art. D441-5 C. com.).',
      );
    }
  } else if (!isSafeInteger(pt.recoveryIndemnity) || pt.recoveryIndemnity <= 0) {
    c.add(
      'FR-RECOVERY-INDEMNITY',
      'paymentTerms.recoveryIndemnity',
      'L’indemnité forfaitaire doit être > 0 (40 €, art. D441-5 C. com.).',
      {
        expected: 4000,
        actual: pt.recoveryIndemnity,
      },
    );
  }
  const disc = pt.earlyPaymentDiscount;
  if (disc === undefined) {
    if (!hasText) {
      c.add(
        'FR-EARLY-PAYMENT-DISCOUNT',
        'paymentTerms.earlyPaymentDiscount',
        'Les conditions d’escompte doivent être explicites ({ rate, withinDays } ou "none"), sauf si un texte BT-20 est fourni (art. L441-9 C. com.).',
      );
    }
  } else if (disc !== 'none') {
    if (!isSafeInteger(disc.rate) || disc.rate <= 0) {
      c.add(
        'FR-EARLY-PAYMENT-DISCOUNT',
        'paymentTerms.earlyPaymentDiscount.rate',
        'Taux d’escompte > 0 attendu.',
        {
          actual: disc.rate,
        },
      );
    }
    if (!isSafeInteger(disc.withinDays) || disc.withinDays <= 0) {
      c.add(
        'FR-EARLY-PAYMENT-DISCOUNT',
        'paymentTerms.earlyPaymentDiscount.withinDays',
        'Délai d’escompte (jours) > 0 attendu.',
        {
          actual: disc.withinDays,
        },
      );
    }
  }
}
