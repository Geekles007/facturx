/**
 * Construit les fichiers générés du site (non versionnés) :
 *
 *   pnpm site:build
 *
 * - bundle du validateur : site-src/validateur/main.ts → site/validateur/app.js (+ fragments chargés à la demande)
 * - bundle du Studio : site-src/studio/main.tsx → site/studio/app.js (+ fragments), et ses polices
 * - exemples cliquables dérivés des fichiers de référence du SDK
 *
 * Les jeux de règles et le runtime XSLT viennent de `pnpm validator:fetch`.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
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

// ---------- Studio ----------

const studioDir = join(root, 'site/studio');
mkdirSync(studioDir, { recursive: true });
for (const name of readdirSync(studioDir)) {
  if (name === 'app.js' || /^chunk-.*\.js$/.test(name)) rmSync(join(studioDir, name));
}
const studio = await build({
  entryPoints: [join(root, 'site-src/studio/main.tsx')],
  outdir: studioDir,
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
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // Le profil sRGB de l'OutputIntent, embarqué tel quel dans le bundle (456 octets).
  loader: { '.icc': 'binary' },
});
let studioBytes = 0;
for (const info of Object.values(studio.metafile.outputs)) studioBytes += info.bytes;
console.log(
  `site/studio/ — ${Object.keys(studio.metafile.outputs).length} fichiers JS, ${(studioBytes / 1024).toFixed(0)} Ko`,
);

// Polices proposées par le Studio : TTF statiques, licence SIL OFL, copiées depuis leurs paquets.
// Statiques et non WOFF : le SDK les embarque telles quelles dans le PDF/A.
const require = createRequire(import.meta.url);
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const geist = join(dirname(require.resolve('geist/font/sans')), 'fonts');
const FONTS = [
  [join(geist, 'geist-sans/Geist-Regular.ttf'), 'geist-regular.ttf'],
  [join(geist, 'geist-sans/Geist-SemiBold.ttf'), 'geist-semibold.ttf'],
  [join(geist, 'geist-mono/GeistMono-Regular.ttf'), 'geistmono-regular.ttf'],
  [join(geist, 'geist-mono/GeistMono-SemiBold.ttf'), 'geistmono-semibold.ttf'],
  [join(pkg('@expo-google-fonts/inter'), '400Regular/Inter_400Regular.ttf'), 'inter-regular.ttf'],
  [
    join(pkg('@expo-google-fonts/inter'), '600SemiBold/Inter_600SemiBold.ttf'),
    'inter-semibold.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/ibm-plex-sans'), '400Regular/IBMPlexSans_400Regular.ttf'),
    'plex-regular.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/ibm-plex-sans'), '600SemiBold/IBMPlexSans_600SemiBold.ttf'),
    'plex-semibold.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/dm-sans'), '400Regular/DMSans_400Regular.ttf'),
    'dmsans-regular.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/dm-sans'), '600SemiBold/DMSans_600SemiBold.ttf'),
    'dmsans-semibold.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/source-serif-4'), '400Regular/SourceSerif4_400Regular.ttf'),
    'sourceserif-regular.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/source-serif-4'), '600SemiBold/SourceSerif4_600SemiBold.ttf'),
    'sourceserif-semibold.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/libre-baskerville'), '400Regular/LibreBaskerville_400Regular.ttf'),
    'baskerville-regular.ttf',
  ],
  [
    join(pkg('@expo-google-fonts/libre-baskerville'), '700Bold/LibreBaskerville_700Bold.ttf'),
    'baskerville-bold.ttf',
  ],
];
const fontsDir = join(studioDir, 'polices');
mkdirSync(fontsDir, { recursive: true });
for (const [source, target] of FONTS) copyFileSync(source, join(fontsDir, target));
const licences = [
  ['Geist, Geist Mono', join(root, 'site/fonts/LICENSE-Geist.txt')],
  ['Inter', join(pkg('@expo-google-fonts/inter'), 'LICENSE_FONT')],
  ['IBM Plex Sans', join(pkg('@expo-google-fonts/ibm-plex-sans'), 'LICENSE_FONT')],
  ['DM Sans', join(pkg('@expo-google-fonts/dm-sans'), 'LICENSE_FONT')],
  ['Source Serif 4', join(pkg('@expo-google-fonts/source-serif-4'), 'LICENSE_FONT')],
  ['Libre Baskerville', join(pkg('@expo-google-fonts/libre-baskerville'), 'LICENSE_FONT')],
];
writeFileSync(
  join(fontsDir, 'LICENCES.txt'),
  licences
    .map(([name, file]) => `===== ${name} =====\n\n${readFileSync(file, 'utf8').trim()}\n`)
    .join('\n'),
);
console.log(`site/studio/polices/ — ${FONTS.length} polices TTF statiques, licences SIL OFL`);

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
