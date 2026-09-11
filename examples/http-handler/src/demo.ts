/**
 * Démo sans serveur : construit des `Request` Web standard et appelle le handler directement.
 * (Dans votre app, c'est le framework qui fournit la Request.)
 */
import { cents, computeTotals, type InvoiceDraft, percent, quantity, unitPrice } from 'facturx-sdk';
import { PDFDocument } from 'pdf-lib';
import { handleFacturX } from './handler.ts';

const draft: InvoiceDraft = {
  id: 'API-2026-007',
  issueDate: '2026-09-11',
  typeCode: '380',
  operationCategory: 'services',
  currency: 'EUR',
  seller: {
    name: 'Atelier Exemple SAS',
    siren: '443061841',
    vatId: 'FR64443061841',
    address: { postCode: '75011', city: 'Paris', countryCode: 'FR' },
  },
  buyer: {
    name: 'Client Démo SARL',
    siren: '732829320',
    address: { postCode: '69002', city: 'Lyon', countryCode: 'FR' },
  },
  delivery: { date: '2026-09-10' },
  lines: [
    {
      id: '1',
      name: 'Abonnement',
      quantity: quantity(10000),
      unitCode: 'MON',
      unitPrice: unitPrice(4900000),
      netAmount: cents(49000),
      tax: { category: 'S', rate: percent('20') },
    },
  ],
  paymentTerms: {
    dueDate: '2026-10-11',
    latePenaltyRate: percent('10'),
    recoveryIndemnity: cents(4000),
    earlyPaymentDiscount: 'none',
  },
};
const invoice = { ...draft, ...computeTotals(draft) };

const doc = await PDFDocument.create({ updateMetadata: false });
doc.addPage();
const visualPdf = await doc.save();

// POST /emit
const form = new FormData();
form.set('pdf', new Blob([visualPdf], { type: 'application/pdf' }), 'facture.pdf');
form.set('invoice', JSON.stringify(invoice));
const emitted = await handleFacturX(
  new Request('http://app.local/api/facturx/emit', { method: 'POST', body: form }),
);
console.log(
  'POST /emit    →',
  emitted.status,
  emitted.headers.get('content-type'),
  emitted.headers.get('content-disposition'),
);
if (emitted.status !== 200) throw new Error(await emitted.text());
const facturx = await emitted.arrayBuffer();

// POST /receive
const received = await handleFacturX(
  new Request('http://app.local/api/facturx/receive', {
    method: 'POST',
    body: facturx,
    headers: { 'content-type': 'application/pdf' },
  }),
);
const body = (await received.json()) as {
  invoice: { id: string; totals: { amountDueForPayment: number } };
  conformanceLevel: string;
};
console.log(
  'POST /receive →',
  received.status,
  body.invoice.id,
  body.conformanceLevel,
  `${body.invoice.totals.amountDueForPayment / 100} EUR`,
);
if (received.status !== 200 || body.invoice.id !== 'API-2026-007')
  throw new Error('réception incohérente');

// Erreur de validation → 422 avec les anomalies
const broken = { ...invoice, totals: { ...invoice.totals, taxInclusiveAmount: cents(1) } };
form.set('invoice', JSON.stringify(broken));
const rejected = await handleFacturX(
  new Request('http://app.local/api/facturx/emit', { method: 'POST', body: form }),
);
const problem = (await rejected.json()) as { issues: { code: string; path: string }[] };
console.log(
  'POST /emit    →',
  rejected.status,
  problem.issues.map((i) => `${i.code}@${i.path}`).join(', '),
);
if (rejected.status !== 422) throw new Error('la facture incohérente aurait dû être refusée');
