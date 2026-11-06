/**
 * Les deux chemins des fonctions vers Supabase, tous deux avec les droits du service :
 *   - `sql`, une connexion Postgres directe (postgres.js, rôle `postgres`), pour les transactions
 *     que PostgREST ne tient pas sur plusieurs requêtes (spec § 7, étape 4) ;
 *   - `admin()`, supabase-js avec la clé de service, pour le serveur d'auth et le Storage.
 *
 * Ni l'un ni l'autre ne passe par la RLS : chaque requête filtre elle-même par l'entreprise que
 * `contexte()` a tirée du jeton, jamais par une entreprise lue dans le corps (spec § 11).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

export const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', {
  // Sans requêtes préparées nommées : la connexion peut passer par le pooler de transactions.
  prepare: false,
  // Une émission ne tient qu'une connexion (sa transaction) ; quelques-unes par worker suffisent.
  max: 3,
  // Secondes : un worker inactif rend ses connexions.
  idle_timeout: 20,
  onnotice: () => {},
});

let client: SupabaseClient | undefined;

export function admin(): SupabaseClient {
  client ??= createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return client;
}
