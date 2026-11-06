/**
 * Les réponses des Edge Functions (spec § 13) : un succès en JSON, ou une erreur
 * `{ code, message, details? }` avec le statut du tableau.
 *
 * Une fonction lève la `Response` d'une erreur (`throw erreur(…)`) là où elle la constate, y compris
 * au fond d'une transaction, que la levée annule. `traiter` la rend telle quelle ; toute autre
 * exception devient un 500 `INTERNE` au message générique, avec un identifiant de requête, et son
 * détail ne va qu'aux journaux de la fonction.
 */

export type CodeErreur =
  | 'SESSION'
  | 'DROITS'
  | 'NON_CONFIRME'
  | 'SUPPRESSION'
  | 'BROUILLON_MODIFIE'
  | 'DATE'
  | 'DOUBLON'
  | 'PDF_DEJA_DEPOSE'
  | 'ANOMALIES'
  | 'LIMITE'
  | 'ENVOI'
  | 'INTERNE';

/** Une anomalie au format des `Issue` du SDK : le Studio ouvre l'onglet Contrôle sur `path`. */
export interface Anomalie {
  code: string;
  path: string;
  message: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function erreur(
  status: number,
  code: CodeErreur,
  message: string,
  details?: unknown,
): Response {
  return json(details === undefined ? { code, message } : { code, message, details }, status);
}

/** 422 `ANOMALIES`, la liste dans `details`. */
export function anomalies(liste: readonly Anomalie[], message: string): Response {
  return erreur(422, 'ANOMALIES', message, liste);
}

/**
 * Ce qu'une exception imprévue laisse dans les journaux : son nom, son code (SQLSTATE d'une erreur
 * Postgres), son message et sa pile. Ni les en-têtes de la requête (le jeton), ni son corps (la
 * facture), ni le détail d'une erreur Postgres, qui peut citer des valeurs.
 */
function resumer(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { type: typeof e };
  return { nom: e.name, code: (e as { code?: unknown }).code, message: e.message, pile: e.stack };
}

/** Le gestionnaire d'une fonction, ses erreurs rendues au format du § 13. */
export function traiter(
  gestionnaire: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await gestionnaire(req);
    } catch (e) {
      if (e instanceof Response) return e;
      const requete = crypto.randomUUID();
      console.error(JSON.stringify({ requete, erreur: resumer(e) }));
      return erreur(
        500,
        'INTERNE',
        'Erreur interne du serveur. Réessayez ; si elle persiste, citez cet identifiant.',
        { requete },
      );
    }
  };
}
