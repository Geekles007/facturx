/**
 * Garde-fous avant publication : node scripts/release-check.mjs vX.Y.Z
 * - le tag correspond aux deux package.json
 * - le CHANGELOG racine a la section, et le CHANGELOG du paquet est identique
 * - la version n'existe pas encore sur npm
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection, pkgDir, readJson, root, versionFromRef } from './release-lib.mjs';

const version = versionFromRef(process.argv[2] ?? '');
const pkg = readJson(join(pkgDir, 'package.json'));
const rootPkg = readJson(join(root, 'package.json'));
const errors = [];

if (pkg.version !== version)
  errors.push(`packages/facturx/package.json est en ${pkg.version}, tag ${version}.`);
if (rootPkg.version !== version)
  errors.push(`package.json racine est en ${rootPkg.version}, tag ${version}.`);
try {
  changelogSection(version);
} catch (error) {
  errors.push(error.message);
}
if (
  readFileSync(join(root, 'CHANGELOG.md'), 'utf8') !==
  readFileSync(join(pkgDir, 'CHANGELOG.md'), 'utf8')
) {
  errors.push('packages/facturx/CHANGELOG.md diffère du CHANGELOG.md racine (lancer `pnpm bump`).');
}
try {
  const published = execFileSync('npm', ['view', `${pkg.name}@${version}`, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (published) errors.push(`${pkg.name}@${version} est déjà publié.`);
} catch {
  // 404 : la version n'existe pas, c'est ce qu'on veut
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ ${pkg.name}@${version} prêt à publier.`);
