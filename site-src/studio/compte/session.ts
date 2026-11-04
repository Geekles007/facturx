/**
 * Faut-il charger le code du compte ? Ce module en décide, et ne doit donc rien importer de
 * `supabase-js` : le Studio sans compte ne télécharge ni la bibliothèque ni `compte/index.ts`.
 */

/** Vrai si ce site a été construit avec un projet Supabase (voir `FACTURX_SUPABASE_URL` et `_KEY`). */
export function compteActif(): boolean {
  return __FACTURX_SUPABASE_URL__ !== '' && __FACTURX_SUPABASE_KEY__ !== '';
}

/**
 * Vrai si une session `supabase-js` a probablement été conservée par ce navigateur : sa clé de
 * `localStorage` s'appelle `sb-<projet>-auth-token`. Sans cette clé, le Studio reste local.
 * Un accès refusé (navigation privée stricte, stockage bloqué) vaut « pas de session ».
 */
export function sessionProbable(): boolean {
  try {
    const stockage = globalThis.localStorage;
    if (!stockage) return false;
    for (let i = 0; i < stockage.length; i++) {
      const cle = stockage.key(i);
      if (cle?.startsWith('sb-') && cle.endsWith('-auth-token')) return true;
    }
  } catch {
    // Pas de lecture possible : le Studio fonctionne sans compte.
  }
  return false;
}

/**
 * Vrai si l'adresse est le retour d'un lien reçu par e-mail (confirmation, réinitialisation) :
 * `supabase-js` y lit la session dans le fragment, mais seulement s'il est chargé. Sans cela, le
 * lien de confirmation, ouvert avant toute session, laisserait l'utilisateur déconnecté.
 */
export function retourDeLien(): boolean {
  try {
    return /[#&]access_token=/.test(globalThis.location.hash);
  } catch {
    return false;
  }
}
