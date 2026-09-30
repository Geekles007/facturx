/**
 * Ce que le Studio retient d'une facture à l'autre : l'entreprise, ses clients, son catalogue,
 * l'historique des factures émises, la numérotation et l'apparence.
 *
 * La numérotation suit la règle française : une séquence chronologique et continue, sans trou ni
 * doublon (art. 242 nonies A de l'annexe II du CGI). Le Studio propose le numéro suivant et avertit
 * d'un doublon ; il ne renumérote jamais une facture émise.
 */

import type { RenderDisplay, RenderStyle, RenderTemplate } from 'facturx-sdk/pdf';
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

export interface Numbering {
  /** Gabarit : `{AAAA}` année, `{AA}` année sur deux chiffres, `{MM}` mois, `{N…}` compteur sur autant de chiffres. */
  pattern: string;
  /** Prochain numéro de la séquence. */
  next: number;
  /** Recommencer à 1 chaque année. */
  yearly: boolean;
  /** Année du dernier numéro attribué, pour la remise à zéro annuelle. */
  year: number;
}

export const defaultNumbering = (): Numbering => ({
  pattern: 'F-{AAAA}-{NNNN}',
  next: 1,
  yearly: true,
  year: new Date().getFullYear(),
});

/** Numéro obtenu avec `pattern` pour le rang `n` à la date `iso`. */
export function formatNumber(pattern: string, n: number, iso: string): string {
  const [year = '2026', month = '01'] = iso.split('-');
  return pattern
    .replace(/\{(AAAA|YYYY)\}/g, year)
    .replace(/\{(AA|YY)\}/g, year.slice(2))
    .replace(/\{MM\}/g, month)
    .replace(/\{(N+)\}/g, (_, width: string) => String(n).padStart(width.length, '0'));
}

/** Rang à utiliser pour une facture datée de `iso`, remise à zéro annuelle comprise. */
export function nextRank(numbering: Numbering, iso: string): number {
  const year = Number(iso.slice(0, 4));
  return numbering.yearly && year > numbering.year ? 1 : numbering.next;
}

/**
 * Rang d'un numéro composé avec `pattern` (`F-2026-0042` → 42), ou `undefined` s'il n'en suit pas
 * le gabarit — un numéro saisi à la main, par exemple.
 */
export function rankOf(pattern: string, id: string): number | undefined {
  let groups = 0;
  const source = pattern
    .split(/(\{(?:AAAA|YYYY|AA|YY|MM|N+)\})/)
    .map((part) => {
      if (/^\{(AAAA|YYYY)\}$/.test(part)) return '\\d{4}';
      if (/^\{(AA|YY|MM)\}$/.test(part)) return '\\d{2}';
      if (/^\{N+\}$/.test(part)) {
        groups++;
        return '(\\d+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  if (groups !== 1) return undefined;
  const match = new RegExp(`^${source}$`).exec(id.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * La numérotation après l'émission d'une facture datée de `iso`. Si le numéro émis suit le
 * gabarit avec un rang plus élevé que prévu, la séquence repart de lui : jamais de retour en arrière.
 */
export function advance(numbering: Numbering, iso: string, id?: string): Numbering {
  const year = Number(iso.slice(0, 4));
  const issued = id === undefined ? undefined : rankOf(numbering.pattern, id);
  const next = Math.max(nextRank(numbering, iso), issued ?? 0) + 1;
  return { ...numbering, next, year: Math.max(year, numbering.year) };
}

/** BR-FR-01 et BR-FR-02 : 35 caractères au plus, parmi A-Z a-z 0-9 - + _ /. */
export function numberProblems(id: string): ('length' | 'chars')[] {
  const out: ('length' | 'chars')[] = [];
  if (id.length > 35) out.push('length');
  if (id !== '' && !/^[A-Za-z0-9+_/-]+$/.test(id)) out.push('chars');
  return out;
}

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

/** Octets → base64, par blocs (un `String.fromCharCode(...grand tableau)` déborde la pile). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** JSON qui transporte des `Uint8Array` (pièces jointes, logo, polices) en base64 balisé. */
export function toPortableJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => (v instanceof Uint8Array ? { $bytes: toBase64(v) } : v),
    2,
  );
}

export function fromPortableJson<T>(text: string): T {
  return JSON.parse(text, (_, v) =>
    v && typeof v === 'object' && typeof (v as { $bytes?: unknown }).$bytes === 'string'
      ? fromBase64((v as { $bytes: string }).$bytes)
      : v,
  ) as T;
}
