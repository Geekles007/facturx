/**
 * Le compte, côté navigateur : restaurer la session au démarrage, créer un compte, se connecter,
 * réinitialiser le mot de passe, se déconnecter ; et, à la première connexion, proposer d'importer
 * ce que le Studio a gardé dans ce navigateur sans compte (spec § 10).
 *
 * Ce module et `client.ts` sont les seuls à tirer `supabase-js` : on n'y arrive que par `import()`
 * (main.tsx quand une session est probable, le dialogue de connexion sinon). Les erreurs de
 * l'authentification sont traduites en phrases de l'interface ; `connecter`, `inscrire` (quand la
 * session s'ouvre sans confirmation) et `deconnecter` rechargent la page, qui repart d'une
 * session propre — sauf la reconnexion au même compte après une session expirée, qui garde la
 * saisie en cours là où elle est.
 */

import { type AuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { type Strings, t } from '../i18n.js';
import type { CompanyProfile } from '../library.js';
import { indexedDbPersistence as local, utiliser } from '../storage.js';
import { type CompteUi, type Loaded, store, toast, ui } from '../store.js';
import { client } from './client.js';
import { supabasePersistence } from './persistence.js';
import { effacerRetourDeLien, oublierSession, retourDeLien } from './session.js';

/** Version des CGU que l'utilisateur accepte en s'inscrivant ; le serveur refuse l'inscription sans elle. */
export const CGU_VERSION = '2026-11' as const;

/** Au-delà, le démarrage renonce au compte plutôt que de retenir l'affichage du Studio. */
const DELAI_DEMARRAGE_MS = 10_000;

/** Le message d'un lien qui n'ouvre rien reste affiché assez longtemps pour être lu en entier. */
const DUREE_MESSAGE_LIEN_MS = 15_000;

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
 * Après un retour de lien : retire le code ou l'erreur de l'adresse, qu'un rechargement ne doit pas
 * rejouer, et dit pourquoi aucune session ne s'est ouverte, le cas échéant. Un lien ouvert dans un
 * autre navigateur que celui de la demande n'a pas de vérificateur à échanger : l'adresse n'en
 * est pas moins confirmée côté serveur, d'où l'invitation à se connecter.
 */
function expliquerRetour(retour: 'code' | 'erreur', etat: Etat): void {
  effacerRetourDeLien();
  if (etat.session || etat.expire) return;
  const phrases = t.compte.link;
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
      utiliser(supabasePersistence(client(), compte.entrepriseId));
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

// ---------- authentification ----------

const ERREURS: Record<string, keyof Strings['compte']['errors']> = {
  invalid_credentials: 'credentials',
  email_not_confirmed: 'notConfirmed',
  user_already_exists: 'exists',
  email_exists: 'exists',
  weak_password: 'weak',
  email_address_invalid: 'invalidEmail',
  over_request_rate_limit: 'rateLimit',
  over_email_send_rate_limit: 'rateLimit',
  signup_disabled: 'signupClosed',
};

/** Une phrase de l'interface pour l'erreur de l'authentification (jamais le texte anglais du serveur). */
function erreur(cause: AuthError): Error {
  const phrases = t.compte.errors;
  if (isAuthRetryableFetchError(cause)) return new Error(phrases.network);
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

/**
 * Termine la session de ce navigateur seulement (les autres appareils restent connectés), puis
 * recharge, quoi que réponde le serveur. `supabase-js` retire la session locale avant de rendre
 * l'erreur d'un serveur injoignable : sortir à moitié (menu du compte affiché, session perdue)
 * serait pire que de ne pas avoir révoqué le jeton côté serveur, qui expire seul. Rien ne lève.
 */
export async function deconnecter(): Promise<void> {
  try {
    await client().auth.signOut({ scope: 'local' });
  } catch {
    // Verrou ou stockage indisponible : le nettoyage ci-dessous suffit.
  } finally {
    oublierSession();
    location.reload();
  }
}

// ---------- import des données locales : la proposition ----------

/** Ce que ce navigateur garde du Studio utilisé sans compte, compté pour la proposition d'import. */
export interface Inventaire {
  entreprise: boolean;
  clients: number;
  produits: number;
  factures: number;
  brouillon: boolean;
  /** Un import précédent de ce navigateur dans ce compte n'est pas allé au bout. */
  reprise: boolean;
}

/**
 * Ce que ce navigateur retient de la proposition, pour un compte : refusée (elle ne revient qu'à la
 * demande, depuis « Mon compte »), faite, ou inachevée (elle revient, comme une reprise). Et
 * l'empreinte du brouillon local déjà devenu un brouillon du compte : il ne le redevient pas.
 */
export interface MarqueImport {
  etat: 'refuse' | 'partiel' | 'fait';
  le: string;
  brouillon?: string;
}

/** La marque vit dans IndexedDB, à côté des données locales, une par compte (entreprise). */
const cleMarque = (entrepriseId: string): string => `import-local-${entrepriseId}`;

/** Une entreprise saisie, et non celle par défaut, vide : seule une telle entreprise s'importe. */
export function entrepriseRenseignee(profil: unknown): profil is CompanyProfile {
  const nom = (profil as { seller?: { name?: unknown } } | undefined)?.seller?.name;
  return typeof nom === 'string' && nom.trim() !== '';
}

/** Une saisie en cours : ni l'exemple, ni une facture émise affichée (des vues). */
export function brouillonSaisi(valeur: unknown): valeur is NonNullable<Loaded['draft']> {
  const b = valeur as Loaded['draft'] | null;
  return (
    typeof b === 'object' &&
    b !== null &&
    typeof b.form === 'object' &&
    b.form !== null &&
    b.sample !== true &&
    b.issued === undefined
  );
}

/** Vrai s'il y a quelque chose à importer. */
export const aDesDonnees = (i: Inventaire): boolean =>
  i.entreprise || i.clients > 0 || i.produits > 0 || i.factures > 0 || i.brouillon;

/** La marque de ce navigateur pour le compte connecté. */
export async function lireMarqueImport(): Promise<MarqueImport | undefined> {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (!entrepriseId) return undefined;
  return local.get<MarqueImport>(cleMarque(entrepriseId));
}

/**
 * Retient l'issue de la proposition pour le compte connecté, dans ce navigateur. L'empreinte d'un
 * brouillon déjà repris est gardée d'une marque à l'autre. Ne lève pas : au pire, la proposition
 * reviendra.
 */
export async function retenirImport(etat: MarqueImport['etat'], brouillon?: string): Promise<void> {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (!entrepriseId) return;
  const avant = await lireMarqueImport().catch(() => undefined);
  const marque: MarqueImport = { etat, le: new Date().toISOString() };
  const empreinte = brouillon ?? avant?.brouillon;
  if (empreinte) marque.brouillon = empreinte;
  await local.set(cleMarque(entrepriseId), marque).catch(() => undefined);
}

/**
 * Ce que ce navigateur garde du Studio sans compte, lu dans IndexedDB (jamais le serveur), sans les
 * PDF : de quoi le dire avant d'importer. Rien si IndexedDB ne répond pas.
 */
export async function inventaireLocal(): Promise<Inventaire | undefined> {
  try {
    const [entreprise, brouillon, factures, clients, produits, marque] = await Promise.all([
      local.get('company'),
      local.get('draft'),
      local.list('invoices'),
      local.list('clients'),
      local.list('products'),
      lireMarqueImport(),
    ]);
    return {
      entreprise: entrepriseRenseignee(entreprise),
      clients: clients.length,
      produits: produits.length,
      factures: factures.length,
      brouillon: brouillonSaisi(brouillon),
      reprise: marque?.etat === 'partiel',
    };
  } catch {
    return undefined;
  }
}

/**
 * À la première connexion (spec § 10) : ce que ce navigateur garde, s'il faut proposer de
 * l'importer. Rien — et rien n'est proposé — si ce navigateur n'a pas de données du Studio sans
 * compte, si la proposition a déjà été refusée ou faite pour ce compte, si la session n'est pas
 * active, si le serveur n'a pas répondu au démarrage, ou si la suppression du compte est demandée.
 * La proposition n'est jamais imposée : elle s'ouvre, et l'utilisateur choisit.
 */
export async function importAProposer(): Promise<Inventaire | undefined> {
  const { compte, storage: etat } = store.get().ui;
  if (compte?.session !== 'active' || compte.suppressionDemandeeLe || etat !== 'ok') {
    return undefined;
  }
  const marque = await lireMarqueImport().catch(() => undefined);
  if (marque && marque.etat !== 'partiel') return undefined;
  const inventaire = await inventaireLocal();
  return inventaire && aDesDonnees(inventaire) ? inventaire : undefined;
}
