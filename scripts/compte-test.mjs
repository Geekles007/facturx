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
 *      versionnée, quand il n'existe pas : en CI), une requête de mise en route par fonction servie,
 *      et `deno test -A` sur supabase/functions/tests/ (avec l'import map de
 *      supabase/functions/deno.json), l'adresse de la pile et ses clés dans l'environnement, avec
 *      `PURGE_SECRET`, tiré du même fichier que celui des fonctions : les tests de `purger` l'envoient ;
 *   3. le Studio contre les fonctions servies : les émissions réelles de
 *      site-src/studio/compte/emission-pile.test.ts et emission-gel.test.ts, le suivi des factures
 *      émises (suivi.test.ts), les relances réelles, avec le simulateur d'envoi (relances.test.ts),
 *      l'import réel des données locales (import.test.ts), et la demande de suppression du compte,
 *      puis son annulation (suppression.test.ts), avec `FACTURX_EMETTRE=1`, par Vitest,
 *      pendant que les fonctions sont servies ; un fichier après l'autre, car le plafond
 *      d'emission-gel.test.ts suppose une émission qui ne partage pas le serveur avec d'autres
 *      rendus de PDF. Ailleurs (l'étape « Tests du Studio contre la pile » de la CI), elles sont
 *      sautées : les fonctions n'y sont pas servies.
 *
 * Le code de sortie est celui de la première étape en échec. Une étape qui n'exécute aucun test (un
 * dossier absent, vide ou mal nommé, des fichiers introuvables, des tests tous sautés) fait sortir
 * en 1 : un tel passage n'éprouve rien, et ne doit pas paraître vert, en CI comme ici.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deposerPolices } from './compte-polices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pgtapDir = join(root, 'supabase/tests');
const fonctionsDir = join(root, 'supabase/functions');
const denoDir = join(fonctionsDir, 'tests');
/**
 * Les émissions, les relances, les imports et la suppression réels du Studio, qui demandent
 * `emettre`, `relancer`, `importer` et `supprimer-compte` servies.
 */
const studioEmission = [
  'site-src/studio/compte/emission-pile.test.ts',
  'site-src/studio/compte/emission-gel.test.ts',
  'site-src/studio/compte/suivi.test.ts',
  'site-src/studio/compte/relances.test.ts',
  'site-src/studio/compte/import.test.ts',
  'site-src/studio/compte/suppression.test.ts',
];
/** Les variables des fonctions : le fichier local s'il existe, sinon sa copie versionnée. */
const envFonctions = ['.env', '.env.example']
  .map((nom) => join(fonctionsDir, nom))
  .find((chemin) => existsSync(chemin));

/** Les fonctions servies : les dossiers de supabase/functions/ qui ont un index.ts, hors `_…` et tests. */
function fonctionsServies() {
  return readdirSync(fonctionsDir, { withFileTypes: true })
    .filter(
      (entree) =>
        entree.isDirectory() &&
        !entree.name.startsWith('_') &&
        entree.name !== 'tests' &&
        existsSync(join(fonctionsDir, entree.name, 'index.ts')),
    )
    .map((entree) => entree.name)
    .sort();
}

/**
 * Met chaque fonction en route avant les tests, et attend sa réponse. La première requête d'un
 * serveur neuf charge les modules de la fonction (SDK, pdf-lib, supabase-js, postgres) : sur une
 * machine chargée, ce chargement ajouté au premier rendu PDF dépassait la limite de CPU du runtime
 * local (réponse 546), et faisait tomber le premier test. Une requête sans jeton suffit : la fonction
 * répond 401 sans rien écrire. Un 5xx (worker qui démarre mal) est retenté ici, deux fois, et jamais
 * dans les tests : un nouvel essai y cacherait un vrai dépassement.
 */
async function mettreEnRoute(apiUrl) {
  for (const nom of fonctionsServies()) {
    let statut;
    for (let essai = 1; essai <= 3; essai++) {
      try {
        const reponse = await fetch(`${apiUrl}/functions/v1/${nom}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        statut = reponse.status;
        await reponse.body?.cancel();
      } catch (erreur) {
        statut = erreur.message;
      }
      if (typeof statut === 'number' && statut < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(`compte:test — mise en route de ${nom} : ${statut}.`);
  }
}

/** Le dossier existe-t-il, avec au moins un fichier de test (à n'importe quelle profondeur) ? */
function aDesTests(dossier, extension) {
  if (!existsSync(dossier)) return false;
  return readdirSync(dossier, { recursive: true }).some((nom) => nom.endsWith(extension));
}

/** Les couleurs ANSI, que les outils impriment même dans un tube quand l'environnement le demande. */
const COULEURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Le nombre de tests qu'une étape a exécutés, lu dans le bilan qu'elle imprime : `Tests=N` de
 * pg_prove (`supabase test db`), `N passed | M failed` de `deno test` (sans ses étapes ni les tests
 * filtrés), `Tests  N passed | M failed | K skipped` de Vitest (sans les sautés). Un bilan
 * introuvable compte pour zéro.
 */
export function testsExecutes(etape, sortie) {
  const texte = sortie.replace(COULEURS, '');
  const dernier = (motif) => [...texte.matchAll(motif)].at(-1);
  if (etape === 'pgtap') return Number(dernier(/\bFiles=\d+, Tests=(\d+)/g)?.[1] ?? 0);
  if (etape === 'deno') {
    const bilan = dernier(/\| (\d+) passed(?: \(\d+ steps?\))? \| (\d+) failed/g);
    return bilan ? Number(bilan[1]) + Number(bilan[2]) : 0;
  }
  const ligne = dernier(/^\s*Tests\s+(.*)$/gm)?.[1] ?? '';
  const nombre = (mot) => Number(ligne.match(new RegExp(`(\\d+) ${mot}`))?.[1] ?? 0);
  return nombre('passed') + nombre('failed');
}

/**
 * Lance une étape, relaie sa sortie, et rend son code et le nombre de tests qu'elle a exécutés
 * (`testsExecutes`). Seule la fin de la sortie est gardée : le bilan y est.
 */
function etape(nom, commande, args, options) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(commande, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let fin = '';
    for (const flux of ['stdout', 'stderr']) {
      enfant[flux].on('data', (morceau) => {
        process[flux].write(morceau);
        fin = (fin + morceau.toString('utf8')).slice(-65_536);
      });
    }
    enfant.once('error', reject);
    enfant.once('close', (code) => resolve({ code: code ?? 1, tests: testsExecutes(nom, fin) }));
  });
}

/**
 * Le code de sortie d'une étape finie : le sien s'il est en échec, 1 si elle n'a exécuté aucun test
 * (avec le message qui le dit), 0 sinon.
 */
function verdict(nom, { code, tests }) {
  if (code !== 0) return code;
  if (tests > 0) return 0;
  console.error(
    `compte:test — l'étape ${nom} n'a exécuté aucun test (dossier, fichiers ou filtre à vérifier) : échec.`,
  );
  return 1;
}

/**
 * La valeur de `nom` dans un fichier `.env` (une ligne `NOM=valeur`), ou `undefined`. Comme dotenv, que
 * le serveur de fonctions applique au même fichier, des guillemets simples ou doubles qui entourent la
 * valeur n'en font pas partie.
 */
function lireVariable(chemin, nom) {
  const ligne = readFileSync(chemin, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${nom}=`));
  return ligne
    ?.slice(nom.length + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
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
  for (const [dossier, extension] of [
    [pgtapDir, '.sql'],
    [denoDir, '.ts'],
  ]) {
    if (!aDesTests(dossier, extension)) {
      console.error(`compte:test — aucun test ${extension} dans ${dossier} : échec.`);
      return 1;
    }
  }
  const studio = studioEmission.filter((fichier) => existsSync(join(root, fichier)));
  if (studio.length !== studioEmission.length) {
    const absents = studioEmission.filter((fichier) => !studio.includes(fichier));
    console.error(`compte:test — fichiers de test du Studio introuvables : ${absents.join(', ')}.`);
    return 1;
  }

  const status = spawnSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) {
    console.error(status.stderr || status.error?.message);
    console.error('La pile locale ne répond pas : lancer `pnpm compte:start`.');
    return 1;
  }
  const stack = lireStatus(status.stdout);

  const codePgtap = verdict(
    'pgtap',
    await etape('pgtap', 'supabase', ['test', 'db'], { cwd: root }),
  );
  if (codePgtap !== 0) return codePgtap;

  // Le script de `pnpm compte:polices`, avec l'adresse et la clé de la pile : mêmes polices, même bucket.
  const polices = await deposerPolices({ url: stack.API_URL, cle: stack.SERVICE_ROLE_KEY });
  console.log(`compte:test — polices TTF déposées dans le bucket « polices » : ${polices}.`);

  const purgeSecret = envFonctions ? lireVariable(envFonctions, 'PURGE_SECRET') : undefined;
  const { serveur, pret } = demarrerServeur();
  try {
    await attendre(pret);
    await mettreEnRoute(stack.API_URL);
    // `--config` : sans lui, `deno test` lancé depuis la racine ne trouve pas l'import map.
    const deno = await etape(
      'deno',
      'deno',
      ['test', '-A', '--config', 'supabase/functions/deno.json', 'supabase/functions/tests'],
      {
        cwd: root,
        env: {
          ...process.env,
          SUPABASE_URL: stack.API_URL,
          SUPABASE_ANON_KEY: stack.ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
          SUPABASE_DB_URL: stack.DB_URL,
          // Le secret que les fonctions servies reçoivent : celui du fichier, pas de l'environnement.
          ...(purgeSecret === undefined ? {} : { PURGE_SECRET: purgeSecret }),
        },
      },
    );
    const codeDeno = verdict('deno', deno);
    if (codeDeno !== 0) return codeDeno;
    // Le Studio, contre les fonctions encore servies : les clés passent par l'environnement, jamais
    // par la ligne de commande. Un fichier à la fois : leurs rendus de PDF ne se disputent pas le
    // serveur, dont emission-gel.test.ts mesure le temps de réponse.
    const vitest = await etape(
      'vitest',
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.site.config.mts',
        '--no-file-parallelism',
        ...studio,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          SUPABASE_URL: stack.API_URL,
          SUPABASE_ANON_KEY: stack.ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
          FACTURX_EMETTRE: '1',
        },
      },
    );
    return verdict('vitest', vitest);
  } finally {
    await arreter(serveur);
  }
}

// Lancé, pas importé (les tests importent `testsExecutes`).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
