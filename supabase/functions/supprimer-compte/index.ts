/**
 * Edge Function `supprimer-compte` (spec § 12) : la demande de suppression du compte, et son annulation,
 * pendant les 30 jours de grâce que la fonction `purger` laisse avant d'effacer l'entreprise.
 *
 *   POST /functions/v1/supprimer-compte   { action: 'demander' | 'annuler' }
 *
 * Réponse 200 `{ suppressionDemandeeLe }` : la date de la demande en vigueur après l'appel (ISO), ou
 * `null` quand il n'y en a plus. Erreurs (§ 13) : 401 `SESSION`, 403 `DROITS`, 422 `ANOMALIES` pour un
 * corps illisible ou une action inconnue.
 *
 * `demander` pose la date du jour si l'entreprise n'en a pas : une seconde demande ne repousse pas le
 * délai. `annuler` l'efface, demande ou non. Dès que la date est posée, `emettre`, `importer` et
 * `relancer` refusent (403 `SUPPRESSION`, `exigerCompteActif`) ; celle-ci reste appelable, c'est elle qui
 * rend la main. L'entreprise visée est celle du jeton (`contexte`), jamais une entreprise du corps.
 *
 * Ce n'est pas cette fonction qui impose l'export des données avant la suppression (spec § 12, 1) : le
 * Studio le fait avant de l'appeler.
 */
import { contexte } from '../_shared/contexte.ts';
import { lireObjetPortable, lireTexte } from '../_shared/corps.ts';
import { sql } from '../_shared/db.ts';
import { anomalies, json, traiter } from '../_shared/erreurs.ts';

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

Deno.serve(
  traiter(async (req) => {
    const ctx = await contexte(req);
    const action = lireAction(await lireTexte(req, PLAFOND_REQUETE));

    // `demander` garde la date d'une demande déjà posée ; `annuler` l'efface.
    const date = action === 'demander' ? sql`coalesce(suppression_demandee_le, now())` : null;
    const [entreprise] = await sql<{ date: Date | null }[]>`
      update public.entreprises set suppression_demandee_le = ${date}
       where id = ${ctx.entrepriseId}
      returning suppression_demandee_le as date`;
    if (!entreprise) throw new Error('entreprise absente pour le compte');

    return json({ suppressionDemandeeLe: entreprise.date?.toISOString() ?? null });
  }),
);
