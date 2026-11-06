/**
 * Lance les tests du compte contre la pile Supabase locale (`pnpm compte:start`) :
 *
 *   pnpm compte:test
 *
 *   1. pgTAP : `supabase test db` (supabase/tests/) ;
 *   2. Edge Functions : les polices du Studio (`pnpm site:build` les construit) sont déposées dans le
 *      bucket `polices` de la pile, comme `pnpm compte:polices` le fait, car les fonctions produisent
 *      les PDF avec elles et `supabase db reset` vide le bucket ; puis `supabase functions serve` en
 *      arrière-plan, avec les variables de supabase/functions/.env (ou de .env.example, sa copie
 *      versionnée, quand il n'existe pas : en CI), et `deno test -A` sur supabase/functions/tests/
 *      (avec l'import map de supabase/functions/deno.json), l'adresse de la pile et ses clés dans
 *      l'environnement.
 *
 * Le code de sortie est celui de `deno test`. Un dossier de tests absent ou vide est sauté, et sans
 * aucun test le script sort proprement sans toucher à la pile.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deposerPolices } from './compte-polices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pgtapDir = join(root, 'supabase/tests');
const denoDir = join(root, 'supabase/functions/tests');
/** Les variables des fonctions : le fichier local s'il existe, sinon sa copie versionnée. */
const envFonctions = ['.env', '.env.example']
  .map((nom) => join(root, 'supabase/functions', nom))
  .find((chemin) => existsSync(chemin));

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

/**
 * Ce que le CLI Supabase imprime quand le serveur de fonctions écoute : « Serving functions on
 * http://127.0.0.1:…/functions/v1/<function-name> » (conteneur edge-runtime) ou « Serving Functions
 * at … » (pile expérimentale). On attend cette ligne plutôt qu'une réponse HTTP : la passerelle
 * répond sur /functions/v1/ dès `supabase start`, avant que `functions serve` n'ait remplacé le
 * conteneur edge-runtime.
 */
const SERVEUR_PRET = /Serving functions (?:on|at)\b/i;

/** Lance `supabase functions serve`, relaie sa sortie, et résout quand il annonce qu'il sert. */
function demarrerServeur() {
  const options = envFonctions ? ['--env-file', envFonctions] : [];
  const serveur = spawn('supabase', ['functions', 'serve', ...options], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pret = new Promise((resolve, reject) => {
    const fins = { stdout: '', stderr: '' };
    for (const nom of ['stdout', 'stderr']) {
      serveur[nom].on('data', (morceau) => {
        process[nom].write(morceau);
        fins[nom] = (fins[nom] + morceau.toString('utf8')).slice(-1024);
        if (SERVEUR_PRET.test(fins[nom])) resolve();
      });
    }
    serveur.once('error', reject);
    serveur.once('close', (code, signal) =>
      reject(
        new Error(
          `supabase functions serve s'est arrêté avant de servir les fonctions (${signal ?? `code ${code}`}).`,
        ),
      ),
    );
  });
  // Un rejet tardif (arrêt voulu, après la résolution) ne doit pas remonter comme non géré.
  pret.catch(() => {});
  return { serveur, pret };
}

/** Attend l'annonce du serveur, au plus `delaiMs` ; sinon lève une erreur qui dit quoi vérifier. */
async function attendre(pret, delaiMs = 120_000) {
  let minuteur;
  const expire = new Promise((_, reject) => {
    minuteur = setTimeout(
      () =>
        reject(
          new Error(
            `supabase functions serve n'a pas annoncé « Serving functions » après ${delaiMs / 1000} s : voir sa sortie ci-dessus (Docker, supabase/functions/).`,
          ),
        ),
      delaiMs,
    );
  });
  try {
    await Promise.race([pret, expire]);
  } finally {
    clearTimeout(minuteur);
  }
}

/** Arrête le serveur de fonctions et attend sa sortie (le CLI retire son conteneur en partant). */
async function arreter(serveur) {
  if (serveur.exitCode !== null || serveur.signalCode !== null) return;
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

  // Le script de `pnpm compte:polices`, avec l'adresse et la clé de la pile : mêmes polices, même bucket.
  const polices = await deposerPolices({ url: stack.API_URL, cle: stack.SERVICE_ROLE_KEY });
  console.log(`compte:test — polices TTF déposées dans le bucket « polices » : ${polices}.`);

  const { serveur, pret } = demarrerServeur();
  try {
    await attendre(pret);
    // `--config` : sans lui, `deno test` lancé depuis la racine ne trouve pas l'import map.
    const deno = spawn(
      'deno',
      ['test', '-A', '--config', 'supabase/functions/deno.json', 'supabase/functions/tests'],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          SUPABASE_URL: stack.API_URL,
          SUPABASE_ANON_KEY: stack.ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
          SUPABASE_DB_URL: stack.DB_URL,
        },
      },
    );
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
