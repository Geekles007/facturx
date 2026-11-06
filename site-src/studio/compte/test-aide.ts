/**
 * Aides des tests du compte contre la pile Supabase locale : un compte neuf, le client de service,
 * un jeton que le serveur refuse.
 *
 * Les variables sont celles de `supabase status -o env`, que le job CI `compte` pose sans les
 * afficher : `SUPABASE_URL` (`API_URL`), `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Chaque
 * appel de `compteDeTest` crée son propre compte, sous une adresse unique : aucun test ne dépend
 * d'un autre, ni de l'ordre, ni de ce que la pile contient déjà.
 *
 * Seuls des tests importent ce module : il n'entre pas dans le bundle du Studio.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} : à définir (voir supabase status -o env).`);
  return valeur;
}

const sansSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Client de service de la pile : il passe outre la RLS, pour préparer et vérifier. */
export function adminDeTest(): SupabaseClient {
  return createClient(variable('SUPABASE_URL'), variable('SUPABASE_SERVICE_ROLE_KEY'), sansSession);
}

/** Où `supabase-js` range la session des clients de test : une mémoire par client. */
const CLE_SESSION = 'sb-essai-auth-token';
const memoires = new WeakMap<SupabaseClient, Map<string, string>>();

/**
 * Un compte confirmé, qui a accepté les CGU (sans quoi l'inscription est refusée), connecté par un
 * client à lui, et l'entreprise que l'inscription lui a créée. Le client ne renouvelle pas son
 * jeton de lui-même : un test ne laisse aucune minuterie derrière lui.
 */
export async function compteDeTest(): Promise<{ sb: SupabaseClient; entrepriseId: string }> {
  const email = `essai-${crypto.randomUUID()}@facturx.test`;
  const password = crypto.randomUUID();
  const cree = await adminDeTest().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { cgu: '2026-11' },
  });
  if (cree.error) throw new Error(`création du compte : ${cree.error.message}`);

  const memoire = new Map<string, string>();
  const sb = createClient(variable('SUPABASE_URL'), variable('SUPABASE_ANON_KEY'), {
    auth: {
      storageKey: CLE_SESSION,
      storage: {
        getItem: (cle) => memoire.get(cle) ?? null,
        setItem: (cle, valeur) => {
          memoire.set(cle, valeur);
        },
        removeItem: (cle) => {
          memoire.delete(cle);
        },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const connexion = await sb.auth.signInWithPassword({ email, password });
  if (connexion.error) throw new Error(`connexion : ${connexion.error.message}`);
  memoires.set(sb, memoire);

  const membre = await sb
    .from('membres')
    .select('entreprise_id')
    .eq('user_id', cree.data.user.id)
    .single<{ entreprise_id: string }>();
  if (membre.error) throw new Error(`membre : ${membre.error.message}`);
  return { sb, entrepriseId: membre.data.entreprise_id };
}

/** Une partie d'un JWT, décodée. */
const decoder = (partie: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(partie, 'base64url').toString('utf8'));
const encoder = (valeur: unknown): string =>
  Buffer.from(JSON.stringify(valeur), 'utf8').toString('base64url');

/**
 * Remplace le jeton de la session du client par un jeton expiré depuis une heure : un onglet resté
 * ouvert pendant que la session prenait fin. La session conservée garde son `expires_at`, de sorte
 * que `supabase-js` croit le jeton bon, ne tente aucun renouvellement et l'envoie ; le serveur le
 * refuse (401). La pile ne donne pas de quoi signer un jeton : celui-ci garde la signature de
 * l'ancien, qui ne correspond plus, et le serveur le refuse de la même façon.
 *
 * Rend de quoi rétablir la session d'avant, comme une reconnexion.
 */
export function perimerJeton(sb: SupabaseClient): () => void {
  const memoire = memoires.get(sb);
  const texte = memoire?.get(CLE_SESSION);
  if (!memoire || !texte) throw new Error('perimerJeton : client sans session de test');
  const session = JSON.parse(texte) as { access_token: string };
  const [entete = '', charge = '', signature = ''] = session.access_token.split('.');
  const perime = { ...decoder(charge), exp: Math.floor(Date.now() / 1000) - 3600 };
  session.access_token = `${entete}.${encoder(perime)}.${signature}`;
  memoire.set(CLE_SESSION, JSON.stringify(session));
  return () => memoire.set(CLE_SESSION, texte);
}
