/**
 * Le client Supabase du Studio : un seul, créé au premier appel, avec le projet injecté à la
 * construction. La session vit dans `localStorage` (réglage par défaut de `supabase-js`), d'où la
 * clé `sb-<projet>-auth-token` que `session.ts` cherche au démarrage.
 *
 * Seul module, avec `index.ts`, à importer `supabase-js` : il n'est atteint que par `import()`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let courant: SupabaseClient | undefined;

export function client(): SupabaseClient {
  courant ??= createClient(__FACTURX_SUPABASE_URL__, __FACTURX_SUPABASE_KEY__);
  return courant;
}
