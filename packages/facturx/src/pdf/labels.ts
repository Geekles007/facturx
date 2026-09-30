/**
 * Libellés de la page lisible, en français et en anglais.
 *
 * Les clés historiques (1.5) restent obligatoires dans `RenderLabels` ; celles ajoutées ensuite
 * sont facultatives et retombent sur la table de la langue de base : une table écrite pour la 1.5
 * continue de compiler, et ne laisse aucun trou sur la page.
 *
 * Les mentions légales elles-mêmes (pénalités, indemnité, escompte) ne sont pas ici : elles viennent
 * de `resolveNotes`, la même source que le XML, et restent donc en français quelle que soit la langue
 * des libellés — ce sont les phrases que la facture structurée transmet.
 */

import type { OperationCategory } from '../types/codes.js';

export interface RenderLabels {
  /** Titre du document, par code de type (BT-3). */
  invoice: Record<string, string>;
  seller: string;
  buyer: string;
  delivery: string;
  issueDate: string;
  dueDate: string;
  reference: string;
  designation: string;
  quantity: string;
  unitPrice: string;
  vat: string;
  netAmount: string;
  lineTotal: string;
  allowances: string;
  charges: string;
  taxExclusive: string;
  taxBase: string;
  taxRate: string;
  taxAmount: string;
  taxInclusive: string;
  prepaid: string;
  rounding: string;
  amountDue: string;
  paymentTerms: string;
  page: (current: number, total: number) => string;

  // ---- depuis la 1.6 : facultatifs, repli sur la langue de base ----

  /** Préfixe du numéro de facture sous le titre. */
  number?: string;
  /** « Suite » : rappel en tête des pages suivantes. */
  continued?: (title: string, id: string) => string;
  /** Période de livraison ou de prestation (BG-14). */
  period?: string;
  /** « du … au … ». */
  fromTo?: (start: string, end: string) => string;
  /** Adresse de livraison (BG-15). */
  deliveryAddress?: string;
  /** Bénéficiaire du paiement (BG-10). */
  payee?: string;
  /** Nature de l'opération et ses trois valeurs. */
  operation?: string;
  operations?: Record<OperationCategory, string>;
  /** Mention d'autofacturation (types 389 et 261). */
  selfBilling?: string;
  /** Mention de l'option pour la TVA sur les débits (BT-8). */
  vatOnDebits?: string;
  /** Date d'exigibilité de la TVA (BT-7). */
  taxPointDate?: string;
  /** Factures de référence (BG-3) : avoir, rectificative, définitive après acompte. */
  precedingInvoices?: string;
  /** « n° … du … » pour une facture de référence. */
  invoiceRef?: (id: string, date?: string) => string;
  /** Références documentaires du niveau document (BT-11 à BT-19). */
  references?: {
    purchaseOrder: string;
    contract: string;
    project: string;
    salesOrder: string;
    receivingAdvice: string;
    despatchAdvice: string;
    tenderOrLot: string;
    invoicedObject: string;
    buyerAccountingReference: string;
  };
  /** Identifiants des parties. */
  ids?: {
    siren: string;
    siret: string;
    vat: string;
    taxRegistration: string;
    electronicAddress: string;
    contact: string;
  };
  /** Colonne du numéro de ligne. */
  lineNumber?: string;
  /** Détails d'une ligne. */
  line?: {
    sellerItemId: string;
    buyerItemId: string;
    standardItemId: string;
    origin: string;
    orderLine: string;
    accounting: string;
    grossPrice: string;
    priceDiscount: string;
    per: string;
    allowance: string;
    charge: string;
  };
  /** Ventilation de TVA (BG-23). */
  vatBreakdown?: string;
  /** Libellé court d'une catégorie de TVA hors taux normal, dans la colonne TVA. */
  taxCategories?: Record<string, string>;
  /** Mention d'exonération lisible pour un code VATEX, à défaut de texte BT-120. */
  exemptions?: Record<string, string>;
  /** Total de la TVA (BT-110). */
  taxTotal?: string;
  /** Montant dû (BT-115) d'un avoir, à la place de « Net à payer ». */
  creditAmount?: string;
  /** Bloc de règlement. */
  payment?: string;
  /** Libellés des moyens de paiement (BT-81). */
  paymentMeans?: Record<string, string>;
  bank?: {
    iban: string;
    bic: string;
    accountName: string;
    mandate: string;
    creditorId: string;
    debitedAccount: string;
  };
  /** Référence de paiement à rappeler (BT-83). */
  remittance?: string;
  /** Légende du QR code de paiement SEPA. */
  scanToPay?: string;
  /** Autres notes de la facture (BG-1). */
  notes?: string;
  /** Unités lisibles (UN/ECE Rec. 20), par code. Un code absent s'affiche tel quel. */
  units?: Record<string, string>;
  /** Noms de pays (ISO 3166-1), par code. Un code absent s'affiche tel quel. */
  countries?: Record<string, string>;
  /** Mention facultative : la facture est une Factur-X. */
  facturxNotice?: string;
}

/** Table complète : toutes les clés présentes, y compris les facultatives. */
export type FullRenderLabels = Required<RenderLabels>;

const FR: FullRenderLabels = {
  invoice: {
    '380': 'Facture',
    '381': 'Avoir',
    '384': 'Facture rectificative',
    '386': "Facture d'acompte",
    '389': 'Facture auto-facturée',
    '393': 'Facture affacturée',
    '261': 'Avoir auto-facturé',
    '262': 'Avoir pour remise globale',
    '396': 'Avoir affacturé',
  },
  seller: 'Vendeur',
  buyer: 'Acheteur',
  delivery: 'Livraison',
  issueDate: 'Date',
  dueDate: 'Échéance',
  reference: 'Référence acheteur',
  designation: 'Désignation',
  quantity: 'Qté',
  unitPrice: 'P.U. HT',
  vat: 'TVA',
  netAmount: 'Montant HT',
  lineTotal: 'Total des lignes',
  allowances: 'Remises',
  charges: 'Frais',
  taxExclusive: 'Total HT',
  taxBase: 'Base HT',
  taxRate: 'Taux',
  taxAmount: 'TVA',
  taxInclusive: 'Total TTC',
  prepaid: 'Acomptes versés',
  rounding: 'Arrondi',
  amountDue: 'Net à payer',
  paymentTerms: 'Conditions de règlement',
  page: (c, t) => `Page ${c} / ${t}`,

  number: 'N°',
  continued: (title, id) => `${title} ${id} — suite`,
  period: 'Période',
  fromTo: (start, end) => `du ${start} au ${end}`,
  deliveryAddress: 'Adresse de livraison',
  payee: 'Bénéficiaire du paiement',
  operation: "Nature de l'opération",
  operations: {
    goods: 'Livraison de biens',
    services: 'Prestation de services',
    mixed: 'Livraison de biens et prestation de services',
  },
  selfBilling: 'Autofacturation',
  vatOnDebits: "Option pour le paiement de la taxe d'après les débits",
  taxPointDate: "Date d'exigibilité de la TVA",
  precedingInvoices: 'Facture de référence',
  invoiceRef: (id, date) => (date ? `n° ${id} du ${date}` : `n° ${id}`),
  references: {
    purchaseOrder: 'Bon de commande',
    contract: 'Contrat',
    project: 'Projet',
    salesOrder: 'Commande',
    receivingAdvice: 'Avis de réception',
    despatchAdvice: "Avis d'expédition",
    tenderOrLot: 'Lot',
    invoicedObject: 'Objet facturé',
    buyerAccountingReference: 'Référence comptable',
  },
  ids: {
    siren: 'SIREN',
    siret: 'SIRET',
    vat: 'N° TVA',
    taxRegistration: 'N° fiscal',
    electronicAddress: 'Adresse électronique',
    contact: 'Contact',
  },
  lineNumber: '#',
  line: {
    sellerItemId: 'Réf.',
    buyerItemId: 'Réf. client',
    standardItemId: 'EAN',
    origin: 'Origine',
    orderLine: 'Ligne de commande',
    accounting: 'Compte',
    grossPrice: 'Prix brut',
    priceDiscount: 'remise',
    per: 'pour',
    allowance: 'Remise',
    charge: 'Frais',
  },
  vatBreakdown: 'Détail de la TVA',
  taxCategories: {
    Z: 'Taux zéro',
    E: 'Exonéré',
    AE: 'Autoliquidation',
    K: 'Livr. intracom.',
    G: 'Export',
    O: 'Hors champ',
    L: 'IGIC',
    M: 'IPSI',
  },
  exemptions: {
    'VATEX-FR-FRANCHISE': 'TVA non applicable, art. 293 B du CGI',
    'VATEX-EU-AE': 'Autoliquidation',
    'VATEX-EU-IC': 'Exonération de TVA, article 262 ter, I du CGI',
    'VATEX-EU-G': 'Exonération de TVA, article 262 I du CGI',
    'VATEX-EU-O': "Opération hors du champ d'application de la TVA",
    'VATEX-EU-79-C': 'Débours refacturés à l’euro près, exclus de la base imposable',
    'VATEX-EU-132': 'Exonération de TVA (article 132 de la directive 2006/112/CE)',
    'VATEX-FR-CNWVAT': 'Avoir sans TVA',
  },
  taxTotal: 'Total TVA',
  creditAmount: "Montant de l'avoir",
  payment: 'Règlement',
  paymentMeans: {
    '10': 'Espèces',
    '20': 'Chèque',
    '30': 'Virement',
    '42': 'Paiement sur compte bancaire',
    '48': 'Carte bancaire',
    '49': 'Prélèvement',
    '57': 'Ordre permanent',
    '58': 'Virement SEPA',
    '59': 'Prélèvement SEPA',
    '97': 'Compensation',
  },
  bank: {
    iban: 'IBAN',
    bic: 'BIC',
    accountName: 'Titulaire',
    mandate: 'RUM',
    creditorId: 'ICS',
    debitedAccount: 'Compte débité',
  },
  remittance: 'Référence à rappeler',
  scanToPay: 'Scannez pour payer',
  notes: 'Informations',
  units: {
    C62: 'u',
    H87: 'pce',
    XPP: 'pce',
    HUR: 'h',
    DAY: 'j',
    WEE: 'sem.',
    MON: 'mois',
    ANN: 'an',
    MIN: 'min',
    KGM: 'kg',
    GRM: 'g',
    TNE: 't',
    MTR: 'm',
    KMT: 'km',
    MTK: 'm²',
    MTQ: 'm³',
    LTR: 'l',
    KWH: 'kWh',
    E48: 'service',
    SET: 'lot',
    LS: 'forfait',
    PR: 'paire',
  },
  countries: {
    FR: 'France',
    BE: 'Belgique',
    LU: 'Luxembourg',
    CH: 'Suisse',
    MC: 'Monaco',
    DE: 'Allemagne',
    ES: 'Espagne',
    IT: 'Italie',
    PT: 'Portugal',
    NL: 'Pays-Bas',
    AT: 'Autriche',
    IE: 'Irlande',
    GB: 'Royaume-Uni',
    US: 'États-Unis',
    CA: 'Canada',
    PL: 'Pologne',
    SE: 'Suède',
    DK: 'Danemark',
    FI: 'Finlande',
    NO: 'Norvège',
    GR: 'Grèce',
    CZ: 'Tchéquie',
    RO: 'Roumanie',
    HU: 'Hongrie',
    MA: 'Maroc',
    TN: 'Tunisie',
    DZ: 'Algérie',
    SN: 'Sénégal',
    CI: "Côte d'Ivoire",
    CM: 'Cameroun',
  },
  facturxNotice:
    'Facture électronique Factur-X (profil EN 16931) : les données structurées sont jointes à ce PDF.',
};

const EN: FullRenderLabels = {
  invoice: {
    '380': 'Invoice',
    '381': 'Credit note',
    '384': 'Corrected invoice',
    '386': 'Prepayment invoice',
    '389': 'Self-billed invoice',
    '393': 'Factored invoice',
    '261': 'Self-billed credit note',
    '262': 'Credit note for global discount',
    '396': 'Factored credit note',
  },
  seller: 'Seller',
  buyer: 'Buyer',
  delivery: 'Delivery',
  issueDate: 'Date',
  dueDate: 'Due',
  reference: 'Buyer reference',
  designation: 'Description',
  quantity: 'Qty',
  unitPrice: 'Unit price',
  vat: 'VAT',
  netAmount: 'Net amount',
  lineTotal: 'Sum of lines',
  allowances: 'Allowances',
  charges: 'Charges',
  taxExclusive: 'Total excl. VAT',
  taxBase: 'Taxable',
  taxRate: 'Rate',
  taxAmount: 'VAT',
  taxInclusive: 'Total incl. VAT',
  prepaid: 'Prepaid',
  rounding: 'Rounding',
  amountDue: 'Amount due',
  paymentTerms: 'Payment terms',
  page: (c, t) => `Page ${c} of ${t}`,

  number: 'No.',
  continued: (title, id) => `${title} ${id} — continued`,
  period: 'Period',
  fromTo: (start, end) => `from ${start} to ${end}`,
  deliveryAddress: 'Delivery address',
  payee: 'Payee',
  operation: 'Nature of the transaction',
  operations: {
    goods: 'Supply of goods',
    services: 'Supply of services',
    mixed: 'Supply of goods and services',
  },
  selfBilling: 'Self-billing',
  vatOnDebits: 'VAT payable on an accrual basis (option for debits)',
  taxPointDate: 'VAT point date',
  precedingInvoices: 'Related invoice',
  invoiceRef: (id, date) => (date ? `no. ${id} of ${date}` : `no. ${id}`),
  references: {
    purchaseOrder: 'Purchase order',
    contract: 'Contract',
    project: 'Project',
    salesOrder: 'Sales order',
    receivingAdvice: 'Receiving advice',
    despatchAdvice: 'Despatch advice',
    tenderOrLot: 'Lot',
    invoicedObject: 'Invoiced object',
    buyerAccountingReference: 'Accounting reference',
  },
  ids: {
    siren: 'SIREN',
    siret: 'SIRET',
    vat: 'VAT no.',
    taxRegistration: 'Tax no.',
    electronicAddress: 'Electronic address',
    contact: 'Contact',
  },
  lineNumber: '#',
  line: {
    sellerItemId: 'Ref.',
    buyerItemId: 'Buyer ref.',
    standardItemId: 'EAN',
    origin: 'Origin',
    orderLine: 'Order line',
    accounting: 'Account',
    grossPrice: 'Gross price',
    priceDiscount: 'discount',
    per: 'per',
    allowance: 'Allowance',
    charge: 'Charge',
  },
  vatBreakdown: 'VAT breakdown',
  taxCategories: {
    Z: 'Zero rated',
    E: 'Exempt',
    AE: 'Reverse charge',
    K: 'Intra-EU',
    G: 'Export',
    O: 'Out of scope',
    L: 'IGIC',
    M: 'IPSI',
  },
  exemptions: {
    'VATEX-FR-FRANCHISE': 'VAT not applicable, art. 293 B of the French tax code',
    'VATEX-EU-AE': 'Reverse charge',
    'VATEX-EU-IC': 'Intra-Community supply, exempt from VAT',
    'VATEX-EU-G': 'Export outside the EU, exempt from VAT',
    'VATEX-EU-O': 'Outside the scope of VAT',
    'VATEX-EU-79-C': 'Disbursements, excluded from the taxable amount',
    'VATEX-EU-132': 'Exempt from VAT (article 132 of Directive 2006/112/EC)',
    'VATEX-FR-CNWVAT': 'Credit note without VAT',
  },
  taxTotal: 'Total VAT',
  creditAmount: 'Credit amount',
  payment: 'Payment',
  paymentMeans: {
    '10': 'Cash',
    '20': 'Cheque',
    '30': 'Credit transfer',
    '42': 'Payment to bank account',
    '48': 'Bank card',
    '49': 'Direct debit',
    '57': 'Standing agreement',
    '58': 'SEPA credit transfer',
    '59': 'SEPA direct debit',
    '97': 'Clearing between partners',
  },
  bank: {
    iban: 'IBAN',
    bic: 'BIC',
    accountName: 'Account holder',
    mandate: 'Mandate ref.',
    creditorId: 'Creditor ID',
    debitedAccount: 'Debited account',
  },
  remittance: 'Payment reference',
  scanToPay: 'Scan to pay',
  notes: 'Notes',
  units: {
    C62: 'unit',
    H87: 'pc',
    XPP: 'pc',
    HUR: 'h',
    DAY: 'd',
    WEE: 'wk',
    MON: 'mo',
    ANN: 'yr',
    MIN: 'min',
    KGM: 'kg',
    GRM: 'g',
    TNE: 't',
    MTR: 'm',
    KMT: 'km',
    MTK: 'm²',
    MTQ: 'm³',
    LTR: 'l',
    KWH: 'kWh',
    E48: 'service',
    SET: 'set',
    LS: 'lump sum',
    PR: 'pair',
  },
  countries: {
    FR: 'France',
    BE: 'Belgium',
    LU: 'Luxembourg',
    CH: 'Switzerland',
    MC: 'Monaco',
    DE: 'Germany',
    ES: 'Spain',
    IT: 'Italy',
    PT: 'Portugal',
    NL: 'Netherlands',
    AT: 'Austria',
    IE: 'Ireland',
    GB: 'United Kingdom',
    US: 'United States',
    CA: 'Canada',
    PL: 'Poland',
    SE: 'Sweden',
    DK: 'Denmark',
    FI: 'Finland',
    NO: 'Norway',
    GR: 'Greece',
    CZ: 'Czechia',
    RO: 'Romania',
    HU: 'Hungary',
    MA: 'Morocco',
    TN: 'Tunisia',
    DZ: 'Algeria',
    SN: 'Senegal',
    CI: "Côte d'Ivoire",
    CM: 'Cameroon',
  },
  facturxNotice:
    'Factur-X electronic invoice (EN 16931 profile): the structured data is attached to this PDF.',
};

export const RENDER_LABELS = { fr: FR, en: EN } as const;

/**
 * Table effective : la langue demandée, ou une table sur mesure complétée par la langue de base
 * pour les clés qu'elle ne fournit pas (celles ajoutées après la 1.5, typiquement).
 */
export function resolveLabels(
  labels: 'fr' | 'en' | RenderLabels | undefined,
  base: 'fr' | 'en' = 'fr',
): FullRenderLabels {
  if (labels === undefined) return RENDER_LABELS[base];
  if (typeof labels === 'string') return RENDER_LABELS[labels];
  const fallback = RENDER_LABELS[base];
  const merged = { ...fallback } as Record<string, unknown>;
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined) merged[key] = value;
  }
  // Les tables imbriquées se complètent clé par clé : une table sur mesure qui ne traduit que
  // deux moyens de paiement ne doit pas faire disparaître les huit autres.
  for (const key of [
    'invoice',
    'operations',
    'references',
    'ids',
    'line',
    'taxCategories',
    'exemptions',
    'paymentMeans',
    'bank',
    'units',
    'countries',
  ] as const) {
    const own = (labels as unknown as Record<string, unknown>)[key];
    if (own && typeof own === 'object') {
      merged[key] = { ...(fallback[key] as object), ...(own as object) };
    }
  }
  return merged as unknown as FullRenderLabels;
}
