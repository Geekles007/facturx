/**
 * Prépare les ressources du validateur en ligne (non versionnées, comme les schémas de test) :
 *
 *   pnpm validator:fetch            # ne récupère que ce qui manque
 *   pnpm validator:fetch --force    # tout re-télécharger / regénérer
 *
 * Produit dans site/validateur/ :
 *   vendor/SaxonJS2.rt.js       runtime XSLT navigateur (Saxonica, licence jointe, redistribué sans modification)
 *   vendor/SaxonJS-LICENSE.txt  licence Saxon-JS reproduite comme elle l'exige
 *   schemas/*.sef.json.gz       les trois schematrons officiels compilés, compressés (~0,1 Mo chacun)
 *   schemas/FACTUR-X_EN16931_codedb.xml  base de codes chargée par document() depuis le schematron Factur-X
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SCHEMATRONS } from './fetch-schemas.mjs';

/** Runtime navigateur Saxon-JS : même version majeure/mineure que le paquet npm `saxon-js` utilisé en CI. */
export const SAXON_VERSION = '2.7';
const SAXON_URL = 'https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js';
/** Empreinte du fichier publié par Saxonica : une différence doit être vue, pas subie. */
const SAXON_SHA256 = '7704990d3bfd64e6621ddf3939943be13a8cc20c17687e0f2dd1ca3d03434e88';

/** Base de codes chargée à l'exécution par le schematron Factur-X (`document(...)`). */
export const CODEDB = 'FACTUR-X_EN16931_codedb.xml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemasSrc = join(root, 'packages/facturx/test/schemas');
const outDir = join(root, 'site/validateur');
const vendorDir = join(outDir, 'vendor');
const schemasDir = join(outDir, 'schemas');

const force = process.argv.includes('--force');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchSaxon() {
  const target = join(vendorDir, 'SaxonJS2.rt.js');
  if (!force && existsSync(target) && sha256(readFileSync(target)) === SAXON_SHA256) {
    console.log('runtime Saxon-JS : déjà présent');
    return;
  }
  console.log(`runtime Saxon-JS ${SAXON_VERSION} : téléchargement…`);
  const res = await fetch(SAXON_URL);
  if (!res.ok) throw new Error(`${SAXON_URL} → HTTP ${res.status}`);
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
  for (const { name, sef } of SCHEMATRONS) {
    const target = join(schemasDir, `${sef}.gz`);
    if (!force && existsSync(target)) {
      console.log(`${name} : déjà présent`);
      continue;
    }
    const gz = gzipSync(readFileSync(join(schemasSrc, sef)), { level: 9 });
    writeFileSync(target, gz);
    console.log(`${name} → ${sef}.gz (${(gz.length / 1024).toFixed(0)} Ko)`);
  }
  const codedb = join(schemasDir, CODEDB);
  if (force || !existsSync(codedb)) {
    copyFileSync(join(schemasSrc, CODEDB), codedb);
    console.log(`  → ${codedb}`);
  }
}

for (const dir of [vendorDir, schemasDir]) mkdirSync(dir, { recursive: true });
await fetchSaxon();
copyLicence();
copySchematrons();
console.log('ressources du validateur prêtes.');
