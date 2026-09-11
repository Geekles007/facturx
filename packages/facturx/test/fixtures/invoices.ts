import {
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  type PaymentMeans,
  percent,
  quantity,
  unitPrice,
} from '../../src/index.js';
import { buyer, seller } from './parties.js';

const paymentTerms: Invoice['paymentTerms'] = {
  dueDate: '2026-10-11',
  latePenaltyRate: percent('10'),
  recoveryIndemnity: cents(4000),
  earlyPaymentDiscount: 'none',
};

const paymentMeans: PaymentMeans[] = [
  {
    typeCode: '58',
    creditTransfer: { iban: 'FR7630006000011234567890189', bic: 'BNPAFRPP' },
    remittanceInformation: 'F-2026-0001',
  },
];

/** Facture simple : 1 ligne, 2 × 100,00 € à 20 % → HT 200,00, TVA 40,00, TTC 240,00. */
export function simpleDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0001',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    seller: seller(),
    buyer: buyer(),
    delivery: { date: '2026-09-10' },
    lines: [
      {
        id: '1',
        name: 'Prestation de conseil',
        quantity: quantity(20000),
        unitCode: 'DAY',
        unitPrice: unitPrice(1000000),
        netAmount: cents(20000),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms,
    paymentMeans,
  };
}

export function simpleInvoice(): Invoice {
  const draft = simpleDraft();
  return { ...draft, ...computeTotals(draft) };
}

/**
 * Facture multi-taux avec remises :
 * - ligne 1 : 3 × 50,00 à 20 % avec remise de ligne 10,00 → 140,00
 * - ligne 2 : 1,5 × 20,00 à 5,5 %                          →  30,00
 * - remise document 5,00 (20 %), frais de port 2,00 (20 %)
 * → S 20 % : base 137,00, TVA 27,40 ; S 5,5 % : base 30,00, TVA 1,65
 * → lignes 170,00 ; HT 167,00 ; TVA 29,05 ; TTC 196,05
 */
export function multiRateDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0002',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    buyerReference: 'PO-4587',
    seller: seller(),
    buyer: buyer(),
    delivery: { period: { start: '2026-09-01', end: '2026-09-30' } },
    references: { purchaseOrder: 'PO-4587' },
    lines: [
      {
        id: '1',
        name: 'Licence logicielle',
        quantity: quantity(30000),
        unitCode: 'C62',
        unitPrice: unitPrice(500000),
        allowances: [{ amount: cents(1000), reason: 'Remise fidélité', reasonCode: '95' }],
        netAmount: cents(14000),
        tax: { category: 'S', rate: percent('20') },
      },
      {
        id: '2',
        name: 'Livres',
        quantity: quantity(15000),
        unitCode: 'KGM',
        unitPrice: unitPrice(200000),
        netAmount: cents(3000),
        tax: { category: 'S', rate: percent('5.5') },
      },
    ],
    allowances: [
      {
        amount: cents(500),
        reason: 'Remise commerciale',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    charges: [
      {
        amount: cents(200),
        reason: 'Frais de port',
        reasonCode: 'FC',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: { ...paymentTerms, earlyPaymentDiscount: { rate: percent('2'), withinDays: 10 } },
    paymentMeans,
  };
}

export function multiRateInvoice(): Invoice {
  const draft = multiRateDraft();
  return { ...draft, ...computeTotals(draft) };
}
