/**
 * Prépare les Edge Functions du compte (supabase/functions/_vendor/, non versionné) :
 *
 *   pnpm compte:preparer
 *
 * Les fonctions emploient le SDK du dépôt, celui du bundle du Studio, sans attendre une publication
 * npm et sans dépendre de la façon dont le bundler des fonctions traite un import hors de leur
 * dossier. On copie donc dans `_vendor/` :
 *   - facturx-sdk/    le SDK construit (packages/facturx/dist/, `pnpm build`) ;
 *   - shared/         les modules du Studio que le serveur partage (site-src/shared/*.ts, sans les tests) ;
 *   - sdk-version.ts  la version du SDK, consignée avec chaque facture émise ;
 *   - srgb.ts         le profil colorimétrique sRGB de la sortie PDF/A-3.
 *
 * Les imports de ces modules sont résolus par supabase/functions/deno.json, dont les versions
 * suivent celles du SDK (scripts/compte-preparer.test.mjs).
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'supabase/functions/_vendor');

const EN_TETE = '// Généré par `pnpm compte:preparer` (non versionné) : ne pas modifier.\n';

/** Vide `_vendor/` puis le reconstruit à partir du SDK construit et des modules partagés. */
export async function preparer() {
  const dist = join(root, 'packages/facturx/dist');
  if (!existsSync(join(dist, 'index.js')) || !existsSync(join(dist, 'pdf.js'))) {
    throw new Error(
      'le SDK n’est pas construit : lancer `pnpm build` avant `pnpm compte:preparer`.',
    );
  }

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  cpSync(dist, join(vendorDir, 'facturx-sdk'), { recursive: true });

  // Les modules partagés n'existent qu'à partir de la tâche qui les crée : sans dossier, rien à copier.
  const shared = join(root, 'site-src/shared');
  if (existsSync(shared)) {
    mkdirSync(join(vendorDir, 'shared'));
    for (const nom of readdirSync(shared)) {
      if (nom.endsWith('.ts') && !nom.endsWith('.test.ts')) {
        copyFileSync(join(shared, nom), join(vendorDir, 'shared', nom));
      }
    }
  }

  const { version } = JSON.parse(readFileSync(join(root, 'packages/facturx/package.json'), 'utf8'));
  writeFileSync(
    join(vendorDir, 'sdk-version.ts'),
    `${EN_TETE}export const SDK_VERSION = '${version}';\n`,
  );

  const icc = readFileSync(join(root, 'packages/facturx/test/fixtures/sRGB.icc'));
  writeFileSync(
    join(vendorDir, 'srgb.ts'),
    `${EN_TETE}export const SRGB_ICC_BASE64 = '${icc.toString('base64')}';\n`,
  );
}

// Exécuté directement : on prépare. Importé (par son test) : on n'expose que la fonction.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparer()
    .then(() => console.log('supabase/functions/_vendor/ prêt.'))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
