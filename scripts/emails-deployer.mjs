/**
 * Envoie à la production les objets et les modèles des e-mails du compte :
 *
 *   pnpm emails:construire && pnpm emails:deployer
 *
 * Les cinq modèles de Supabase Auth (supabase/templates/<modèle>.html) et leurs objets
 * (supabase/templates/objets.json) vont au projet hébergé par l'API de gestion :
 *
 *   PATCH https://api.supabase.com/v1/projects/<ref>/config/auth
 *
 * avec pour seul corps les dix clés `mailer_subjects_<modèle>` et `mailer_templates_<modèle>_content`.
 * Jamais `supabase config push` : il écrit tout config.toml dans le projet, soit les réglages de la
 * pile locale (adresses en localhost, Mailpit, confirmation d'e-mail coupée) par-dessus la production.
 * Le script relit ensuite la configuration (GET de la même adresse) et vérifie que les dix valeurs y
 * sont, telles qu'envoyées.
 *
 * Il lit le jeton personnel dans `SUPABASE_ACCESS_TOKEN` et l'identifiant du projet dans
 * `SUPABASE_PROJECT_REF`. Il n'affiche jamais le jeton, ni rien d'une réponse : le GET rend la
 * configuration d'authentification entière, mot de passe SMTP et secrets OAuth compris, et le journal
 * du workflow est public comme le dépôt. Il ne dit que les codes HTTP et, si la relecture diffère,
 * les noms (jamais les valeurs) des clés en cause.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossierParDefaut = join(root, 'supabase/templates');
const API = 'https://api.supabase.com/v1/projects';

/** Lit un fichier du dossier des modèles ; s'il manque, dit lequel et comment le construire. */
function lire(dossier, nom) {
  try {
    return readFileSync(join(dossier, nom), 'utf8');
  } catch (erreur) {
    if (erreur.code === 'ENOENT') {
      throw new Error(`${nom} manque dans ${dossier} : lancer \`pnpm emails:construire\`.`);
    }
    throw erreur;
  }
}

/**
 * Le corps du PATCH : `mailer_subjects_<modèle>` (l'objet, d'objets.json) et
 * `mailer_templates_<modèle>_content` (le fichier <modèle>.html) pour chaque modèle d'objets.json.
 * Lève si un fichier manque, ou si un objet ou un modèle est vide : la production n'en recevrait
 * qu'un e-mail blanc.
 */
export function corpsDesModeles(dossier = dossierParDefaut) {
  const objets = JSON.parse(lire(dossier, 'objets.json'));
  const corps = {};
  for (const [modele, objet] of Object.entries(objets)) {
    const html = lire(dossier, `${modele}.html`);
    if (typeof objet !== 'string' || objet.trim() === '') {
      throw new Error(`objets.json : l'objet du modèle « ${modele} » est vide.`);
    }
    if (html.trim() === '') throw new Error(`${modele}.html est vide.`);
    corps[`mailer_subjects_${modele}`] = objet;
    corps[`mailer_templates_${modele}_content`] = html;
  }
  return corps;
}

/** Les clés d'`envoye` dont la valeur, dans la configuration `lu`, diffère ou manque, triées. */
export function clesQuiDifferent(envoye, lu) {
  return Object.keys(envoye)
    .filter((cle) => lu?.[cle] !== envoye[cle])
    .sort();
}

/**
 * Un appel à `config/auth`, dont le code HTTP est consigné. Le corps de la réponse n'est jamais lu
 * ici (l'appelant ne lit que le GET, pour le comparer) et aucune erreur ne le cite : ni celle d'un
 * code hors 2xx, ni celle du réseau (sans sa cause, qui pourrait porter l'en-tête).
 */
async function appeler({ fetch, journal, ref, jeton, methode, corps }) {
  const options = { method: methode, headers: { Authorization: `Bearer ${jeton}` } };
  if (corps) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(corps);
  }
  let reponse;
  try {
    reponse = await fetch(`${API}/${encodeURIComponent(ref)}/config/auth`, options);
  } catch {
    throw new Error(`${methode} config/auth : la requête n'a pas abouti.`);
  }
  journal(`${methode} config/auth : ${reponse.status}`);
  if (!reponse.ok) {
    await reponse.body?.cancel();
    throw new Error(`${methode} config/auth refusé : code ${reponse.status}.`);
  }
  return reponse;
}

/**
 * Envoie les modèles de `dossier` au projet `ref` avec le jeton `jeton`, puis les relit. `fetch` est
 * celui de Node (les tests en injectent un) ; `journal` reçoit les seules lignes qu'on peut montrer :
 * `PATCH config/auth : <code>`, `GET config/auth : <code>`, `modèles identiques`.
 *
 * Lève sur un code hors 2xx, ou si la relecture diffère sur certaines clés (les noms seuls).
 */
export async function deployer({ ref, jeton, dossier = dossierParDefaut, fetch, journal }) {
  const envoye = corpsDesModeles(dossier);

  const envoi = await appeler({ fetch, journal, ref, jeton, methode: 'PATCH', corps: envoye });
  await envoi.body?.cancel();

  const relecture = await appeler({ fetch, journal, ref, jeton, methode: 'GET' });
  let lu;
  try {
    lu = await relecture.json();
  } catch {
    // Le message de JSON.parse cite un bout du texte lu : on ne le garde pas.
    throw new Error('GET config/auth : la réponse n’est pas du JSON.');
  }

  const differentes = clesQuiDifferent(envoye, lu);
  if (differentes.length > 0) {
    throw new Error(`modèles différents après l'envoi : ${differentes.join(', ')}.`);
  }
  journal('modèles identiques');
}

// Exécuté directement : on déploie. Importé (par son test) : on n'expose que les fonctions.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const absentes = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'].filter(
    (nom) => !process.env[nom],
  );
  if (absentes.length > 0) {
    console.error(`${absentes.join(' et ')} : à définir pour déployer les modèles d'e-mails.`);
    process.exit(1);
  }
  deployer({
    ref: process.env.SUPABASE_PROJECT_REF,
    jeton: process.env.SUPABASE_ACCESS_TOKEN,
    fetch: globalThis.fetch,
    journal: console.log,
  }).catch((erreur) => {
    console.error(erreur.message);
    process.exit(1);
  });
}
