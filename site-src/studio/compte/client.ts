/**
 * Le client Supabase du Studio : un seul, créé au premier appel, avec le projet injecté à la
 * construction. La session vit dans `localStorage` (réglage par défaut de `supabase-js`), d'où la
 * clé `sb-<projet>-auth-token` que `session.ts` cherche au démarrage.
 *
 * Le flux est PKCE : le lien de confirmation ne rend qu'un code, que seul le navigateur d'où la
 * demande est partie sait échanger (il y a gardé le vérificateur). Le flux implicite, par défaut,
 * accepterait des jetons dans l'adresse : un lien fabriqué avec ceux d'un autre compte
 * connecterait le visiteur chez l'attaquant, qui recevrait ensuite ses brouillons et ses clients.
 *
 * Seul module, avec `index.ts`, à importer `supabase-js` : il n'est atteint que par `import()`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let courant: SupabaseClient | undefined;

export function client(): SupabaseClient {
  courant ??= createClient(__FACTURX_SUPABASE_URL__, __FACTURX_SUPABASE_KEY__, {
    auth: { flowType: 'pkce' },
  });
  return courant;
}
