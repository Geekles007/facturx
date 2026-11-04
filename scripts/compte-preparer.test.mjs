import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { preparer } from './compte-preparer.mjs';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (chemin, encodage = 'utf8') => readFileSync(join(racine, chemin), encodage);
const sdk = JSON.parse(lire('packages/facturx/package.json'));

/**
 * Les Edge Functions emploient le SDK du dépôt, copié dans `supabase/functions/_vendor/` : leurs
 * dépendances doivent donc être celles du SDK, à la version près, et jamais une plage.
 */
describe('préparation des fonctions du compte', () => {
  it('les versions de deno.json suivent le SDK', () => {
    const deno = JSON.parse(lire('supabase/functions/deno.json'));
    expect(deno.imports['pdf-lib']).toBe(
      `npm:pdf-lib@${sdk.dependencies['pdf-lib'].replace(/^\^/, '')}`,
    );
    expect(deno.imports['@pdf-lib/fontkit']).toBe(
      `npm:@pdf-lib/fontkit@${sdk.peerDependencies['@pdf-lib/fontkit'].replace(/^\^/, '')}`,
    );
    for (const spec of Object.values(deno.imports)) expect(spec).not.toMatch(/[\^~]|@\d+$/);
  });

  it('preparer copie le SDK, les modules partagés, la version et le profil sRGB', async () => {
    await preparer();
    expect(existsSync(join(racine, 'supabase/functions/_vendor/facturx-sdk/pdf.js'))).toBe(true);
    expect(lire('supabase/functions/_vendor/sdk-version.ts')).toContain(`'${sdk.version}'`);
    const icc = lire('packages/facturx/test/fixtures/sRGB.icc', null);
    expect(lire('supabase/functions/_vendor/srgb.ts')).toContain(icc.toString('base64'));
  });
});
