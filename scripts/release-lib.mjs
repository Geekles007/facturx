import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const pkgDir = join(root, 'packages', 'facturx');
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Version depuis un tag `vX.Y.Z` ou une version nue. */
export function versionFromRef(ref) {
  const version = ref.startsWith('v') ? ref.slice(1) : ref;
  if (!SEMVER.test(version)) throw new Error(`Version invalide « ${ref} » (attendu vX.Y.Z).`);
  return version;
}

/** Corps de la section `## [version]` du CHANGELOG racine, sans son titre. */
export function changelogSection(version) {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const header = `## [${version}]`;
  const start = changelog.indexOf(header);
  if (start < 0) throw new Error(`CHANGELOG.md : section « ${header} » absente.`);
  const afterTitle = changelog.indexOf('\n', start) + 1;
  const nextSection = changelog.indexOf('\n## [', afterTitle);
  const linkDefs = changelog.indexOf('\n[', afterTitle);
  const candidates = [nextSection, linkDefs].filter((i) => i > 0);
  const end = candidates.length ? Math.min(...candidates) : changelog.length;
  return changelog.slice(afterTitle, end).trim();
}
