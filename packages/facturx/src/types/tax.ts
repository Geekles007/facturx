import type { Cents, Rate } from '../money.js';
import type { ExemptionReasonCode, TaxCategoryCode } from './codes.js';

/**
 * Information TVA d'une ligne (BG-30), d'une remise (BG-20) ou de frais (BG-21) au niveau document.
 * Numéros BT : ligne / remise document / frais document.
 */
export interface TaxInfo {
  /** BT-151 / BT-95 / BT-102 — Catégorie TVA. Obligatoire (BR-CO-04). */
  category: TaxCategoryCode;
  /**
   * BT-152 / BT-96 / BT-103 — Taux TVA en points de base (2000 = 20 %).
   * Obligatoire et > 0 pour `S` (BR-S-05) ; = 0 pour `Z`, `E`, `AE`, `K`, `G` (BR-Z-05…) ;
   * absent pour `O` (BR-O-05).
   */
  rate?: Rate;
}

/** Ventilation de TVA — BG-23. Une entrée par couple (catégorie, taux). */
export interface TaxBreakdown {
  /** BT-118 — Catégorie TVA. */
  category: TaxCategoryCode;
  /** BT-119 — Taux TVA en points de base. Absent pour `O`. */
  rate?: Rate;
  /**
   * BT-116 — Base imposable de la catégorie/taux : Σ lignes − Σ remises + Σ frais
   * portant la même catégorie et le même taux (BR-S-08, BR-Z-08, BR-E-08…).
   */
  taxableAmount: Cents;
  /** BT-117 — Montant de TVA = BT-116 × BT-119 ÷ 100, arrondi à 2 décimales (BR-CO-17). */
  taxAmount: Cents;
  /**
   * BT-120 — Motif d'exonération en texte.
   * Obligatoire (texte OU code) pour `E`, `AE`, `K`, `G`, `O` (BR-E-10, BR-AE-10, BR-K-10, BR-G-10, BR-O-10) ;
   * interdit pour `S` et `Z` (BR-S-10, BR-Z-10).
   * Règle FR : franchise en base → « TVA non applicable, art. 293 B du CGI » ; autoliquidation → « Autoliquidation ».
   */
  exemptionReason?: string;
  /** BT-121 — Code de motif d'exonération (liste VATEX). Mêmes règles que BT-120. */
  exemptionReasonCode?: ExemptionReasonCode;
}
