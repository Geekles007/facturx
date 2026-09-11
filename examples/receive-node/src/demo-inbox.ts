/** Fabrique un « inbox » de démonstration : une facture conforme, une incohérente, un PDF sans Factur-X. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cents,
  computeTotals,
  type InvoiceDraft,
  percent,
  quantity,
  toCiiXml,
  unitPrice,
} from '@geekles/facturx';
import { embedFacturX } from '@geekles/facturx/pdf';
import { PDFDocument } from 'pdf-lib';

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage();
  return doc.save();
}

function draft(id: string): InvoiceDraft {
  return {
    id,
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    seller: {
      name: 'Fournisseur SAS',
      siren: '443061841',
      vatId: 'FR64443061841',
      address: { postCode: '75011', city: 'Paris', countryCode: 'FR' },
    },
    buyer: {
      name: 'Votre entreprise',
      siren: '732829320',
      address: { postCode: '69002', city: 'Lyon', countryCode: 'FR' },
    },
    delivery: { date: '2026-09-10' },
    lines: [
      {
        id: '1',
        name: 'Maintenance mensuelle',
        quantity: quantity(10000),
        unitCode: 'MON',
        unitPrice: unitPrice(12000000),
        netAmount: cents(120000),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: {
      dueDate: '2026-10-11',
      latePenaltyRate: percent('10'),
      recoveryIndemnity: cents(4000),
      earlyPaymentDiscount: 'none',
    },
    paymentMeans: [{ typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189' } }],
  };
}

export async function createDemoInbox(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const ok = { ...draft('FOURN-2026-101'), ...computeTotals(draft('FOURN-2026-101')) };
  writeFileSync(
    join(dir, 'FOURN-2026-101.pdf'),
    await embedFacturX(await blankPdf(), { invoice: ok }),
  );

  // Un émetteur peu scrupuleux : TTC gonflé de 10 € dans le XML
  const bad = { ...draft('FOURN-2026-102'), ...computeTotals(draft('FOURN-2026-102')) };
  bad.totals.taxInclusiveAmount = cents(bad.totals.taxInclusiveAmount + 1000);
  bad.totals.amountDueForPayment = bad.totals.taxInclusiveAmount;
  writeFileSync(
    join(dir, 'FOURN-2026-102.pdf'),
    await embedFacturX(await blankPdf(), { xml: toCiiXml(bad, { validate: false }) }),
  );

  // Un PDF ordinaire, sans XML
  writeFileSync(join(dir, 'bon-de-livraison.pdf'), await blankPdf());
}
