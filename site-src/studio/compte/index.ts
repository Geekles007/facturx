/**
 * Le compte, côté navigateur : restaurer la session au démarrage, créer un compte, se connecter,
 * réinitialiser le mot de passe, changer d'adresse ou de mot de passe, se déconnecter.
 *
 * Ce module et `client.ts` sont les seuls à tirer `supabase-js` : on n'y arrive que par `import()`
 * (main.tsx quand une session est probable, le dialogue de connexion sinon). Les erreurs de
 * l'authentification sont traduites en phrases de l'interface ; `connecter`, `inscrire` (quand la
 * session s'ouvre sans confirmation) et `deconnecter` rechargent la page, qui repart d'une
 * session propre — sauf la reconnexion au même compte après une session expirée, qui garde la
 * saisie en cours là où elle est.
 */

import {
  type AuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';
import { type Strings, t } from '../i18n.js';
import { estDuCompte } from '../persistence.js';
import { indexedDbPersistence as local, storage, utiliser } from '../storage.js';
import {
  arreterLaConservation,
  type CompteUi,
  ecrituresNonPassees,
  enregistrerMaintenant,
  store,
  toast,
  ui,
} from '../store.js';
import { client } from './client.js';
import { clesDuNavigateur, type Miroir, supabasePersistence } from './persistence.js';
import { effacerRetourDeLien, oublierSession, retourDeLien } from './session.js';

/** Version des CGU que l'utilisateur accepte en s'inscrivant ; le serveur refuse l'inscription sans elle. */
export const CGU_VERSION = '2026-11' as const;

/** Au-delà, le démarrage renonce au compte plutôt que de retenir l'affichage du Studio. */
const DELAI_DEMARRAGE_MS = 10_000;

/** Le message d'un lien qui n'ouvre rien reste affiché assez longtemps pour être lu en entier. */
const DUREE_MESSAGE_LIEN_MS = 15_000;

/** Au-delà, la déconnexion n'attend plus les écritures : ce qui n'est pas parti est dit. */
const ATTENTE_ENVOIS_MS = 10_000;

/** Le message d'une saisie mise de côté reste le temps de lire, et de choisir de la rouvrir. */
const DUREE_MISE_DE_COTE_MS = 30_000;

/** Ce que `membres` donne de l'entreprise du compte, avec la date de suppression demandée. */
interface LigneMembre {
  entreprise_id: string;
  entreprises: { suppression_demandee_le: string | null } | null;
}

/** Ce que le démarrage a appris en route : la session existe-t-elle, a-t-il renoncé à attendre ? */
interface Etat {
  session: boolean;
  expire: boolean;
}

async function lire(etat: Etat): Promise<CompteUi | undefined> {
  const sb = client();
  // Un lien de réinitialisation ramène ici avec un code, que `supabase-js` échange contre la session
  // en annonçant `PASSWORD_RECOVERY` : le formulaire du nouveau mot de passe s'ouvre alors. L'écoute
  // est posée avant l'échange, que `getSession` attend.
  sb.auth.onAuthStateChange((evenement) => {
    if (evenement === 'PASSWORD_RECOVERY') ui({ recuperation: true });
  });
  // Restaure la session (et la renouvelle si son jeton est périmé). Au retour d'un lien reçu par
  // e-mail, `supabase-js` échange d'abord le code de l'adresse contre la session, s'il le peut.
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return undefined;
  etat.session = true;
  const { data: membre, error } = await sb
    .from('membres')
    .select('entreprise_id, entreprises(suppression_demandee_le)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<LigneMembre>();
  if (error || !membre) return undefined;
  return {
    email: user.email ?? '',
    confirme: Boolean(user.email_confirmed_at),
    entrepriseId: membre.entreprise_id,
    suppressionDemandeeLe: membre.entreprises?.suppression_demandee_le ?? undefined,
    session: 'active',
  };
}

/**
 * Après un retour de lien : retire le code, l'erreur ou le message de l'adresse, qu'un rechargement
 * ne doit pas rejouer, et dit pourquoi aucune session ne s'est ouverte, le cas échéant. Un lien
 * ouvert dans un autre navigateur que celui de la demande n'a pas de vérificateur à échanger :
 * l'adresse n'en est pas moins confirmée côté serveur, d'où l'invitation à se connecter. Le premier
 * des deux liens d'un changement d'adresse ne fait que le dire : il reste à ouvrir l'autre.
 */
function expliquerRetour(retour: 'code' | 'erreur' | 'message', etat: Etat): void {
  effacerRetourDeLien();
  const phrases = t.compte.link;
  // Le premier des deux liens d'un changement d'adresse, ouvert ici ou ailleurs : il reste l'autre.
  if (retour === 'message') {
    toast(phrases.autreAdresse, 'info', DUREE_MESSAGE_LIEN_MS);
    return;
  }
  if (etat.session || etat.expire) return;
  if (retour === 'erreur') toast(phrases.expired, 'error', DUREE_MESSAGE_LIEN_MS);
  else toast(phrases.noSession, 'info', DUREE_MESSAGE_LIEN_MS);
}

/**
 * Restaure la session, relève l'entreprise du compte, met la conservation du serveur derrière
 * `storage` et renseigne `ui.compte`. Sans session, ou si le serveur ne répond pas, ne renvoie
 * rien : le Studio démarre alors en mode local. Ne lève jamais.
 */
export async function demarrer(): Promise<CompteUi | undefined> {
  // Lu avant que `supabase-js` ne touche à l'adresse.
  const retour = retourDeLien();
  const etat: Etat = { session: false, expire: false };
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<undefined>((resolve) => {
    minuterie = setTimeout(() => {
      etat.expire = true;
      resolve(undefined);
    }, DELAI_DEMARRAGE_MS);
  });
  try {
    const compte = await Promise.race([lire(etat), delai]);
    if (compte) {
      // Entreprise, brouillons, clients, catalogue, fichiers : tout va désormais au serveur.
      utiliser(
        supabasePersistence(client(), compte.entrepriseId, {
          surSaisieMiseDeCote: direSaisieMiseDeCote,
        }),
      );
      ui({ compte });
    }
    return compte;
  } catch {
    return undefined;
  } finally {
    clearTimeout(minuterie);
    if (retour) expliquerRetour(retour, etat);
  }
}

/**
 * Une saisie que le serveur n'avait pas reçue a été mise de côté (le miroir du brouillon était
 * illisible au démarrage), ou l'était déjà : le Studio le dit, et propose de la rouvrir
 * comme un nouveau brouillon (`compte/brouillons.tsx`, chargé à ce moment-là).
 */
export function direSaisieMiseDeCote(): void {
  const phrases = t.compte.conservation;
  toast(phrases.miseDeCote, 'info', DUREE_MISE_DE_COTE_MS, {
    label: phrases.rouvrirMiseDeCote,
    run: () => import('./brouillons.js').then((m) => m.reprendreLaSaisieMiseDeCote()),
  });
}

// ---------- authentification ----------

const ERREURS: Record<string, keyof Strings['compte']['errors']> = {
  invalid_credentials: 'credentials',
  email_not_confirmed: 'notConfirmed',
  user_already_exists: 'exists',
  email_exists: 'exists',
  weak_password: 'weak',
  same_password: 'samePassword',
  email_address_invalid: 'invalidEmail',
  over_request_rate_limit: 'rateLimit',
  over_email_send_rate_limit: 'rateLimit',
  signup_disabled: 'signupClosed',
  session_not_found: 'session',
  session_expired: 'session',
  // `secure_password_change` : GoTrue demande une session de moins de 24 heures, ou un code.
  reauthentication_needed: 'reauth',
};

/** Une phrase de l'interface pour l'erreur de l'authentification (jamais le texte anglais du serveur). */
function erreur(cause: AuthError): Error {
  const phrases = t.compte.errors;
  if (isAuthRetryableFetchError(cause)) return new Error(phrases.network);
  if (isAuthSessionMissingError(cause)) return new Error(phrases.session);
  const cle = cause.code ? ERREURS[cause.code] : undefined;
  return new Error(phrases[cle ?? 'other']);
}

/** Où ramènent les liens de l'e-mail (confirmation, réinitialisation) : le Studio, dans sa langue. */
function adresseDeRetour(): string {
  return `${location.origin}${t.lang === 'en' ? '/en/studio/' : '/studio/'}`;
}

/**
 * Crée le compte. Le serveur refuse l'inscription sans `cgu` dans les métadonnées. Renvoie
 * `confirmation` quand un e-mail est parti (le cas normal, y compris pour une adresse déjà connue,
 * afin de ne pas révéler qui a un compte) ; si la session s'ouvre sans confirmation, recharge.
 */
export async function inscrire(
  email: string,
  motDePasse: string,
  cguVersion: typeof CGU_VERSION,
): Promise<'confirmation' | 'connecte'> {
  const { data, error } = await client().auth.signUp({
    email,
    password: motDePasse,
    options: { data: { cgu: cguVersion }, emailRedirectTo: adresseDeRetour() },
  });
  if (error) throw erreur(error);
  if (!data.session) return 'confirmation';
  location.reload();
  return 'connecte';
}

/** Vrai si l'utilisateur est membre de cette entreprise. */
async function membreDe(userId: string, entrepriseId: string): Promise<boolean> {
  const { data, error } = await client()
    .from('membres')
    .select('entreprise_id')
    .eq('user_id', userId)
    .eq('entreprise_id', entrepriseId)
    .maybeSingle();
  return !error && data !== null;
}

/**
 * Ouvre la session, puis recharge la page. Après une session expirée, la reconnexion au même compte
 * ne recharge rien : la session redevient active, et `store.ts` envoie ce que le serveur avait
 * refusé, saisie comprise. Un autre compte recharge, et repart avec ses propres données.
 */
export async function connecter(email: string, motDePasse: string): Promise<void> {
  const { data, error } = await client().auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw erreur(error);
  const compte = store.get().ui.compte;
  const userId = data.user?.id;
  if (compte?.session === 'expiree' && userId && (await membreDe(userId, compte.entrepriseId))) {
    ui({ compte: { ...compte, session: 'active' }, connexion: undefined });
    return;
  }
  location.reload();
}

/**
 * Renvoie l'e-mail de confirmation de l'adresse du compte (spec § 13, `NON_CONFIRME`), avec le même
 * lien de retour que l'inscription.
 */
export async function renvoyerConfirmation(email: string): Promise<void> {
  const { error } = await client().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: adresseDeRetour() },
  });
  if (error) throw erreur(error);
}

/** Envoie le lien de réinitialisation ; la réponse est la même que l'adresse ait un compte ou non. */
export async function reinitialiser(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email, {
    redirectTo: adresseDeRetour(),
  });
  if (error) throw erreur(error);
}

// ---------- adresse et mot de passe ----------

/**
 * Demande le changement d'adresse du compte. Rien ne change tant qu'il n'est pas confirmé : Supabase
 * envoie un lien à la nouvelle adresse et à l'actuelle (`double_confirm_changes`), qui ramènent au
 * Studio ; l'adresse affichée reste celle d'aujourd'hui. Lève avec une phrase de l'interface.
 */
export async function changerAdresse(email: string): Promise<void> {
  const nouvelle = email.trim();
  const actuelle = store.get().ui.compte?.email ?? '';
  if (!nouvelle) throw new Error(t.compte.motDePasse.adresseManquante);
  if (nouvelle.toLowerCase() === actuelle.toLowerCase()) {
    throw new Error(t.compte.motDePasse.memeAdresse);
  }
  const { error } = await client().auth.updateUser(
    { email: nouvelle },
    { emailRedirectTo: adresseDeRetour() },
  );
  if (error) throw erreur(error);
}

/** Change le mot de passe du compte connecté. Lève avec une phrase de l'interface. */
export async function changerMotDePasse(motDePasse: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password: motDePasse });
  if (error) throw erreur(error);
}

// ---------- déconnexion ----------

/** Ce qu'une clé d'écriture du magasin désigne, pour le dire à l'utilisateur. */
function elementDe(cle: string): string {
  const elements = t.compte.deconnexion.elements;
  if (cle === 'draft' || cle === 'company' || cle === 'numbering') return elements[cle];
  if (cle === 'appearance-default') return elements.apparence;
  const prefixe = cle.split(':')[0];
  if (prefixe === 'clients' || prefixe === 'products' || prefixe === 'files') {
    return elements[prefixe];
  }
  return elements.autre;
}

/**
 * Envoie ce qui attendait, au plus `ATTENTE_ENVOIS_MS`, puis dit ce qui n'a pas atteint le serveur :
 * les écritures du magasin restées en échec, et la saisie du brouillon que le miroir de ce
 * navigateur garde sans que le serveur l'ait reçue (y compris quand la conservation ne tourne pas :
 * serveur injoignable au démarrage, écran d'un compte en suppression), et les saisies mises de côté
 * (`verifierMiroir`). Un miroir illisible n'est pas compté : IndexedDB ne répond pas, et rien n'y sera
 * effacé non plus.
 */
async function ceQuiNEstPasParti(entrepriseId: string): Promise<string[]> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const fini = await Promise.race([
    enregistrerMaintenant().then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      minuterie = setTimeout(() => resolve(false), ATTENTE_ENVOIS_MS);
    }),
  ]);
  clearTimeout(minuterie);
  const cles = ecrituresNonPassees();
  const ici = clesDuNavigateur(entrepriseId);
  const [miroir, abri] = await Promise.all([
    local.get<Miroir>(ici.miroir).catch(() => undefined),
    local.get<unknown>(ici.abri).catch(() => undefined),
  ]);
  if (miroir && !miroir.envoye) cles.unshift('draft');
  const elements = [...new Set(cles.map(elementDe))];
  if (Array.isArray(abri) && abri.length > 0) {
    elements.push(t.compte.deconnexion.elements.miseDeCote);
  }
  if (!fini) elements.push(t.compte.deconnexion.elements.enCours);
  return elements;
}

/**
 * Efface de ce navigateur ce que le compte y gardait (relevé aux tâches 15 et 16) : le miroir du
 * brouillon, son identifiant, la vue affichée, les valeurs locales (`kv-compte-*`) et les saisies
 * mises de côté. Les données du
 * Studio sans compte, celles d'un autre compte, et la marque d'import (`import-local-*`, Ruling 61)
 * restent : la marque décrit les données de ce navigateur — elles y restent tant que l'utilisateur
 * ne demande pas à les effacer (spec § 10) — et l'effacer ferait reproposer l'import, oublierait un
 * refus, et reprendrait une seconde fois le même brouillon local. Ne lève pas.
 */
async function oublierCeNavigateur(entrepriseId: string): Promise<void> {
  const cles = Object.values(clesDuNavigateur(entrepriseId));
  await Promise.all(cles.map((cle) => local.remove('kv', cle).catch(() => undefined)));
}

/**
 * Se déconnecter, sur un poste qui peut être partagé : une fois parties les écritures en attente,
 * la conservation s'arrête et les données du compte quittent ce navigateur. Ce qui n'a pas atteint
 * le serveur est d'abord dit : sans l'accord de l'utilisateur, rien n'est effacé et la session reste
 * ouverte. Puis la session de ce navigateur seulement se termine (les autres appareils restent
 * connectés), et la page se recharge, quoi que réponde le serveur. `supabase-js` retire la session
 * locale avant de rendre l'erreur d'un serveur injoignable : sortir à moitié (menu du compte
 * affiché, session perdue) serait pire que de ne pas avoir révoqué le jeton côté serveur, qui
 * expire seul. Rien ne lève.
 */
export async function deconnecter(): Promise<void> {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (entrepriseId) {
    toast(t.compte.deconnexion.enCours, 'info', ATTENTE_ENVOIS_MS);
    const restes = await ceQuiNEstPasParti(entrepriseId);
    if (store.get().ui.toast?.text === t.compte.deconnexion.enCours) ui({ toast: undefined });
    if (restes.length > 0 && !confirm(t.compte.deconnexion.nonEnvoye(restes))) return;
    arreterLaConservation();
    if (estDuCompte(storage)) {
      // Une écriture du brouillon encore en file réécrirait le miroir après l'effacement.
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        storage.envoisTermines().catch(() => undefined),
        new Promise((fin) => {
          minuterie = setTimeout(fin, ATTENTE_ENVOIS_MS);
        }),
      ]);
      clearTimeout(minuterie);
    }
    await oublierCeNavigateur(entrepriseId);
  }
  try {
    await client().auth.signOut({ scope: 'local' });
  } catch {
    // Verrou ou stockage indisponible : le nettoyage ci-dessous suffit.
  } finally {
    oublierSession();
    location.reload();
  }
}
