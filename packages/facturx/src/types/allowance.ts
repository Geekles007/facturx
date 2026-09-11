import type { Cents, Rate } from '../money.js';
import type { AllowanceReasonCode, ChargeReasonCode } from './codes.js';
import type { TaxInfo } from './tax.js';

/** Remise au niveau document — BG-20. */
export interface DocumentAllowance {
  /** BT-92 — Montant de la remise (hors TVA), en centimes, positif. Obligatoire (BR-31). */
  amount: Cents;
  /** BT-93 — Montant de base. */
  baseAmount?: Cents;
  /** BT-94 — Pourcentage (points de base). */
  percentage?: Rate;
  /** BT-97 — Motif (texte). Texte OU code obligatoire (BR-33). */
  reason?: string;
  /** BT-98 — Code de motif (UNTDID 5189). */
  reasonCode?: AllowanceReasonCode;
  /** BT-95 / BT-96 — Catégorie et taux TVA de la remise. Catégorie obligatoire (BR-32). */
  tax: TaxInfo;
}

/** Frais au niveau document — BG-21. */
export interface DocumentCharge {
  /** BT-99 — Montant des frais (hors TVA), en centimes, positif. Obligatoire (BR-36). */
  amount: Cents;
  /** BT-100 — Montant de base. */
  baseAmount?: Cents;
  /** BT-101 — Pourcentage (points de base). */
  percentage?: Rate;
  /** BT-104 — Motif (texte). Texte OU code obligatoire (BR-38). */
  reason?: string;
  /** BT-105 — Code de motif (UNTDID 7161). */
  reasonCode?: ChargeReasonCode;
  /** BT-102 / BT-103 — Catégorie et taux TVA des frais. Catégorie obligatoire (BR-37). */
  tax: TaxInfo;
}
