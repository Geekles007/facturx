-- Stockage : buckets `factures`, `fichiers` et `polices`, et les règles de `storage.objects`
-- (supabase/migrations/20261104000400_stockage.sql).
--
-- Les objets sont posés en `service_role`, comme le font les Edge Functions et le script des polices,
-- puis relus et écrits sous la RLS : en tant que A, B, et sans session (rôle anon).
--
-- Trois précautions, tirées des tests d'isolation des tables :
--   - Pas de masquage par la règle de lecture. Un `update` ou un `delete` qui lit une colonne (`where`,
--     `set name = name || …`) passe aussi par la règle `select` : seul A y verrait ses lignes, même si la
--     règle d'écriture laissait tout passer. Chaque écriture est donc essayée aussi avec des constantes et
--     sans `where`, et les objets de B sont relus en `service_role` pour constater qu'ils sont intacts.
--   - Le dossier d'un objet n'est pas toujours un uuid : un objet `pas-un-uuid/…` ne doit gêner aucune
--     lecture (un cast en `uuid` lèverait 22P02 pour tous les comptes).
--   - Le Storage interdit `delete from storage.objects` en SQL sans `storage.allow_delete_query` (trigger
--     `protect_delete`, 42501 quelle que soit la RLS) : l'API Storage le pose, et les essais de
--     suppression le posent ici pour que seule la RLS décide.
-- Comme dans 01 : psql n'interpole pas `:a` dans une chaîne `$$ … $$`, d'où `format($$ … %L … $$, :'a')`.
begin;
select plan(58);

-- Hermétique : la base peut déjà contenir des objets, les polices que `pnpm compte:polices` y dépose
-- (dont `geist-regular.ttf`, nom que le test pose aussi) ou les PDF que laissent les tests de fonctions.
-- Les assertions globales (ce que lit `anon`, l'état final de la table) supposent que la table ne porte
-- que les objets du test : on la vide donc ici, dans la transaction, que le `rollback` final annule. Rien
-- n'est effacé pour de vrai (ni les lignes, ni les fichiers, que seule l'API Storage supprime). Plutôt que
-- de restreindre chaque assertion aux noms du test, ce qui les affaiblirait : « rien d'autre n'est lisible »
-- ou « rien n'a bougé » doit valoir pour toute la table. Le Storage interdit `delete from storage.objects`
-- sans `storage.allow_delete_query` (trigger `protect_delete`) : l'API le pose elle-même.
set local storage.allow_delete_query = 'true';
delete from storage.objects;
reset storage.allow_delete_query;

select tests.creer_utilisateur('a@test') as a \gset
select tests.creer_utilisateur('b@test') as b \gset
select entreprise_id as entreprise_a from membres where user_id = :'a' \gset
select entreprise_id as entreprise_b from membres where user_id = :'b' \gset

-- ---------------------------------------------------------------------------------------------
-- Buckets et règles (en propriétaire)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'factures' $$,
  $$ values ('factures', 'factures', false, null::bigint, null::text[]) $$,
  'bucket factures : privé, sans limite propre');
-- 2 Mo, en octets (2 × 1024 × 1024) ; les logos (1 Mo) et les polices (2 Mo) y sont contrôlés plus haut.
select results_eq(
  $$ select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'fichiers' $$,
  $$ values ('fichiers', 'fichiers', false, 2097152::bigint, array['image/png', 'image/jpeg', 'font/ttf']) $$,
  'bucket fichiers : privé, 2 Mo, PNG, JPEG et TTF');
select results_eq(
  $$ select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'polices' $$,
  $$ values ('polices', 'polices', true, null::bigint, null::text[]) $$,
  'bucket polices : public');
-- Toutes les règles de la table, pas seulement les nôtres : une règle d'écriture ajoutée à `factures` ou
-- à `polices`, ou une règle trop large, se verrait ici. Toutes sont permissives.
select set_eq(
  $$ select policyname, cmd, roles::text, permissive from pg_policies where schemaname = 'storage' and tablename = 'objects' $$,
  $$ values
       ('factures_lecture', 'SELECT', '{authenticated}', 'PERMISSIVE'),
       ('fichiers_lecture', 'SELECT', '{authenticated}', 'PERMISSIVE'),
       ('fichiers_ajout', 'INSERT', '{authenticated}', 'PERMISSIVE'),
       ('fichiers_modification', 'UPDATE', '{authenticated}', 'PERMISSIVE'),
       ('fichiers_suppression', 'DELETE', '{authenticated}', 'PERMISSIVE'),
       ('polices_lecture', 'SELECT', '{anon,authenticated}', 'PERMISSIVE') $$,
  'storage.objects : six règles, aucune écriture hors de fichiers');

-- ---------------------------------------------------------------------------------------------
-- Les objets (en service_role)
-- ---------------------------------------------------------------------------------------------
-- Dans `factures`, un PDF par entreprise, un objet dont le dossier n'est pas un uuid, un objet sans
-- dossier et un objet dont le dossier commence par l'uuid de A sans l'être (`{uuid}x`) ; dans `fichiers`, le logo de B et un objet dont le dossier n'est pas un uuid ; dans `polices`,
-- une police du Studio.
set local role service_role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name) values
  ('factures', :'entreprise_a' || '/fa.pdf'),
  ('factures', :'entreprise_b' || '/fb.pdf'),
  ('factures', 'pas-un-uuid/x.pdf'),
  ('factures', 'racine.pdf'),
  ('factures', :'entreprise_a' || 'x/y.pdf'),
  ('fichiers', :'entreprise_b' || '/logo'),
  ('fichiers', 'pas-un-uuid/logo'),
  ('polices', 'geist-regular.ttf');
reset role;

-- ---------------------------------------------------------------------------------------------
-- En tant que A
-- ---------------------------------------------------------------------------------------------
select tests.agir_comme(:'a');

-- Lecture. Les objets de B, celui dont le dossier n'est pas un uuid et celui sans dossier sont là, et la
-- lecture réussit quand même : la règle compare en texte.
select results_eq(
  $$ select bucket_id, name from storage.objects where bucket_id = 'factures' order by name $$,
  format($$ values ('factures', %L) $$, :'entreprise_a' || '/fa.pdf'),
  'factures : A lit son PDF, et celui-là seulement');
select is_empty(
  format($$ select 1 from storage.objects where bucket_id = 'factures' and name like %L $$, :'entreprise_b' || '/%'),
  'PDF de B invisibles');
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'factures' and name = 'pas-un-uuid/x.pdf' $$,
  'factures : un dossier qui n''est pas un uuid ne se lit pas');
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'factures' and name = 'racine.pdf' $$,
  'factures : un objet sans dossier ne se lit pas');
select results_eq(
  $$ select count(*) from storage.objects where bucket_id = 'fichiers' $$,
  $$ values (0::bigint) $$,
  'fichiers : A n''en a aucun, et ne voit ni ceux de B ni celui sans uuid');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'polices' $$,
  $$ values ('geist-regular.ttf') $$,
  'polices : A les lit');

-- Écriture dans `factures` : aucune, ni chez soi ni chez B (les PDF sont déposés par les Edge Functions).
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('factures', %L, %L) $$, :'entreprise_a' || '/x.pdf', :'a'),
  '42501', null, 'factures : A ne dépose pas de PDF chez lui');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('factures', %L, %L) $$, :'entreprise_b' || '/x.pdf', :'a'),
  '42501', null, 'factures : ni chez B');
-- Ni erreur ni effet pour `update` et `delete` : pas de règle, donc aucune ligne ne peut être touchée
-- (relu en service_role plus bas). Des constantes et pas de `where`, pour que la règle `select` ne
-- masque rien. Dans `fichiers` (A n'y a rien), `polices` et `factures` : rien ne change.
select lives_ok($$ update storage.objects set metadata = '{"pirate":true}'::jsonb $$, 'update sans where : sans effet hors de fichiers');
select lives_ok($$ update storage.objects set name = 'pirate/' || name where bucket_id = 'factures' $$, 'factures : renommer un PDF, sans effet');
select lives_ok($$ update storage.objects set bucket_id = 'fichiers' where bucket_id = 'factures' $$, 'factures : changer de bucket, sans effet');
set local storage.allow_delete_query = 'true';
select lives_ok($$ delete from storage.objects where bucket_id = 'factures' $$, 'factures : supprimer un PDF, sans effet');
select lives_ok($$ delete from storage.objects where bucket_id = 'polices' $$, 'polices : supprimer une police, sans effet');
select lives_ok($$ delete from storage.objects $$, 'delete sans where : sans effet hors de fichiers');
reset storage.allow_delete_query;

-- `polices` : A n'y écrit pas non plus.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('polices', 'pirate.ttf') $$,
  '42501', null, 'polices : A ne dépose pas de police');

-- `fichiers` : le logo de A, chez lui seulement.
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/logo', :'a'),
  'fichiers : A dépose son logo');
-- `eb/logo` et `pas-un-uuid/logo` existent déjà : l'unicité ne répond pas à la place de la règle, ce qui
-- dirait à A si un nom existe chez B.
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_b' || '/logo', :'a'),
  '42501', null, 'fichiers : pas de dépôt chez B, même sous un nom qui y existe');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_b' || '/nouveau', :'a'),
  '42501', null, 'fichiers : ni sous un nom neuf');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', 'pas-un-uuid/logo', %L) $$, :'a'),
  '42501', null, 'fichiers : pas de dépôt sous un dossier qui n''est pas un uuid');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', 'logo', %L) $$, :'a'),
  '42501', null, 'fichiers : pas de dépôt sans dossier');
-- Le dossier est l'uuid en entier, pas un préfixe.
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || 'x/logo', :'a'),
  '42501', null, 'fichiers : pas de dépôt sous un dossier qui n''a que l''uuid pour préfixe');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'fichiers' order by name $$,
  format($$ values (%L) $$, :'entreprise_a' || '/logo'),
  'fichiers : A lit son logo, et celui-là seulement');

-- Modifier. D'abord ce que la fiche demande (avec `where` et lecture de `name`), puis des constantes sans
-- `where` : la règle d'écriture, seule, doit s'arrêter aux objets de A. Les objets de B sont relus en
-- service_role plus bas.
select lives_ok($$ update storage.objects set name = name || '-x' where bucket_id = 'fichiers' $$, 'fichiers : renommer, sans filtre sur le dossier');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'fichiers' order by name $$,
  format($$ values (%L) $$, :'entreprise_a' || '/logo-x'),
  'fichiers : seul le logo de A a été renommé');
select lives_ok($$ update storage.objects set metadata = '{"modifie":true}'::jsonb $$, 'fichiers : update de constantes sans where');
select results_eq(
  $$ select name, metadata ->> 'modifie' from storage.objects where bucket_id = 'fichiers' order by name $$,
  format($$ values (%L, 'true') $$, :'entreprise_a' || '/logo-x'),
  'fichiers : seul A a été touché');
-- Un renommage dans son propre dossier passe ; vers le dossier de B, vers un dossier qui n'est pas un
-- uuid, ou sans dossier, non (`with check`, sans `where`).
select lives_ok(
  format($$ update storage.objects set name = %L $$, :'entreprise_a' || '/logo'),
  'fichiers : renommer dans son dossier');
select throws_ok(
  format($$ update storage.objects set name = %L $$, :'entreprise_b' || '/vole'),
  '42501', null, 'fichiers : déplacer vers le dossier de B, refusé');
select throws_ok(
  format($$ update storage.objects set name = %L where name = %L $$, :'entreprise_b' || '/vole', :'entreprise_a' || '/logo'),
  '42501', null, 'fichiers : déplacer vers le dossier de B, refusé avec un where aussi');
select throws_ok($$ update storage.objects set name = 'pas-un-uuid/vole' $$, '42501', null, 'fichiers : déplacer vers un dossier qui n''est pas un uuid, refusé');
select throws_ok($$ update storage.objects set name = 'vole' $$, '42501', null, 'fichiers : déplacer hors de tout dossier, refusé');
select throws_ok(
  format($$ update storage.objects set name = %L $$, :'entreprise_a' || 'x/vole'),
  '42501', null, 'fichiers : déplacer vers un dossier qui n''a que l''uuid pour préfixe, refusé');
-- Un fichier de A ne passe ni dans `factures` (un PDF qui ressemblerait à une facture émise) ni dans
-- `polices` (public).
select throws_ok($$ update storage.objects set bucket_id = 'factures' $$, '42501', null, 'fichiers : passer dans factures, refusé');
select throws_ok($$ update storage.objects set bucket_id = 'polices' $$, '42501', null, 'fichiers : passer dans polices, refusé');

-- Supprimer : avec `where bucket_id = …` (la règle `select` s'applique aussi), puis sans `where`.
set local storage.allow_delete_query = 'true';
select lives_ok($$ delete from storage.objects where bucket_id = 'fichiers' $$, 'fichiers : supprimer, sans filtre sur le dossier');
select is_empty($$ select 1 from storage.objects where bucket_id = 'fichiers' $$, 'fichiers : le logo de A est supprimé');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/logo', :'a'),
  'fichiers : A dépose de nouveau son logo');
select lives_ok($$ delete from storage.objects $$, 'fichiers : supprimer sans where');
select is_empty($$ select 1 from storage.objects where bucket_id = 'fichiers' $$, 'fichiers : le logo de A est de nouveau supprimé');
reset storage.allow_delete_query;
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', %L, %L) $$, :'entreprise_a' || '/logo', :'a'),
  'fichiers : A dépose une dernière fois son logo');

-- ---------------------------------------------------------------------------------------------
-- Sans session (rôle anon)
-- ---------------------------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$ select name from storage.objects $$,
  $$ values ('geist-regular.ttf') $$,
  'anon : les polices, rien d''autre');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('factures', %L) $$, :'entreprise_a' || '/x.pdf'),
  '42501', null, 'anon : pas de PDF');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('fichiers', %L) $$, :'entreprise_a' || '/x'),
  '42501', null, 'anon : pas de fichier');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('polices', 'pirate.ttf') $$,
  '42501', null, 'anon : pas de police');
select lives_ok($$ update storage.objects set metadata = '{"pirate":true}'::jsonb $$, 'anon : update sans where, sans effet');
select lives_ok($$ update storage.objects set name = 'pirate.ttf' where bucket_id = 'polices' $$, 'anon : renommer une police, sans effet');
set local storage.allow_delete_query = 'true';
select lives_ok($$ delete from storage.objects $$, 'anon : delete sans where, sans effet');
reset storage.allow_delete_query;

-- ---------------------------------------------------------------------------------------------
-- Relu en service_role : rien n'a bougé, hors du logo de A
-- ---------------------------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '', true);
-- Sans ordre : `ea` et `eb` sont des uuid, dont l'ordre n'est pas connu d'avance.
select set_eq(
  $$ select bucket_id, name, metadata is null from storage.objects $$,
  format($$ values
    ('factures', %L, true),
    ('factures', %L, true),
    ('factures', 'pas-un-uuid/x.pdf', true),
    ('factures', 'racine.pdf', true),
    ('factures', %L, true),
    ('fichiers', %L, true),
    ('fichiers', %L, true),
    ('fichiers', 'pas-un-uuid/logo', true),
    ('polices', 'geist-regular.ttf', true) $$,
    :'entreprise_a' || '/fa.pdf', :'entreprise_b' || '/fb.pdf', :'entreprise_a' || 'x/y.pdf',
    :'entreprise_a' || '/logo', :'entreprise_b' || '/logo'),
  'les objets de B, des polices et des PDF sont intacts ; A n''a que son logo');
reset role;

-- ---------------------------------------------------------------------------------------------
-- En tant que B
-- ---------------------------------------------------------------------------------------------
select tests.agir_comme(:'b');
select results_eq(
  $$ select bucket_id, name from storage.objects where bucket_id <> 'polices' order by bucket_id, name $$,
  format($$ values ('factures', %L), ('fichiers', %L) $$, :'entreprise_b' || '/fb.pdf', :'entreprise_b' || '/logo'),
  'B : son PDF et son logo, sans ceux de A ni les objets au dossier sans uuid');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('fichiers', %L) $$, :'entreprise_a' || '/vole'),
  '42501', null, 'B : pas de dépôt chez A');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('fichiers', %L) $$, :'entreprise_b' || '/police.ttf'),
  'B : dépose une police chez lui');

-- ---------------------------------------------------------------------------------------------
-- Un compte membre de deux entreprises voit les deux
-- ---------------------------------------------------------------------------------------------
reset role;
insert into membres (entreprise_id, user_id, cgu_version) values (:'entreprise_b', :'a', '2026-11');
select tests.agir_comme(:'a');
select set_eq(
  $$ select name from storage.objects where bucket_id = 'factures' $$,
  format($$ values (%L), (%L) $$, :'entreprise_a' || '/fa.pdf', :'entreprise_b' || '/fb.pdf'),
  'factures : membre de deux entreprises, A lit les PDF des deux');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('fichiers', %L) $$, :'entreprise_b' || '/de-a.png'),
  'fichiers : ... dépose chez l''une comme chez l''autre');
select set_eq(
  $$ select name from storage.objects where bucket_id = 'fichiers' $$,
  format($$ values (%L), (%L), (%L), (%L) $$,
    :'entreprise_a' || '/logo', :'entreprise_b' || '/logo', :'entreprise_b' || '/police.ttf', :'entreprise_b' || '/de-a.png'),
  'fichiers : ... et lit les fichiers des deux');
reset role;

select * from finish();
rollback;
