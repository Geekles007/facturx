/**
 * Qui appelle, pour quelle entreprise, et quel jour il est.
 *
 * Le jeton est vérifié par le serveur d'auth (`auth.getUser`), jamais seulement décodé : une session
 * révoquée ou un compte supprimé n'y passent pas. L'entreprise est celle du compte dans `membres`,
 * jamais une entreprise lue dans le corps de la requête (spec § 11). `config.toml` désactive donc
 * `verify_jwt` pour ces fonctions : sans jeton, c'est ici que se répond le 401 `SESSION` du § 13.
 */
import { isAuthApiError } from '@supabase/supabase-js';
import { aujourdhuiParis } from '../emettre/regles.ts';
import { admin, sql } from './db.ts';
import { erreur } from './erreurs.ts';

export interface Contexte {
  userId: string;
  email: string;
  /** L'adresse du compte est confirmée (`email_confirmed_at`). */
  confirme: boolean;
  entrepriseId: string;
  /** La suppression du compte a été demandée (spec § 12) : émettre et relancer sont refusés. */
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
 * « Aujourd'hui » pour la fonction : la date de Paris. Avec `FACTURX_TESTS` à `1` exactement (fichier
 * .env local et CI, jamais en production), l'en-tête `x-facturx-aujourdhui` la remplace, s'il porte
 * une date ISO : les tests y placent un 31 décembre ou un 2 janvier.
 */
export function aujourdhui(req: Request): string {
  if (Deno.env.get('FACTURX_TESTS') === '1') {
    const date = req.headers.get('x-facturx-aujourdhui');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return aujourdhuiParis(new Date());
}
