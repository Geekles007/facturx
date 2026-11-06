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
import { ErreurConservation, estDuCompte } from './persistence.js';
import type { Assets } from './pipeline.js';
import { buildFacturX, download, fileStem } from './pipeline.js';
import { storage } from './storage.js';
import { brouillonAffiche, enregistrerMaintenant, store, toast, ui } from './store.js';

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

/** Pourquoi la saisie du brouillon ouvert n'est pas partie (`raison` : un code de la conservation). */
export function messageEnAttente(raison?: string): string {
  const s = store.get().ui;
  const phrases = t.compte.conservation.enAttente;
  if (s.storage === 'injoignable') return phrases.injoignable;
  if (s.compte?.session === 'expiree' || raison === 'SESSION') return phrases.session;
  if (s.conflit || raison === 'BROUILLON_MODIFIE') return phrases.conflit;
  if (s.brouillonRefuse !== undefined) return phrases.refus(s.brouillonRefuse);
  if (s.reseau === 'hors-ligne' || raison === 'RESEAU') return phrases.reseau;
  if (raison === 'EN_COURS') return phrases.enCours;
  return phrases.refus(raison ?? '');
}

/**
 * En mode compte, avant de quitter le brouillon ouvert : sa saisie part au serveur, et l'on attend
 * la fin des envois. Faux, avec un message qui dit pourquoi, si elle ne peut pas partir (hors
 * ligne, session expirée, conflit, refus) : changer de document la perdrait, on reste donc sur
 * lui. Sans compte, toujours vrai.
 */
export async function quitterLeBrouillon(): Promise<boolean> {
  if (!store.get().ui.compte || !estDuCompte(storage)) return true;
  if (!(await enregistrerMaintenant())) {
    toast(messageEnAttente(), 'error', 9000);
    return false;
  }
  await storage.envoisTermines();
  return true;
}

/** Au-delà, on renonce à rattraper une saisie qui ne cesse de changer pendant les envois. */
const ESSAIS_DE_BASCULE = 10;

/**
 * Bascule vers un autre document sans rien perdre de la saisie : on enregistre, puis `basculer`
 * vérifie et change de document d'un seul tenant, sans rien attendre — aucune frappe ne peut
 * s'intercaler entre la vérification et l'éditeur. Si l'on a tapé pendant l'envoi, la
 * vérification échoue (`basculer` rend faux, ou lève `EN_ATTENTE`/`EN_COURS`) et l'on recommence.
 * Faux, avec un message, si la saisie ne peut pas partir. Sans compte, `basculer` seul.
 */
export async function changerDeDocument(
  basculer: () => boolean | Promise<boolean>,
): Promise<boolean> {
  if (!store.get().ui.compte || !estDuCompte(storage)) return basculer();
  for (let essai = 1; ; essai++) {
    if (!(await quitterLeBrouillon())) return false;
    try {
      if (await basculer()) return true;
    } catch (erreur) {
      const raison = erreur instanceof ErreurConservation ? erreur.detail : undefined;
      if (raison !== 'EN_COURS') throw erreur;
    }
    if (essai === ESSAIS_DE_BASCULE) {
      toast(messageEnAttente('EN_COURS'), 'error', 9000);
      return false;
    }
  }
}

/**
 * Remplace la facture affichée par un nouveau brouillon. En mode compte, c'en est un de plus : le
 * brouillon ouvert part d'abord au serveur et reste dans la liste ; s'il ne peut pas partir, rien
 * ne change et le Studio dit pourquoi. Vrai si la facture a été remplacée. Sans compte, rien
 * n'attend : le remplacement est immédiat, comme toujours.
 */
export function startDraft(form: InvoiceForm, appearance?: Appearance): Promise<boolean> {
  return changerDeDocument(() => {
    // Synchrone : on ne quitte le brouillon qu'au moment où l'éditeur change.
    if (
      estDuCompte(storage) &&
      store.get().ui.compte &&
      !storage.quitterBrouillon(brouillonAffiche())
    )
      return false;
    remplacer(form, appearance);
    return true;
  });
}

/** Remplace la facture affichée, tout de suite (sans rien enregistrer ni vérifier avant). */
export function remplacer(form: InvoiceForm, appearance?: Appearance): void {
  store.set((s) => ({
    form,
    ...(appearance ? { appearance } : {}),
    ui: {
      ...s.ui,
      issued: undefined,
      library: undefined,
      tab: 'content',
      sample: false,
      conflit: false,
      focus: undefined,
    },
  }));
  ui({ mobile: 'edit' });
}
