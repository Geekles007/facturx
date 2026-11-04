/**
 * Garde-fous des modules que le Studio et les Edge Functions se partagent. `pnpm compte:preparer`
 * les copie tels quels dans supabase/functions/_vendor/shared/ ; Deno ne résout pas `./x.js` vers
 * `./x.ts` comme esbuild ou vitest, d'où l'absence de tout import relatif.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { FONT_FAMILIES } from '../studio/fonts.js';
import { FICHIERS_POLICES } from './polices.js';

const here = dirname(fileURLToPath(import.meta.url));

test('aucun module partagé n’importe un fichier relatif (Deno ne résout pas .js → .ts)', () => {
  for (const f of ['numerotation.ts', 'portable.ts', 'polices.ts', 'rendu.ts'])
    expect(readFileSync(join(here, f), 'utf8')).not.toMatch(/from\s+['"]\./);
});

test('rendu.ts n’importe que facturx-sdk/pdf', () => {
  const imports = [
    ...readFileSync(join(here, 'rendu.ts'), 'utf8').matchAll(/from\s+'([^']+)'/g),
  ].map((m) => m[1]);
  expect(new Set(imports)).toEqual(new Set(['facturx-sdk/pdf']));
});

test('chaque famille du Studio a ses fichiers dans FICHIERS_POLICES', () => {
  for (const f of FONT_FAMILIES)
    expect(FICHIERS_POLICES[f.id]).toEqual({ regular: f.regular, bold: f.bold });
});
