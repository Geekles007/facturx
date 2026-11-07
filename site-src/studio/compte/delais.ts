/**
 * Les délais de l'émission en mode compte (`emission.ts`). À part, pour qu'un test puisse les
 * raccourcir (`vi.mock('./delais.js', …)`) sans que le code qui les emploie prévoie quoi que ce soit
 * pour lui.
 */

/**
 * Le plus long qu'une étape de l'émission fige l'éditeur : l'enregistrement qui la précède, l'appel
 * à `emettre` (le `fetch` est abandonné au même délai). Au-delà, l'issue est incertaine (on cherche
 * la facture par son brouillon) et l'éditeur reprend.
 */
export const DELAI_EMISSION_MS = 60_000;

/** Le plus long que dure la recherche de la facture d'une réponse perdue. */
export const DELAI_RECHERCHE_MS = 15_000;

/** Le plus long que dure la relecture de l'historique après l'émission (sinon : `reconstituer`). */
export const DELAI_RELECTURE_MS = 15_000;

/** Le plus long qu'attendent les recopies locales (miroir, identifiant) du brouillon quitté. */
export const DELAI_LOCAL_MS = 5_000;

/**
 * Le plus long que l'éditeur reste figé tant que le brouillon n'est pas quitté. Au-delà, l'émission
 * est abandonnée : ce qui en reviendrait ensuite ne quitte ni n'ouvre plus rien, l'issue est dite
 * incertaine, et l'éditeur reprend. Une fois le brouillon quitté (`brouillonEmis`), on va jusqu'au
 * bout : il ne reste que la relecture, bornée par `DELAI_RELECTURE_MS`.
 */
export const DELAI_GEL_MS = 120_000;
