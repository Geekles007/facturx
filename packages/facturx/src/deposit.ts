import { type Cents, sumCents } from './money.js';
import type { BusinessProcessCode, OperationCategory } from './types/codes.js';
import type { Invoice, InvoiceDraft } from './types/invoice.js';
import type { PrecedingInvoiceReference } from './types/references.js';

export type DepositErrorCode = 'NO_DEPOSIT' | 'NOT_DEPOSIT' | 'CURRENCY' | 'NO_CATEGORY';

/** Erreur typée de `withDeposits`. */
export class DepositError extends Error {
  override readonly name = 'DepositError';
  readonly code: DepositErrorCode;

  constructor(code: DepositErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Cadre de facturation « facture définitive après acompte » (BR-FR-08) selon la nature de l'opération. */
export const FINAL_AFTER_DEPOSIT_BY_CATEGORY: Readonly<
  Record<OperationCategory, BusinessProcessCode>
> = {
  goods: 'B4',
  services: 'S4',
  mixed: 'M4',
};

export interface WithDepositsResult {
  /** Brouillon complété : cadre `B4`/`S4`/`M4` (sauf cadre déjà fourni) et références BT-25/26 vers les acomptes. */
  draft: InvoiceDraft;
  /** BT-113 — Σ des montants TTC des factures d'acompte, à passer à `computeTotals(draft, { prepaidAmount })`. */
  prepaidAmount: Cents;
}

/**
 * Lie une facture définitive à ses factures d'acompte (cas d'usage « acompte », XP Z12-014) :
 * - cadre de facturation `*4` déduit de `operationCategory` (conservé s'il est déjà fourni) ;
 * - `references.precedingInvoices` complétées par chaque acompte (dédoublonnées par numéro) ;
 * - `prepaidAmount` = Σ TTC des acomptes, à déduire du net à payer (BT-113 / BR-CO-16).
 * Exige des acomptes de type `386`, dans la devise de la facture. Ne modifie pas le brouillon reçu.
 */
export function withDeposits(
  draft: InvoiceDraft,
  deposits: readonly Invoice[],
): WithDepositsResult {
  if (deposits.length === 0)
    throw new DepositError('NO_DEPOSIT', 'Au moins une facture d’acompte est requise.');
  if (draft.operationCategory === undefined && draft.businessProcess === undefined) {
    throw new DepositError(
      'NO_CATEGORY',
      'operationCategory est requise pour déduire le cadre de facturation B4/S4/M4.',
    );
  }
  for (const deposit of deposits) {
    if (deposit.typeCode !== '386') {
      throw new DepositError(
        'NOT_DEPOSIT',
        `La facture ${deposit.id} n’est pas une facture d’acompte (BT-3 = 386, reçu ${deposit.typeCode}).`,
      );
    }
    if (deposit.currency !== draft.currency) {
      throw new DepositError(
        'CURRENCY',
        `La facture d’acompte ${deposit.id} est en ${deposit.currency}, la facture définitive en ${draft.currency}.`,
      );
    }
  }

  const existing = draft.references?.precedingInvoices ?? [];
  const known = new Set(existing.map((r) => r.id));
  const added: PrecedingInvoiceReference[] = deposits
    .filter((d) => !known.has(d.id))
    .map((d) => ({ id: d.id, issueDate: d.issueDate }));

  const businessProcess =
    draft.businessProcess ??
    FINAL_AFTER_DEPOSIT_BY_CATEGORY[draft.operationCategory as OperationCategory];

  return {
    draft: {
      ...draft,
      businessProcess,
      references: { ...draft.references, precedingInvoices: [...existing, ...added] },
    },
    prepaidAmount: sumCents(deposits.map((d) => d.totals.taxInclusiveAmount)),
  };
}
