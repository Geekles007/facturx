/**
 * Garde-fou de `pnpm site:build` : la clé Supabase injectée dans le bundle du Studio
 * (`FACTURX_SUPABASE_KEY`) est lisible par tout visiteur. Ce doit être la clé publique du projet ;
 * une clé de service, passée par erreur, donnerait à n'importe qui les droits d'administration
 * de la base. Les clés publiques (JWT `anon`, `sb_publishable_…`) passent ; une absence de clé
 * aussi, le Studio étant alors construit sans compte.
 */

/** Le rôle porté par un JWT (second segment, en JSON base64url), ou rien si ce n'en est pas un. */
function roleDuJwt(cle) {
  const segments = cle.split('.');
  if (segments.length !== 3) return undefined;
  try {
    const charge = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return typeof charge?.role === 'string' ? charge.role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lève une erreur, en français, si `cle` est une clé de service : un JWT de rôle `service_role`
 * (ancien format) ou une clé `sb_secret_…` (nouveau format). Le message ne cite pas la clé.
 */
export function verifierCleSupabase(cle) {
  if (!cle) return;
  let nature;
  if (cle.startsWith('sb_secret_')) nature = 'une clé secrète (sb_secret_…)';
  else if (roleDuJwt(cle) === 'service_role') nature = 'une clé de service (rôle service_role)';
  if (!nature) return;
  throw new Error(
    `FACTURX_SUPABASE_KEY est ${nature} : le bundle du Studio est public, ce secret n’y a pas sa place. ` +
      'Fournir la clé publique du projet (anon, ou sb_publishable_…). Construction abandonnée.',
  );
}
