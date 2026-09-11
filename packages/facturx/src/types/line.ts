import type { Cents, Quantity, Rate, UnitPrice } from '../money.js';
import type { AllowanceReasonCode, ChargeReasonCode, IsoDate, UnitCode } from './codes.js';
import type { TaxInfo } from './tax.js';

/** Remise au niveau ligne — BG-27. */
export interface LineAllowance {
  /** BT-136 — Montant de la remise (hors TVA), en centimes, positif. */
  amount: Cents;
  /** BT-137 — Montant de base sur lequel s'applique la remise. */
  baseAmount?: Cents;
  /** BT-138 — Pourcentage de remise (points de base). */
  percentage?: Rate;
  /** BT-139 — Motif de la remise (texte). Texte OU code obligatoire (BR-42). */
  reason?: string;
  /** BT-140 — Code de motif de remise (UNTDID 5189). */
  reasonCode?: AllowanceReasonCode;
}

/** Frais au niveau ligne — BG-28. */
export interface LineCharge {
  /** BT-141 — Montant des frais (hors TVA), en centimes, positif. */
  amount: Cents;
  /** BT-142 — Montant de base sur lequel s'appliquent les frais. */
  baseAmount?: Cents;
  /** BT-143 — Pourcentage de frais (points de base). */
  percentage?: Rate;
  /** BT-144 — Motif des frais (texte). Texte OU code obligatoire (BR-44). */
  reason?: string;
  /** BT-145 — Code de motif de frais (UNTDID 7161). */
  reasonCode?: ChargeReasonCode;
}

/** Période de facturation d'une ligne — BG-26. */
export interface LinePeriod {
  /** BT-134 — Date de début. */
  start?: IsoDate;
  /** BT-135 — Date de fin (≥ début, BR-30). */
  end?: IsoDate;
}

/** Ligne de facture — BG-25. */
export interface Line {
  /** BT-126 — Identifiant de ligne, unique dans la facture. Obligatoire (BR-21). */
  id: string;
  /** BT-127 — Note de ligne. */
  note?: string;
  /** BT-132 — Référence de la ligne de commande acheteur. */
  orderLineReference?: string;
  /** BT-133 — Référence comptable acheteur pour la ligne. */
  buyerAccountingReference?: string;
  /** BG-26 — Période de facturation de la ligne. */
  period?: LinePeriod;
  /** BT-153 — Désignation de l'article. Obligatoire (BR-25). */
  name: string;
  /** BT-154 — Description de l'article. */
  description?: string;
  /** BT-155 — Référence article vendeur. */
  sellerItemId?: string;
  /** BT-156 — Référence article acheteur. */
  buyerItemId?: string;
  /** BT-157 — Identifiant standard de l'article (ex. GTIN, schéma 0160). */
  standardItemId?: { value: string; scheme: string };
  /** BT-159 — Pays d'origine de l'article (ISO 3166-1 alpha-2). */
  originCountry?: string;
  /** BT-129 — Quantité facturée, 4 décimales. Obligatoire (BR-22). */
  quantity: Quantity;
  /** BT-130 — Unité de la quantité (UN/ECE Rec. 20). Obligatoire (BR-23). */
  unitCode: UnitCode;
  /** BT-146 — Prix unitaire net (hors TVA, après remise sur prix), 4 décimales, ≥ 0 (BR-27). Obligatoire (BR-26). */
  unitPrice: UnitPrice;
  /** BT-148 — Prix unitaire brut avant remise sur prix (BT-147), 4 décimales, ≥ 0 (BR-28). */
  grossUnitPrice?: UnitPrice;
  /** BT-147 — Remise sur prix unitaire (brut − net), 4 décimales. */
  priceDiscount?: UnitPrice;
  /** BT-149 — Quantité de base du prix, 4 décimales. Par défaut 1 (10 000). */
  baseQuantity?: Quantity;
  /** BT-150 — Unité de la quantité de base (doit égaler BT-130). */
  baseQuantityUnitCode?: UnitCode;
  /** BG-27 — Remises de ligne. */
  allowances?: LineAllowance[];
  /** BG-28 — Frais de ligne. */
  charges?: LineCharge[];
  /**
   * BT-131 — Montant net de la ligne (hors TVA) :
   * BT-129 × BT-146 ÷ BT-149, arrondi au centime, − Σ BT-136 + Σ BT-141. Obligatoire (BR-24).
   * Fourni par l'appelant et VÉRIFIÉ (jamais recalculé en silence).
   */
  netAmount: Cents;
  /** BG-30 — Information TVA de la ligne (BT-151, BT-152). */
  tax: TaxInfo;
}
