import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// `geist` n'expose pas son package.json dans ses « exports » : on remonte depuis un sous-chemin
// qu'il expose, plutôt que de coder en dur un chemin dans node_modules (pnpm le rend illisible).
const geist = dirname(realpathSync(require.resolve('geist/font/sans')));

/**
 * Police **statique**, pas variable : `renderInvoicePdf` refuse les secondes, parce que veraPDF
 * rejette le document qu'elles produisent (« the font programs … shall be embedded »).
 * `geist` est déjà une dépendance de développement du dépôt et livre les deux formes.
 */
export const testFonts = {
  regular: new Uint8Array(readFileSync(join(geist, 'fonts/geist-sans/Geist-Regular.ttf'))),
  bold: new Uint8Array(readFileSync(join(geist, 'fonts/geist-sans/Geist-Bold.ttf'))),
};
