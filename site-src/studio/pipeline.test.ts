/**
 * Le PDF que produit le Studio, de bout en bout : formulaire → facture → page rendue → Factur-X.
 *
 * Mêmes fonctions que dans le navigateur (`buildInvoice`, `buildFacturX`), mêmes polices que celles
 * que le site sert. Le document doit se relire à l'identique, et passer veraPDF quand il est là
 * (`PATH="$PWD/scripts:$PATH"`, comme pour les tests du SDK).
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { toCiiXml } from 'facturx-sdk';
import { extractInvoice } from 'facturx-sdk/pdf';
import { describe, expect, it } from 'vitest';
import { type Appearance, defaultAppearance } from './library.js';
import { buildInvoice } from './model.js';
import { type Assets, buildFacturX } from './pipeline.js';
import { sampleForm } from './sample.js';

const require = createRequire(import.meta.url);
const geist = join(dirname(realpathSync(require.resolve('geist/font/sans'))), 'fonts/geist-sans');
const baskerville = dirname(require.resolve('@expo-google-fonts/libre-baskerville/package.json'));
const read = (path: string) => new Uint8Array(readFileSync(path));

const GEIST: Assets['fonts'] = {
  regular: read(join(geist, 'Geist-Regular.ttf')),
  bold: read(join(geist, 'Geist-SemiBold.ttf')),
};
const BASKERVILLE: Assets['fonts'] = {
  regular: read(join(baskerville, '400Regular/LibreBaskerville_400Regular.ttf')),
  bold: read(join(baskerville, '700Bold/LibreBaskerville_700Bold.ttf')),
};

const VARIANTS: [string, Appearance, Assets['fonts']][] = [
  ['modèle par défaut', defaultAppearance(), GEIST],
  [
    'bandeau, couleur claire, libellés renommés',
    {
      ...defaultAppearance(),
      template: 'modern',
      accent: '#f5c518',
      labels: { designation: 'Prestation', amountDue: 'À régler' },
      display: { lineNumbers: true, facturxNotice: true },
    },
    GEIST,
  ],
  [
    'papier à lettre, police à empattements, document en anglais',
    { ...defaultAppearance(), template: 'letterhead', language: 'en', font: 'baskerville' },
    BASKERVILLE,
  ],
];

function verapdf(): boolean {
  const probe = spawnSync('verapdf', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /veraPDF/i.test(probe.stdout + probe.stderr);
}

describe('PDF Factur-X produit par le Studio', () => {
  it.each(VARIANTS)('se relit à l’identique — %s', async (_name, appearance, fonts) => {
    const { invoice } = buildInvoice(sampleForm('2026-09-30'));
    const pdf = await buildFacturX(invoice, appearance, { fonts });
    const read = await extractInvoice(pdf);
    expect(read?.invoice.id).toBe(invoice.id);
    expect(read?.invoice.totals).toEqual(invoice.totals);
    expect(read?.xml).toBe(toCiiXml(invoice));
  });

  it.skipIf(!verapdf()).each(VARIANTS)(
    'est un PDF/A-3b selon veraPDF — %s',
    async (_name, appearance, fonts) => {
      const { invoice } = buildInvoice(sampleForm('2026-09-30'));
      const pdf = await buildFacturX(invoice, appearance, { fonts });
      const dir = mkdtempSync(join(tmpdir(), 'studio-verapdf-'));
      chmodSync(dir, 0o755);
      const file = join(dir, 'facture.pdf');
      writeFileSync(file, pdf, { mode: 0o644 });
      const run = spawnSync('verapdf', ['--flavour', '3b', '--format', 'text', file], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      expect(run.stdout, run.stderr).toMatch(/^PASS /m);
    },
    180_000,
  );
});
