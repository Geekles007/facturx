/**
 * Listes de codes proposées dans les menus du Studio, avec leur libellé dans les deux langues.
 *
 * Les listes officielles sont longues (UN/ECE Rec. 20 compte deux mille unités) : on n'en garde
 * que ce qu'une facture française utilise, dans un ordre d'usage plutôt qu'alphabétique. Les
 * codes eux-mêmes restent ceux de la norme — c'est eux que le XML transporte.
 */

import {
  BUSINESS_PROCESS_CODES,
  type BusinessProcessCode,
  type InvoiceTypeCode,
  type OperationCategory,
  type ProcessingCode,
} from 'facturx-sdk';

export type Lang = 'fr' | 'en';

export interface Option<T extends string = string> {
  value: T;
  fr: string;
  en: string;
  /** Explication courte, affichée sous le menu. */
  hintFr?: string;
  hintEn?: string;
  group?: 'common' | 'more';
}

export const pick = (o: { fr: string; en: string }, lang: Lang): string => o[lang];

export const DOCUMENT_TYPES: Option<InvoiceTypeCode>[] = [
  {
    value: '380',
    fr: 'Facture',
    en: 'Invoice',
    hintFr: 'Le cas courant : une vente ou une prestation.',
    hintEn: 'The usual case: a sale or a service.',
  },
  {
    value: '386',
    fr: "Facture d'acompte",
    en: 'Prepayment invoice',
    hintFr: 'Un acompte avant livraison ; la facture définitive le déduira.',
    hintEn: 'A deposit before delivery; the final invoice will deduct it.',
  },
  {
    value: '381',
    fr: 'Avoir',
    en: 'Credit note',
    hintFr: "Annule ou réduit une facture : montants positifs, facture d'origine en référence.",
    hintEn: 'Cancels or reduces an invoice: positive amounts, original invoice referenced.',
  },
  {
    value: '384',
    fr: 'Facture rectificative',
    en: 'Corrected invoice',
    hintFr: 'Remplace une facture erronée, référencée.',
    hintEn: 'Replaces an erroneous invoice, which it references.',
  },
  {
    value: '389',
    fr: 'Facture auto-facturée',
    en: 'Self-billed invoice',
    hintFr: "Émise par l'acheteur au nom du vendeur, sous mandat.",
    hintEn: "Issued by the buyer on the seller's behalf, under a mandate.",
    group: 'more',
  },
  {
    value: '393',
    fr: 'Facture affacturée',
    en: 'Factored invoice',
    hintFr: 'Créance cédée à un affactureur : ajoutez la mention de subrogation.',
    hintEn: 'Receivable assigned to a factor: add the subrogation notice.',
    group: 'more',
  },
  { value: '261', fr: 'Avoir auto-facturé', en: 'Self-billed credit note', group: 'more' },
  {
    value: '262',
    fr: 'Avoir pour remise globale',
    en: 'Credit note for global discount',
    group: 'more',
  },
  { value: '396', fr: 'Avoir affacturé', en: 'Factored credit note', group: 'more' },
];

export const OPERATION_CATEGORIES: Option<OperationCategory>[] = [
  { value: 'services', fr: 'Prestation de services', en: 'Supply of services' },
  { value: 'goods', fr: 'Livraison de biens', en: 'Supply of goods' },
  { value: 'mixed', fr: 'Biens et services', en: 'Goods and services' },
];

/** Libellés courts, pour un choix segmenté ; le libellé complet sert d'infobulle. */
export const OPERATION_SHORT: Record<OperationCategory, { fr: string; en: string }> = {
  services: { fr: 'Services', en: 'Services' },
  goods: { fr: 'Biens', en: 'Goods' },
  mixed: { fr: 'Mixte', en: 'Mixed' },
};

export const PROCESSING: Option<ProcessingCode | ''>[] = [
  { value: '', fr: 'Non précisé', en: 'Not specified' },
  {
    value: 'B2B',
    fr: 'B2B — e-invoicing (plateforme agréée)',
    en: 'B2B — e-invoicing (approved platform)',
    hintFr:
      "L'adresse électronique 0225 de l'acheteur devient obligatoire et doit commencer par son SIREN.",
    hintEn: "The buyer's 0225 electronic address becomes mandatory and must start with its SIREN.",
  },
  { value: 'B2BINT', fr: 'B2B international — e-reporting', en: 'International B2B — e-reporting' },
  { value: 'B2C', fr: 'B2C — e-reporting', en: 'B2C — e-reporting' },
  { value: 'OUTOFSCOPE', fr: 'Hors réforme', en: 'Out of scope' },
  {
    value: 'ARCHIVEONLY',
    fr: 'Archivage seul (avoir interne)',
    en: 'Archive only (internal credit note)',
  },
];

const BUSINESS_PROCESS_EN: Record<BusinessProcessCode, string> = {
  B1: 'Goods invoice',
  S1: 'Services invoice',
  M1: 'Mixed invoice (goods and services)',
  B2: 'Goods invoice, already paid',
  S2: 'Services invoice, already paid',
  M2: 'Mixed invoice, already paid',
  B4: 'Final goods invoice after deposit',
  S4: 'Final services invoice after deposit',
  M4: 'Final mixed invoice after deposit',
  S5: 'Services invoice by a subcontractor',
  S6: 'Services invoice by a co-contractor',
  B7: 'Goods invoice already e-reported (VAT collected)',
  S7: 'Services invoice already e-reported (VAT collected)',
};

export const BUSINESS_PROCESSES: Option<BusinessProcessCode | ''>[] = [
  { value: '', fr: 'Automatique (déduit de la nature)', en: 'Automatic (from the nature)' },
  ...(Object.entries(BUSINESS_PROCESS_CODES) as [BusinessProcessCode, string][]).map(
    ([value, fr]) => ({
      value,
      fr: `${value} — ${fr.replace(/^Dépôt d'une facture /, '').replace(/^Dépôt par /, 'par ')}`,
      en: `${value} — ${BUSINESS_PROCESS_EN[value]}`,
    }),
  ),
];

/**
 * Taux et régimes de TVA d'une ligne, sous la forme `catégorie:taux`. Les taux sont ceux de la
 * règle BR-FR-16 ; les régimes sans taux portent un motif d'exonération (voir `EXEMPTIONS`).
 */
export const VAT_CHOICES: Option[] = [
  { value: 'S:20', fr: '20 %', en: '20%' },
  { value: 'S:10', fr: '10 %', en: '10%' },
  { value: 'S:5.5', fr: '5,5 %', en: '5.5%' },
  { value: 'S:2.1', fr: '2,1 %', en: '2.1%' },
  { value: 'E:0', fr: 'Exonéré (franchise, art. 261…)', en: 'Exempt (franchise, art. 261…)' },
  { value: 'AE:0', fr: 'Autoliquidation', en: 'Reverse charge' },
  { value: 'K:0', fr: 'Livraison intracommunautaire', en: 'Intra-EU supply' },
  { value: 'G:0', fr: 'Export hors UE', en: 'Export outside the EU' },
  { value: 'O:', fr: 'Hors champ de la TVA', en: 'Outside the scope of VAT' },
  { value: 'Z:0', fr: 'Taux zéro', en: 'Zero rated', group: 'more' },
  { value: 'S:8.5', fr: '8,5 % (DOM)', en: '8.5% (overseas)', group: 'more' },
  { value: 'S:1.75', fr: '1,75 % (DOM)', en: '1.75% (overseas)', group: 'more' },
  { value: 'S:1.05', fr: '1,05 % (DOM)', en: '1.05% (overseas)', group: 'more' },
  { value: 'S:0.9', fr: '0,9 % (Corse)', en: '0.9% (Corsica)', group: 'more' },
  { value: 'S:13', fr: '13 % (Corse)', en: '13% (Corsica)', group: 'more' },
  { value: 'S:9.2', fr: '9,2 %', en: '9.2%', group: 'more' },
  { value: 'S:9.6', fr: '9,6 %', en: '9.6%', group: 'more' },
  { value: 'S:7', fr: '7 %', en: '7%', group: 'more' },
  { value: 'S:19.6', fr: '19,6 %', en: '19.6%', group: 'more' },
  { value: 'S:20.6', fr: '20,6 %', en: '20.6%', group: 'more' },
];

/** Catégories qui exigent un motif d'exonération (BR-E-10, BR-AE-10, BR-IC-10, BR-G-10, BR-O-10). */
export const EXEMPT_CATEGORIES = ['E', 'AE', 'K', 'G', 'O'] as const;
export type ExemptCategory = (typeof EXEMPT_CATEGORIES)[number];

export interface Exemption extends Option {
  /** Mention légale à imprimer (texte BT-120), en français : c'est la langue de la loi. */
  text: string;
  categories: readonly ExemptCategory[];
}

/** Motifs d'exonération (liste VATEX) et la mention que chacun appelle sur une facture française. */
export const EXEMPTIONS: Exemption[] = [
  {
    value: 'VATEX-FR-FRANCHISE',
    fr: 'Franchise en base (micro-entreprise)',
    en: 'VAT franchise (small business)',
    text: 'TVA non applicable, art. 293 B du CGI',
    categories: ['E'],
  },
  {
    value: 'VATEX-EU-132',
    fr: "Exonération d'intérêt général (santé, enseignement…)",
    en: 'Public-interest exemption (health, education…)',
    text: 'Exonération de TVA, article 261 du CGI',
    categories: ['E'],
  },
  {
    value: 'VATEX-EU-79-C',
    fr: 'Débours',
    en: 'Disbursements',
    text: 'Débours refacturés à l’euro près, exclus de la base imposable (art. 267 II 2° du CGI)',
    categories: ['E', 'O'],
  },
  {
    value: 'VATEX-EU-AE',
    fr: 'Autoliquidation',
    en: 'Reverse charge',
    text: 'Autoliquidation',
    categories: ['AE'],
  },
  {
    value: 'VATEX-EU-IC',
    fr: 'Livraison intracommunautaire',
    en: 'Intra-Community supply',
    text: 'Exonération de TVA, article 262 ter, I du CGI',
    categories: ['K'],
  },
  {
    value: 'VATEX-EU-G',
    fr: 'Export hors Union européenne',
    en: 'Export outside the EU',
    text: 'Exonération de TVA, article 262 I du CGI',
    categories: ['G'],
  },
  {
    value: 'VATEX-EU-O',
    fr: 'Hors champ de la TVA',
    en: 'Outside the scope of VAT',
    text: "Opération hors du champ d'application de la TVA",
    categories: ['O'],
  },
];

export const DEFAULT_EXEMPTION: Record<ExemptCategory, string> = {
  E: 'VATEX-FR-FRANCHISE',
  AE: 'VATEX-EU-AE',
  K: 'VATEX-EU-IC',
  G: 'VATEX-EU-G',
  O: 'VATEX-EU-O',
};

/** Unités (UN/ECE Rec. 20 et 21), dans l'ordre où on les cherche. */
export const UNITS: Option[] = [
  { value: 'C62', fr: 'Unité', en: 'Unit' },
  { value: 'HUR', fr: 'Heure', en: 'Hour' },
  { value: 'DAY', fr: 'Jour', en: 'Day' },
  { value: 'LS', fr: 'Forfait', en: 'Lump sum' },
  { value: 'H87', fr: 'Pièce', en: 'Piece' },
  { value: 'MON', fr: 'Mois', en: 'Month' },
  { value: 'ANN', fr: 'Année', en: 'Year' },
  { value: 'WEE', fr: 'Semaine', en: 'Week', group: 'more' },
  { value: 'MIN', fr: 'Minute', en: 'Minute', group: 'more' },
  { value: 'E48', fr: 'Unité de service', en: 'Service unit', group: 'more' },
  { value: 'SET', fr: 'Lot', en: 'Set', group: 'more' },
  { value: 'PR', fr: 'Paire', en: 'Pair', group: 'more' },
  { value: 'KGM', fr: 'Kilogramme', en: 'Kilogram', group: 'more' },
  { value: 'GRM', fr: 'Gramme', en: 'Gram', group: 'more' },
  { value: 'TNE', fr: 'Tonne', en: 'Tonne', group: 'more' },
  { value: 'MTR', fr: 'Mètre', en: 'Metre', group: 'more' },
  { value: 'KMT', fr: 'Kilomètre', en: 'Kilometre', group: 'more' },
  { value: 'MTK', fr: 'Mètre carré', en: 'Square metre', group: 'more' },
  { value: 'MTQ', fr: 'Mètre cube', en: 'Cubic metre', group: 'more' },
  { value: 'LTR', fr: 'Litre', en: 'Litre', group: 'more' },
  { value: 'KWH', fr: 'Kilowattheure', en: 'Kilowatt hour', group: 'more' },
];

/** Moyens de paiement (UNTDID 4461). */
export const PAYMENT_MEANS: Option[] = [
  { value: '58', fr: 'Virement SEPA', en: 'SEPA credit transfer' },
  { value: '30', fr: 'Virement', en: 'Credit transfer' },
  { value: '59', fr: 'Prélèvement SEPA', en: 'SEPA direct debit' },
  { value: '48', fr: 'Carte bancaire', en: 'Bank card' },
  { value: '20', fr: 'Chèque', en: 'Cheque' },
  { value: '10', fr: 'Espèces', en: 'Cash' },
  { value: '42', fr: 'Paiement sur compte bancaire', en: 'Payment to bank account', group: 'more' },
  { value: '49', fr: 'Prélèvement', en: 'Direct debit', group: 'more' },
  { value: '57', fr: 'Ordre permanent', en: 'Standing agreement', group: 'more' },
  { value: '97', fr: 'Compensation', en: 'Clearing between partners', group: 'more' },
];

/** Motifs de remise (UNTDID 5189). */
export const ALLOWANCE_REASONS: Option[] = [
  { value: '', fr: 'Sans code', en: 'No code' },
  { value: '95', fr: 'Remise', en: 'Discount' },
  { value: '67', fr: 'Remise commerciale', en: 'Commercial discount' },
  { value: '100', fr: 'Remise spéciale', en: 'Special rebate' },
  { value: '64', fr: 'Accord spécial', en: 'Special agreement' },
  { value: '105', fr: "Remise sur chiffre d'affaires", en: 'Annual turnover' },
  { value: '66', fr: 'Retour', en: 'Return' },
  { value: '65', fr: 'Erreur de production', en: 'Production error' },
  { value: '68', fr: 'Dommage au transport', en: 'Transport damage' },
  { value: '41', fr: 'Bonus travaux anticipés', en: 'Bonus for works ahead of schedule' },
];

/** Motifs de frais (UNTDID 7161). */
export const CHARGE_REASONS: Option[] = [
  { value: '', fr: 'Sans code', en: 'No code' },
  { value: 'FC', fr: 'Frais de port', en: 'Freight' },
  { value: 'PC', fr: 'Emballage', en: 'Packing' },
  { value: 'ABK', fr: 'Divers', en: 'Miscellaneous' },
  { value: 'ADR', fr: 'Autres services', en: 'Other services' },
  { value: 'FI', fr: 'Frais financiers', en: 'Financing' },
  { value: 'AA', fr: 'Publicité', en: 'Advertising' },
  { value: 'AAA', fr: 'Télécommunication', en: 'Telecommunication' },
  { value: 'ZZZ', fr: "Défini d'un commun accord", en: 'Mutually defined' },
];

/** Sujets de note (UNTDID 4451) qu'un émetteur écrit lui-même ; PMD, PMT, AAB et BAR sont générés. */
export const NOTE_SUBJECTS: Option[] = [
  { value: '', fr: 'Note libre', en: 'Free note' },
  { value: 'AAI', fr: 'Information générale', en: 'General information' },
  { value: 'SUR', fr: 'Remarque du fournisseur', en: 'Supplier remarks' },
  { value: 'ABL', fr: 'Information légale', en: 'Legal information' },
  { value: 'TXD', fr: 'Mention fiscale', en: 'Tax declaration' },
  { value: 'REG', fr: 'Information réglementaire', en: 'Regulatory information' },
  { value: 'ACC', fr: 'Subrogation (affacturage)', en: 'Assignment notice (factoring)' },
  { value: 'BLU', fr: 'Éco-participation', en: 'Eco-contribution' },
  { value: 'CUS', fr: 'Douane', en: 'Customs' },
  { value: 'DCL', fr: 'Mandat de facturation', en: 'Billing mandate' },
];

/** Schémas d'adresse électronique (liste EAS) utiles en France. */
export const ADDRESS_SCHEMES: Option[] = [
  { value: '0225', fr: '0225 — SIREN (réforme)', en: '0225 — SIREN (French reform)' },
  { value: '0009', fr: '0009 — SIRET', en: '0009 — SIRET' },
  { value: 'EM', fr: 'EM — adresse e-mail', en: 'EM — e-mail address' },
  { value: '0088', fr: '0088 — GLN', en: '0088 — GLN' },
  { value: '0002', fr: '0002 — SIREN (ancien)', en: '0002 — SIREN (legacy)' },
];

export const CURRENCIES: Option[] = [
  { value: 'EUR', fr: 'Euro (EUR)', en: 'Euro (EUR)' },
  { value: 'USD', fr: 'Dollar américain (USD)', en: 'US dollar (USD)' },
  { value: 'GBP', fr: 'Livre sterling (GBP)', en: 'Pound sterling (GBP)' },
  { value: 'CHF', fr: 'Franc suisse (CHF)', en: 'Swiss franc (CHF)' },
  { value: 'CAD', fr: 'Dollar canadien (CAD)', en: 'Canadian dollar (CAD)' },
  { value: 'XOF', fr: 'Franc CFA (XOF)', en: 'CFA franc (XOF)' },
  { value: 'XAF', fr: 'Franc CFA (XAF)', en: 'CFA franc (XAF)' },
  { value: 'MAD', fr: 'Dirham marocain (MAD)', en: 'Moroccan dirham (MAD)' },
];

export const COUNTRIES: Option[] = [
  { value: 'FR', fr: 'France', en: 'France' },
  { value: 'BE', fr: 'Belgique', en: 'Belgium' },
  { value: 'LU', fr: 'Luxembourg', en: 'Luxembourg' },
  { value: 'CH', fr: 'Suisse', en: 'Switzerland' },
  { value: 'MC', fr: 'Monaco', en: 'Monaco' },
  { value: 'DE', fr: 'Allemagne', en: 'Germany' },
  { value: 'ES', fr: 'Espagne', en: 'Spain' },
  { value: 'IT', fr: 'Italie', en: 'Italy' },
  { value: 'PT', fr: 'Portugal', en: 'Portugal' },
  { value: 'NL', fr: 'Pays-Bas', en: 'Netherlands' },
  { value: 'AT', fr: 'Autriche', en: 'Austria' },
  { value: 'IE', fr: 'Irlande', en: 'Ireland' },
  { value: 'GB', fr: 'Royaume-Uni', en: 'United Kingdom' },
  { value: 'US', fr: 'États-Unis', en: 'United States' },
  { value: 'CA', fr: 'Canada', en: 'Canada' },
  { value: 'PL', fr: 'Pologne', en: 'Poland' },
  { value: 'SE', fr: 'Suède', en: 'Sweden' },
  { value: 'DK', fr: 'Danemark', en: 'Denmark' },
  { value: 'FI', fr: 'Finlande', en: 'Finland' },
  { value: 'NO', fr: 'Norvège', en: 'Norway' },
  { value: 'GR', fr: 'Grèce', en: 'Greece' },
  { value: 'CZ', fr: 'Tchéquie', en: 'Czechia' },
  { value: 'RO', fr: 'Roumanie', en: 'Romania' },
  { value: 'HU', fr: 'Hongrie', en: 'Hungary' },
  { value: 'MA', fr: 'Maroc', en: 'Morocco' },
  { value: 'TN', fr: 'Tunisie', en: 'Tunisia' },
  { value: 'DZ', fr: 'Algérie', en: 'Algeria' },
  { value: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { value: 'CI', fr: "Côte d'Ivoire", en: "Côte d'Ivoire" },
  { value: 'CM', fr: 'Cameroun', en: 'Cameroon' },
];

/** Qualificatifs de pièce jointe (BR-FR-17), libellés. */
export const ATTACHMENT_KINDS: Option[] = [
  { value: 'BON_COMMANDE', fr: 'Bon de commande', en: 'Purchase order' },
  { value: 'BON_LIVRAISON', fr: 'Bon de livraison', en: 'Delivery note' },
  { value: 'RIB', fr: "Relevé d'identité bancaire", en: 'Bank details' },
  { value: 'DOCUMENT_ANNEXE', fr: 'Document annexe', en: 'Supporting document' },
  { value: 'PJA', fr: 'Pièce jointe additionnelle', en: 'Additional attachment' },
  { value: 'ETAT_ACOMPTE', fr: "État d'acompte", en: 'Deposit statement' },
  { value: 'BORDEREAU_SUIVI', fr: 'Bordereau de suivi', en: 'Tracking slip' },
  {
    value: 'RECAPITULATIF_COTRAITANCE',
    fr: 'Récapitulatif de cotraitance',
    en: 'Co-contracting summary',
  },
];

export const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
