import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedFacturX, renderInvoicePdf } from '../src/pdf/index.js';
import { multiRateInvoice, simpleInvoice } from './fixtures/invoices.js';

/**
 * Conformité PDF/A-3b vérifiée par veraPDF (référence ISO 19005), sur la couche que le SDK ajoute :
 * la page d'entrée ne contient qu'un rectangle (aucune police), donc toute règle violée vient de
 * la pièce jointe, de /AF, du XMP, de Info, de /ID ou de l'OutputIntent.
 * Ignoré si `verapdf` n'est pas dans le PATH (en local : `PATH="$PWD/scripts:$PATH"` + Docker).
 */
function hasVerapdf(): boolean {
  const probe = spawnSync('verapdf', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /veraPDF/i.test(probe.stdout + probe.stderr);
}

interface FailedRule {
  clause: string | undefined;
  testNumber: number | undefined;
  description: string | undefined;
  specification: string | undefined;
}

/** Parcourt le JSON veraPDF (structure variable selon les versions) : conformité + règles en échec. */
function readReport(json: unknown): { compliant: boolean | undefined; failed: FailedRule[] } {
  let compliant: boolean | undefined;
  const failed: FailedRule[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.compliant === 'boolean' && compliant === undefined) compliant = obj.compliant;
    if (obj.ruleStatus === 'FAILED') {
      failed.push({
        clause: obj.clause as string | undefined,
        testNumber: obj.testNumber as number | undefined,
        description: obj.description as string | undefined,
        specification: obj.specification as string | undefined,
      });
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(json);
  return { compliant, failed };
}

async function blankVectorPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 700, width: 495, height: 80, borderWidth: 1 });
  return doc.save({ updateFieldAppearances: false });
}

const available = hasVerapdf();

describe.skipIf(!available)('conformité PDF/A-3b (veraPDF)', () => {
  it('le PDF produit par embedFacturX est PDF/A-3b', async () => {
    const icc = readFileSync(new URL('./fixtures/sRGB.icc', import.meta.url));
    const pdf = await embedFacturX(
      await blankVectorPdf(),
      { invoice: multiRateInvoice() },
      { date: new Date('2026-09-11T10:00:00Z'), outputIntent: { iccProfile: new Uint8Array(icc) } },
    );
    expectPdfA3b(pdf);
  }, 120_000);

  /**
   * La chaîne complète : rendre la page lisible depuis le modèle, puis y embarquer le XML.
   * C'est le seul endroit qui prouve que la police est bien embarquée — un PDF/A est rejeté sinon.
   */
  it('le PDF rendu puis embarqué est PDF/A-3b', async () => {
    const icc = readFileSync(new URL('./fixtures/sRGB.icc', import.meta.url));
    const font = new Uint8Array(
      readFileSync(new URL('../../../site/fonts/Geist-Variable.woff2', import.meta.url)),
    );
    const invoice = simpleInvoice();
    const rendu = await renderInvoicePdf(invoice, { fonts: { regular: font } });
    const pdf = await embedFacturX(
      rendu,
      { invoice },
      { date: new Date('2026-09-11T10:00:00Z'), outputIntent: { iccProfile: new Uint8Array(icc) } },
    );
    expectPdfA3b(pdf);
  }, 120_000);
});

/** Écrit le PDF puis oppose veraPDF à sa conformité, en nommant chaque règle en échec. */
function expectPdfA3b(pdf: Uint8Array): void {
  // Lisible par l'utilisateur du conteneur Docker (mkdtemp crée un dossier 0700 sous Linux)
  const dir = mkdtempSync(join(tmpdir(), 'facturx-verapdf-'));
  chmodSync(dir, 0o755);
  const file = join(dir, 'facture.pdf');
  writeFileSync(file, pdf, { mode: 0o644 });

  const run = spawnSync('verapdf', ['--flavour', '3b', '--format', 'json', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const start = run.stdout.indexOf('{');
  expect(
    start,
    `veraPDF n'a pas produit de JSON :\n${run.stdout.slice(0, 500)}\n${run.stderr.slice(0, 500)}`,
  ).toBeGreaterThanOrEqual(0);
  const { compliant, failed } = readReport(JSON.parse(run.stdout.slice(start)));
  const detail = failed
    .map(
      (f) =>
        `  - ${f.specification ?? ''} ${f.clause ?? ''}-${f.testNumber ?? ''} : ${f.description ?? ''}`,
    )
    .join('\n');
  expect(compliant, `Non conforme PDF/A-3b :\n${detail}`).toBe(true);
  expect(failed).toEqual([]);
}
