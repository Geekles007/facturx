import {
  applyRate,
  type Cents,
  centsToString,
  lineNetAmount,
  ONE_QUANTITY,
  type Rate,
  sumCents,
} from '../money.js';
import type { TaxCategoryCode } from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import type { TaxInfo } from '../types/tax.js';
import { isSafeInteger } from './formats.js';
import type { IssueCode, IssueCollector, TaxRuleFamily } from './issues.js';

/** Clé de regroupement (catégorie, taux) d'une ventilation. */
export function taxKey(tax: { category: TaxCategoryCode; rate?: Rate | undefined }): string {
  return `${tax.category}:${tax.rate ?? ''}`;
}

const ZERO_RATE_CATEGORIES: ReadonlySet<TaxCategoryCode> = new Set(['Z', 'E', 'AE', 'K', 'G']);
const EXEMPTION_REQUIRED: ReadonlySet<TaxCategoryCode> = new Set(['E', 'AE', 'K', 'G', 'O']);
const EXEMPTION_FORBIDDEN: ReadonlySet<TaxCategoryCode> = new Set(['S', 'Z']);

function fam(
  category: TaxCategoryCode,
  suffix: '01' | '05' | '06' | '07' | '08' | '09' | '10',
): IssueCode {
  return `BR-${category as TaxRuleFamily}-${suffix}`;
}

/** Règle de taux selon la catégorie (BR-S-05, BR-Z-05, BR-E-05, BR-AE-05, BR-K-05, BR-G-05, BR-O-05 et -06/-07). */
function checkRateForCategory(
  tax: TaxInfo,
  path: string,
  suffix: '05' | '06' | '07',
  c: IssueCollector,
): void {
  const { category, rate } = tax;
  if (category === 'S' || category === 'L' || category === 'M') {
    if (!isSafeInteger(rate) || rate <= 0) {
      c.add(
        fam(category, suffix),
        `${path}.rate`,
        `Un taux > 0 est obligatoire pour la catégorie ${category}.`,
        { expected: '> 0', actual: rate },
      );
    }
  } else if (ZERO_RATE_CATEGORIES.has(category)) {
    if (rate !== undefined && rate !== 0) {
      c.add(
        fam(category, suffix),
        `${path}.rate`,
        `Le taux doit être 0 pour la catégorie ${category}.`,
        {
          expected: 0,
          actual: rate,
        },
      );
    }
  } else if (category === 'O' && rate !== undefined) {
    c.add(
      fam(category, suffix),
      `${path}.rate`,
      'Aucun taux ne doit être fourni pour la catégorie O (hors champ).',
      {
        actual: rate,
      },
    );
  }
}

function sumBy<T>(items: readonly T[] | undefined, pick: (t: T) => Cents): Cents {
  return sumCents((items ?? []).map(pick));
}

/**
 * Cohérence arithmétique : lignes → totaux de lignes → ventilation TVA → totaux document.
 * Chaque écart produit une anomalie avec la valeur attendue et la valeur reçue ; rien n'est corrigé.
 * Suppose que `checkRequired` a validé la présence et le type entier des montants.
 */
export function checkArithmetic(inv: Invoice, c: IssueCollector): void {
  if (!Array.isArray(inv.lines) || !inv.totals || !Array.isArray(inv.taxBreakdown)) return;

  // 1. Lignes : BT-131 = qté × prix ÷ base − remises + frais
  const netByKey = new Map<string, Cents>();
  const categoriesInLines = new Set<TaxCategoryCode>();
  for (const [i, line] of inv.lines.entries()) {
    const p = `lines[${i}]`;
    if (
      !isSafeInteger(line.quantity) ||
      !isSafeInteger(line.unitPrice) ||
      !isSafeInteger(line.netAmount) ||
      !line.tax
    ) {
      continue;
    }
    const base = line.baseQuantity ?? ONE_QUANTITY;
    const gross = lineNetAmount(line.quantity, line.unitPrice, base);
    const allowances = sumBy(line.allowances, (a) => a.amount);
    const charges = sumBy(line.charges, (ch) => ch.amount);
    const expected = gross - allowances + charges;
    if (line.netAmount !== expected) {
      c.add(
        'CALC-LINE-NET',
        `${p}.netAmount`,
        `Montant net de ligne incohérent : attendu ${centsToString(expected as Cents)}, reçu ${centsToString(line.netAmount)}.`,
        { expected, actual: line.netAmount },
      );
    }
    checkRateForCategory(line.tax, `${p}.tax`, '05', c);
    categoriesInLines.add(line.tax.category);
    const key = taxKey(line.tax);
    netByKey.set(key, sumCents([netByKey.get(key) ?? (0 as Cents), line.netAmount]));
  }

  // 2. Remises / frais document par (catégorie, taux)
  for (const [i, a] of (inv.allowances ?? []).entries()) {
    if (!a.tax || !isSafeInteger(a.amount)) continue;
    checkRateForCategory(a.tax, `allowances[${i}].tax`, '06', c);
    categoriesInLines.add(a.tax.category);
    const key = taxKey(a.tax);
    netByKey.set(key, sumCents([netByKey.get(key) ?? (0 as Cents), -a.amount as Cents]));
  }
  for (const [i, ch] of (inv.charges ?? []).entries()) {
    if (!ch.tax || !isSafeInteger(ch.amount)) continue;
    checkRateForCategory(ch.tax, `charges[${i}].tax`, '07', c);
    categoriesInLines.add(ch.tax.category);
    const key = taxKey(ch.tax);
    netByKey.set(key, sumCents([netByKey.get(key) ?? (0 as Cents), ch.amount]));
  }

  // 3. Totaux de lignes / remises / frais (BR-CO-10, 11, 12)
  const t = inv.totals;
  const lineTotal = sumBy(inv.lines, (l) =>
    isSafeInteger(l.netAmount) ? l.netAmount : (0 as Cents),
  );
  if (isSafeInteger(t.lineTotalAmount) && t.lineTotalAmount !== lineTotal) {
    c.add(
      'BR-CO-10',
      'totals.lineTotalAmount',
      `Total des lignes (BT-106) ≠ Σ BT-131 : attendu ${centsToString(lineTotal)}.`,
      { expected: lineTotal, actual: t.lineTotalAmount },
    );
  }
  const allowanceTotal = sumBy(inv.allowances, (a) =>
    isSafeInteger(a.amount) ? a.amount : (0 as Cents),
  );
  const declaredAllowance = t.allowanceTotalAmount ?? (0 as Cents);
  if (isSafeInteger(declaredAllowance) && declaredAllowance !== allowanceTotal) {
    c.add(
      'BR-CO-11',
      'totals.allowanceTotalAmount',
      `Total des remises (BT-107) ≠ Σ BT-92 : attendu ${centsToString(allowanceTotal)}.`,
      { expected: allowanceTotal, actual: t.allowanceTotalAmount },
    );
  }
  const chargeTotal = sumBy(inv.charges, (ch) =>
    isSafeInteger(ch.amount) ? ch.amount : (0 as Cents),
  );
  const declaredCharge = t.chargeTotalAmount ?? (0 as Cents);
  if (isSafeInteger(declaredCharge) && declaredCharge !== chargeTotal) {
    c.add(
      'BR-CO-12',
      'totals.chargeTotalAmount',
      `Total des frais (BT-108) ≠ Σ BT-99 : attendu ${centsToString(chargeTotal)}.`,
      { expected: chargeTotal, actual: t.chargeTotalAmount },
    );
  }

  // 4. Total HT (BR-CO-13) — calculé sur les valeurs déclarées, chacune déjà contrôlée
  if (isSafeInteger(t.lineTotalAmount) && isSafeInteger(t.taxExclusiveAmount)) {
    const expected = (t.lineTotalAmount - declaredAllowance + declaredCharge) as Cents;
    if (t.taxExclusiveAmount !== expected) {
      c.add(
        'BR-CO-13',
        'totals.taxExclusiveAmount',
        `Total HT (BT-109) ≠ BT-106 − BT-107 + BT-108 : attendu ${centsToString(expected)}.`,
        { expected, actual: t.taxExclusiveAmount },
      );
    }
  }

  // 5. Ventilation TVA
  const seenKeys = new Set<string>();
  const categoriesInBreakdown = new Set<TaxCategoryCode>();
  for (const [i, tb] of inv.taxBreakdown.entries()) {
    const p = `taxBreakdown[${i}]`;
    if (!isSafeInteger(tb.taxableAmount) || !isSafeInteger(tb.taxAmount)) continue;
    categoriesInBreakdown.add(tb.category);
    const key = taxKey(tb);
    if (seenKeys.has(key)) {
      c.add(
        'BR-CO-18',
        p,
        `Ventilation en double pour la catégorie ${tb.category} au taux ${tb.rate ?? '∅'}.`,
      );
    }
    seenKeys.add(key);

    // taux cohérent avec la catégorie (même logique que les lignes)
    if (tb.category === 'S' || tb.category === 'L' || tb.category === 'M') {
      if (!isSafeInteger(tb.rate) || tb.rate <= 0) {
        c.add(
          'CALC-TAX-RATE',
          `${p}.rate`,
          `Un taux > 0 est attendu pour la catégorie ${tb.category}.`,
          {
            expected: '> 0',
            actual: tb.rate,
          },
        );
      }
    } else if (ZERO_RATE_CATEGORIES.has(tb.category) && tb.rate !== undefined && tb.rate !== 0) {
      c.add('CALC-TAX-RATE', `${p}.rate`, `Le taux doit être 0 pour la catégorie ${tb.category}.`, {
        expected: 0,
        actual: tb.rate,
      });
    } else if (tb.category === 'O' && tb.rate !== undefined) {
      c.add('CALC-TAX-RATE', `${p}.rate`, 'Aucun taux pour la catégorie O.', { actual: tb.rate });
    }

    // BT-116 = Σ lignes − Σ remises + Σ frais de même (catégorie, taux)  (BR-S-08, BR-Z-08…)
    const expectedTaxable = netByKey.get(key) ?? (0 as Cents);
    if (tb.taxableAmount !== expectedTaxable) {
      c.add(
        fam(tb.category, '08'),
        `${p}.taxableAmount`,
        `Base imposable (BT-116) incohérente pour ${tb.category} ${tb.rate ?? ''} : attendu ${centsToString(expectedTaxable)}.`,
        { expected: expectedTaxable, actual: tb.taxableAmount },
      );
    }

    // BT-117 = BT-116 × BT-119 ÷ 100 arrondi (BR-CO-17) ; 0 pour les catégories exonérées (BR-E-09…)
    const expectedTax =
      tb.category === 'S' || tb.category === 'L' || tb.category === 'M'
        ? isSafeInteger(tb.rate)
          ? applyRate(tb.taxableAmount, tb.rate)
          : undefined
        : (0 as Cents);
    if (expectedTax !== undefined && tb.taxAmount !== expectedTax) {
      c.add(
        tb.category === 'S' || tb.category === 'L' || tb.category === 'M'
          ? 'BR-CO-17'
          : fam(tb.category, '09'),
        `${p}.taxAmount`,
        `Montant de TVA (BT-117) incohérent : attendu ${centsToString(expectedTax)}.`,
        { expected: expectedTax, actual: tb.taxAmount },
      );
    }

    // Motif d'exonération (BR-E-10, BR-AE-10, BR-K-10, BR-G-10, BR-O-10 / BR-S-10, BR-Z-10)
    const hasReason =
      (typeof tb.exemptionReason === 'string' && tb.exemptionReason.trim() !== '') ||
      (typeof tb.exemptionReasonCode === 'string' && tb.exemptionReasonCode.trim() !== '');
    if (EXEMPTION_REQUIRED.has(tb.category) && !hasReason) {
      c.add(
        fam(tb.category, '10'),
        `${p}.exemptionReason`,
        `La catégorie ${tb.category} exige un motif d’exonération (BT-120) ou un code (BT-121).`,
      );
    }
    if (EXEMPTION_FORBIDDEN.has(tb.category) && hasReason) {
      c.add(
        fam(tb.category, '10'),
        `${p}.exemptionReason`,
        `La catégorie ${tb.category} ne doit pas porter de motif d’exonération.`,
      );
    }
  }

  // Chaque (catégorie, taux) présent dans les lignes/remises/frais doit avoir sa ventilation (BR-S-01…)
  for (const [key] of netByKey) {
    if (!seenKeys.has(key)) {
      const category = key.slice(0, key.indexOf(':')) as TaxCategoryCode;
      const rate = key.slice(key.indexOf(':') + 1);
      c.add(
        fam(category, '01'),
        'taxBreakdown',
        `Aucune ventilation TVA pour la catégorie ${category}${rate ? ` au taux ${rate}` : ''}.`,
        { expected: key },
      );
    }
  }

  // 6. Totaux TVA / TTC / à payer (BR-CO-14, 15, 16)
  const taxTotal = sumBy(inv.taxBreakdown, (tb) =>
    isSafeInteger(tb.taxAmount) ? tb.taxAmount : (0 as Cents),
  );
  if (isSafeInteger(t.taxTotalAmount) && t.taxTotalAmount !== taxTotal) {
    c.add(
      'BR-CO-14',
      'totals.taxTotalAmount',
      `Total TVA (BT-110) ≠ Σ BT-117 : attendu ${centsToString(taxTotal)}.`,
      { expected: taxTotal, actual: t.taxTotalAmount },
    );
  }
  if (
    isSafeInteger(t.taxExclusiveAmount) &&
    isSafeInteger(t.taxTotalAmount) &&
    isSafeInteger(t.taxInclusiveAmount)
  ) {
    const expected = (t.taxExclusiveAmount + t.taxTotalAmount) as Cents;
    if (t.taxInclusiveAmount !== expected) {
      c.add(
        'BR-CO-15',
        'totals.taxInclusiveAmount',
        `Total TTC (BT-112) ≠ BT-109 + BT-110 : attendu ${centsToString(expected)}.`,
        { expected, actual: t.taxInclusiveAmount },
      );
    }
  }
  if (isSafeInteger(t.taxInclusiveAmount) && isSafeInteger(t.amountDueForPayment)) {
    const expected = (t.taxInclusiveAmount -
      (t.prepaidAmount ?? 0) +
      (t.roundingAmount ?? 0)) as Cents;
    if (t.amountDueForPayment !== expected) {
      c.add(
        'BR-CO-16',
        'totals.amountDueForPayment',
        `Montant à payer (BT-115) ≠ BT-112 − BT-113 + BT-114 : attendu ${centsToString(expected)}.`,
        { expected, actual: t.amountDueForPayment },
      );
    }
  }
}
