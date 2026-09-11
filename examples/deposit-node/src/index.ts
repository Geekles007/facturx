/**
 * Acomptes → facture définitive (cas d'usage « acompte », XP Z12-014).
 *
 * Refonte d'un site : 10 000 € HT. Acompte de 30 % à la commande, 40 % à mi-parcours,
 * facture définitive à la livraison qui référence les deux acomptes et déduit leur TTC.
 *
 *   pnpm --filter example-deposit-node start
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_PROCESS_CODES,
  cents,
  centsToString,
  computeTotals,
  INVOICE_TYPE_LABELS,
  type Invoice,
  type InvoiceDraft,
  type IsoDate,
  percent,
  quantity,
  toCiiXml,
  unitPrice,
  validateInvoice,
  withDeposits,
} from 'facturx-sdk';
import { embedFacturX, extractInvoice } from 'facturx-sdk/pdf';
import { PDFDocument } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');

const seller = {
  name: 'Atelier Exemple SAS',
  siren: '443061841',
  vatId: 'FR64443061841',
  address: { line1: '12 rue de la Facture', postCode: '75011', city: 'Paris', countryCode: 'FR' },
};
const buyer = {
  name: 'Client Démo SARL',
  siren: '732829320',
  address: { line1: '5 avenue du Client', postCode: '69002', city: 'Lyon', countryCode: 'FR' },
};
const terms = {
  latePenaltyRate: percent('10'),
  recoveryIndemnity: cents(4000),
  earlyPaymentDiscount: 'none' as const,
};
const common = {
  currency: 'EUR',
  operationCategory: 'services',
  seller,
  buyer,
  delivery: { period: { start: '2026-06-01', end: '2026-09-30' } },
  references: { purchaseOrder: 'PO-7781' },
} as const;

/** Facture d'acompte : type 386, une ligne forfaitaire, TVA exigible au versement. */
function depositInvoice(id: string, issueDate: IsoDate, label: string, amountHt: string): Invoice {
  const draft: InvoiceDraft = {
    ...common,
    id,
    issueDate,
    typeCode: '386',
    lines: [
      {
        id: '1',
        name: label,
        quantity: quantity(10000),
        unitCode: 'LS',
        unitPrice: unitPrice(Number(amountHt.replace('.', '')) * 100),
        netAmount: cents(Number(amountHt.replace('.', ''))),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: { dueDate: issueDate, ...terms },
  };
  return { ...draft, ...computeTotals(draft) };
}

const deposits = [
  depositInvoice(
    'AC-2026-0001',
    '2026-06-01',
    'Acompte 30 % — refonte du site (PO-7781)',
    '3000.00',
  ),
  depositInvoice(
    'AC-2026-0002',
    '2026-07-15',
    'Acompte 40 % — refonte du site (PO-7781)',
    '4000.00',
  ),
];

/** Facture définitive : les lignes complètes, liée aux acomptes par withDeposits. */
const finalDraft: InvoiceDraft = {
  ...common,
  id: 'F-2026-0050',
  issueDate: '2026-09-11',
  typeCode: '380',
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
const linked = withDeposits(finalDraft, deposits);
const finalInvoice: Invoice = {
  ...linked.draft,
  ...computeTotals(linked.draft, { prepaidAmount: linked.prepaidAmount }),
};

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage();
  return doc.save();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const invoice of [...deposits, finalInvoice]) {
    const result = validateInvoice(invoice);
    if (!result.ok)
      throw new Error(
        `${invoice.id} : ${result.issues.map((i) => `[${i.code}] ${i.path}`).join(', ')}`,
      );
    const pdf = await embedFacturX(await blankPdf(), { invoice });
    writeFileSync(join(outDir, `${invoice.id}.pdf`), pdf);
    writeFileSync(join(outDir, `${invoice.id}.xml`), toCiiXml(invoice, { pretty: true }));

    // Relecture, comme le ferait le destinataire
    const read = (await extractInvoice(pdf))?.invoice;
    if (!read) throw new Error('extraction impossible');
    rows.push({
      numéro: read.id,
      type: `${read.typeCode} ${INVOICE_TYPE_LABELS[read.typeCode]}`,
      cadre: `${read.businessProcess} — ${BUSINESS_PROCESS_CODES[read.businessProcess ?? 'S1']}`,
      HT: centsToString(read.totals.taxExclusiveAmount),
      TTC: centsToString(read.totals.taxInclusiveAmount),
      'acomptes déduits': centsToString(read.totals.prepaidAmount ?? cents(0)),
      'à payer': centsToString(read.totals.amountDueForPayment),
      références: (read.references?.precedingInvoices ?? []).map((r) => r.id).join(', ') || '-',
    });
  }
  console.table(rows);
  console.log(`→ ${outDir}`);

  // Ce que la validation attrape si l'on oublie de lier les acomptes
  const forgotten: Invoice = { ...finalDraft, businessProcess: 'S4', ...computeTotals(finalDraft) };
  const check = validateInvoice(forgotten);
  console.log(
    'Définitive sans référence aux acomptes →',
    check.ok ? 'acceptée (!)' : check.issues.map((i) => `[${i.code}] ${i.path}`).join(' ; '),
  );
  if (check.ok || finalInvoice.totals.amountDueForPayment !== 360000)
    throw new Error('scénario inattendu');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
