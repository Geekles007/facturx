/**
 * Les réponses des Edge Functions (spec § 13) : un succès en JSON, ou une erreur
 * `{ code, message, details? }` avec le statut du tableau.
 *
 * Une fonction lève la `Response` d'une erreur (`throw erreur(…)`) là où elle la constate, y compris
 * au fond d'une transaction, que la levée annule. `traiter` la rend telle quelle ; toute autre
 * exception devient un 500 `INTERNE` au message générique, avec un identifiant de requête, et son
 * détail ne va qu'aux journaux de la fonction.
 *
 * CORS (Ruling 27) : le Studio appelle les fonctions depuis le navigateur, d'une autre origine.
 * `traiter` répond au préflight `OPTIONS` avant tout le reste, sans jeton, et donne à chaque réponse,
 * erreurs comprises, l'origine de la requête si elle figure dans `FACTURX_ORIGINES` (liste séparée
 * par des virgules, lue à chaque requête) ; sans la variable, aucune origine n'est admise. `json`
 * pose les en-têtes qui ne dépendent pas de la requête.
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

/** Les en-têtes CORS qui ne dépendent pas de la requête ; `Vary` : la réponse dépend de l'origine. */
const CORS: Record<string, string> = {
  vary: 'Origin',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
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

/** Les origines admises : `FACTURX_ORIGINES`, lue à chaque requête. */
function originesAdmises(): Set<string> {
  return new Set(
    (Deno.env.get('FACTURX_ORIGINES') ?? '')
      .split(',')
      .map((origine) => origine.trim())
      .filter((origine) => origine !== ''),
  );
}

/** `reponse`, avec l'origine de `req` en `Access-Control-Allow-Origin` si elle est admise. */
function autoriser(req: Request, reponse: Response): Response {
  const origine = req.headers.get('origin');
  if (origine && originesAdmises().has(origine)) {
    reponse.headers.set('access-control-allow-origin', origine);
  }
  return reponse;
}

/**
 * Ce qu'une exception imprévue laisse dans les journaux : son nom, son code (SQLSTATE d'une erreur
 * Postgres), son message et sa pile. Ni les en-têtes de la requête (le jeton), ni son corps (la
 * facture), ni le détail d'une erreur Postgres, qui peut citer des valeurs.
 */
export function resumer(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { type: typeof e };
  return { nom: e.name, code: (e as { code?: unknown }).code, message: e.message, pile: e.stack };
}

/** Le gestionnaire d'une fonction, son préflight CORS et ses erreurs rendus au format du § 13. */
export function traiter(
  gestionnaire: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') {
      return autoriser(req, new Response(null, { status: 204, headers: CORS }));
    }
    try {
      return autoriser(req, await gestionnaire(req));
    } catch (e) {
      if (e instanceof Response) return autoriser(req, e);
      const requete = crypto.randomUUID();
      console.error(JSON.stringify({ requete, erreur: resumer(e) }));
      return autoriser(
        req,
        erreur(
          500,
          'INTERNE',
          'Erreur interne du serveur. Réessayez ; si elle persiste, citez cet identifiant.',
          { requete },
        ),
      );
    }
  };
}
