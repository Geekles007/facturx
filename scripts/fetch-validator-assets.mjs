/**
 * Prépare les ressources du validateur en ligne (non versionnées, comme les schémas de test) :
 *
 *   pnpm validator:fetch            # ne récupère que ce qui manque
 *   pnpm validator:fetch --force    # tout re-télécharger / regénérer
 *
 * Produit dans site/validateur/ :
 *   vendor/SaxonJS2.rt.js       runtime XSLT navigateur (Saxonica, licence jointe, redistribué sans modification)
 *   vendor/SaxonJS-LICENSE.txt  licence Saxon-JS reproduite comme elle l'exige
 *   schemas/<version>/*.sef.json.gz  les schematrons officiels compilés, compressés (0,1 à 0,4 Mo
 *                               chacun), chargés à la demande selon le profil de la facture
 *   schemas/<version>/FACTUR-X_*_codedb.xml  bases de codes chargées par document() depuis les
 *                               schematrons Factur-X
 *
 * `<version>` est le tag France_RFE : servis avec un an de cache, les jeux de règles changent
 * d'adresse quand ils changent de version.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { FNFE_TAG, fetchWithRetry, SCHEMATRONS } from './fetch-schemas.mjs';

/** Runtime navigateur Saxon-JS : même version majeure/mineure que le paquet npm `saxon-js` utilisé en CI. */
export const SAXON_VERSION = '2.7';
const SAXON_URL = 'https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js';
/** Empreinte du fichier publié par Saxonica : une différence doit être vue, pas subie. */
const SAXON_SHA256 = '7704990d3bfd64e6621ddf3939943be13a8cc20c17687e0f2dd1ca3d03434e88';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemasSrc = join(root, 'packages/facturx/test/schemas');
const outDir = join(root, 'site/validateur');
const vendorDir = join(outDir, 'vendor');
const schemasRoot = join(outDir, 'schemas');
const schemasDir = join(schemasRoot, FNFE_TAG);

const force = process.argv.includes('--force');
/** À (re)copier : absent, plus ancien que sa source, ou `--force`. */
const outdated = (target, source) =>
  force || !existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchSaxon() {
  const target = join(vendorDir, 'SaxonJS2.rt.js');
  if (!force && existsSync(target) && sha256(readFileSync(target)) === SAXON_SHA256) {
    console.log('runtime Saxon-JS : déjà présent');
    return;
  }
  console.log(`runtime Saxon-JS ${SAXON_VERSION} : téléchargement…`);
  const res = await fetchWithRetry(SAXON_URL);
  const body = Buffer.from(await res.arrayBuffer());
  const got = sha256(body);
  if (got !== SAXON_SHA256) {
    throw new Error(
      `empreinte inattendue pour SaxonJS2.rt.js\n  attendue : ${SAXON_SHA256}\n  obtenue  : ${got}\n` +
        `Saxonica a probablement publié une nouvelle version ; vérifier le fichier puis mettre à jour SAXON_SHA256.`,
    );
  }
  writeFileSync(target, body);
  console.log(`  → ${target} (${(body.length / 1024).toFixed(0)} Ko)`);
}

/** La licence Saxon-JS impose de reproduire la notice avec toute redistribution. */
function copyLicence() {
  const target = join(vendorDir, 'SaxonJS-LICENSE.txt');
  if (!force && existsSync(target)) return;
  const candidates = [
    join(root, 'node_modules/saxon-js/LICENSE.txt'),
    join(root, 'packages/facturx/node_modules/saxon-js/LICENSE.txt'),
  ];
  const source = candidates.find((p) => existsSync(p));
  if (!source) {
    throw new Error(
      'licence Saxon-JS introuvable : installer les dépendances (`pnpm install`) avant `pnpm validator:fetch`.',
    );
  }
  copyFileSync(source, target);
  console.log(`  → ${target}`);
}

function copySchematrons() {
  const missing = SCHEMATRONS.filter((s) => !existsSync(join(schemasSrc, s.sef)));
  if (missing.length > 0) {
    console.log('schematrons compilés absents : exécution de `pnpm schemas:fetch`…');
    execFileSync(process.execPath, [join(root, 'scripts/fetch-schemas.mjs')], { stdio: 'inherit' });
  }
  // Les jeux de règles d'une autre version ne sont plus demandés par aucune page.
  for (const name of readdirSync(schemasRoot)) {
    if (name !== FNFE_TAG) rmSync(join(schemasRoot, name), { recursive: true });
  }
  for (const { name, sef } of SCHEMATRONS) {
    const target = join(schemasDir, `${sef}.gz`);
    if (!outdated(target, join(schemasSrc, sef))) {
      console.log(`${name} : déjà présent`);
      continue;
    }
    const gz = gzipSync(readFileSync(join(schemasSrc, sef)), { level: 9 });
    writeFileSync(target, gz);
    console.log(`${name} → ${sef}.gz (${(gz.length / 1024).toFixed(0)} Ko)`);
  }
  // Bases de codes chargées à l'exécution par les schematrons Factur-X (`document(...)`).
  for (const { codedb } of SCHEMATRONS) {
    if (!codedb) continue;
    const target = join(schemasDir, codedb);
    if (!outdated(target, join(schemasSrc, codedb))) continue;
    copyFileSync(join(schemasSrc, codedb), target);
    console.log(`  → ${target}`);
  }
}

for (const dir of [vendorDir, schemasDir]) mkdirSync(dir, { recursive: true });
await fetchSaxon();
copyLicence();
copySchematrons();
console.log('ressources du validateur prêtes.');
