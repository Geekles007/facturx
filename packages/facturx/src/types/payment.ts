import type { Cents, Rate } from '../money.js';
import type { IsoDate, PaymentMeansCode } from './codes.js';

/** Escompte pour paiement anticipé (mention obligatoire FR, art. L441-9 C. com.). */
export interface EarlyPaymentDiscount {
  /** Taux d'escompte en points de base (ex. 200 = 2 %). */
  rate: Rate;
  /** Délai (en jours à compter de l'émission) pour bénéficier de l'escompte. */
  withinDays: number;
}

/**
 * Conditions de paiement — BT-9 (échéance) et BT-20 (texte des conditions).
 *
 * Règles FR (art. L441-9 et L441-10 C. com.) : la facture doit mentionner la date d'échéance,
 * le taux des pénalités de retard, l'indemnité forfaitaire pour frais de recouvrement (40 €, art. D441-5)
 * et les conditions d'escompte (ou l'absence d'escompte).
 *
 * Deux façons de satisfaire ces mentions :
 * - **champs structurés** (`latePenaltyRate`, `recoveryIndemnity`, `earlyPaymentDiscount`) : le SDK compose
 *   le texte BT-20 (voir `buildPaymentTermsText`) — voie recommandée pour une facture rédigée avec le SDK ;
 * - **texte libre** (`text`) : seule information disponible dans un XML lu (`fromCiiXml`) ; sa présence est
 *   exigée, son contenu n'est pas interprété.
 * La validation FR exige l'une ou l'autre.
 */
export interface PaymentTerms {
  /** BT-9 — Date d'échéance. Obligatoire si BT-20 absent et montant dû > 0 (BR-CO-25). */
  dueDate?: IsoDate;
  /**
   * BT-20 — Texte libre des conditions de paiement.
   * Si absent, généré depuis `latePenaltyRate`, `recoveryIndemnity` et `earlyPaymentDiscount`.
   */
  text?: string;
  /**
   * Règle FR — Taux annuel des pénalités de retard, en points de base (ex. 1000 = 10 %).
   * Doit être > 0 (minimum légal : 3 × le taux d'intérêt légal, art. L441-10 II).
   */
  latePenaltyRate?: Rate;
  /**
   * Règle FR — Indemnité forfaitaire pour frais de recouvrement, en centimes (4000 = 40 €, art. D441-5).
   */
  recoveryIndemnity?: Cents;
  /**
   * Règle FR — Conditions d'escompte pour paiement anticipé, ou `'none'` pour la mention
   * « Pas d'escompte pour paiement anticipé ». Le choix doit être explicite.
   */
  earlyPaymentDiscount?: EarlyPaymentDiscount | 'none';
}

/** Compte bancaire de règlement (virement) — BG-17. */
export interface CreditTransfer {
  /** BT-84 — IBAN (ou identifiant de compte). Obligatoire si BT-81 ∈ {30, 58} (BR-61). */
  iban: string;
  /** BT-85 — Nom du compte. */
  accountName?: string;
  /** BT-86 — BIC / identifiant du prestataire de services de paiement. */
  bic?: string;
}

/** Mandat de prélèvement — BG-19. */
export interface DirectDebit {
  /** BT-89 — Référence unique du mandat (RUM). */
  mandateReference?: string;
  /** BT-90 — Identifiant créancier SEPA (ICS). */
  creditorId?: string;
  /** BT-91 — IBAN du compte débité. */
  debitedIban?: string;
}

/** Instructions de paiement — BG-16. */
export interface PaymentMeans {
  /** BT-81 — Code du moyen de paiement (UNTDID 4461). Obligatoire (BR-49). */
  typeCode: PaymentMeansCode;
  /** BT-82 — Libellé du moyen de paiement. */
  text?: string;
  /** BG-17 — Virement : compte à créditer. */
  creditTransfer?: CreditTransfer;
  /** BG-19 — Prélèvement : mandat. */
  directDebit?: DirectDebit;
}
