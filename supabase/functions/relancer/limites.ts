/**
 * Les limites d'une relance (spec § 9 et § 11), appliquées dans la transaction de `relancer`, sous le
 * verrou de l'entreprise :
 *
 *   - une relance envoyée par facture tous les 72 heures ;
 *   - 20 relances envoyées par jour de Paris et par entreprise ;
 *   - 60 relances refusées par le service d'envoi par jour de Paris et par entreprise (un plafond
 *     lâche : une tentative refusée n'envoie rien, mais elle ne doit pas se répéter sans fin).
 *
 * Chaque 429 `LIMITE` porte `details.reessayerApres` (ISO) et `details.cause`, ce qui retient la
 * relance : `delai` (72 h sur la facture), `jour` (20 envois du jour), `tentatives` (60 refus du jour)
 * ou `verrou` (une autre relance de l'entreprise en cours d'envoi). Le Studio dit la bonne limite.
 *
 * Le verrou est consultatif et par entreprise : il fait se suivre les relances de l'entreprise, de sorte
 * que chacune compte ce que la précédente a consigné. Il est pris avant tout comptage, et le jour est
 * lu dans la base après lui, dans la requête qui compte : une relance qui a attendu le verrou jusqu'à
 * minuit compte dans le jour où elle est datée (`clock_timestamp()`), pas dans celui où elle est née.
 * L'attente est bornée (10 secondes, soit moins que le délai d'un envoi) : au-delà, 429 `LIMITE`.
 */
import type postgres from 'postgres';
import { aujourdhuiImpose } from '../_shared/contexte.ts';
import { erreur } from '../_shared/erreurs.ts';

/** `sql` ou la transaction ouverte par `sql.begin`. */
type Requetes = postgres.ISql;

/** Une relance par facture tous les 3 jours (spec § 11), comptés en heures : 72 h exactes. */
export const DELAI_HEURES = 72;

/** Relances envoyées par jour de Paris et par entreprise (spec § 11). */
export const PLAFOND_PAR_JOUR = 20;

/** Relances refusées par le service d'envoi, par jour de Paris et par entreprise. */
export const PLAFOND_REFUSEES_PAR_JOUR = 60;

/** Le niveau le plus haut : le dernier rappel se répète. */
export const NIVEAU_MAX = 3;

/** Combien de temps une relance attend le verrou de l'entreprise, en secondes. */
export const ATTENTE_VERROU = 10;

/** Ce qui retient la relance : `details.cause` de la réponse 429. */
export type CauseLimite = 'delai' | 'jour' | 'tentatives' | 'verrou';

/** Le complément de chaque message de refus : rien n'a été envoyé. */
const SANS_ENVOI = 'aucune relance n’est partie';

/** La clé du verrou consultatif de l'entreprise. */
export const cleDuVerrou = (entrepriseId: string): string => `relancer:${entrepriseId}`;

/**
 * Prend le verrou de l'entreprise, puis applique les limites. Rend le niveau de la relance : les
 * relances envoyées de la facture plus un, au plus 3. Les relances refusées ne comptent ni pour le niveau
 * ni pour le délai. Le jour de Paris est celui de la base au moment du comptage, sauf si l'en-tête de
 * test en impose un (`aujourdhuiImpose(req)`, lu ici et non par l'appelant : l'appelant n'a ainsi pas
 * de jour à donner, et ne peut pas en donner un lu avant le verrou). Lève 429 `LIMITE`, avec
 * `details.reessayerApres` et `details.cause` : si deux limites sont atteintes, la plus tardive.
 */
export async function appliquerLimites(
  tx: Requetes,
  entrepriseId: string,
  factureId: string,
  req: Request,
): Promise<number> {
  await tx`select set_config('lock_timeout', ${`${ATTENTE_VERROU}s`}, true)`;
  try {
    await tx`select pg_advisory_xact_lock(hashtextextended(${cleDuVerrou(entrepriseId)}, 0))`;
  } catch (echec) {
    // 55P03 : le verrou n'est pas venu à temps ; une autre relance de l'entreprise est en cours d'envoi.
    if ((echec as { code?: unknown }).code !== '55P03') throw echec;
    throw erreur(
      429,
      'LIMITE',
      `Une autre relance de l’entreprise est en cours d’envoi : réessayez dans quelques secondes. ${SANS_ENVOI}.`,
      {
        reessayerApres: new Date(Date.now() + ATTENTE_VERROU * 1000).toISOString(),
        cause: 'verrou' satisfies CauseLimite,
      },
    );
  }

  const [{ envoyees, bloquee, libre_le }] = await tx<
    { envoyees: number; bloquee: boolean | null; libre_le: Date | null }[]
  >`
    select count(*)::int as envoyees,
           max(envoyee_le) + make_interval(hours => ${DELAI_HEURES}) > clock_timestamp() as bloquee,
           max(envoyee_le) + make_interval(hours => ${DELAI_HEURES}) as libre_le
      from public.relances
     where entreprise_id = ${entrepriseId} and facture_id = ${factureId} and etat = 'envoyee'`;

  // Le jour va de minuit à minuit à Paris, borne haute exclue ; `at time zone` sait si c'est l'heure
  // d'été ou d'hiver. Sans jour imposé, il est lu ici, à l'instant du comptage.
  const [{ envoyees_du_jour, refusees_du_jour, minuit_suivant }] = await tx<
    { envoyees_du_jour: number; refusees_du_jour: number; minuit_suivant: Date }[]
  >`
    with j as (
      select coalesce(${aujourdhuiImpose(req) ?? null}::date,
                      (clock_timestamp() at time zone 'Europe/Paris')::date) as jour
    ), b as (
      select (j.jour::timestamp at time zone 'Europe/Paris') as debut,
             ((j.jour + 1)::timestamp at time zone 'Europe/Paris') as fin
        from j
    )
    select b.fin as minuit_suivant,
           (select count(*) from public.relances r
             where r.entreprise_id = ${entrepriseId} and r.etat = 'envoyee'
               and r.envoyee_le >= b.debut and r.envoyee_le < b.fin)::int as envoyees_du_jour,
           (select count(*) from public.relances r
             where r.entreprise_id = ${entrepriseId} and r.etat = 'refusee'
               and r.envoyee_le >= b.debut and r.envoyee_le < b.fin)::int as refusees_du_jour
      from b`;

  // Plusieurs limites en défaut ensemble : réessayer après la plus tardive.
  const limites: { apres: Date; cause: CauseLimite; message: string }[] = [];
  if (bloquee && libre_le) {
    limites.push({
      apres: libre_le,
      cause: 'delai',
      message: `Cette facture a déjà été relancée il y a moins de ${DELAI_HEURES} heures.`,
    });
  }
  if (envoyees_du_jour >= PLAFOND_PAR_JOUR) {
    limites.push({
      apres: minuit_suivant,
      cause: 'jour',
      message: `${PLAFOND_PAR_JOUR} relances ont déjà été envoyées aujourd’hui.`,
    });
  }
  if (refusees_du_jour >= PLAFOND_REFUSEES_PAR_JOUR) {
    limites.push({
      apres: minuit_suivant,
      cause: 'tentatives',
      message: `${PLAFOND_REFUSEES_PAR_JOUR} tentatives d’envoi ont déjà été refusées aujourd’hui.`,
    });
  }
  if (limites.length > 0) {
    const tardive = limites.reduce((a, b) => (b.apres > a.apres ? b : a));
    throw erreur(429, 'LIMITE', `${tardive.message} Réessayez plus tard : ${SANS_ENVOI}.`, {
      reessayerApres: tardive.apres.toISOString(),
      cause: tardive.cause,
    });
  }
  return Math.min(envoyees + 1, NIVEAU_MAX);
}
