/**
 * Prépare une version : pnpm bump X.Y.Z
 * - exige la section `## [X.Y.Z]` dans CHANGELOG.md (à écrire avant)
 * - met à jour les deux package.json, copie le CHANGELOG dans le paquet
 * - réécrit les numéros de version affichés hors package.json (README, site)
 * - affiche les commandes git à lancer ; le push du tag déclenche la publication
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection, pkgDir, readJson, root, versionFromRef } from './release-lib.mjs';

/**
 * Endroits où un numéro de version est écrit en dur, hors `package.json`.
 *
 * Ils se sont désynchronisés deux fois : le badge du site annonçait encore la 1.0.1 après la 1.0.2,
 * et l'en-tête du README la 1.0.0 alors que la 1.2.0 était publiée. Un lecteur qui voit un numéro
 * périmé sur la page d'accueil doute du reste — d'où cette synchronisation, et son garde-fou :
 * si un motif ne correspond plus (texte remanié, balise renommée), `bump` **échoue** au lieu de
 * passer l'endroit sous silence. Mieux vaut une version qui refuse de sortir qu'une page qui ment.
 */
const VERSIONED_FILES = [
  {
    path: join(root, 'README.md'),
    label: 'en-tête du README (« État : X.Y.Z »)',
    pattern: /^(> État : \*\*)\d+\.\d+\.\d+(\*\*)/m,
  },
  {
    path: join(root, 'site', 'index.html'),
    label: 'badge npm de la page d’accueil',
    pattern: /(>npm <span class="mono dim">)\d+\.\d+\.\d+(<\/span>)/,
  },
];

const version = versionFromRef(process.argv[2] ?? '');
changelogSection(version); // lève si la section manque

for (const path of [join(pkgDir, 'package.json'), join(root, 'package.json')]) {
  const pkg = readJson(path);
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
copyFileSync(join(root, 'CHANGELOG.md'), join(pkgDir, 'CHANGELOG.md'));

const synchronises = [];
for (const { path, label, pattern } of VERSIONED_FILES) {
  const avant = readFileSync(path, 'utf8');
  const apres = avant.replace(pattern, `$1${version}$2`);
  if (apres === avant && !pattern.test(avant)) {
    throw new Error(
      `Motif de version introuvable dans ${path} (${label}).\n` +
        "Le texte a dû changer : corrigez VERSIONED_FILES dans scripts/bump.mjs, sinon ce numéro restera périmé sans que personne ne s'en aperçoive.",
    );
  }
  if (apres !== avant) {
    writeFileSync(path, apres);
    synchronises.push(label);
  }
}

const detail = synchronises.length > 0 ? `, ${synchronises.join(', ')}` : '';
console.log(`✓ version ${version} écrite (package.json ×2, CHANGELOG copié${detail}). Ensuite :

  pnpm check
  git add -A && git commit -m "v${version}"
  git tag -a v${version} -m "v${version}" && git push origin main v${version}
`);
