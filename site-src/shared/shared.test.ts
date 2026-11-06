/**
 * Garde-fous des modules que le Studio et les Edge Functions se partagent. `pnpm compte:preparer`
 * les copie tels quels dans supabase/functions/_vendor/shared/ ; Deno ne résout pas `./x.js` vers
 * `./x.ts` comme esbuild ou vitest, d'où l'absence de tout import relatif.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENDER_LABELS } from 'facturx-sdk/pdf';
import { expect, test } from 'vitest';
import { FONT_FAMILIES } from '../studio/fonts.js';
import { defaultAppearance } from '../studio/library.js';
import { FICHIERS_POLICES } from './polices.js';
import { fromPortableJson, toPortableJson } from './portable.js';
import { labelsFor } from './rendu.js';

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

test('labelsFor ne renomme que les libellés renommables, jamais une mention ni la pagination', () => {
  // Une apparence lue en base ou reçue par une Edge Function peut porter n'importe quelle clé.
  const labels = {
    seller: 'Prestataire',
    page: 'Page',
    invoice: 'Titre',
    vatOnDebits: 'Rien',
    inconnu: 'x',
  };
  const table = labelsFor({ ...defaultAppearance(), labels });
  expect(table.seller).toBe('Prestataire');
  expect(table.page).toBe(RENDER_LABELS.fr.page);
  expect(table.invoice).toEqual(RENDER_LABELS.fr.invoice);
  expect(table.vatOnDebits).toBe(RENDER_LABELS.fr.vatOnDebits);
  expect(table).not.toHaveProperty('inconnu');
});

test('chaque famille du Studio a ses fichiers dans FICHIERS_POLICES', () => {
  for (const f of FONT_FAMILIES)
    expect(FICHIERS_POLICES[f.id]).toEqual({ regular: f.regular, bold: f.bold });
});

test('toPortableJson : indenté de deux espaces par défaut, compact sur demande, même valeur relue', () => {
  const valeur = {
    note: 'é€🙂',
    octets: Uint8Array.of(1, 2, 3),
    liste: [1.5, null, true, { a: [] }],
    vide: {},
  };
  // Le défaut est ce que les sauvegardes du Studio écrivent depuis toujours.
  expect(toPortableJson(valeur)).toBe(
    JSON.stringify(valeur, (_, v) => (v instanceof Uint8Array ? { $bytes: 'AQID' } : v), 2),
  );
  const compact = toPortableJson(valeur, { compact: true });
  expect(compact).not.toMatch(/\n| {2}/);
  expect(compact).toBe(
    '{"note":"é€🙂","octets":{"$bytes":"AQID"},"liste":[1.5,null,true,{"a":[]}],"vide":{}}',
  );
  // Les deux textes relisent la même valeur.
  expect(fromPortableJson(compact)).toEqual(fromPortableJson(toPortableJson(valeur)));
  expect(fromPortableJson<typeof valeur>(compact).octets).toEqual(Uint8Array.of(1, 2, 3));
});
