/**
 * Le formulaire du Studio et sa traduction en `Invoice`.
 *
 * Le formulaire garde les saisies telles quelles (« 1 234,5 », un champ vide) : un nombre à moitié
 * tapé ne doit pas être corrigé sous les doigts de l'utilisateur. La traduction en facture passe
 * par les fonctions exactes du SDK — `fromDecimal`, `computeLineNetAmount`, `computeTotals` — et
 * relève chaque saisie illisible avec le chemin du champ, dans la même syntaxe que les anomalies
 * de `validateInvoice` : l'interface les affiche au même endroit.
 *
 * Rien n'est inventé : un champ vide reste absent de la facture, et c'est la validation qui dit
 * s'il manque.
 */

import {
  type AllowanceReasonCode,
  type Attachment,
  type AttachmentMimeType,
  applyRate,
  type BusinessProcessCode,
  type Cents,
  type ChargeReasonCode,
  type ComputeTotalsOptions,
  cents,
  centsToString,
  computeLineNetAmount,
  computeTotals,
  type DocumentAllowance,
  type DocumentCharge,
  type ExemptionReasonCode,
  e4ToString,
  fromDecimal,
  type Invoice,
  type InvoiceDraft,
  type InvoiceNote,
  type InvoiceTypeCode,
  type IsoDate,
  type Line,
  type LineAllowance,
  type LineCharge,
  lineNetAmount,
  MoneyError,
  ONE_QUANTITY,
  type OperationCategory,
  type Party,
  type PaymentMeans,
  type PaymentTerms,
  type ProcessingCode,
  type Quantity,
  type Rate,
  rateToString,
  type TaxCategoryCode,
  type TaxInfo,
  type UnitPrice,
} from 'facturx-sdk';
import { EXEMPT_CATEGORIES, type ExemptCategory } from './catalog.js';

// ---------- formulaire ----------

export interface FormAddress {
  line1: string;
  line2: string;
  line3: string;
  postCode: string;
  city: string;
  countrySubdivision: string;
  countryCode: string;
}

export interface FormParty {
  name: string;
  tradingName: string;
  siren: string;
  siret: string;
  vatId: string;
  /** Vendeur seulement (BT-32). */
  taxRegistrationId: string;
  /** Vendeur seulement (BT-33) : forme juridique, capital, RCS. */
  legalInfo: string;
  address: FormAddress;
  contact: { name: string; phone: string; email: string };
  electronicAddress: { value: string; scheme: string };
  routingCode: string;
  /** Acheteur seulement : particulier (B2C). */
  consumer: boolean;
}

/** Remise ou frais : un montant, ou un pourcentage de la base. */
export interface FormAdjustment {
  uid: string;
  reason: string;
  reasonCode: string;
  mode: 'amount' | 'percent';
  value: string;
}

/** Remise ou frais du document : taux de TVA explicite (`S:20`), ou `auto` — réparti par taux. */
export interface FormDocAdjustment extends FormAdjustment {
  vat: string;
}

export interface FormLine {
  uid: string;
  name: string;
  description: string;
  note: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  /** Quantité de base du prix (« 12,00 € pour 100 ») ; vide = 1. */
  baseQuantity: string;
  /** Prix brut avant remise sur prix ; vide = pas de remise sur prix. */
  grossUnitPrice: string;
  /** `catégorie:taux`, voir `VAT_CHOICES`. */
  vat: string;
  sellerItemId: string;
  buyerItemId: string;
  gtin: string;
  originCountry: string;
  orderLineReference: string;
  buyerAccountingReference: string;
  periodStart: string;
  periodEnd: string;
  allowances: FormAdjustment[];
  charges: FormAdjustment[];
}

export interface FormPaymentMeans {
  uid: string;
  typeCode: string;
  text: string;
  iban: string;
  bic: string;
  accountName: string;
  mandateReference: string;
  creditorId: string;
  debitedIban: string;
}

export interface FormNote {
  uid: string;
  subjectCode: string;
  text: string;
}

export interface FormAttachment {
  uid: string;
  id: string;
  description: string;
  uri: string;
  file?: { name: string; mimeType: string; bytes: Uint8Array };
}

export interface FormPreceding {
  uid: string;
  id: string;
  issueDate: string;
}

export interface InvoiceForm {
  typeCode: InvoiceTypeCode;
  id: string;
  issueDate: string;
  currency: string;
  operationCategory: OperationCategory | '';
  businessProcess: BusinessProcessCode | '';
  processing: ProcessingCode | '';
  vatOnDebits: boolean;
  taxPointDate: string;
  buyerReference: string;
  seller: FormParty;
  buyer: FormParty;
  payee: { enabled: boolean; name: string; id: string; legalId: string };
  delivery: {
    mode: 'date' | 'period';
    date: string;
    start: string;
    end: string;
    partyName: string;
    locationId: string;
    hasAddress: boolean;
    address: FormAddress;
  };
  lines: FormLine[];
  allowances: FormDocAdjustment[];
  charges: FormDocAdjustment[];
  /** Motif d'exonération par catégorie : code VATEX et mention (BT-121, BT-120). */
  exemptions: Record<ExemptCategory, { code: string; reason: string }>;
  prepaid: string;
  rounding: string;
  paymentTerms: {
    dueDate: string;
    mode: 'structured' | 'text';
    latePenaltyRate: string;
    recoveryIndemnity: string;
    discount: 'none' | 'rate';
    discountRate: string;
    discountDays: string;
    text: string;
  };
  paymentMeans: FormPaymentMeans[];
  remittanceInformation: string;
  references: {
    purchaseOrder: string;
    contract: string;
    project: string;
    salesOrder: string;
    receivingAdvice: string;
    despatchAdvice: string;
    tenderOrLot: string;
    invoicedObject: string;
    buyerAccountingReference: string;
    precedingInvoices: FormPreceding[];
  };
  notes: FormNote[];
  attachments: FormAttachment[];
}

// ---------- valeurs par défaut ----------

let counter = 0;
/** Identifiant stable d'un élément de liste, pour l'interface ; n'apparaît pas dans la facture. */
export const uid = (): string => `u${Date.now().toString(36)}${(counter++).toString(36)}`;

export const blankAddress = (countryCode = 'FR'): FormAddress => ({
  line1: '',
  line2: '',
  line3: '',
  postCode: '',
  city: '',
  countrySubdivision: '',
  countryCode,
});

export const blankParty = (): FormParty => ({
  name: '',
  tradingName: '',
  siren: '',
  siret: '',
  vatId: '',
  taxRegistrationId: '',
  legalInfo: '',
  address: blankAddress(),
  contact: { name: '', phone: '', email: '' },
  electronicAddress: { value: '', scheme: '0225' },
  routingCode: '',
  consumer: false,
});

export const blankLine = (vat = 'S:20'): FormLine => ({
  uid: uid(),
  name: '',
  description: '',
  note: '',
  quantity: '1',
  unitCode: 'C62',
  unitPrice: '',
  baseQuantity: '',
  grossUnitPrice: '',
  vat,
  sellerItemId: '',
  buyerItemId: '',
  gtin: '',
  originCountry: '',
  orderLineReference: '',
  buyerAccountingReference: '',
  periodStart: '',
  periodEnd: '',
  allowances: [],
  charges: [],
});

export const blankAdjustment = (reason = ''): FormAdjustment => ({
  uid: uid(),
  reason,
  reasonCode: '',
  mode: 'percent',
  value: '',
});

export const blankDocAdjustment = (reason = ''): FormDocAdjustment => ({
  ...blankAdjustment(reason),
  vat: 'auto',
});

export const blankPaymentMeans = (typeCode = '58'): FormPaymentMeans => ({
  uid: uid(),
  typeCode,
  text: '',
  iban: '',
  bic: '',
  accountName: '',
  mandateReference: '',
  creditorId: '',
  debitedIban: '',
});

export function isoToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date ISO décalée de `days` jours (calendrier civil, sans fuseau). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Dernier jour du mois d'une date ISO. */
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function blankForm(today = isoToday()): InvoiceForm {
  return {
    typeCode: '380',
    id: '',
    issueDate: today,
    currency: 'EUR',
    operationCategory: 'services',
    businessProcess: '',
    processing: '',
    vatOnDebits: false,
    taxPointDate: '',
    buyerReference: '',
    seller: blankParty(),
    buyer: blankParty(),
    payee: { enabled: false, name: '', id: '', legalId: '' },
    delivery: {
      mode: 'date',
      date: today,
      start: '',
      end: '',
      partyName: '',
      locationId: '',
      hasAddress: false,
      address: blankAddress(),
    },
    lines: [blankLine()],
    allowances: [],
    charges: [],
    exemptions: {
      E: { code: 'VATEX-FR-FRANCHISE', reason: 'TVA non applicable, art. 293 B du CGI' },
      AE: { code: 'VATEX-EU-AE', reason: 'Autoliquidation' },
      K: { code: 'VATEX-EU-IC', reason: 'Exonération de TVA, article 262 ter, I du CGI' },
      G: { code: 'VATEX-EU-G', reason: 'Exonération de TVA, article 262 I du CGI' },
      O: { code: 'VATEX-EU-O', reason: "Opération hors du champ d'application de la TVA" },
    },
    prepaid: '',
    rounding: '',
    paymentTerms: {
      dueDate: addDays(today, 30),
      mode: 'structured',
      latePenaltyRate: '10',
      recoveryIndemnity: '40',
      discount: 'none',
      discountRate: '',
      discountDays: '',
      text: '',
    },
    paymentMeans: [blankPaymentMeans()],
    remittanceInformation: '',
    references: {
      purchaseOrder: '',
      contract: '',
      project: '',
      salesOrder: '',
      receivingAdvice: '',
      despatchAdvice: '',
      tenderOrLot: '',
      invoicedObject: '',
      buyerAccountingReference: '',
      precedingInvoices: [],
    },
    notes: [],
    attachments: [],
  };
}

// ---------- nombres ----------

/** Erreur de saisie : un champ que la facture ne peut pas lire. */
export interface InputError {
  path: string;
  kind: 'number' | 'decimals' | 'negative' | 'vat' | 'gross';
  /** Décimales admises, pour `decimals`. */
  scale?: number;
}

/** « 1 234,50 » → « 1234.50 » : espaces, insécables et apostrophes de milliers retirés, virgule en point. */
export function normalizeDecimal(text: string): string {
  return text.replace(/[\s\u00a0\u202f'’]/g, '').replace(',', '.');
}

/**
 * Lit une saisie décimale en entier à `scale` décimales, sans flottant. Vide → `undefined`.
 * Une saisie illisible est relevée dans `errors` et vaut `undefined`.
 */
export function parseScaled(
  text: string,
  scale: number,
  path: string,
  errors: InputError[],
  options: { negative?: boolean } = {},
): number | undefined {
  const value = normalizeDecimal(text);
  if (value === '') return undefined;
  if (!/^[+-]?\d+(\.\d*)?$|^[+-]?\.\d+$/.test(value)) {
    errors.push({ path, kind: 'number' });
    return undefined;
  }
  const normalized = value.replace(/^([+-]?)\./, '$10.').replace(/\.$/, '');
  const fraction = normalized.split('.')[1] ?? '';
  if (fraction.length > scale) {
    errors.push({ path, kind: 'decimals', scale });
    return undefined;
  }
  let result: number;
  try {
    result = fromDecimal(normalized, scale);
  } catch (error) {
    if (error instanceof MoneyError) {
      errors.push({ path, kind: 'number' });
      return undefined;
    }
    throw error;
  }
  if (result < 0 && !options.negative) {
    errors.push({ path, kind: 'negative' });
    return undefined;
  }
  return result;
}

/** Entier sans unité (jours d'escompte). */
function parseInteger(text: string, path: string, errors: InputError[]): number | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    errors.push({ path, kind: 'number' });
    return undefined;
  }
  return Number(value);
}

/** `S:20` → `{ category: 'S', rate: 2000 }` ; `O:` → `{ category: 'O' }`. */
export function parseVat(value: string): TaxInfo | undefined {
  const [category, rateText = ''] = value.split(':');
  if (!category) return undefined;
  const tax: TaxInfo = { category: category as TaxCategoryCode };
  if (rateText !== '') {
    try {
      tax.rate = fromDecimal(rateText, 2) as Rate;
    } catch {
      return undefined;
    }
  }
  return tax;
}

/** Inverse de `parseVat`. */
export function vatKey(tax: { category: string; rate?: number | undefined }): string {
  if (tax.rate === undefined) return `${tax.category}:`;
  return `${tax.category}:${rateToString(tax.rate as Rate).replace(/\.?0+$/, '')}`;
}

/** Montant en centimes → saisie française (« 1234,5 » devient « 1234,50 »). */
export const centsInput = (value: number | undefined): string =>
  value === undefined ? '' : centsToString(value as Cents).replace('.', ',');

/** Quantité ou prix à 4 décimales → saisie française, sans zéros inutiles. */
export const e4Input = (value: number | undefined, minDecimals = 0): string => {
  if (value === undefined) return '';
  const text = e4ToString(value as Quantity);
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '').padEnd(minDecimals, '0');
  return trimmed ? `${whole},${trimmed}` : (whole as string);
};

/** Taux en points de base → saisie française (« 5,5 »). */
export const rateInput = (value: number | undefined): string =>
  value === undefined
    ? ''
    : rateToString(value as Rate)
        .replace(/\.?0+$/, '')
        .replace('.', ',');

// ---------- formulaire → facture ----------

export interface BuildResult {
  invoice: Invoice;
  errors: InputError[];
  /** Options passées à `computeTotals`, reprises par le code généré. */
  totalsOptions: ComputeTotalsOptions;
  /**
   * Chemin d'un champ de la facture → chemin du formulaire. Les remises et frais « répartis par
   * taux » deviennent plusieurs éléments dans la facture : `allowances[2]` peut venir de la
   * remise n° 0 du formulaire.
   */
  toFormPath: (path: string) => string;
}

const trim = (value: string): string => value.trim();
const compact = (value: string): string => value.replace(/[\s\u00a0\u202f]/g, '');

/** Pose `value` sur `target[key]` seulement si elle est renseignée : une chaîne vide reste absente. */
function put<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | '' | undefined,
): void {
  if (value !== undefined && value !== '') target[key] = value as T[K];
}

function buildAddress(a: FormAddress): Party['address'] {
  const out: Party['address'] = { countryCode: trim(a.countryCode).toUpperCase() };
  put(out, 'line1', trim(a.line1));
  put(out, 'line2', trim(a.line2));
  put(out, 'line3', trim(a.line3));
  put(out, 'postCode', trim(a.postCode));
  put(out, 'city', trim(a.city));
  put(out, 'countrySubdivision', trim(a.countrySubdivision));
  return out;
}

function buildParty(p: FormParty, role: 'seller' | 'buyer'): Party {
  const out: Party = { name: trim(p.name), address: buildAddress(p.address) };
  put(out, 'tradingName', trim(p.tradingName));
  put(out, 'siren', compact(p.siren));
  put(out, 'siret', compact(p.siret));
  put(out, 'vatId', compact(p.vatId).toUpperCase());
  if (role === 'seller') {
    put(out, 'taxRegistrationId', trim(p.taxRegistrationId));
    put(out, 'legalInfo', trim(p.legalInfo));
  }
  const contact: NonNullable<Party['contact']> = {};
  put(contact, 'name', trim(p.contact.name));
  put(contact, 'phone', trim(p.contact.phone));
  put(contact, 'email', trim(p.contact.email));
  if (Object.keys(contact).length > 0) out.contact = contact;
  const ea = trim(p.electronicAddress.value);
  if (ea) out.electronicAddress = { value: ea, scheme: p.electronicAddress.scheme || '0225' };
  put(out, 'routingCode', trim(p.routingCode));
  if (role === 'buyer' && p.consumer) out.consumer = true;
  return out;
}

/** Remise ou frais de ligne : un montant, ou un pourcentage du montant brut de la ligne. */
function buildLineAdjustment<T extends LineAllowance | LineCharge>(
  a: FormAdjustment,
  base: Cents,
  path: string,
  errors: InputError[],
): T {
  const out = {} as T;
  if (a.mode === 'percent') {
    const pct = parseScaled(a.value, 2, `${path}.percentage`, errors) ?? 0;
    out.percentage = pct as Rate;
    out.baseAmount = base;
    out.amount = applyRate(base, pct as Rate);
  } else {
    out.amount = cents(parseScaled(a.value, 2, `${path}.amount`, errors) ?? 0);
  }
  put(out, 'reason', trim(a.reason));
  put(out, 'reasonCode', a.reasonCode as T['reasonCode']);
  return out;
}

function buildLine(l: FormLine, index: number, errors: InputError[]): Line {
  const path = `lines[${index}]`;
  const qty = (parseScaled(l.quantity, 4, `${path}.quantity`, errors, { negative: true }) ??
    0) as Quantity;
  const price = (parseScaled(l.unitPrice, 4, `${path}.unitPrice`, errors) ?? 0) as UnitPrice;
  const tax = parseVat(l.vat);
  if (!tax) errors.push({ path: `${path}.tax`, kind: 'vat' });
  const line: Line = {
    id: String(index + 1),
    name: trim(l.name),
    quantity: qty,
    unitCode: l.unitCode || 'C62',
    unitPrice: price,
    netAmount: cents(0),
    tax: tax ?? { category: 'S', rate: 2000 as Rate },
  };
  put(line, 'description', trim(l.description));
  put(line, 'note', trim(l.note));
  put(line, 'sellerItemId', trim(l.sellerItemId));
  put(line, 'buyerItemId', trim(l.buyerItemId));
  if (trim(l.gtin)) line.standardItemId = { value: compact(l.gtin), scheme: '0160' };
  put(line, 'originCountry', trim(l.originCountry).toUpperCase());
  put(line, 'orderLineReference', trim(l.orderLineReference));
  put(line, 'buyerAccountingReference', trim(l.buyerAccountingReference));
  if (l.periodStart || l.periodEnd) {
    line.period = {};
    put(line.period, 'start', l.periodStart as IsoDate);
    put(line.period, 'end', l.periodEnd as IsoDate);
  }
  const base = parseScaled(l.baseQuantity, 4, `${path}.baseQuantity`, errors);
  if (base !== undefined && base !== ONE_QUANTITY) {
    line.baseQuantity = base as Quantity;
    line.baseQuantityUnitCode = line.unitCode;
  }
  const gross = parseScaled(l.grossUnitPrice, 4, `${path}.grossUnitPrice`, errors);
  if (gross !== undefined) {
    if (gross < price) {
      errors.push({ path: `${path}.grossUnitPrice`, kind: 'gross' });
    } else {
      line.grossUnitPrice = gross as UnitPrice;
      line.priceDiscount = (gross - price) as UnitPrice;
    }
  }
  const lineBase = lineNetAmount(qty, price, line.baseQuantity ?? ONE_QUANTITY);
  if (l.allowances.length) {
    line.allowances = l.allowances.map((a, i) =>
      buildLineAdjustment<LineAllowance>(a, lineBase, `${path}.allowances[${i}]`, errors),
    );
  }
  if (l.charges.length) {
    line.charges = l.charges.map((c, i) =>
      buildLineAdjustment<LineCharge>(c, lineBase, `${path}.charges[${i}]`, errors),
    );
  }
  line.netAmount = computeLineNetAmount(line);
  return line;
}

const taxKeyOf = (tax: TaxInfo): string => `${tax.category}:${tax.rate ?? ''}`;

/**
 * Remises et frais du document. Un taux explicite donne un seul élément ; `auto` le répartit entre
 * les taux de TVA des lignes, au prorata de leurs bases — une remise sur une facture à 20 % et
 * 5,5 % porte sur deux assiettes, et EN 16931 exige un taux par remise.
 */
function buildDocAdjustments<T extends DocumentAllowance | DocumentCharge>(
  items: FormDocAdjustment[],
  lines: Line[],
  kind: 'allowances' | 'charges',
  errors: InputError[],
  sources: number[],
): T[] {
  const groups = new Map<string, { tax: TaxInfo; base: number }>();
  for (const line of lines) {
    const key = taxKeyOf(line.tax);
    const group = groups.get(key) ?? { tax: line.tax, base: 0 };
    group.base += line.netAmount;
    groups.set(key, group);
  }
  const out: T[] = [];
  items.forEach((item, index) => {
    const path = `${kind}[${index}]`;
    const reason = trim(item.reason);
    const describe = (target: T) => {
      put(target, 'reason', reason);
      put(target, 'reasonCode', item.reasonCode as T['reasonCode']);
      return target;
    };
    const explicit = item.vat !== 'auto' ? parseVat(item.vat) : undefined;
    const targets = explicit
      ? [{ tax: explicit, base: groups.get(taxKeyOf(explicit))?.base ?? 0 }]
      : [...groups.values()];
    if (targets.length === 0) targets.push({ tax: { category: 'S', rate: 2000 as Rate }, base: 0 });
    if (item.mode === 'percent') {
      const pct = (parseScaled(item.value, 2, `${path}.percentage`, errors) ?? 0) as Rate;
      for (const target of targets) {
        const base = cents(target.base);
        out.push(
          describe({
            amount: applyRate(base, pct),
            baseAmount: base,
            percentage: pct,
            tax: target.tax,
          } as T),
        );
        sources.push(index);
      }
      return;
    }
    const total = parseScaled(item.value, 2, `${path}.amount`, errors) ?? 0;
    if (targets.length === 1) {
      out.push(describe({ amount: cents(total), tax: (targets[0] as { tax: TaxInfo }).tax } as T));
      sources.push(index);
      return;
    }
    // Montant fixe réparti au prorata des bases ; le reste d'arrondi va à la plus grosse assiette.
    const sum = targets.reduce((s, t) => s + t.base, 0);
    const shares = targets.map((t) => (sum === 0 ? 0 : Math.floor((total * t.base) / sum)));
    const largest = targets.reduce(
      (best, t, i) => (t.base > (targets[best]?.base ?? 0) ? i : best),
      0,
    );
    shares[largest] = (shares[largest] ?? 0) + total - shares.reduce((s, v) => s + v, 0);
    targets.forEach((target, i) => {
      if ((shares[i] ?? 0) === 0 && targets.length > 1) return;
      out.push(describe({ amount: cents(shares[i] ?? 0), tax: target.tax } as T));
      sources.push(index);
    });
  });
  return out;
}

function buildPaymentTerms(form: InvoiceForm, errors: InputError[]): PaymentTerms {
  const t = form.paymentTerms;
  const terms: PaymentTerms = {};
  put(terms, 'dueDate', t.dueDate as IsoDate);
  if (t.mode === 'text') {
    terms.text = t.text;
    return terms;
  }
  const penalty = parseScaled(t.latePenaltyRate, 2, 'paymentTerms.latePenaltyRate', errors);
  if (penalty !== undefined) terms.latePenaltyRate = penalty as Rate;
  const indemnity = parseScaled(t.recoveryIndemnity, 2, 'paymentTerms.recoveryIndemnity', errors);
  if (indemnity !== undefined) terms.recoveryIndemnity = cents(indemnity);
  if (t.discount === 'none') {
    terms.earlyPaymentDiscount = 'none';
  } else {
    const rate =
      parseScaled(t.discountRate, 2, 'paymentTerms.earlyPaymentDiscount.rate', errors) ?? 0;
    const days =
      parseInteger(t.discountDays, 'paymentTerms.earlyPaymentDiscount.withinDays', errors) ?? 0;
    terms.earlyPaymentDiscount = { rate: rate as Rate, withinDays: days };
  }
  return terms;
}

function buildPaymentMeans(items: FormPaymentMeans[]): PaymentMeans[] {
  return items.map((pm) => {
    const out: PaymentMeans = { typeCode: pm.typeCode };
    put(out, 'text', trim(pm.text));
    const iban = compact(pm.iban).toUpperCase();
    if (iban) {
      out.creditTransfer = { iban };
      put(out.creditTransfer, 'bic', compact(pm.bic).toUpperCase());
      put(out.creditTransfer, 'accountName', trim(pm.accountName));
    }
    const dd: NonNullable<PaymentMeans['directDebit']> = {};
    put(dd, 'mandateReference', trim(pm.mandateReference));
    put(dd, 'creditorId', compact(pm.creditorId).toUpperCase());
    put(dd, 'debitedIban', compact(pm.debitedIban).toUpperCase());
    if (Object.keys(dd).length > 0) out.directDebit = dd;
    return out;
  });
}

/** Traduit le formulaire en facture complète : lignes, remises, totaux et ventilation calculés par le SDK. */
export function buildInvoice(form: InvoiceForm): BuildResult {
  const errors: InputError[] = [];
  const draft: InvoiceDraft = {
    id: trim(form.id),
    issueDate: form.issueDate as IsoDate,
    typeCode: form.typeCode,
    currency: form.currency || 'EUR',
    seller: buildParty(form.seller, 'seller'),
    buyer: buildParty(form.buyer, 'buyer'),
    lines: form.lines.map((l, i) => buildLine(l, i, errors)),
    paymentTerms: buildPaymentTerms(form, errors),
  };
  if (form.operationCategory) draft.operationCategory = form.operationCategory;
  if (form.businessProcess) draft.businessProcess = form.businessProcess;
  if (form.processing) draft.processing = form.processing;
  if (form.vatOnDebits) draft.vatOnDebits = true;
  put(draft, 'taxPointDate', form.taxPointDate as IsoDate);
  put(draft, 'buyerReference', trim(form.buyerReference));
  put(draft, 'remittanceInformation', trim(form.remittanceInformation));

  if (form.payee.enabled && trim(form.payee.name)) {
    draft.payee = { name: trim(form.payee.name) };
    put(draft.payee, 'id', compact(form.payee.id));
    put(draft.payee, 'legalId', compact(form.payee.legalId));
  }

  const d = form.delivery;
  const delivery: NonNullable<InvoiceDraft['delivery']> = {};
  if (d.mode === 'date') {
    put(delivery, 'date', d.date as IsoDate);
  } else if (d.start || d.end) {
    delivery.period = {};
    put(delivery.period, 'start', d.start as IsoDate);
    put(delivery.period, 'end', d.end as IsoDate);
  }
  put(delivery, 'partyName', trim(d.partyName));
  put(delivery, 'locationId', trim(d.locationId));
  if (d.hasAddress) delivery.address = buildAddress(d.address);
  if (Object.keys(delivery).length > 0) draft.delivery = delivery;

  const allowanceSources: number[] = [];
  const chargeSources: number[] = [];
  const allowances = buildDocAdjustments<DocumentAllowance>(
    form.allowances,
    draft.lines,
    'allowances',
    errors,
    allowanceSources,
  );
  const charges = buildDocAdjustments<DocumentCharge>(
    form.charges,
    draft.lines,
    'charges',
    errors,
    chargeSources,
  );
  if (allowances.length) draft.allowances = allowances;
  if (charges.length) draft.charges = charges;

  if (form.paymentMeans.length) draft.paymentMeans = buildPaymentMeans(form.paymentMeans);

  const r = form.references;
  const references: NonNullable<InvoiceDraft['references']> = {};
  for (const key of [
    'purchaseOrder',
    'contract',
    'project',
    'salesOrder',
    'receivingAdvice',
    'despatchAdvice',
    'tenderOrLot',
    'invoicedObject',
    'buyerAccountingReference',
  ] as const) {
    put(references, key, trim(r[key]));
  }
  const preceding = r.precedingInvoices
    .filter((p) => trim(p.id))
    .map((p) => {
      const ref: { id: string; issueDate?: IsoDate } = { id: trim(p.id) };
      put(ref, 'issueDate', p.issueDate as IsoDate);
      return ref;
    });
  if (preceding.length) references.precedingInvoices = preceding;
  if (Object.keys(references).length > 0) draft.references = references;

  const notes: InvoiceNote[] = form.notes
    .filter((n) => trim(n.text))
    .map((n) =>
      n.subjectCode ? { text: trim(n.text), subjectCode: n.subjectCode } : { text: trim(n.text) },
    );
  if (notes.length) draft.notes = notes;

  const attachments: Attachment[] = form.attachments
    .filter((a) => trim(a.id))
    .map((a) => {
      const out: Attachment = { id: trim(a.id) };
      put(out, 'description', trim(a.description));
      put(out, 'uri', trim(a.uri));
      if (a.file) {
        out.file = {
          filename: a.file.name,
          mimeType: a.file.mimeType as AttachmentMimeType,
          bytes: a.file.bytes,
        };
      }
      return out;
    });
  if (attachments.length) draft.attachments = attachments;

  // Motifs d'exonération des seules catégories employées : le SDK n'en invente jamais.
  const used = new Set<string>([
    ...draft.lines.map((l) => l.tax.category),
    ...allowances.map((a) => a.tax.category),
    ...charges.map((c) => c.tax.category),
  ]);
  const exemptions: NonNullable<ComputeTotalsOptions['exemptions']> = {};
  for (const category of EXEMPT_CATEGORIES) {
    if (!used.has(category)) continue;
    const e = form.exemptions[category];
    const entry: { code?: ExemptionReasonCode; reason?: string } = {};
    put(entry, 'code', e?.code as ExemptionReasonCode);
    put(entry, 'reason', trim(e?.reason ?? ''));
    exemptions[category] = entry;
  }
  const totalsOptions: ComputeTotalsOptions = {};
  if (Object.keys(exemptions).length) totalsOptions.exemptions = exemptions;
  const prepaid = parseScaled(form.prepaid, 2, 'totals.prepaidAmount', errors);
  if (prepaid !== undefined) totalsOptions.prepaidAmount = cents(prepaid);
  const rounding = parseScaled(form.rounding, 2, 'totals.roundingAmount', errors, {
    negative: true,
  });
  if (rounding !== undefined) totalsOptions.roundingAmount = cents(rounding);

  const invoice: Invoice = { ...draft, ...computeTotals(draft, totalsOptions) };
  const toFormPath = (path: string): string =>
    path.replace(/^(allowances|charges)\[(\d+)\]/, (_, kind: string, index: string) => {
      const sources = kind === 'allowances' ? allowanceSources : chargeSources;
      return `${kind}[${sources[Number(index)] ?? index}]`;
    });
  return { invoice, errors, totalsOptions, toFormPath };
}

// ---------- facture → formulaire ----------

function addressForm(a: Party['address'] | undefined): FormAddress {
  return {
    line1: a?.line1 ?? '',
    line2: a?.line2 ?? '',
    line3: a?.line3 ?? '',
    postCode: a?.postCode ?? '',
    city: a?.city ?? '',
    countrySubdivision: a?.countrySubdivision ?? '',
    countryCode: a?.countryCode ?? 'FR',
  };
}

export function partyForm(p: Party | undefined): FormParty {
  return {
    name: p?.name ?? '',
    tradingName: p?.tradingName ?? '',
    siren: p?.siren ?? '',
    siret: p?.siret ?? '',
    vatId: p?.vatId ?? '',
    taxRegistrationId: p?.taxRegistrationId ?? '',
    legalInfo: p?.legalInfo ?? '',
    address: addressForm(p?.address),
    contact: {
      name: p?.contact?.name ?? '',
      phone: p?.contact?.phone ?? '',
      email: p?.contact?.email ?? '',
    },
    electronicAddress: {
      value: p?.electronicAddress?.value ?? '',
      scheme: p?.electronicAddress?.scheme ?? '0225',
    },
    routingCode: p?.routingCode ?? '',
    consumer: p?.consumer === true,
  };
}

function adjustmentForm(
  a: LineAllowance | LineCharge | DocumentAllowance | DocumentCharge,
): FormAdjustment {
  const percent = a.percentage !== undefined && a.baseAmount !== undefined;
  return {
    uid: uid(),
    reason: a.reason ?? '',
    reasonCode: (a.reasonCode as string | undefined) ?? '',
    mode: percent ? 'percent' : 'amount',
    value: percent ? rateInput(a.percentage) : centsInput(a.amount),
  };
}

/**
 * Relit une facture (importée, ou reprise de l'historique) dans le formulaire. Les montants
 * calculés — montants de ligne, totaux, ventilation — ne sont pas repris : le Studio les recalcule,
 * et la validation dira si la facture d'origine les avait faux.
 */
export function invoiceToForm(invoice: Invoice): InvoiceForm {
  const form = blankForm(invoice.issueDate ?? isoToday());
  form.typeCode = invoice.typeCode;
  form.id = invoice.id ?? '';
  form.currency = invoice.currency ?? 'EUR';
  form.operationCategory = invoice.operationCategory ?? '';
  form.businessProcess = invoice.businessProcess ?? '';
  form.processing = invoice.processing ?? '';
  form.vatOnDebits = invoice.vatOnDebits === true;
  form.taxPointDate = invoice.taxPointDate ?? '';
  form.buyerReference = invoice.buyerReference ?? '';
  form.remittanceInformation = invoice.remittanceInformation ?? '';
  form.seller = partyForm(invoice.seller);
  form.buyer = partyForm(invoice.buyer);
  if (invoice.payee) {
    form.payee = {
      enabled: true,
      name: invoice.payee.name,
      id: invoice.payee.id ?? '',
      legalId: invoice.payee.legalId ?? '',
    };
  }
  const d = invoice.delivery;
  form.delivery = {
    mode: d?.period && !d.date ? 'period' : 'date',
    date: d?.date ?? '',
    start: d?.period?.start ?? '',
    end: d?.period?.end ?? '',
    partyName: d?.partyName ?? '',
    locationId: d?.locationId ?? '',
    hasAddress: d?.address !== undefined,
    address: addressForm(d?.address),
  };
  form.lines = (invoice.lines ?? []).map((l) => ({
    ...blankLine(vatKey(l.tax)),
    name: l.name ?? '',
    description: l.description ?? '',
    note: l.note ?? '',
    quantity: e4Input(l.quantity),
    unitCode: l.unitCode ?? 'C62',
    unitPrice: e4Input(l.unitPrice, 2),
    baseQuantity:
      l.baseQuantity !== undefined && l.baseQuantity !== ONE_QUANTITY
        ? e4Input(l.baseQuantity)
        : '',
    grossUnitPrice: l.grossUnitPrice !== undefined ? e4Input(l.grossUnitPrice, 2) : '',
    sellerItemId: l.sellerItemId ?? '',
    buyerItemId: l.buyerItemId ?? '',
    gtin: l.standardItemId?.value ?? '',
    originCountry: l.originCountry ?? '',
    orderLineReference: l.orderLineReference ?? '',
    buyerAccountingReference: l.buyerAccountingReference ?? '',
    periodStart: l.period?.start ?? '',
    periodEnd: l.period?.end ?? '',
    allowances: (l.allowances ?? []).map(adjustmentForm),
    charges: (l.charges ?? []).map(adjustmentForm),
  }));
  if (form.lines.length === 0) form.lines = [blankLine()];
  form.allowances = (invoice.allowances ?? []).map((a) => ({
    ...adjustmentForm(a),
    vat: vatKey(a.tax),
  }));
  form.charges = (invoice.charges ?? []).map((c) => ({ ...adjustmentForm(c), vat: vatKey(c.tax) }));
  for (const tb of invoice.taxBreakdown ?? []) {
    if ((EXEMPT_CATEGORIES as readonly string[]).includes(tb.category)) {
      const category = tb.category as ExemptCategory;
      form.exemptions[category] = {
        code: tb.exemptionReasonCode ?? form.exemptions[category].code,
        reason: tb.exemptionReason ?? '',
      };
    }
  }
  form.prepaid = centsInput(invoice.totals?.prepaidAmount);
  form.rounding = centsInput(invoice.totals?.roundingAmount);
  const pt = invoice.paymentTerms ?? {};
  const structured =
    pt.latePenaltyRate !== undefined &&
    pt.recoveryIndemnity !== undefined &&
    pt.earlyPaymentDiscount !== undefined;
  const discount = pt.earlyPaymentDiscount;
  form.paymentTerms = {
    dueDate: pt.dueDate ?? '',
    mode: structured ? 'structured' : 'text',
    latePenaltyRate: rateInput(pt.latePenaltyRate) || '10',
    recoveryIndemnity: centsInput(pt.recoveryIndemnity).replace(/,00$/, '') || '40',
    discount: discount && discount !== 'none' ? 'rate' : 'none',
    discountRate: discount && discount !== 'none' ? rateInput(discount.rate) : '',
    discountDays: discount && discount !== 'none' ? String(discount.withinDays) : '',
    text: pt.text ?? '',
  };
  form.paymentMeans = (invoice.paymentMeans ?? []).map((pm) => ({
    uid: uid(),
    typeCode: pm.typeCode,
    text: pm.text ?? '',
    iban: pm.creditTransfer?.iban ?? '',
    bic: pm.creditTransfer?.bic ?? '',
    accountName: pm.creditTransfer?.accountName ?? '',
    mandateReference: pm.directDebit?.mandateReference ?? '',
    creditorId: pm.directDebit?.creditorId ?? '',
    debitedIban: pm.directDebit?.debitedIban ?? '',
  }));
  const r = invoice.references ?? {};
  form.references = {
    purchaseOrder: r.purchaseOrder ?? '',
    contract: r.contract ?? '',
    project: r.project ?? '',
    salesOrder: r.salesOrder ?? '',
    receivingAdvice: r.receivingAdvice ?? '',
    despatchAdvice: r.despatchAdvice ?? '',
    tenderOrLot: r.tenderOrLot ?? '',
    invoicedObject: r.invoicedObject ?? '',
    buyerAccountingReference: r.buyerAccountingReference ?? '',
    precedingInvoices: (r.precedingInvoices ?? []).map((p) => ({
      uid: uid(),
      id: p.id,
      issueDate: p.issueDate ?? '',
    })),
  };
  // Les notes générées (pénalités, indemnité, escompte, traitement) sont reconstruites depuis les champs.
  const generated = structured ? ['PMD', 'PMT', 'AAB', 'BAR'] : ['BAR'];
  form.notes = (invoice.notes ?? [])
    .filter((n) => !generated.includes(n.subjectCode ?? ''))
    .map((n) => ({ uid: uid(), subjectCode: n.subjectCode ?? '', text: n.text }));
  form.attachments = (invoice.attachments ?? []).map((a) => {
    const out: FormAttachment = {
      uid: uid(),
      id: a.id,
      description: a.description ?? '',
      uri: a.uri ?? '',
    };
    if (a.file)
      out.file = { name: a.file.filename, mimeType: a.file.mimeType, bytes: a.file.bytes };
    return out;
  });
  return form;
}

/** Montant d'une ligne du formulaire, pour l'afficher pendant la saisie. */
export function lineAmount(line: FormLine): Cents | undefined {
  const errors: InputError[] = [];
  const built = buildLine(line, 0, errors);
  return errors.length ? undefined : built.netAmount;
}

export type { AllowanceReasonCode, ChargeReasonCode };
