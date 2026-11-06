/**
 * Le délai de grâce de la suppression d'un compte (spec § 12), en un seul endroit : `purger` efface les
 * entreprises dont la demande l'a dépassé, `supprimer-compte` n'admet plus l'annulation d'une demande qui
 * l'a dépassé. Les deux se répondent : une demande est annulable, ou purgeable, jamais les deux, de sorte
 * qu'une annulation ne peut pas aboutir sur une entreprise que la purge a déjà prise.
 */
import { sql } from './db.ts';

/** Délai de grâce d'une suppression de compte (spec § 12), en jours. */
export const DELAI_GRACE_JOURS = 30;

/**
 * La suppression de l'entreprise a été demandée il y a plus de `DELAI_GRACE_JOURS` jours : un fragment
 * de requête sur `entreprises.suppression_demandee_le` (nul pour une demande absente, jamais vrai).
 */
export const echue = () =>
  sql`suppression_demandee_le < now() - make_interval(days => ${DELAI_GRACE_JOURS})`;
