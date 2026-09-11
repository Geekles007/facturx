/**
 * Prépare une version : pnpm bump X.Y.Z
 * - exige la section `## [X.Y.Z]` dans CHANGELOG.md (à écrire avant)
 * - met à jour les deux package.json, copie le CHANGELOG dans le paquet
 * - affiche les commandes git à lancer ; le push du tag déclenche la publication
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection, pkgDir, readJson, root, versionFromRef } from './release-lib.mjs';

const version = versionFromRef(process.argv[2] ?? '');
changelogSection(version); // lève si la section manque

for (const path of [join(pkgDir, 'package.json'), join(root, 'package.json')]) {
  const pkg = readJson(path);
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
copyFileSync(join(root, 'CHANGELOG.md'), join(pkgDir, 'CHANGELOG.md'));

console.log(`✓ version ${version} écrite (package.json ×2, CHANGELOG copié). Ensuite :

  pnpm check
  git add -A && git commit -m "v${version}"
  git tag -a v${version} -m "v${version}" && git push origin main v${version}
`);
