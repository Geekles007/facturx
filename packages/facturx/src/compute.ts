import {
  applyRate,
  type Cents,
  lineNetAmount,
  ONE_QUANTITY,
  type Rate,
  sumCents,
} from './money.js';
import type { ExemptionReasonCode, TaxCategoryCode } from './types/codes.js';
import type { InvoiceDraft, Totals } from './types/invoice.js';
import type { TaxBreakdown } from './types/tax.js';
import { taxKey } from './validate/arithmetic.js';

export interface ComputeTotalsOptions {
  /** BT-113 — acomptes déjà réglés. */
  prepaidAmount?: Cents;
  /** BT-114 — arrondi. */
  roundingAmount?: Cents;
  /**
   * Motifs d'exonération par catégorie (E, AE, K, G, O), reportés dans la ventilation.
   * Le SDK n'invente jamais de motif : sans entrée ici, la validation signalera BR-E-10 & co.
   */
  exemptions?: Partial<Record<TaxCategoryCode, { code?: ExemptionReasonCode; reason?: string }>>;
}

export interface ComputedTotals {
  totals: Totals;
  taxBreakdown: TaxBreakdown[];
}

/** Montant net attendu d'une ligne (BT-131) : qté × prix ÷ base − remises + frais. */
export function computeLineNetAmount(line: InvoiceDraft['lines'][number]): Cents {
  const gross = lineNetAmount(line.quantity, line.unitPrice, line.baseQuantity ?? ONE_QUANTITY);
  const allowances = sumCents((line.allowances ?? []).map((a) => a.amount));
  const charges = sumCents((line.charges ?? []).map((c) => c.amount));
  return (gross - allowances + charges) as Cents;
}

/**
 * Calcule EXPLICITEMENT la ventilation TVA (BG-23) et les totaux (BG-22) d'un brouillon de facture,
 * à partir des `netAmount` de ligne déclarés (qui restent vérifiés par `validateInvoice`).
 * Aucun appel implicite : c'est à l'appelant de décider d'utiliser ce résultat.
 */
export function computeTotals(
  draft: InvoiceDraft,
  options: ComputeTotalsOptions = {},
): ComputedTotals {
  const groups = new Map<string, { category: TaxCategoryCode; rate?: Rate; taxable: Cents }>();
  const add = (tax: { category: TaxCategoryCode; rate?: Rate | undefined }, amount: Cents) => {
    const key = taxKey(tax);
    const g = groups.get(key);
    if (g) {
      g.taxable = sumCents([g.taxable, amount]);
    } else {
      const entry: { category: TaxCategoryCode; rate?: Rate; taxable: Cents } = {
        category: tax.category,
        taxable: amount,
      };
      if (tax.rate !== undefined) entry.rate = tax.rate;
      groups.set(key, entry);
    }
  };

  for (const line of draft.lines) add(line.tax, line.netAmount);
  for (const a of draft.allowances ?? []) add(a.tax, -a.amount as Cents);
  for (const c of draft.charges ?? []) add(c.tax, c.amount);

  const taxBreakdown: TaxBreakdown[] = [];
  for (const g of groups.values()) {
    const isRated = g.category === 'S' || g.category === 'L' || g.category === 'M';
    const taxAmount = isRated && g.rate !== undefined ? applyRate(g.taxable, g.rate) : (0 as Cents);
    const tb: TaxBreakdown = { category: g.category, taxableAmount: g.taxable, taxAmount };
    if (g.rate !== undefined) tb.rate = g.rate;
    const ex = options.exemptions?.[g.category];
    if (ex?.code !== undefined) tb.exemptionReasonCode = ex.code;
    if (ex?.reason !== undefined) tb.exemptionReason = ex.reason;
    taxBreakdown.push(tb);
  }

  const lineTotalAmount = sumCents(draft.lines.map((l) => l.netAmount));
  const allowanceTotalAmount = sumCents((draft.allowances ?? []).map((a) => a.amount));
  const chargeTotalAmount = sumCents((draft.charges ?? []).map((c) => c.amount));
  const taxExclusiveAmount = (lineTotalAmount - allowanceTotalAmount + chargeTotalAmount) as Cents;
  const taxTotalAmount = sumCents(taxBreakdown.map((tb) => tb.taxAmount));
  const taxInclusiveAmount = (taxExclusiveAmount + taxTotalAmount) as Cents;
  const prepaid = options.prepaidAmount ?? (0 as Cents);
  const rounding = options.roundingAmount ?? (0 as Cents);
  const amountDueForPayment = (taxInclusiveAmount - prepaid + rounding) as Cents;

  const totals: Totals = {
    lineTotalAmount,
    taxExclusiveAmount,
    taxTotalAmount,
    taxInclusiveAmount,
    amountDueForPayment,
  };
  if (draft.allowances?.length) totals.allowanceTotalAmount = allowanceTotalAmount;
  if (draft.charges?.length) totals.chargeTotalAmount = chargeTotalAmount;
  if (options.prepaidAmount !== undefined) totals.prepaidAmount = options.prepaidAmount;
  if (options.roundingAmount !== undefined) totals.roundingAmount = options.roundingAmount;

  return { totals, taxBreakdown };
}
