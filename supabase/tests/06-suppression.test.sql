-- Dépôt dans `fichiers` pendant le délai de grâce d'une suppression de compte
-- (supabase/migrations/20261104000700_fichiers_suppression.sql) : la règle d'insertion refuse quand la
-- suppression de l'entreprise du dossier est demandée, et seulement alors.
--
-- Les demandes sont posées en propriétaire, les dépôts essayés en tant que A ou B sous la RLS. Le
-- Storage interdit `delete from storage.objects` en SQL sans `storage.allow_delete_query` (voir 04).
-- Comme dans 01 : psql n'interpole pas `:a` dans une chaîne `$$ … $$`, d'où `format($$ … %L … $$, :'a')`.
begin;
select plan(9);

select tests.creer_utilisateur('a@test') as a \gset
select tests.creer_utilisateur('b@test') as b \gset
select entreprise_id as entreprise_a from membres where user_id = :'a' \gset
select entreprise_id as entreprise_b from membres where user_id = :'b' \gset

-- Sans demande de suppression, A dépose.
select tests.agir_comme(:'a');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/logo', :'a'),
  'sans demande de suppression, A dépose son logo');
reset role;

-- La suppression de l'entreprise de A est demandée : plus de dépôt chez A, sous aucun nom.
update public.entreprises set suppression_demandee_le = now() where id = :'entreprise_a';
select tests.agir_comme(:'a');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/autre', :'a'),
  '42501', null, 'suppression demandée : A ne dépose plus');

-- Le reste n'est pas touché : lire, renommer dans son dossier, supprimer.
select results_eq(
  $$ select name from storage.objects where bucket_id = 'fichiers' $$,
  format($$ values (%L) $$, :'entreprise_a' || '/logo'),
  'suppression demandée : A lit encore son logo');
select lives_ok(
  format($$ update storage.objects set name = %L where bucket_id = 'fichiers' $$, :'entreprise_a' || '/logo-renomme'),
  'suppression demandée : A renomme encore dans son dossier');
set local storage.allow_delete_query = 'true';
select lives_ok($$ delete from storage.objects where bucket_id = 'fichiers' $$, 'suppression demandée : A supprime encore ses fichiers');
reset storage.allow_delete_query;
select is_empty($$ select 1 from storage.objects where bucket_id = 'fichiers' $$, 'et ils sont partis');
reset role;

-- Une autre entreprise n'est pas concernée.
select tests.agir_comme(:'b');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_b' || '/logo', :'b'),
  'B, sans demande, dépose son logo');
reset role;

-- Une demande de plus de 30 jours refuse aussi (la purge n'a peut-être pas encore tourné).
update public.entreprises set suppression_demandee_le = now() - interval '31 days' where id = :'entreprise_a';
select tests.agir_comme(:'a');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/autre', :'a'),
  '42501', null, 'demande de 31 jours : A ne dépose pas non plus');
reset role;

-- Annulée, la demande ne bloque plus.
update public.entreprises set suppression_demandee_le = null where id = :'entreprise_a';
select tests.agir_comme(:'a');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/apres', :'a'),
  'suppression annulée : A dépose de nouveau');
reset role;

select * from finish();
rollback;
