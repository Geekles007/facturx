/**
 * Génère les e-mails du compte dans supabase/templates/ (versionné) :
 *
 *   pnpm emails:construire
 *
 * Les modèles s'écrivent en TypeScript (site-src/courriels/compte.ts, avec le cadre partagé de
 * site-src/shared/courriel.ts). On les compile avec esbuild, on les charge, puis on écrit :
 *   - <modèle>.html   le gabarit Go bilingue de chacun des cinq modèles de Supabase Auth ;
 *   - objets.json     leurs objets, `{ "<modèle>": "<objet>" }`.
 *
 * La pile locale lit ces fichiers (supabase/config.toml) ; la production les reçoit du workflow
 * « Déploiement du compte ». Un test (site-src/courriels/compte.test.ts) vérifie qu'ils sont à jour.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossier = join(root, 'supabase/templates');

const compilation = await build({
  entryPoints: [join(root, 'site-src/courriels/compte.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});
const source = compilation.outputFiles[0].text;
const { MODELES, modelesDuCompte } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const modeles = modelesDuCompte();
const objets = {};

mkdirSync(dossier, { recursive: true });
for (const modele of MODELES) {
  writeFileSync(join(dossier, `${modele}.html`), modeles[modele].html);
  objets[modele] = modeles[modele].objet;
}
writeFileSync(join(dossier, 'objets.json'), `${JSON.stringify(objets, null, 2)}\n`);

console.log(`supabase/templates/ : ${MODELES.length} modèles et objets.json écrits.`);
