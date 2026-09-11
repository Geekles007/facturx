/**
 * Émission : lit data/invoice.json (votre modèle applicatif), génère le PDF « visuel » comme votre
 * application le fait déjà (ici avec pdf-lib), puis produit le Factur-X dans out/.
 *
 *   pnpm --filter example-emit-node start
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centsToString, FacturXValidationError, toCiiXml, validateInvoice } from 'facturx';
import { embedFacturX } from 'facturx/pdf';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { AppInvoice } from './app-model.ts';
import { toFacturX } from './to-facturx.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');

/** Le PDF que votre application produit déjà (Puppeteer, LibreOffice, react-pdf…). Ici : pdf-lib, 1 page. */
async function renderVisualPdf(app: AppInvoice, totalTtc: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const write = (text: string, y: number, size = 11) =>
    page.drawText(text, { x: 50, y, size, font });
  write(`Facture ${app.number}`, 780, 20);
  write(`${app.seller.name} -> ${app.buyer.name}`, 750);
  for (const [i, l] of app.lines.entries()) {
    write(`${l.qty} × ${l.label} @ ${l.price} € (TVA ${l.vat} %)`, 700 - i * 18);
  }
  write(`Total TTC : ${totalTtc} €`, 600, 14);
  return doc.save();
}

async function main() {
  const app = JSON.parse(
    readFileSync(join(here, '..', 'data', 'invoice.json'), 'utf8'),
  ) as AppInvoice;

  // 1. Modèle applicatif → Invoice typée (totaux calculés explicitement)
  const invoice = toFacturX(app);

  // 2. Validation « formulaire » : toutes les anomalies, avec chemin, sans exception
  const result = validateInvoice(invoice);
  if (!result.ok) {
    for (const issue of result.issues)
      console.error(`✗ [${issue.code}] ${issue.path} — ${issue.message}`);
    process.exit(1);
  }

  // 3. PDF visuel (votre outil) + Factur-X (le SDK)
  const visual = await renderVisualPdf(app, centsToString(invoice.totals.taxInclusiveAmount));
  const facturx = await embedFacturX(visual, { invoice }, { producer: 'example-emit-node' });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${app.number}.pdf`), facturx);
  writeFileSync(join(outDir, `${app.number}.xml`), toCiiXml(invoice, { pretty: true }));

  console.log(
    `✓ ${app.number} : HT ${centsToString(invoice.totals.taxExclusiveAmount)} €, TVA ${centsToString(invoice.totals.taxTotalAmount)} €, TTC ${centsToString(invoice.totals.taxInclusiveAmount)} €`,
  );
  console.log(`  → ${join(outDir, `${app.number}.pdf`)} (${facturx.length} octets) + .xml`);
}

main().catch((error: unknown) => {
  if (error instanceof FacturXValidationError) {
    for (const issue of error.issues)
      console.error(`✗ [${issue.code}] ${issue.path} — ${issue.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
