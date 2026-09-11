/** Notes de release GitHub depuis le CHANGELOG : node scripts/release-notes.mjs vX.Y.Z */
import { join } from 'node:path';
import { changelogSection, pkgDir, readJson, versionFromRef } from './release-lib.mjs';

const version = versionFromRef(process.argv[2] ?? '');
const { name } = readJson(join(pkgDir, 'package.json'));
process.stdout.write(
  `${changelogSection(version)}\n\n📦 https://www.npmjs.com/package/${name}/v/${version}\n`,
);
