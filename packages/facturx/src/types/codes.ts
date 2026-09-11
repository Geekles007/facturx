/**
 * Listes de codes EN 16931 utilisées par le profil Factur-X EN 16931.
 * Les unions sont ouvertes (`string & {}`) là où la liste officielle est longue,
 * fermées là où la norme ou la v1 la restreint.
 */

/** Date calendaire ISO 8601 `YYYY-MM-DD` (format 102 en CII). */
export type IsoDate = `${number}-${number}-${number}`;

/**
 * BT-3 — Code de type de facture (UNTDID 1001), restreint aux codes de la règle BR-FR-04 déjà intégrés
 * à EN 16931 : `380` facture, `384` rectificative, `386` acompte, `389` auto-facturée, `393` affacturée,
 * `381` avoir, `261` avoir auto-facturé, `262` avoir pour remise globale, `396` avoir affacturé.
 * Les codes « en attente d'intégration » (500, 501, 471–473, 502, 503) sont refusés jusqu'à leur adoption.
 * Même structure pour tous ; montants positifs pour les avoirs.
 */
export type InvoiceTypeCode = '380' | '384' | '386' | '389' | '393' | '381' | '261' | '262' | '396';
export const INVOICE_TYPE_LABELS: Readonly<Record<InvoiceTypeCode, string>> = {
  '380': 'Facture commerciale',
  '384': 'Facture rectificative',
  '386': "Facture d'acompte",
  '389': 'Facture auto-facturée',
  '393': 'Facture affacturée',
  '381': 'Avoir',
  '261': 'Avoir auto-facturé',
  '262': 'Avoir pour remise globale',
  '396': 'Avoir affacturé',
};
export const INVOICE_TYPE_CODES: readonly InvoiceTypeCode[] = Object.keys(
  INVOICE_TYPE_LABELS,
) as InvoiceTypeCode[];
/** Avoirs : 381, 261, 262, 396. */
export function isCreditNoteType(code: string | undefined): boolean {
  return code === '381' || code === '261' || code === '262' || code === '396';
}
/** Documents émis par l'acheteur (autofacturation, BT-3 = 389 / 261). */
export function isSelfBilledType(code: string | undefined): boolean {
  return code === '389' || code === '261';
}

/**
 * Règle FR (réforme, spécifications externes DGFiP) — Nature de l'opération facturée :
 * livraison de biens, prestation de services, ou opération mixte.
 * Portée par le cadre de facturation BT-23 (`B1` / `S1` / `M1`) dans Factur-X.
 */
export type OperationCategory = 'goods' | 'services' | 'mixed';
export const OPERATION_CATEGORIES: readonly OperationCategory[] = ['goods', 'services', 'mixed'];

/**
 * BT-23 — Cadre de facturation (règle BR-FR-08, AFNOR XP Z12-012). La première lettre donne la nature
 * de l'opération (B biens, S services, M mixte), le chiffre le cas d'usage.
 */
export type BusinessProcessCode =
  | 'B1'
  | 'S1'
  | 'M1'
  | 'B2'
  | 'S2'
  | 'M2'
  | 'B4'
  | 'S4'
  | 'M4'
  | 'S5'
  | 'S6'
  | 'B7'
  | 'S7';

/** Libellés des cadres de facturation autorisés (BR-FR-08). */
export const BUSINESS_PROCESS_CODES: Readonly<Record<BusinessProcessCode, string>> = {
  B1: "Dépôt d'une facture de bien",
  S1: "Dépôt d'une facture de prestation de service",
  M1: "Dépôt d'une facture double (biens et services non accessoires l'un de l'autre)",
  B2: "Dépôt d'une facture de bien déjà payée",
  S2: "Dépôt d'une facture de prestation de service déjà payée",
  M2: "Dépôt d'une facture double déjà payée",
  B4: "Dépôt d'une facture définitive (après acompte) de bien",
  S4: "Dépôt d'une facture définitive (après acompte) de service",
  M4: "Dépôt d'une facture définitive (après acompte) double",
  S5: "Dépôt par un sous-traitant d'une facture de prestation de service",
  S6: "Dépôt par un cotraitant d'une facture de prestation de service",
  B7: "Dépôt d'une facture de bien ayant fait l'objet d'un e-reporting (TVA déjà collectée)",
  S7: "Dépôt d'une facture de prestation de service ayant fait l'objet d'un e-reporting (TVA déjà collectée)",
};

export function isBusinessProcessCode(value: string | undefined): value is BusinessProcessCode {
  return value !== undefined && Object.hasOwn(BUSINESS_PROCESS_CODES, value);
}

/** Cadre de facturation par défaut d'une nature d'opération : dépôt d'une facture par le fournisseur. */
export const BUSINESS_PROCESS_BY_CATEGORY: Readonly<
  Record<OperationCategory, BusinessProcessCode>
> = {
  goods: 'B1',
  services: 'S1',
  mixed: 'M1',
};

/** BR-FR-15 — Catégories de TVA acceptées en France (L et M ne sont pas pertinentes). */
export const FRENCH_TAX_CATEGORY_CODES: readonly TaxCategoryCode[] = [
  'S',
  'E',
  'AE',
  'K',
  'G',
  'O',
  'Z',
];

/** BR-FR-16 — Taux de TVA autorisés, en points de base (2000 = 20 %). */
export const FRENCH_VAT_RATES_BPS: readonly number[] = [
  0, 90, 105, 175, 210, 550, 700, 850, 920, 960, 1000, 1300, 1960, 2000, 2060,
];

/**
 * BR-FR-20 — Traitement attendu de la facture, porté par une note `BAR` (BT-21/BT-22) :
 * `B2B` e-invoicing, `B2BINT` e-reporting des ventes B2B internationales, `B2C` e-reporting B2C,
 * `OUTOFSCOPE` hors réforme, `ARCHIVEONLY` avoir interne d'annulation (pas de transmission).
 */
export type ProcessingCode = 'B2B' | 'B2BINT' | 'B2C' | 'OUTOFSCOPE' | 'ARCHIVEONLY';
export const PROCESSING_CODES: Readonly<Record<ProcessingCode, string>> = {
  B2B: 'Relève du e-invoicing',
  B2BINT: 'Relève du e-reporting des ventes B2B internationales',
  B2C: 'Relève du e-reporting des ventes B2C',
  OUTOFSCOPE: 'Hors réforme',
  ARCHIVEONLY: "Avoir interne d'annulation, à ne pas transmettre",
};
export function isProcessingCode(value: string | undefined): value is ProcessingCode {
  return value !== undefined && Object.hasOwn(PROCESSING_CODES, value);
}

/** BR-FR-05 — Codes de notes obligatoires : PMD pénalités de retard, PMT indemnité forfaitaire, AAB escompte. */
export const LEGAL_NOTE_CODES = ['PMD', 'PMT', 'AAB'] as const;
export type LegalNoteCode = (typeof LEGAL_NOTE_CODES)[number];

/** Nature d'opération déduite d'un cadre de facturation BT-23 (`B*`, `S*`, `M*`), sinon `undefined`. */
export function operationCategoryFromBusinessProcess(
  id: string | undefined,
): OperationCategory | undefined {
  const letter = id?.trim().charAt(0).toUpperCase();
  return letter === 'B'
    ? 'goods'
    : letter === 'S'
      ? 'services'
      : letter === 'M'
        ? 'mixed'
        : undefined;
}

/** BT-5 — Code devise ISO 4217. */
export type CurrencyCode = 'EUR' | (string & {});

/** Code pays ISO 3166-1 alpha-2 (BT-40, BT-55, BT-80…). */
export type CountryCode = 'FR' | (string & {});

/**
 * BT-118 / BT-151 / BT-95 / BT-102 — Code de catégorie TVA (UNTDID 5305, sous-ensemble EN 16931).
 * S = taux normal/réduit, Z = taux zéro, E = exonéré, AE = autoliquidation,
 * K = livraison intracommunautaire, G = export hors UE, O = hors champ,
 * L = IGIC (Canaries), M = IPSI (Ceuta/Melilla).
 */
export type TaxCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M';
export const TAX_CATEGORY_CODES: readonly TaxCategoryCode[] = [
  'S',
  'Z',
  'E',
  'AE',
  'K',
  'G',
  'O',
  'L',
  'M',
];

/** BT-121 — Code de motif d'exonération de TVA (liste VATEX, CEF). */
export type ExemptionReasonCode =
  | 'VATEX-EU-AE'
  | 'VATEX-EU-G'
  | 'VATEX-EU-IC'
  | 'VATEX-EU-O'
  | 'VATEX-EU-79-C'
  | 'VATEX-EU-132'
  | 'VATEX-FR-FRANCHISE'
  | 'VATEX-FR-CNWVAT'
  | (string & {});

/** BT-130 / BT-150 — Code d'unité de mesure (UN/ECE Recommendation 20 & 21). */
export type UnitCode =
  | 'C62' // unité
  | 'H87' // pièce
  | 'HUR' // heure
  | 'DAY' // jour
  | 'MON' // mois
  | 'ANN' // année
  | 'KGM' // kilogramme
  | 'GRM' // gramme
  | 'TNE' // tonne
  | 'MTR' // mètre
  | 'MTK' // mètre carré
  | 'MTQ' // mètre cube
  | 'LTR' // litre
  | 'KWH' // kilowatt-heure
  | 'E48' // unité de service
  | 'SET' // ensemble
  | 'XPP' // pièce (Rec. 21)
  | 'LS' // forfait
  | (string & {});

/** BT-81 — Code du moyen de paiement (UNTDID 4461). */
export type PaymentMeansCode =
  | '10' // espèces
  | '20' // chèque
  | '30' // virement
  | '42' // paiement sur compte bancaire
  | '48' // carte bancaire
  | '49' // prélèvement
  | '57' // ordre permanent
  | '58' // virement SEPA
  | '59' // prélèvement SEPA
  | '97' // compensation
  | (string & {});

/** BT-98 / BT-140 — Code de motif de remise (UNTDID 5189). */
export type AllowanceReasonCode =
  | '41' // bonus travaux anticipés
  | '42' // autre bonus
  | '60' // remise fabricant consommateur
  | '62' // dû à l'état militaire
  | '63' // dû à un accident de travail
  | '64' // accord spécial
  | '65' // erreur de production
  | '66' // dispositif de retour
  | '67' // remise commerciale
  | '68' // dommage de transport
  | '70' // remise dans la période
  | '71' // remise de compte
  | '88' // remise d'ajustement
  | '95' // remise
  | '100' // remise spéciale
  | '102' // remise fixe long terme
  | '103' // temporaire
  | '104' // standard
  | '105' // chiffre d'affaires annuel
  | (string & {});

/** BT-105 / BT-145 — Code de motif de frais (UNTDID 7161). */
export type ChargeReasonCode =
  | 'AA' // publicité
  | 'AAA' // télécommunication
  | 'ABK' // divers
  | 'ADR' // autres services
  | 'ADT' // enlèvement
  | 'FC' // frais de transport
  | 'FI' // frais financiers
  | 'PC' // emballage
  | 'ZZZ' // défini d'un commun accord
  | (string & {});

/** BT-35 / BT-50 — Schéma d'adresse électronique (liste EAS). */
export type ElectronicAddressScheme =
  | '0002' // SIREN
  | '0009' // SIRET
  | '0060' // DUNS
  | '0088' // EAN/GLN
  | '0208' // BCE (Belgique)
  | '0225' // FRCTC — code routage Factur-X France
  | 'EM' // e-mail
  | (string & {});

/**
 * BT-21 — Code de sujet de note (UNTDID 4451). Règles FR (BR-FR-05/06/07) :
 * `PMD` pénalités de retard, `PMT` indemnité forfaitaire de 40 €, `AAB` escompte (chacun une seule fois) ;
 * `TXD` mention TVA (une seule fois) ; `ABL` information légale (RCS, capital…), `AAI` information générale,
 * `SUR` remarques fournisseur, `ACC` clause de subrogation (affacturage), `CUS` information douanière,
 * `BLU` éco-participation, `BAR` type de traitement attendu, `DCL` mandat de facturation, `REG` réglementaire.
 */
export type NoteSubjectCode =
  | 'PMD'
  | 'PMT'
  | 'AAB'
  | 'TXD'
  | 'ABL'
  | 'AAI'
  | 'SUR'
  | 'ACC'
  | 'CUS'
  | 'BLU'
  | 'BAR'
  | 'DCL'
  | 'REG'
  | 'ADU'
  | (string & {});
