/**
 * Listes de codes EN 16931 utilisées par le profil Factur-X EN 16931.
 * Les unions sont ouvertes (`string & {}`) là où la liste officielle est longue,
 * fermées là où la norme ou la v1 la restreint.
 */

/** Date calendaire ISO 8601 `YYYY-MM-DD` (format 102 en CII). */
export type IsoDate = `${number}-${number}-${number}`;

/** BT-3 — Code de type de facture (UNTDID 1001) : `380` facture commerciale, `381` avoir (même structure, montants positifs). */
export type InvoiceTypeCode = '380' | '381';
export const INVOICE_TYPE_CODES: readonly InvoiceTypeCode[] = ['380', '381'];

/**
 * Règle FR (réforme, spécifications externes DGFiP) — Nature de l'opération facturée :
 * livraison de biens, prestation de services, ou opération mixte.
 * Portée par le cadre de facturation BT-23 (`B1` / `S1` / `M1`) dans Factur-X.
 */
export type OperationCategory = 'goods' | 'services' | 'mixed';
export const OPERATION_CATEGORIES: readonly OperationCategory[] = ['goods', 'services', 'mixed'];

/** Cadre de facturation BT-23 correspondant à une nature d'opération (dépôt d'une facture par le fournisseur). */
export const BUSINESS_PROCESS_BY_CATEGORY: Readonly<Record<OperationCategory, string>> = {
  goods: 'B1',
  services: 'S1',
  mixed: 'M1',
};

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

/** BT-21 — Code de sujet de note (UNTDID 4451). Ex. : `AAI` info générale, `PMT` paiement, `REG` info réglementaire. */
export type NoteSubjectCode = 'AAI' | 'PMT' | 'REG' | 'ABL' | 'SUR' | 'TXD' | 'ADU' | (string & {});
