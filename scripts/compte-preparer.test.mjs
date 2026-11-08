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

  // Deno type-check les modules qui importent le SDK (`deno check`, `deno test`) : sans ces deux
  // retouches, `facturx-sdk/pdf` n'y a aucun type (RenderLabels, LayoutInvoiceOptions…).
  it('le SDK copié porte ses types pour Deno', async () => {
    await preparer();
    for (const point of ['index', 'pdf']) {
      expect(lire(`supabase/functions/_vendor/facturx-sdk/${point}.js`)).toMatch(
        new RegExp(`^// @ts-self-types="\\./${point}\\.d\\.ts"\\n`),
      );
      // Les .d.ts importent leur chunk de types en `.js`, qui n'existe pas : Deno veut le .d.ts.
      expect(lire(`supabase/functions/_vendor/facturx-sdk/${point}.d.ts`)).not.toMatch(
        /from '\.\/[\w-]+\.js'/,
      );
    }
  });
});
