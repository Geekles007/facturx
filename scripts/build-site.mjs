/**
 * Construit les fichiers générés du site (non versionnés) :
 *
 *   pnpm site:build
 *
 * - bundle du validateur : site-src/validateur/main.ts → site/validateur/app.js (+ fragments chargés à la demande)
 * - exemples cliquables dérivés des fichiers de référence du SDK
 *
 * Les jeux de règles et le runtime XSLT viennent de `pnpm validator:fetch`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildBrokenFacturX, buildExampleFacturX } from './example-invoice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'site/validateur');
const examplesDir = join(outDir, 'exemples');
const goldenDir = join(root, 'packages/facturx/test/golden');

if (!existsSync(join(root, 'packages/facturx/dist/index.js'))) {
  throw new Error('le SDK n’est pas construit : lancer `pnpm build` avant `pnpm site:build`.');
}

mkdirSync(outDir, { recursive: true });
// Les fragments portent une empreinte : on nettoie pour ne pas accumuler d’anciens fichiers.
for (const name of readdirSync(outDir)) {
  if (name === 'app.js' || /^chunk-.*\.js$/.test(name)) rmSync(join(outDir, name));
}

const result = await build({
  entryPoints: [join(root, 'site-src/validateur/main.ts')],
  outdir: outDir,
  entryNames: 'app',
  chunkNames: 'chunk-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  console.log(`${file.replace(/^.*site\//, 'site/')} — ${(info.bytes / 1024).toFixed(0)} Ko`);
}

// Exemples : une facture de référence conforme, et la même avec un total faussé.
mkdirSync(examplesDir, { recursive: true });
writeFileSync(join(examplesDir, 'facture-conforme.xml'), readFileSync(join(goldenDir, 'full.xml')));

const broken = readFileSync(join(goldenDir, 'simple.xml'), 'utf8').replace(
  '<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>',
  '<ram:GrandTotalAmount>242.00</ram:GrandTotalAmount>',
);
if (!broken.includes('242.00'))
  throw new Error('exemple non conforme : total introuvable dans simple.xml');
writeFileSync(join(examplesDir, 'facture-non-conforme.xml'), broken);
// PDF/A-3 Factur-X complet, produit par le SDK (couverture veraPDF assurée par les tests).
const [pdf, brokenPdf] = await Promise.all([buildExampleFacturX(), buildBrokenFacturX()]);
writeFileSync(join(examplesDir, 'facture-exemple.pdf'), pdf);
writeFileSync(join(examplesDir, 'facture-exemple-non-conforme.pdf'), brokenPdf);
console.log(
  `exemples/ : 2 XML, facture-exemple.pdf (${(pdf.length / 1024).toFixed(0)} Ko), facture-exemple-non-conforme.pdf (${(brokenPdf.length / 1024).toFixed(0)} Ko)`,
);
