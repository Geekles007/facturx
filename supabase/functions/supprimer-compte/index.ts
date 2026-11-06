/**
 * Edge Function `supprimer-compte` (spec § 12) : la demande de suppression du compte, et son annulation,
 * pendant les 30 jours de grâce que la fonction `purger` laisse avant d'effacer l'entreprise.
 *
 *   POST /functions/v1/supprimer-compte   { action: 'demander' | 'annuler' }
 *
 * Réponse 200 `{ suppressionDemandeeLe }` : la date de la demande en vigueur après l'appel (ISO), ou
 * `null` quand il n'y en a plus. Erreurs (§ 13) : 401 `SESSION`, 403 `DROITS`, 409 `SUPPRESSION` pour
 * une annulation trop tardive (`details.suppressionDemandeeLe` porte la date de la demande), 422
 * `ANOMALIES` pour un corps illisible ou une action inconnue.
 *
 * `demander` pose la date du jour si l'entreprise n'en a pas : une seconde demande ne repousse pas le
 * délai. `annuler` l'efface, demande ou non, tant que le délai de grâce n'est pas écoulé (30 jours,
 * `_shared/suppression.ts`) : passé ce délai, la demande n'est plus annulable. C'est ce qui rend la purge
 * sûre : `purger` n'efface que des entreprises dont la demande a dépassé le délai, et aucune annulation ne
 * peut plus aboutir sur elles, même pendant que la purge les efface (une entreprise dont le Storage et
 * les utilisateurs seraient partis, et dont les lignes resteraient sans membre, n'aurait plus personne
 * pour la reprendre). Dès que la date est posée, `emettre`, `importer` et `relancer` refusent (403
 * `SUPPRESSION`, `exigerCompteActif`) ; celle-ci reste appelable, c'est elle qui rend la main.
 * L'entreprise visée est celle du jeton (`contexte`), jamais une entreprise du corps.
 *
 * Ce n'est pas cette fonction qui impose l'export des données avant la suppression (spec § 12, 1) : le
 * Studio le fait avant de l'appeler.
 */
import { contexte } from '../_shared/contexte.ts';
import { lireObjetPortable, lireTexte } from '../_shared/corps.ts';
import { sql } from '../_shared/db.ts';
import { anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { DELAI_GRACE_JOURS, echue } from '../_shared/suppression.ts';

/** Le corps tient en une ligne : au-delà, ce n'est pas la requête du Studio. */
const PLAFOND_REQUETE = 1024;

const ACTIONS = ['demander', 'annuler'] as const;
type Action = (typeof ACTIONS)[number];

/** L'action du corps ; sinon lève 422 `ANOMALIES` (code `CORPS`, `path` `action`). */
function lireAction(texte: string): Action {
  const message = 'La demande est illisible : le compte reste inchangé.';
  const corps = lireObjetPortable(texte, message);
  const action = ACTIONS.find((a) => a === corps.action);
  if (!action) {
    throw anomalies(
      [
        {
          code: 'CORPS',
          path: 'action',
          message: 'Action attendue : « demander » ou « annuler ».',
        },
      ],
      message,
    );
  }
  return action;
}

/** Pose la date du jour, si l'entreprise n'en a pas ; rend la date en vigueur. */
async function demander(entrepriseId: string): Promise<Date> {
  const [entreprise] = await sql<{ date: Date }[]>`
    update public.entreprises
       set suppression_demandee_le = coalesce(suppression_demandee_le, now())
     where id = ${entrepriseId}
    returning suppression_demandee_le as date`;
  if (!entreprise) throw new Error('entreprise absente pour le compte');
  return entreprise.date;
}

/**
 * Efface la demande, si le délai n'est pas écoulé ; sinon lève 409 `SUPPRESSION`. Une entreprise sans
 * demande n'a rien à annuler : la réponse est la même.
 */
async function annuler(entrepriseId: string): Promise<void> {
  const [annulee] = await sql`
    update public.entreprises set suppression_demandee_le = null
     where id = ${entrepriseId} and not coalesce(${echue()}, false)
    returning id`;
  if (annulee) return;

  // Aucune ligne touchée : l'entreprise existe (le jeton la désigne), la demande a donc dépassé le délai.
  const [entreprise] = await sql<{ date: Date | null }[]>`
    select suppression_demandee_le as date from public.entreprises where id = ${entrepriseId}`;
  if (!entreprise?.date) throw new Error('entreprise absente pour le compte');
  throw erreur(
    409,
    'SUPPRESSION',
    `La suppression du compte a été demandée il y a plus de ${DELAI_GRACE_JOURS} jours : elle ne peut plus être annulée.`,
    { suppressionDemandeeLe: entreprise.date.toISOString() },
  );
}

Deno.serve(
  traiter(async (req) => {
    const ctx = await contexte(req);
    const action = lireAction(await lireTexte(req, PLAFOND_REQUETE));

    if (action === 'demander') {
      return json({ suppressionDemandeeLe: (await demander(ctx.entrepriseId)).toISOString() });
    }
    await annuler(ctx.entrepriseId);
    return json({ suppressionDemandeeLe: null });
  }),
);
