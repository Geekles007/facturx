/**
 * Ce que le Studio retient d'une facture à l'autre : l'entreprise, ses clients, son catalogue,
 * l'historique des factures émises, la numérotation et l'apparence.
 *
 * La numérotation suit la règle française : une séquence chronologique et continue, sans trou ni
 * doublon (art. 242 nonies A de l'annexe II du CGI). Le Studio propose le numéro suivant et avertit
 * d'un doublon ; il ne renumérote jamais une facture émise.
 */

import type { RenderDisplay, RenderStyle, RenderTemplate } from 'facturx-sdk/pdf';
import { formatNumber, type Numbering, nextRank } from '../shared/numerotation.js';
import {
  addDays,
  blankForm,
  blankLine,
  blankPaymentMeans,
  endOfMonth,
  type FormLine,
  type FormNote,
  type FormParty,
  type FormPaymentMeans,
  type InvoiceForm,
  isoToday,
  partyForm,
  uid,
} from './model.js';

// ---------- apparence ----------

export type LabelKey =
  | 'seller'
  | 'buyer'
  | 'designation'
  | 'quantity'
  | 'unitPrice'
  | 'vat'
  | 'netAmount'
  | 'amountDue'
  | 'paymentTerms'
  | 'notes'
  | 'scanToPay';

export interface Appearance {
  template: RenderTemplate;
  accent: string;
  /** Réglages fins, par-dessus ceux du modèle. */
  style: Partial<RenderStyle>;
  /** Famille de `FONT_FAMILIES`, ou `custom` pour une police importée. */
  font: string;
  logo?:
    | {
        key: string;
        type: 'png' | 'jpeg';
        position: 'left' | 'right';
        height: number;
        name: string;
      }
    | undefined;
  customFont?: { regularKey: string; boldKey?: string; name: string } | undefined;
  /** Langue du document : libellés, nombres, dates. */
  language: 'fr' | 'en';
  /** Libellés renommés ; les mentions légales, elles, ne se renomment pas. */
  labels: Partial<Record<LabelKey, string>>;
  footer: string;
  display: RenderDisplay;
  pageSize: 'A4' | 'Letter';
}

export const defaultAppearance = (): Appearance => ({
  template: 'classic',
  accent: '#111111',
  style: {},
  font: 'geist',
  language: 'fr',
  labels: {},
  footer: '',
  display: { facturxNotice: true },
  pageSize: 'A4',
});

// ---------- entreprise, clients, catalogue ----------

export interface CompanyProfile {
  seller: FormParty;
  paymentMeans: FormPaymentMeans[];
  /** Préférences appliquées à chaque nouvelle facture. */
  defaults: {
    operationCategory: InvoiceForm['operationCategory'];
    vat: string;
    currency: string;
    paymentDays: number;
    endOfMonth: boolean;
    latePenaltyRate: string;
    recoveryIndemnity: string;
    vatOnDebits: boolean;
    notes: FormNote[];
  };
}

export const defaultCompany = (): CompanyProfile => ({
  seller: partyForm(undefined),
  paymentMeans: [blankPaymentMeans()],
  defaults: {
    operationCategory: 'services',
    vat: 'S:20',
    currency: 'EUR',
    paymentDays: 30,
    endOfMonth: false,
    latePenaltyRate: '10',
    recoveryIndemnity: '40',
    vatOnDebits: false,
    notes: [],
  },
});

export interface ClientRecord {
  uid: string;
  party: FormParty;
  updatedAt: string;
}

export interface ProductRecord {
  uid: string;
  name: string;
  description: string;
  unitCode: string;
  unitPrice: string;
  vat: string;
  sellerItemId: string;
  updatedAt: string;
}

export function productToLine(product: ProductRecord): FormLine {
  return {
    ...blankLine(product.vat),
    name: product.name,
    description: product.description,
    unitCode: product.unitCode,
    unitPrice: product.unitPrice,
    sellerItemId: product.sellerItemId,
  };
}

export function lineToProduct(line: FormLine, existing?: string): ProductRecord {
  return {
    uid: existing ?? uid(),
    name: line.name.trim(),
    description: line.description.trim(),
    unitCode: line.unitCode,
    unitPrice: line.unitPrice,
    vat: line.vat,
    sellerItemId: line.sellerItemId.trim(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------- historique ----------

export interface InvoiceSummary {
  id: string;
  typeCode: string;
  issueDate: string;
  buyerName: string;
  currency: string;
  /** Total TTC et net à payer, en centimes. */
  total: number;
  due: number;
}

export interface SavedInvoice {
  uid: string;
  /** Une facture émise ne se modifie plus : on la corrige par un avoir. */
  status: 'issued';
  form: InvoiceForm;
  appearance: Appearance;
  summary: InvoiceSummary;
  issuedAt: string;
}

// ---------- numérotation ----------

// Le gabarit, le rang et les vérifications vivent dans `shared/`, où les Edge Functions les
// emploient aussi ; le Studio continue de les importer d'ici.
export {
  advance,
  formatNumber,
  type Numbering,
  nextRank,
  numberProblems,
  rankOf,
} from '../shared/numerotation.js';

export const defaultNumbering = (): Numbering => ({
  pattern: 'F-{AAAA}-{NNNN}',
  next: 1,
  yearly: true,
  year: new Date().getFullYear(),
});

// ---------- nouvelle facture ----------

/** Échéance selon les préférences : N jours, éventuellement fin de mois. */
export function dueDateFrom(issueDate: string, days: number, eom: boolean): string {
  const due = addDays(issueDate, days);
  return eom ? endOfMonth(due) : due;
}

/** Une facture vierge, déjà à l'en-tête de l'entreprise et au numéro suivant. */
export function newInvoiceForm(
  company: CompanyProfile,
  numbering: Numbering,
  today = isoToday(),
): InvoiceForm {
  const form = blankForm(today);
  const d = company.defaults;
  form.seller = structuredClone(company.seller);
  form.paymentMeans = company.paymentMeans.length
    ? company.paymentMeans.map((pm) => ({ ...structuredClone(pm), uid: uid() }))
    : [blankPaymentMeans()];
  form.operationCategory = d.operationCategory;
  form.currency = d.currency || 'EUR';
  form.vatOnDebits = d.vatOnDebits;
  form.lines = [blankLine(d.vat)];
  form.paymentTerms = {
    ...form.paymentTerms,
    dueDate: dueDateFrom(today, d.paymentDays, d.endOfMonth),
    latePenaltyRate: d.latePenaltyRate,
    recoveryIndemnity: d.recoveryIndemnity,
  };
  form.notes = d.notes.map((n) => ({ ...n, uid: uid() }));
  form.id = formatNumber(numbering.pattern, nextRank(numbering, today), today);
  form.remittanceInformation = form.id;
  if (company.seller.address.countryCode && company.seller.address.countryCode !== 'FR') {
    form.buyer.address.countryCode = company.seller.address.countryCode;
  }
  return form;
}

// ---------- sauvegarde ----------

// Le JSON portable (octets en base64) vit dans `shared/`, comme la numérotation.
export { fromBase64, fromPortableJson, toBase64, toPortableJson } from '../shared/portable.js';
