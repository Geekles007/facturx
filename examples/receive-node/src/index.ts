/**
 * Réception : parcourt un dossier de PDF (factures fournisseurs), extrait et valide chaque Factur-X,
 * affiche un tableau et écrit un JSON exploitable par votre compta.
 *
 *   pnpm --filter example-receive-node start -- --demo      # fabrique un inbox de démonstration
 *   pnpm --filter example-receive-node start -- ./mon-dossier
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  centsToString,
  FacturXParseError,
  FacturXValidationError,
  type Invoice,
} from '@geekles/facturx';
import { extractInvoice, FacturXPdfError } from '@geekles/facturx/pdf';
import { createDemoInbox } from './demo-inbox.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const demo = args.includes('--demo');
const inbox = args.find((a) => !a.startsWith('--')) ?? join(here, '..', 'inbox');

interface Row {
  file: string;
  status: 'ok' | 'invalide' | 'illisible' | 'sans-facturx';
  number?: string;
  seller?: string;
  due?: string;
  amount?: string;
  issues?: string[];
}

function summarize(invoice: Invoice): Pick<Row, 'number' | 'seller' | 'due' | 'amount'> {
  return {
    number: invoice.id,
    seller: `${invoice.seller.name} (${invoice.seller.siren ?? invoice.seller.vatId ?? '?'})`,
    due: invoice.paymentTerms.dueDate ?? '-',
    amount: `${centsToString(invoice.totals.amountDueForPayment)} ${invoice.currency}`,
  };
}

async function processFile(file: string): Promise<Row> {
  const bytes = readFileSync(join(inbox, file));
  try {
    const found = await extractInvoice(bytes);
    if (!found) return { file, status: 'sans-facturx' };
    return { file, status: 'ok', ...summarize(found.invoice) };
  } catch (error) {
    if (error instanceof FacturXValidationError) {
      return {
        file,
        status: 'invalide',
        issues: error.issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`),
      };
    }
    if (error instanceof FacturXParseError || error instanceof FacturXPdfError) {
      return { file, status: 'illisible', issues: [`[${error.code}] ${error.message}`] };
    }
    throw error;
  }
}

async function main() {
  if (demo) await createDemoInbox(inbox);
  const files = readdirSync(inbox)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  const rows: Row[] = [];
  for (const file of files) rows.push(await processFile(file));

  console.table(rows.map(({ issues: _issues, ...r }) => r));
  for (const row of rows)
    for (const issue of row.issues ?? []) console.log(`  ${row.file}: ${issue}`);

  const out = join(inbox, 'received.json');
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`→ ${out}`);

  const expected = demo ? { ok: 1, invalide: 1, 'sans-facturx': 1 } : undefined;
  if (expected) {
    for (const [status, count] of Object.entries(expected)) {
      if (rows.filter((r) => r.status === status).length !== count)
        throw new Error(`Démo : ${count} fichier(s) « ${status} » attendu(s)`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
