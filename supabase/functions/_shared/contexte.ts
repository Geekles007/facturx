/**
 * Qui appelle, pour quelle entreprise, et quel jour il est.
 *
 * Le jeton est vérifié par le serveur d'auth (`auth.getUser`), jamais seulement décodé : une session
 * révoquée ou un compte supprimé n'y passent pas. L'entreprise est celle du compte dans `membres`,
 * jamais une entreprise lue dans le corps de la requête (spec § 11). `config.toml` désactive donc
 * `verify_jwt` pour ces fonctions : sans jeton, c'est ici que se répond le 401 `SESSION` du § 13.
 */
import { isAuthApiError } from '@supabase/supabase-js';
import { aujourdhuiParis } from './dates.ts';
import { admin, sql } from './db.ts';
import { erreur } from './erreurs.ts';

export interface Contexte {
  userId: string;
  email: string;
  /** L'adresse du compte est confirmée (`email_confirmed_at`). */
  confirme: boolean;
  entrepriseId: string;
  /** La suppression du compte a été demandée (spec § 12) : émettre, importer et relancer sont refusés. */
  suppressionDemandee: boolean;
}

/** Le contexte de la requête ; lève une `Response` 401 `SESSION` ou 403 `DROITS`. */
export async function contexte(req: Request): Promise<Contexte> {
  const jeton = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jeton) throw erreur(401, 'SESSION', 'Session absente : reconnectez-vous.');

  const { data, error } = await admin().auth.getUser(jeton);
  if (error) {
    // Un refus du serveur d'auth (jeton expiré, altéré, sans compte) ; une panne reste une panne.
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500) {
      throw erreur(401, 'SESSION', 'Session expirée ou invalide : reconnectez-vous.');
    }
    throw error;
  }
  const user = data.user;

  // Une entreprise par compte en v1 ; l'ordre ne fait que rendre le choix déterministe.
  const [membre] = await sql<{ entreprise_id: string; suppression: boolean }[]>`
    select m.entreprise_id, e.suppression_demandee_le is not null as suppression
      from public.membres m
      join public.entreprises e on e.id = m.entreprise_id
     where m.user_id = ${user.id}
     order by m.cgu_acceptees_le, m.entreprise_id
     limit 1`;
  if (!membre) throw erreur(403, 'DROITS', 'Ce compte n’est membre d’aucune entreprise.');

  return {
    userId: user.id,
    email: user.email ?? '',
    confirme: Boolean(user.email_confirmed_at),
    entrepriseId: membre.entreprise_id,
    suppressionDemandee: membre.suppression,
  };
}

/**
 * Lève 403 `SUPPRESSION` pendant le délai de grâce de la suppression du compte (spec § 12) : `emettre`,
 * `importer` et `relancer` écrivent des données qui vont disparaître, et le Studio n'offre plus que
 * l'export et l'annulation. `annuler` (fonction `supprimer-compte`) lève le refus. `sans` dit ce que le
 * refus laisse intact, comme les autres refus de chaque fonction.
 */
export function exigerCompteActif(ctx: Contexte, sans: string): void {
  if (ctx.suppressionDemandee) {
    throw erreur(
      403,
      'SUPPRESSION',
      `La suppression du compte est demandée : annulez-la pour reprendre. ${sans}.`,
    );
  }
}

/**
 * Le projet est-il un projet hébergé par Supabase (`https://<ref>.supabase.co`) ? Une adresse absente
 * ou illisible compte comme hébergée : la garde ferme par défaut.
 */
export function projetHeberge(): boolean {
  try {
    const { hostname } = new URL(Deno.env.get('SUPABASE_URL') ?? '');
    return hostname === 'supabase.co' || hostname.endsWith('.supabase.co');
  } catch {
    return true;
  }
}

/**
 * « Aujourd'hui » pour la fonction : la date de Paris. L'en-tête `x-facturx-aujourdhui` la remplace,
 * s'il porte une date ISO, à deux conditions : `FACTURX_TESTS` vaut `1` exactement (fichier .env local
 * et CI, jamais en production), et le projet n'est pas hébergé par Supabase — une garde de plus, au
 * cas où la variable y serait envoyée par erreur. Les tests y placent un 31 décembre ou un 2 janvier.
 */
export function aujourdhui(req: Request): string {
  return aujourdhuiImpose(req) ?? aujourdhuiParis(new Date());
}

/**
 * Le jour que l'en-tête de test impose (voir `aujourdhui`), ou `undefined` : l'horloge est la vraie.
 * Une fonction qui fixe le jour sous un verrou (`relancer`) le lit dans la base à ce moment-là et ne
 * se sert de ceci que pour la substitution des tests.
 */
export function aujourdhuiImpose(req: Request): string | undefined {
  if (Deno.env.get('FACTURX_TESTS') !== '1' || projetHeberge()) return undefined;
  const date = req.headers.get('x-facturx-aujourdhui');
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}
