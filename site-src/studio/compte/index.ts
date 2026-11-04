/**
 * Le compte, côté navigateur : restaurer la session au démarrage, créer un compte, se connecter,
 * réinitialiser le mot de passe, se déconnecter.
 *
 * Ce module et `client.ts` sont les seuls à tirer `supabase-js` : on n'y arrive que par `import()`
 * (main.tsx quand une session est probable, le dialogue de connexion sinon). Les erreurs de
 * l'authentification sont traduites en phrases de l'interface ; `connecter`, `inscrire` (quand la
 * session s'ouvre sans confirmation) et `deconnecter` rechargent la page, qui repart d'une
 * session propre.
 */

import { type AuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { type Strings, t } from '../i18n.js';
import { type CompteUi, ui } from '../store.js';
import { client } from './client.js';

/** Version des CGU que l'utilisateur accepte en s'inscrivant ; le serveur refuse l'inscription sans elle. */
export const CGU_VERSION = '2026-11' as const;

/** Au-delà, le démarrage renonce au compte plutôt que de retenir l'affichage du Studio. */
const DELAI_DEMARRAGE_MS = 10_000;

/** Ce que `membres` donne de l'entreprise du compte, avec la date de suppression demandée. */
interface LigneMembre {
  entreprise_id: string;
  entreprises: { suppression_demandee_le: string | null } | null;
}

async function lire(): Promise<CompteUi | undefined> {
  const sb = client();
  // Restaure la session (et la renouvelle si son jeton est périmé) ; lit aussi le fragment du lien
  // de confirmation, au retour de l'e-mail.
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return undefined;
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
 * Restaure la session, relève l'entreprise du compte et renseigne `ui.compte`. Sans session, ou si
 * le serveur ne répond pas, ne renvoie rien : le Studio démarre alors en mode local. Ne lève jamais.
 */
export async function demarrer(): Promise<CompteUi | undefined> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<undefined>((resolve) => {
    minuterie = setTimeout(() => resolve(undefined), DELAI_DEMARRAGE_MS);
  });
  try {
    const compte = await Promise.race([lire(), delai]);
    if (compte) ui({ compte });
    return compte;
  } catch {
    return undefined;
  } finally {
    clearTimeout(minuterie);
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
function retour(): string {
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
    options: { data: { cgu: cguVersion }, emailRedirectTo: retour() },
  });
  if (error) throw erreur(error);
  if (!data.session) return 'confirmation';
  location.reload();
  return 'connecte';
}

export async function connecter(email: string, motDePasse: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw erreur(error);
  location.reload();
}

/** Envoie le lien de réinitialisation ; la réponse est la même que l'adresse ait un compte ou non. */
export async function reinitialiser(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: retour() });
  if (error) throw erreur(error);
}

/** Termine la session de ce navigateur seulement (les autres appareils restent connectés). */
export async function deconnecter(): Promise<void> {
  const { error } = await client().auth.signOut({ scope: 'local' });
  if (error) throw erreur(error);
  location.reload();
}
