/**
 * Faut-il charger le code du compte ? Ce module en décide, et ne doit donc rien importer de
 * `supabase-js` : le Studio sans compte ne télécharge ni la bibliothèque ni `compte/index.ts`.
 */

/** Vrai si ce site a été construit avec un projet Supabase (voir `FACTURX_SUPABASE_URL` et `_KEY`). */
export function compteActif(): boolean {
  return __FACTURX_SUPABASE_URL__ !== '' && __FACTURX_SUPABASE_KEY__ !== '';
}

/** La clé de `localStorage` où `supabase-js` conserve la session : `sb-<projet>-auth-token`. */
const estCleDeSession = (cle: string): boolean =>
  cle.startsWith('sb-') && cle.endsWith('-auth-token');

/** Les clés de session présentes dans `localStorage` (aucune si l'accès est refusé). */
function clesDeSession(): { stockage: Storage; cles: string[] } | undefined {
  try {
    const stockage = globalThis.localStorage;
    if (!stockage) return undefined;
    const cles: string[] = [];
    for (let i = 0; i < stockage.length; i++) {
      const cle = stockage.key(i);
      if (cle && estCleDeSession(cle)) cles.push(cle);
    }
    return { stockage, cles };
  } catch {
    // Pas de lecture possible (navigation privée stricte, stockage bloqué) : pas de compte.
    return undefined;
  }
}

/**
 * Vrai si une session `supabase-js` a probablement été conservée par ce navigateur. Sans elle, le
 * Studio reste local. Un accès refusé vaut « pas de session ».
 */
export function sessionProbable(): boolean {
  return (clesDeSession()?.cles.length ?? 0) > 0;
}

/** Retire de `localStorage` la session de `supabase-js` : la déconnexion ne dépend pas du serveur. */
export function oublierSession(): void {
  const trouvees = clesDeSession();
  if (!trouvees) return;
  try {
    for (const cle of trouvees.cles) trouvees.stockage.removeItem(cle);
  } catch {
    // Rien de plus à faire : le rechargement qui suit reprend sans compte ou redemande la connexion.
  }
}

/**
 * Nature du retour d'un lien reçu par e-mail (confirmation, réinitialisation, changement
 * d'adresse) : `code` quand Supabase renvoie le code du flux PKCE, `erreur` quand le lien est
 * périmé ou invalide, `message` pour le premier des deux liens d'un changement d'adresse (Supabase
 * le dit, en anglais, dans `message`), rien pour une adresse ordinaire. Le fragment
 * `#access_token=…` du flux implicite n'en est pas un : le client n'accepte que PKCE, qui lie la
 * session au navigateur de la demande, et un lien fabriqué avec les jetons d'un autre compte ne
 * peut donc pas y ouvrir de session.
 */
export function retourDeLien(): 'code' | 'erreur' | 'message' | undefined {
  try {
    const { search, hash } = globalThis.location;
    if (/[?#&]error_(?:code|description)=/.test(search + hash)) return 'erreur';
    if (/[?&]code=/.test(search)) return 'code';
    if (/[?#&]message=/.test(search + hash)) return 'message';
  } catch {
    // Hors d'un navigateur : aucun lien n'a ramené ici.
  }
  return undefined;
}

/** Les paramètres que Supabase ajoute à l'adresse de retour. */
const PARAMETRES_DE_RETOUR = ['code', 'error', 'error_code', 'error_description', 'message'];

/**
 * Retire de l'adresse le code ou l'erreur du retour de lien, une fois traités : un rechargement
 * ne les rejoue pas. Une ancre ordinaire du fragment reste ; le fragment d'une erreur s'en va.
 */
export function effacerRetourDeLien(): void {
  try {
    const url = new URL(globalThis.location.href);
    for (const nom of PARAMETRES_DE_RETOUR) url.searchParams.delete(nom);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (PARAMETRES_DE_RETOUR.some((nom) => fragment.has(nom))) url.hash = '';
    globalThis.history.replaceState(globalThis.history.state, '', url.href);
  } catch {
    // Hors d'un navigateur, ou historique indisponible : l'adresse garde ses paramètres.
  }
}
