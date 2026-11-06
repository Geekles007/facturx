-- Données de départ, jouées par `supabase db reset` et `supabase start` : en local et en CI, jamais
-- en production (`supabase db push` ne les envoie pas). Elles ne contiennent que de quoi écrire
-- les tests pgTAP de supabase/tests/.

-- Le schéma `tests` n'est pas exposé par l'API (config.toml : api.schemas) et ni `anon` ni
-- `authenticated` n'y ont accès : un test l'appelle avant de prendre un rôle, ou après `reset role`.
create schema if not exists tests;

-- Crée un utilisateur déjà confirmé, dont les métadonnées portent l'acceptation des CGU : le
-- déclencheur de l'inscription lui crée alors son entreprise, son membre et sa numérotation.
create or replace function tests.creer_utilisateur(email text) returns uuid
language sql
as $$
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (gen_random_uuid(), 'authenticated', 'authenticated', email, now(), '{"cgu":"2026-11"}')
  returning id
$$;

-- Les requêtes suivantes, jusqu'à `reset role` ou la fin de la transaction, passent par le rôle
-- `authenticated` avec le jeton de cet utilisateur : la RLS s'applique, `auth.uid()` répond `uid`.
-- Pas de `security definer` : `set role` n'y est pas permis.
create or replace function tests.agir_comme(uid uuid) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;
