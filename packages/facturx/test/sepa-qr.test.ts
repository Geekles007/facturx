import { describe, expect, it } from 'vitest';
import {
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  isValidCreditorReference,
  sepaQrPayload,
} from '../src/index.js';
import { simpleDraft, simpleInvoice } from './fixtures/invoices.js';

const IBAN = 'FR7630006000011234567890189';

function invoiceWith(change: (draft: InvoiceDraft) => void, prepaid?: number): Invoice {
  const draft = simpleDraft();
  change(draft);
  const options = prepaid === undefined ? {} : { prepaidAmount: cents(prepaid) };
  return { ...draft, ...computeTotals(draft, options) };
}

/** Les champs du contenu, ligne par ligne. */
function fields(invoice: Invoice): string[] {
  const result = sepaQrPayload(invoice);
  if (!result.available) throw new Error(`QR code indisponible : ${result.reason}`);
  return result.payload.split('\n');
}

describe('QR code de paiement SEPA (EPC069-12)', () => {
  it('écrit le virement de la facture : bénéficiaire, IBAN, BIC, montant à payer, référence', () => {
    expect(sepaQrPayload(simpleInvoice())).toEqual({
      available: true,
      payload: [
        'BCD',
        '002',
        '1',
        'SCT',
        'BNPAFRPP',
        'Atelier Exemple SAS',
        IBAN,
        'EUR240.00',
        '',
        '',
        'F-2026-0001',
      ].join('\n'),
      paymentMeansIndex: 0,
    });
  });

  it('prend le titulaire du compte, puis le bénéficiaire, puis le vendeur', () => {
    const payee = invoiceWith((d) => {
      d.payee = { name: 'Affactureur SA' };
    });
    expect(fields(payee)[5]).toBe('Affactureur SA');
    const holder = invoiceWith((d) => {
      d.payee = { name: 'Affactureur SA' };
      d.paymentMeans = [{ typeCode: '30', creditTransfer: { iban: IBAN, accountName: 'Compte' } }];
    });
    expect(fields(holder)[5]).toBe('Compte');
  });

  it('met le montant à payer, acomptes déduits', () => {
    // TTC 240,00 € dont 100,00 € déjà versés.
    expect(fields(invoiceWith(() => {}, 10000))[7]).toBe('EUR140.00');
  });

  it('écrit une référence ISO 11649 en champ structuré, toute autre en champ libre', () => {
    const rf = fields(
      invoiceWith((d) => {
        d.remittanceInformation = 'rf18 5390 0754 7034';
      }),
    );
    expect(rf).toHaveLength(10);
    expect(rf[9]).toBe('RF18539007547034');
    const free = fields(
      invoiceWith((d) => {
        d.remittanceInformation = 'Commande\n4587';
      }),
    );
    expect(free[9]).toBe('');
    expect(free[10]).toBe('Commande 4587');
  });

  it('rappelle le numéro de facture à défaut de référence de paiement', () => {
    const invoice = invoiceWith((d) => {
      delete d.remittanceInformation;
      d.id = 'F-2026-0042';
    });
    expect(fields(invoice)[10]).toBe('F-2026-0042');
  });

  it('omet un BIC absent ou invalide : il est facultatif en version 002', () => {
    const invoice = invoiceWith((d) => {
      d.paymentMeans = [
        {
          typeCode: '58',
          creditTransfer: { iban: 'fr76 3000 6000 0112 3456 7890 189', bic: 'bnp' },
        },
      ];
    });
    const f = fields(invoice);
    expect(f[1]).toBe('002');
    expect(f[4]).toBe('');
    expect(f[6]).toBe(IBAN);
  });

  it('tient sur une ligne par champ et respecte les longueurs du format', () => {
    const invoice = invoiceWith((d) => {
      d.seller = { ...d.seller, name: `Atelier\r\nExemple\t${'x'.repeat(80)}` };
      d.remittanceInformation = 'r'.repeat(200);
    });
    const f = fields(invoice);
    expect(f).toHaveLength(11);
    expect([...(f[5] ?? '')]).toHaveLength(70);
    expect(f[5]?.startsWith('Atelier Exemple xxx')).toBe(true);
    expect(f[10]).toBe('r'.repeat(140));
  });

  it('retient le premier virement dont l’IBAN est valide', () => {
    const invoice = invoiceWith((d) => {
      d.paymentMeans = [
        { typeCode: '59', directDebit: { mandateReference: 'RUM-1' } },
        { typeCode: '30', creditTransfer: { iban: 'FR7630006000011234567890180' } },
        { typeCode: '58', creditTransfer: { iban: IBAN } },
      ];
    });
    const result = sepaQrPayload(invoice);
    expect(result.available && result.paymentMeansIndex).toBe(2);
  });

  it.each([
    [
      'un avoir',
      (d: InvoiceDraft) => {
        d.typeCode = '381';
      },
      'credit-note',
    ],
    [
      'une facture en dollars',
      (d: InvoiceDraft) => {
        d.currency = 'USD';
      },
      'currency',
    ],
    [
      'une facture réglée par prélèvement',
      (d: InvoiceDraft) => {
        d.paymentMeans = [{ typeCode: '59' }];
      },
      'no-transfer',
    ],
    [
      'un IBAN dont la clé est fausse',
      (d: InvoiceDraft) => {
        d.paymentMeans = [
          { typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890180' } },
        ];
      },
      'invalid-iban',
    ],
    [
      'des noms et une référence au-delà de 331 octets',
      (d: InvoiceDraft) => {
        d.seller = { ...d.seller, name: '€'.repeat(70) };
        d.remittanceInformation = 'é'.repeat(140);
      },
      'too-long',
    ],
  ] as const)('refuse %s', (_, change, reason) => {
    expect(sepaQrPayload(invoiceWith(change))).toEqual({ available: false, reason });
  });

  it('refuse une facture sans rien à payer, ou dont le montant est illisible', () => {
    expect(sepaQrPayload(invoiceWith(() => {}, 24000))).toEqual({
      available: false,
      reason: 'amount',
    });
    const invoice = simpleInvoice();
    const unreadable = {
      ...invoice,
      totals: { ...invoice.totals, amountDueForPayment: Number.NaN },
    };
    expect(sepaQrPayload(unreadable as Invoice)).toEqual({ available: false, reason: 'amount' });
  });

  it('reconnaît une référence de créancier ISO 11649', () => {
    expect(isValidCreditorReference('RF18 5390 0754 7034')).toBe(true);
    expect(isValidCreditorReference('RF712348231')).toBe(true);
    expect(isValidCreditorReference('RF19 5390 0754 7034')).toBe(false);
    expect(isValidCreditorReference('F-2026-0001')).toBe(false);
  });
});
