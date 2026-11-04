/**
 * Lance les tests du compte contre la pile Supabase locale (`pnpm compte:start`) :
 *
 *   pnpm compte:test
 *
 *   1. pgTAP : `supabase test db` (supabase/tests/) ;
 *   2. Edge Functions : `supabase functions serve` en arrière-plan, puis `deno test -A` sur
 *      supabase/functions/tests/, avec l'adresse de la pile et ses clés dans l'environnement.
 *
 * Le code de sortie est celui de `deno test`. Un dossier de tests absent ou vide est sauté, et sans
 * aucun test le script sort proprement sans toucher à la pile.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pgtapDir = join(root, 'supabase/tests');
const denoDir = join(root, 'supabase/functions/tests');

/** Le dossier existe-t-il, avec au moins un fichier de test (à n'importe quelle profondeur) ? */
function aDesTests(dossier, extension) {
  if (!existsSync(dossier)) return false;
  return readdirSync(dossier, { recursive: true }).some((nom) => nom.endsWith(extension));
}

/** Lit `KEY="valeur"` ligne à ligne, tel que `supabase status -o env` l'écrit. */
function lireStatus(texte) {
  const env = {};
  for (const ligne of texte.split('\n')) {
    const m = ligne.match(/^([A-Z][A-Z0-9_]*)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Attend que le serveur de fonctions réponde, quel que soit le statut, jusqu'à `delaiMs`. */
async function attendre(url, delaiMs = 90_000) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${url} ne répond pas après ${delaiMs / 1000} s.`);
}

/** Arrête le serveur de fonctions et attend sa sortie (le CLI retire son conteneur en partant). */
async function arreter(serveur) {
  if (serveur.exitCode !== null) return;
  const fini = new Promise((resolve) => serveur.once('exit', resolve));
  serveur.kill('SIGTERM');
  const tue = setTimeout(() => serveur.kill('SIGKILL'), 15_000);
  await fini;
  clearTimeout(tue);
}

async function main() {
  const pgtap = aDesTests(pgtapDir, '.sql');
  const fonctions = aDesTests(denoDir, '.ts');
  if (!pgtap && !fonctions) {
    console.log(
      'compte:test — aucun test pour l’instant (supabase/tests, supabase/functions/tests).',
    );
    return 0;
  }

  const status = spawnSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) {
    console.error(status.stderr || status.error?.message);
    console.error('La pile locale ne répond pas : lancer `pnpm compte:start`.');
    return 1;
  }
  const stack = lireStatus(status.stdout);

  if (pgtap) {
    const resultat = spawnSync('supabase', ['test', 'db'], { cwd: root, stdio: 'inherit' });
    if (resultat.status !== 0) return resultat.status ?? 1;
  }
  if (!fonctions) return 0;

  const serveur = spawn('supabase', ['functions', 'serve'], { cwd: root, stdio: 'inherit' });
  try {
    await attendre(`${stack.API_URL}/functions/v1/`);
    const deno = spawn('deno', ['test', '-A', 'supabase/functions/tests'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        SUPABASE_URL: stack.API_URL,
        SUPABASE_ANON_KEY: stack.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
        SUPABASE_DB_URL: stack.DB_URL,
      },
    });
    return await new Promise((resolve) => deno.once('exit', (code) => resolve(code ?? 1)));
  } finally {
    await arreter(serveur);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error.message);
    process.exit(1);
  },
);
