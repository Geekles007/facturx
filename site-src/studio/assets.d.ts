/** Profil ICC chargé tel quel par esbuild (`loader: binary`). */
declare module '*.icc' {
  const bytes: Uint8Array;
  export default bytes;
}

/**
 * Le projet Supabase du compte, injecté par esbuild à la construction (`define` de
 * scripts/build-site.mjs) depuis `FACTURX_SUPABASE_URL` et `FACTURX_SUPABASE_KEY` (la clé publique).
 * Chaînes vides quand les variables manquent : le Studio n'offre alors aucun compte.
 */
declare const __FACTURX_SUPABASE_URL__: string;
declare const __FACTURX_SUPABASE_KEY__: string;
