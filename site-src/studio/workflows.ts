/**
 * Les parcours qui enchaînent plusieurs factures : émettre, dupliquer, créer un avoir, facturer
 * le solde après acomptes. Ils s'appuient sur le SDK (`withDeposits`) et respectent la règle de
 * numérotation : un numéro émis ne se réutilise pas, la séquence avance d'un cran à chaque émission.
 */

import { centsToString, DepositError, withDeposits } from 'facturx-sdk';
import { putFile } from './files.js';
import { t } from './i18n.js';
import {
  type Appearance,
  advance,
  dueDateFrom,
  formatNumber,
  nextRank,
  type SavedInvoice,
} from './library.js';
import { buildInvoice, type InvoiceForm, isoToday, uid } from './model.js';
import type { Assets } from './pipeline.js';
import { buildFacturX, download, fileStem } from './pipeline.js';
import { storage } from './storage.js';
import { store, toast, ui } from './store.js';

/** Nouveaux identifiants d'interface pour chaque élément de liste d'un formulaire copié. */
function refreshUids(form: InvoiceForm): InvoiceForm {
  const copy = structuredClone(form);
  for (const line of copy.lines) {
    line.uid = uid();
    for (const a of [...line.allowances, ...line.charges]) a.uid = uid();
  }
  for (const list of [
    copy.allowances,
    copy.charges,
    copy.paymentMeans,
    copy.notes,
    copy.attachments,
    copy.references.precedingInvoices,
  ]) {
    for (const item of list) item.uid = uid();
  }
  return copy;
}

/** Même facture, nouveau numéro, dates du jour : un nouveau document, pas une correction. */
export function duplicateForm(form: InvoiceForm, today = isoToday()): InvoiceForm {
  const { numbering, company } = store.get();
  const copy = refreshUids(form);
  copy.id = formatNumber(numbering.pattern, nextRank(numbering, today), today);
  copy.remittanceInformation = copy.id;
  copy.issueDate = today;
  copy.paymentTerms.dueDate = dueDateFrom(
    today,
    company.defaults.paymentDays,
    company.defaults.endOfMonth,
  );
  if (copy.delivery.mode === 'date') copy.delivery.date = today;
  return copy;
}

/** Avoir sur une facture : mêmes lignes, type 381, facture d'origine en référence. */
export function creditNoteForm(original: InvoiceForm, today = isoToday()): InvoiceForm {
  const copy = duplicateForm(original, today);
  copy.typeCode = '381';
  copy.references.precedingInvoices = [
    { uid: uid(), id: original.id, issueDate: original.issueDate },
  ];
  copy.businessProcess = '';
  copy.prepaid = '';
  return copy;
}

/**
 * Facture définitive après acomptes : `withDeposits` fixe le cadre `B4`/`S4`/`M4`, référence
 * chaque acompte et calcule le montant déjà versé, que la facture déduit.
 */
export function balanceForm(deposits: SavedInvoice[], today = isoToday()): InvoiceForm {
  const first = deposits[0];
  if (!first) throw new DepositError('NO_DEPOSIT', 'Au moins une facture d’acompte est requise.');
  const base = duplicateForm(first.form, today);
  base.typeCode = '380';
  base.businessProcess = '';
  base.references.precedingInvoices = [];
  const draft = buildInvoice(base).invoice;
  const result = withDeposits(
    draft,
    deposits.map((d) => buildInvoice(d.form).invoice),
  );
  base.businessProcess = result.draft.businessProcess ?? '';
  base.references.precedingInvoices = (result.draft.references?.precedingInvoices ?? []).map(
    (p) => ({
      uid: uid(),
      id: p.id,
      issueDate: p.issueDate ?? '',
    }),
  );
  base.prepaid = centsToString(result.prepaidAmount).replace('.', ',');
  return base;
}

/**
 * Émet la facture courante : PDF Factur-X produit, conservé et téléchargé, facture ajoutée à
 * l'historique, numérotation avancée. Refuse un numéro déjà émis.
 */
export async function issueInvoice(assets: Assets, options: { record: boolean }): Promise<boolean> {
  const { form, appearance, history, numbering } = store.get();
  const { invoice } = buildInvoice(form);
  if (options.record && history.some((h) => h.form.id.trim() === form.id.trim())) {
    toast(t.issueDialog.duplicateNumber, 'error');
    return false;
  }
  let pdf: Uint8Array;
  try {
    pdf = await buildFacturX(invoice, appearance, assets);
  } catch (error) {
    toast(t.issueDialog.failed((error as Error).message), 'error');
    return false;
  }
  download(pdf, `${fileStem(invoice.id)}.pdf`, 'application/pdf');
  if (!options.record) return true;
  const saved: SavedInvoice = {
    uid: uid(),
    status: 'issued',
    form: structuredClone(form),
    appearance: structuredClone(appearance) as Appearance,
    summary: {
      id: invoice.id,
      typeCode: invoice.typeCode,
      issueDate: invoice.issueDate,
      buyerName: invoice.buyer.name,
      currency: invoice.currency,
      total: invoice.totals.taxInclusiveAmount,
      due: invoice.totals.amountDueForPayment,
    },
    issuedAt: new Date().toISOString(),
  };
  await putFile(`pdf-${saved.uid}`, pdf);
  storage.put('invoices', saved).catch(() => undefined);
  store.set((s) => ({
    history: [...s.history, saved],
    numbering: advance(numbering, invoice.issueDate, invoice.id),
    // À la première émission, le vendeur devient « mon entreprise » : la facture suivante le reprend.
    ...(s.company.seller.name.trim()
      ? {}
      : {
          company: {
            ...s.company,
            seller: structuredClone(form.seller),
            paymentMeans: structuredClone(form.paymentMeans),
          },
        }),
    ui: { ...s.ui, issued: saved.uid },
  }));
  toast(t.issueDialog.issued(invoice.id));
  return true;
}

/** Ouvre une facture de l'historique, en lecture seule. */
export function openIssued(saved: SavedInvoice): void {
  store.set((s) => ({
    form: structuredClone(saved.form),
    appearance: structuredClone(saved.appearance),
    ui: { ...s.ui, issued: saved.uid, library: undefined, tab: 'content', sample: false },
  }));
}

/** Remplace la facture affichée par un nouveau brouillon. */
export function startDraft(form: InvoiceForm, appearance?: Appearance): void {
  store.set((s) => ({
    form,
    ...(appearance ? { appearance } : {}),
    ui: {
      ...s.ui,
      issued: undefined,
      library: undefined,
      tab: 'content',
      sample: false,
      focus: undefined,
    },
  }));
  ui({ mobile: 'edit' });
}
