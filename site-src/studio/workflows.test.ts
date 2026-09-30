import { centsToString, validateInvoice } from 'facturx-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  type SavedInvoice,
} from './library.js';
import { blankLine, buildInvoice, type InvoiceForm } from './model.js';
import { sampleForm } from './sample.js';
import { store } from './store.js';
import { balanceForm, creditNoteForm, duplicateForm } from './workflows.js';

const TODAY = '2026-09-30';

function saved(form: InvoiceForm): SavedInvoice {
  const { invoice } = buildInvoice(form);
  return {
    uid: form.id,
    status: 'issued',
    form,
    appearance: defaultAppearance(),
    summary: {
      id: invoice.id,
      typeCode: invoice.typeCode,
      issueDate: invoice.issueDate,
      buyerName: invoice.buyer.name,
      currency: invoice.currency,
      total: invoice.totals.taxInclusiveAmount,
      due: invoice.totals.amountDueForPayment,
    },
    issuedAt: `${TODAY}T10:00:00Z`,
  };
}

function deposit(id: string, amount: string): SavedInvoice {
  const form = sampleForm(TODAY);
  form.typeCode = '386';
  form.id = id;
  form.lines = [
    { ...blankLine('S:20'), name: 'Acompte sur commande', quantity: '1', unitPrice: amount },
  ];
  form.allowances = [];
  return saved(form);
}

beforeEach(() => {
  store.set({
    numbering: { ...defaultNumbering(), next: 7, year: 2026 },
    company: defaultCompany(),
  });
});

describe('parcours entre factures', () => {
  it('une copie prend le numéro suivant et les dates du jour', () => {
    const original = sampleForm('2026-06-01');
    const copy = duplicateForm(original, TODAY);
    expect(copy.id).toBe('F-2026-0007');
    expect(copy.issueDate).toBe(TODAY);
    expect(copy.lines.map((l) => l.name)).toEqual(original.lines.map((l) => l.name));
    expect(copy.lines[0]?.uid).not.toBe(original.lines[0]?.uid);
  });

  it('un avoir référence la facture d’origine et reste conforme', () => {
    const original = sampleForm(TODAY);
    const credit = creditNoteForm(original, TODAY);
    expect(credit.typeCode).toBe('381');
    expect(credit.references.precedingInvoices.map((p) => [p.id, p.issueDate])).toEqual([
      [original.id, TODAY],
    ]);
    expect(validateInvoice(buildInvoice(credit).invoice).issues).toEqual([]);
  });

  it('la facture définitive déduit et référence les acomptes (withDeposits)', () => {
    const form = balanceForm([deposit('AC-2026-1', '1000'), deposit('AC-2026-2', '500')], TODAY);
    expect(form.typeCode).toBe('380');
    expect(form.businessProcess).toBe('S4');
    expect(form.references.precedingInvoices.map((p) => p.id)).toEqual(['AC-2026-1', 'AC-2026-2']);
    expect(form.prepaid).toBe('1800,00');
    // La commande complète : 2 000 € HT, soit 2 400 € TTC, dont 1 800 € déjà versés.
    form.lines = [
      { ...blankLine('S:20'), name: 'Commande complète', quantity: '1', unitPrice: '2000' },
    ];
    const { invoice } = buildInvoice(form);
    expect(validateInvoice(invoice).issues).toEqual([]);
    expect(centsToString(invoice.totals.amountDueForPayment)).toBe('600.00');
  });

  it('refuse de facturer le solde d’une facture qui n’est pas un acompte', () => {
    expect(() => balanceForm([saved(sampleForm(TODAY))], TODAY)).toThrow(/acompte/);
  });
});
