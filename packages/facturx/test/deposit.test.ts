import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cents,
  computeTotals,
  DepositError,
  fromCiiXml,
  type Invoice,
  type InvoiceDraft,
  percent,
  quantity,
  toCiiXml,
  unitPrice,
  validateInvoice,
  withDeposits,
} from '../src/index.js';
import { buyer, seller } from './fixtures/parties.js';

const terms = {
  latePenaltyRate: percent('10'),
  recoveryIndemnity: cents(4000),
  earlyPaymentDiscount: 'none' as const,
};

/** Acompte : une ligne « Acompte x % », TVA 20 %, exigible au versement. */
function deposit(
  id: string,
  issueDate: `${number}-${number}-${number}`,
  label: string,
  amount: number,
): Invoice {
  const draft: InvoiceDraft = {
    id,
    issueDate,
    typeCode: '386',
    currency: 'EUR',
    operationCategory: 'services',
    seller: seller(),
    buyer: buyer(),
    delivery: { period: { start: '2026-06-01', end: '2026-09-30' } },
    references: { purchaseOrder: 'PO-7781' },
    lines: [
      {
        id: '1',
        name: label,
        quantity: quantity(10000),
        unitCode: 'LS',
        unitPrice: unitPrice(amount * 100),
        netAmount: cents(amount),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: { dueDate: issueDate, ...terms },
  };
  return { ...draft, ...computeTotals(draft) };
}

function finalDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0050',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'services',
    seller: seller(),
    buyer: buyer(),
    delivery: { period: { start: '2026-06-01', end: '2026-09-30' } },
    references: { purchaseOrder: 'PO-7781' },
    lines: [
      {
        id: '1',
        name: 'Conception',
        quantity: quantity(10000),
        unitCode: 'LS',
        unitPrice: unitPrice(40000000),
        netAmount: cents(400000),
        tax: { category: 'S', rate: percent('20') },
      },
      {
        id: '2',
        name: 'Développement',
        quantity: quantity(10000),
        unitCode: 'LS',
        unitPrice: unitPrice(60000000),
        netAmount: cents(600000),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: { dueDate: '2026-10-11', ...terms },
  };
}

const deposits = () => [
  deposit('AC-2026-0001', '2026-06-01', 'Acompte 30 % — refonte du site (PO-7781)', 300000),
  deposit('AC-2026-0002', '2026-07-15', 'Acompte 40 % — refonte du site (PO-7781)', 400000),
];

describe('acompte → facture définitive', () => {
  it('les factures d’acompte (386) sont valides', () => {
    for (const d of deposits()) {
      expect(validateInvoice(d).ok, d.id).toBe(true);
      expect(d.totals.taxInclusiveAmount).toBe(d.totals.lineTotalAmount * 1.2);
      expect(toCiiXml(d)).toContain('<ram:TypeCode>386</ram:TypeCode>');
    }
  });

  it('withDeposits lie la définitive : cadre S4, références BT-25/26, acomptes TTC déduits', () => {
    const { draft, prepaidAmount } = withDeposits(finalDraft(), deposits());
    expect(draft.businessProcess).toBe('S4');
    expect(draft.references?.precedingInvoices).toEqual([
      { id: 'AC-2026-0001', issueDate: '2026-06-01' },
      { id: 'AC-2026-0002', issueDate: '2026-07-15' },
    ]);
    expect(draft.references?.purchaseOrder).toBe('PO-7781');
    expect(prepaidAmount).toBe(360000 + 480000);

    const invoice: Invoice = { ...draft, ...computeTotals(draft, { prepaidAmount }) };
    expect(invoice.totals).toEqual({
      lineTotalAmount: 1000000,
      taxExclusiveAmount: 1000000,
      taxTotalAmount: 200000,
      taxInclusiveAmount: 1200000,
      prepaidAmount: 840000,
      amountDueForPayment: 360000,
    });
    expect(validateInvoice(invoice).ok).toBe(true);

    const xml = toCiiXml(invoice);
    expect(xml).toContain('<ram:ID>S4</ram:ID>');
    expect(xml.match(/<ram:InvoiceReferencedDocument>/g)?.length).toBe(2);
    expect(xml).toContain('<ram:TotalPrepaidAmount>8400.00</ram:TotalPrepaidAmount>');
    expect(xml).toContain('<ram:DuePayableAmount>3600.00</ram:DuePayableAmount>');
    expect(fromCiiXml(xml)).toEqual(invoice);
  });

  it('ne dédouble pas une référence déjà présente et respecte un cadre fourni', () => {
    const base = finalDraft();
    base.references = {
      purchaseOrder: 'PO-7781',
      precedingInvoices: [{ id: 'AC-2026-0001', issueDate: '2026-06-01' }],
    };
    base.businessProcess = 'S4';
    const { draft } = withDeposits(base, deposits());
    expect(draft.references?.precedingInvoices).toHaveLength(2);
    expect(draft.businessProcess).toBe('S4');
  });

  it('refuse les acomptes invalides', () => {
    expect(() => withDeposits(finalDraft(), [])).toThrow(DepositError);
    const notDeposit = { ...deposits()[0]!, typeCode: '380' as const };
    expect(() => withDeposits(finalDraft(), [notDeposit])).toThrowError(/386/);
    const otherCurrency = { ...deposits()[0]!, currency: 'USD' };
    expect(() => withDeposits(finalDraft(), [otherCurrency])).toThrowError(/USD/);
    const { operationCategory: _oc, ...noCategory } = finalDraft();
    expect(() => withDeposits(noCategory, deposits())).toThrowError(/operationCategory/);
  });

  it('la validation attrape une définitive mal câblée', () => {
    const draft = { ...finalDraft(), businessProcess: 'S4' as const };
    const missingRef: Invoice = {
      ...draft,
      ...computeTotals(draft, { prepaidAmount: cents(840000) }),
    };
    expect(validateInvoice(missingRef).ok).toBe(false);
    expect(validateInvoice(missingRef).issues.map((i) => i.code)).toContain('FR-DEPOSIT-REFERENCE');

    const linked = withDeposits(finalDraft(), deposits());
    const wrongDue: Invoice = {
      ...linked.draft,
      ...computeTotals(linked.draft, { prepaidAmount: linked.prepaidAmount }),
    };
    wrongDue.totals.amountDueForPayment = cents(1200000); // « oubli » de déduire les acomptes
    const result = validateInvoice(wrongDue);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'BR-CO-16', path: 'totals.amountDueForPayment' }),
    );
  });

  it('golden file de la définitive (XSD via xsd.test.ts)', () => {
    const { draft, prepaidAmount } = withDeposits(finalDraft(), deposits());
    const invoice: Invoice = { ...draft, ...computeTotals(draft, { prepaidAmount }) };
    expect(toCiiXml(invoice, { pretty: true })).toBe(
      readFileSync(new URL('./golden/deposit-final.xml', import.meta.url), 'utf8'),
    );
  });
});
