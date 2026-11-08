/**
 * Dépose les polices du Studio dans le bucket public `polices` du projet Supabase :
 *
 *   pnpm site:build && pnpm compte:polices [dossier]
 *
 * Les Edge Functions produisent les PDF avec ces polices (spec § 6, étape 9) : le bucket doit les
 * porter avant la première émission. Le script envoie tous les `*.ttf` de `site/studio/polices/`
 * (que `pnpm site:build` construit à partir des paquets npm du site, comme le Studio), sous leur nom,
 * en remplaçant ce que le bucket contient déjà : on peut le relancer à chaque déploiement.
 *
 * Il lit l'adresse du projet dans `SUPABASE_URL` et la clé de service dans
 * `SUPABASE_SERVICE_ROLE_KEY`, et n'affiche jamais cette clé. Sans l'une des deux, ou sans aucune
 * police à envoyer, il refuse. `pnpm compte:test` appelle `deposerPolices` avec la pile locale.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossierParDefaut = join(root, 'site/studio/polices');
const BUCKET = 'polices';

/** Les noms des TTF du dossier, triés ; un dossier absent ou sans TTF n'en donne aucun. */
function listerPolices(dossier) {
  try {
    return readdirSync(dossier, { withFileTypes: true })
      .filter((entree) => entree.isFile() && /\.ttf$/i.test(entree.name))
      .map((entree) => entree.name)
      .sort();
  } catch (erreur) {
    if (erreur.code === 'ENOENT' || erreur.code === 'ENOTDIR') return [];
    throw erreur;
  }
}

/**
 * Envoie les polices de `dossier` dans le bucket `polices` du projet `url`, avec la clé de service
 * `cle`, et rend leur nombre. `client` est le client Supabase (celui de `@supabase/supabase-js`, créé
 * avec `url` et `cle` quand on n'en donne pas : les tests en injectent un).
 *
 * Lève une erreur, avant tout envoi, si l'adresse ou la clé manque ou si le dossier n'a aucune police,
 * et à la première police que le bucket refuse. Les messages ne citent jamais la clé.
 */
export async function deposerPolices({ url, cle, dossier = dossierParDefaut, client } = {}) {
  const absentes = [];
  if (!url) absentes.push('SUPABASE_URL');
  if (!cle) absentes.push('SUPABASE_SERVICE_ROLE_KEY');
  if (absentes.length > 0) {
    throw new Error(`${absentes.join(' et ')} : à définir pour déposer les polices.`);
  }

  const noms = listerPolices(dossier);
  if (noms.length === 0) {
    throw new Error(
      `aucune police TTF dans ${dossier} : lancer \`pnpm site:build\`, qui les construit.`,
    );
  }

  const stockage = (
    client ??
    (await import('@supabase/supabase-js')).createClient(url, cle, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  ).storage.from(BUCKET);

  for (const nom of noms) {
    let echec;
    try {
      ({ error: echec } = await stockage.upload(nom, readFileSync(join(dossier, nom)), {
        upsert: true,
        contentType: 'font/ttf',
      }));
    } catch (erreur) {
      echec = erreur;
    }
    if (echec) {
      const motif = String(echec.message ?? echec).replaceAll(cle, '…');
      throw new Error(`${nom} refusée par le bucket ${BUCKET} : ${motif}`);
    }
  }
  return noms.length;
}

// Exécuté directement : on dépose. Importé (par son test, par compte-test.mjs) : on n'expose que la fonction.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deposerPolices({
    url: process.env.SUPABASE_URL,
    cle: process.env.SUPABASE_SERVICE_ROLE_KEY,
    dossier: process.argv[2] ? resolve(process.argv[2]) : undefined,
  }).then(
    (nombre) => console.log(`Polices TTF déposées dans le bucket « ${BUCKET} » : ${nombre}.`),
    (erreur) => {
      console.error(erreur.message);
      process.exit(1);
    },
  );
}
