/**
 * D'un chemin de la facture au champ du formulaire qui le produit.
 *
 * Les anomalies du SDK et les zones de l'aperçu parlent le langage de `Invoice` (`lines[0].tax`,
 * `buyer.electronicAddress`, `notes`) ; le formulaire a ses propres champs (`lines[0].vat`,
 * `buyer.electronicAddress.value`, les trois champs des mentions de paiement). Cette table fait le
 * lien, pour qu'un clic sur une anomalie ou sur l'aperçu mène au champ à corriger.
 */

export type SectionId =
  | 'document'
  | 'seller'
  | 'buyer'
  | 'lines'
  | 'adjustments'
  | 'exemptions'
  | 'delivery'
  | 'payment'
  | 'references'
  | 'notes'
  | 'attachments';

type Rule = [RegExp, string | ((m: RegExpMatchArray) => string)];

/** Chemins partagés par les anomalies et l'aperçu. */
const COMMON: Rule[] = [
  [/^delivery\.period(\..*)?$/, 'delivery.start'],
  [/^delivery\.address(\.(\w+))?$/, (m) => `delivery.address.${m[2] ?? 'line1'}`],
  [/^(seller|buyer)\.electronicAddress(\..*)?$/, (m) => `${m[1]}.electronicAddress.value`],
  [/^(seller|buyer)\.address$/, (m) => `${m[1]}.address.line1`],
  [/^(seller|buyer)\.contact(\..*)?$/, (m) => `${m[1]}.contact.email`],
  [/^lines\[(\d+)\]\.tax(\..*)?$/, (m) => `lines[${m[1]}].vat`],
  [/^lines\[(\d+)\]\.netAmount$/, (m) => `lines[${m[1]}].unitPrice`],
  [/^lines\[(\d+)\]\.standardItemId.*$/, (m) => `lines[${m[1]}].gtin`],
  [/^lines\[(\d+)\]\.period(\..*)?$/, (m) => `lines[${m[1]}].periodStart`],
  [/^lines\[(\d+)\]\.priceDiscount$/, (m) => `lines[${m[1]}].grossUnitPrice`],
  [/^lines\[(\d+)\]\.baseQuantityUnitCode$/, (m) => `lines[${m[1]}].baseQuantity`],
  [
    /^lines\[(\d+)\]\.(allowances|charges)\[(\d+)\](\.(reason|reasonCode))?.*$/,
    (m) => `lines[${m[1]}].${m[2]}[${m[3]}].${m[5] ? 'reason' : 'value'}`,
  ],
  [/^lines\[(\d+)\]\.id$/, (m) => `lines[${m[1]}].name`],
  [/^lines\[(\d+)\]$/, (m) => `lines[${m[1]}].name`],
  [/^(allowances|charges)\[(\d+)\]\.tax.*$/, (m) => `${m[1]}[${m[2]}].vat`],
  [/^(allowances|charges)\[(\d+)\]\.(reason|reasonCode)$/, (m) => `${m[1]}[${m[2]}].reason`],
  [/^(allowances|charges)\[(\d+)\].*$/, (m) => `${m[1]}[${m[2]}].value`],
  [/^taxBreakdown.*$/, 'exemptions'],
  [/^totals\.prepaidAmount$/, 'prepaid'],
  [/^totals\.roundingAmount$/, 'rounding'],
  [/^totals.*$/, 'lines'],
  [/^paymentTerms\.earlyPaymentDiscount\.rate$/, 'paymentTerms.discountRate'],
  [/^paymentTerms\.earlyPaymentDiscount\.withinDays$/, 'paymentTerms.discountDays'],
  [/^paymentTerms\.earlyPaymentDiscount$/, 'paymentTerms.discount'],
  [
    /^paymentMeans\[(\d+)\]\.creditTransfer\.(iban|bic|accountName)$/,
    (m) => `paymentMeans[${m[1]}].${m[2]}`,
  ],
  [/^paymentMeans\[(\d+)\]\.directDebit\.(\w+)$/, (m) => `paymentMeans[${m[1]}].${m[2]}`],
  [/^paymentMeans\[(\d+)\]\.creditTransfer$/, (m) => `paymentMeans[${m[1]}].iban`],
  [/^paymentMeans\[(\d+)\].*$/, (m) => `paymentMeans[${m[1]}].typeCode`],
  [
    /^references\.precedingInvoices(\[(\d+)\])?.*$/,
    (m) => (m[2] ? `references.precedingInvoices[${m[2]}].id` : 'references.precedingInvoices'),
  ],
  [/^payee(\.(name|id|legalId))?.*$/, (m) => `payee.${m[2] ?? 'name'}`],
  [/^attachments\[(\d+)\].*$/, (m) => `attachments[${m[1]}].id`],
  [/^notes\[(\d+)\].*$/, (m) => `notes[${m[1]}].text`],
];

/** Chemins propres aux anomalies : « il manque », là où le champ n'existe pas encore. */
const ISSUE: Rule[] = [
  [/^notes$/, 'paymentTerms.latePenaltyRate'],
  [/^delivery$/, 'delivery.date'],
  [/^seller$/, 'seller.siren'],
  [/^buyer$/, 'buyer.name'],
  [/^paymentTerms$/, 'paymentTerms.dueDate'],
  [/^lines$/, 'lines'],
];

/** Chemins propres à l'aperçu : un clic sur un bloc mène à son premier champ. */
const PREVIEW: Rule[] = [
  [/^seller$/, 'seller.name'],
  [/^buyer$/, 'buyer.name'],
  [/^delivery$/, 'delivery.partyName'],
  [/^delivery\.date$/, 'delivery.date'],
  [/^paymentMeans$/, 'paymentMeans'],
];

export function anchorOf(path: string, kind: 'issue' | 'preview' = 'issue'): string {
  for (const [pattern, target] of [...(kind === 'issue' ? ISSUE : PREVIEW), ...COMMON]) {
    const match = path.match(pattern);
    if (match) return typeof target === 'string' ? target : target(match);
  }
  return path;
}

/** Les champs de l'onglet Apparence, atteints depuis l'aperçu. */
export const APPEARANCE_REFS = new Set(['logo', 'footer']);

export function sectionOf(formPath: string): SectionId {
  const head = formPath.split(/[.[]/)[0] ?? '';
  switch (head) {
    case 'seller':
      return 'seller';
    case 'buyer':
      return 'buyer';
    case 'lines':
      return 'lines';
    case 'allowances':
    case 'charges':
    case 'prepaid':
    case 'rounding':
      return 'adjustments';
    case 'exemptions':
      return 'exemptions';
    case 'delivery':
      return 'delivery';
    case 'paymentTerms':
    case 'paymentMeans':
    case 'remittanceInformation':
    case 'payee':
      return 'payment';
    case 'references':
      return 'references';
    case 'notes':
      return 'notes';
    case 'attachments':
      return 'attachments';
    default:
      return 'document';
  }
}

/** Vrai si une anomalie de chemin `issue` concerne le champ `field` (même champ, parent ou enfant). */
export function concerns(field: string, issue: string): boolean {
  if (issue === field) return true;
  return issue.startsWith(`${field}.`) || issue.startsWith(`${field}[`);
}
