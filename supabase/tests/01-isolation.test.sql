-- Isolation entre entreprises : ce que la RLS, les privilèges de colonne et le déclencheur
-- d'inscription garantissent (supabase/migrations/20261104000100_schema.sql).
--
-- psql n'interpole pas `:a` dans une chaîne `$$ … $$` : les requêtes qui portent un identifiant
-- s'écrivent `format($$ … %L … $$, :'a')`.
begin;
select plan(55);

-- Deux comptes, A et B, chacun avec son entreprise (créée par le déclencheur d'inscription).
select tests.creer_utilisateur('a@test') as a \gset
select tests.creer_utilisateur('b@test') as b \gset
select entreprise_id as entreprise_a from membres where user_id = :'a' \gset
select entreprise_id as entreprise_b from membres where user_id = :'b' \gset

-- Une ligne par table et par entreprise, posée par le propriétaire de la base, que la RLS ne
-- retient pas. Si la RLS était désactivée, A verrait celles de B.
insert into clients (id, entreprise_id, party, nom) values
  ('ca', :'entreprise_a', '{}', 'client A'),
  ('cb', :'entreprise_b', '{}', 'client B');
insert into produits (id, entreprise_id, fiche, nom) values
  ('pa', :'entreprise_a', '{}', 'produit A'),
  ('pb', :'entreprise_b', '{}', 'produit B');
insert into brouillons (entreprise_id, form, appearance) values
  (:'entreprise_a', '{}', '{}'),
  (:'entreprise_b', '{}', '{}');
insert into factures (id, entreprise_id, numero, type_code, date_emission, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      origine, emise_par) values
  ('00000000-0000-0000-0000-00000000fa01', :'entreprise_a', 'F-2026-0001', '380', '2026-11-01',
   'client A', 'EUR', 10000, 12000, 12000, '{}', '{}', '{}', 'a.pdf', '0.0.0', 'emise', :'a'),
  ('00000000-0000-0000-0000-00000000fb01', :'entreprise_b', 'F-2026-0001', '380', '2026-11-01',
   'client B', 'EUR', 10000, 12000, 12000, '{}', '{}', '{}', 'b.pdf', '0.0.0', 'emise', :'b');
insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par) values
  (:'entreprise_a', '00000000-0000-0000-0000-00000000fa01', '2026-11-02', 5000, 'virement', :'a'),
  (:'entreprise_b', '00000000-0000-0000-0000-00000000fb01', '2026-11-02', 5000, 'virement', :'b');
insert into relances (entreprise_id, facture_id, niveau, destinataire, objet, corps, etat) values
  (:'entreprise_a', '00000000-0000-0000-0000-00000000fa01', 1, 'a@client.test', 'o', 'c', 'envoyee'),
  (:'entreprise_b', '00000000-0000-0000-0000-00000000fb01', 1, 'b@client.test', 'o', 'c', 'envoyee');

-- ---------------------------------------------------------------------------------------------
-- Inscription (en propriétaire)
-- ---------------------------------------------------------------------------------------------
select isnt_empty(
  format($$ select 1 from entreprises e join membres m on m.entreprise_id = e.id where m.user_id = %L $$, :'a'),
  'inscription : entreprise créée');
select results_eq(
  format($$ select role, cgu_version from membres where user_id = %L $$, :'a'),
  $$ values ('titulaire', '2026-11') $$,
  'inscription : membre titulaire, version des CGU conservée');
select results_eq(
  format($$ select gabarit, prochain, annuelle from numerotation where entreprise_id = (select entreprise_id from membres where user_id = %L) $$, :'a'),
  $$ values ('F-{AAAA}-{NNNN}', 1, true) $$,
  'numérotation par défaut');
select is(
  (select annee from numerotation where entreprise_id = :'entreprise_a'),
  extract(year from now() at time zone 'Europe/Paris')::int,
  'numérotation : l''année courante est celle de Paris');
select results_eq(
  format($$ select profil #>> '{defaults,vat}', profil #>> '{seller,address,countryCode}', jsonb_array_length(profil -> 'paymentMeans') from entreprises where id = %L $$, :'entreprise_a'),
  $$ values ('S:20', 'FR', 1) $$,
  'profil de départ : celui de defaultCompany()');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'x@test', '{}') $$, 'P0001', 'CGU_ABSENTES');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'x@test', '{"cgu":""}') $$, 'P0001', 'CGU_ABSENTES', 'CGU vides : inscription refusée');

-- ---------------------------------------------------------------------------------------------
-- En tant que A
-- ---------------------------------------------------------------------------------------------
select tests.agir_comme(:'a');
select is((select auth.uid()), :'a'::uuid, 'auth.uid() est A');
select results_eq(
  $$ select * from mes_entreprises() $$,
  format($$ values (%L::uuid) $$, :'entreprise_a'),
  'mes_entreprises() : celle de A seulement');
select results_eq(
  $$ select (select count(*) from entreprises), (select count(*) from membres), (select count(*) from clients), (select count(*) from produits), (select count(*) from brouillons), (select count(*) from numerotation), (select count(*) from factures), (select count(*) from paiements), (select count(*) from relances) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint) $$,
  'A voit ses lignes, une par table, et celles-là seulement');

-- Ne voit rien de B, table par table.
select is_empty(format($$ select 1 from entreprises where id = %L $$, :'entreprise_b'), 'entreprise de B invisible');
select is_empty(format($$ select 1 from membres where entreprise_id = %L $$, :'entreprise_b'), 'membres de B invisibles');
select is_empty(format($$ select 1 from clients where entreprise_id = %L $$, :'entreprise_b'), 'clients de B invisibles');
select is_empty(format($$ select 1 from produits where entreprise_id = %L $$, :'entreprise_b'), 'produits de B invisibles');
select is_empty(format($$ select 1 from brouillons where entreprise_id = %L $$, :'entreprise_b'), 'brouillons de B invisibles');
select is_empty(format($$ select 1 from numerotation where entreprise_id = %L $$, :'entreprise_b'), 'numérotation de B invisible');
select is_empty(format($$ select 1 from factures where entreprise_id = %L $$, :'entreprise_b'), 'factures de B invisibles');
select is_empty(format($$ select 1 from paiements where entreprise_id = %L $$, :'entreprise_b'), 'paiements de B invisibles');
select is_empty(format($$ select 1 from relances where entreprise_id = %L $$, :'entreprise_b'), 'relances de B invisibles');

-- Écrit chez B : refusé, ou sans effet.
select throws_ok(format($$ insert into clients (id, entreprise_id, party, nom) values ('c1', %L, '{}', 'x') $$, :'entreprise_b'), '42501');
select throws_ok(format($$ insert into produits (id, entreprise_id, fiche, nom) values ('p1', %L, '{}', 'x') $$, :'entreprise_b'), '42501', null, 'produit chez B refusé');
select throws_ok(format($$ insert into brouillons (entreprise_id, form) values (%L, '{}') $$, :'entreprise_b'), '42501', null, 'brouillon chez B refusé');
select throws_ok(format($$ insert into membres (entreprise_id, user_id, cgu_version) values (%L, %L, '2026-11') $$, :'entreprise_b', :'a'), '42501', null, 'A ne se fait pas membre de B');
-- Ni erreur ni effet : la ligne de B n'est pas visible de A (vérifié en propriétaire, plus bas).
select lives_ok($$ update clients set nom = 'pirate' where id = 'cb' $$, 'modifier un client de B : sans effet');
select lives_ok($$ delete from clients where id = 'cb' $$, 'supprimer un client de B : sans effet');
select throws_ok(format($$ update clients set entreprise_id = %L where id = 'ca' $$, :'entreprise_b'), '42501', null, 'passer un client de A chez B : refusé');

-- Écrit chez A : permis, là où la fiche le permet.
select lives_ok(format($$ insert into clients (id, entreprise_id, party, nom) values ('c2', %L, '{}', 'nouveau') $$, :'entreprise_a'), 'client de A : insert');
select lives_ok($$ update clients set nom = 'client A modifié' where id = 'ca' $$, 'client de A : update');
select lives_ok($$ delete from clients where id = 'c2' $$, 'client de A : delete');
select lives_ok(format($$ insert into produits (id, entreprise_id, fiche, nom) values ('p2', %L, '{}', 'nouveau') $$, :'entreprise_a'), 'produit de A : insert');
select lives_ok(format($$ insert into brouillons (entreprise_id, form) values (%L, '{}') $$, :'entreprise_a'), 'brouillon de A : insert');

-- entreprises : seules `profil` et `apparence_defaut` se modifient, et seulement chez soi.
select throws_ok($$ update entreprises set suppression_demandee_le = now() $$, '42501');
-- Sans `where` : la RLS limite la mise à jour à l'entreprise de A (vérifié plus bas).
select lives_ok($$ update entreprises set profil = profil, apparence_defaut = '{"modifie":true}' $$, 'entreprises : profil et apparence_defaut modifiables');
select throws_ok($$ delete from entreprises $$, '42501', null, 'entreprises : aucune suppression');
select throws_ok($$ insert into entreprises (profil) values ('{}') $$, '42501', null, 'entreprises : aucune création');

-- numerotation : modifiable chez soi, sans création ni suppression.
select lives_ok($$ update numerotation set gabarit = 'X-{NNNN}' $$, 'numérotation : modifiable');
select throws_ok($$ delete from numerotation $$, '42501', null, 'numérotation : aucune suppression');

-- factures et relances : aucune écriture depuis le navigateur.
select throws_ok(format($$ insert into factures (entreprise_id) values (%L) $$, :'entreprise_a'), '42501');
select throws_ok($$ update factures set client_nom = 'x' $$, '42501', null, 'factures : aucune modification');
select throws_ok($$ delete from factures $$, '42501', null, 'factures : aucune suppression');
select throws_ok($$ insert into relances (entreprise_id, facture_id, niveau, destinataire, objet, corps, etat) values (gen_random_uuid(), gen_random_uuid(), 1, 'x', 'x', 'x', 'envoyee') $$, '42501', null, 'relances : aucune écriture');

-- Sans session (rôle anon), aucune table ne se lit.
reset role;
set local role anon;
select throws_ok($$ select 1 from clients $$, '42501', null, 'anon : clients illisibles');
select throws_ok($$ select 1 from factures $$, '42501', null, 'anon : factures illisibles');

-- ---------------------------------------------------------------------------------------------
-- Retour en propriétaire : les écritures de A et B n'ont rien touché chez l'autre ; fonctions ; cascades
-- ---------------------------------------------------------------------------------------------
reset role;
select is((select nom from clients where id = 'cb'), 'client B', 'le client de B est intact (ni modifié, ni supprimé)');
select is((select apparence_defaut from entreprises where id = :'entreprise_a'), '{"modifie":true}'::jsonb, 'l''apparence par défaut de A a changé');
select is((select apparence_defaut from entreprises where id = :'entreprise_b'), null, 'celle de B est intacte');
select is((select gabarit from numerotation where entreprise_id = :'entreprise_a'), 'X-{NNNN}', 'le gabarit de A a changé');
select is((select gabarit from numerotation where entreprise_id = :'entreprise_b'), 'F-{AAAA}-{NNNN}', 'celui de B est intact');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or has_table_privilege('authenticated', c.oid, 'truncate, references, trigger'))),
  0::bigint,
  'aucune table n''est ouverte à anon, ni à authenticated en TRUNCATE, REFERENCES et TRIGGER');
-- security definer (true), volatilité (s = stable), chemin de recherche.
select is(
  (select p.prosecdef::text || ' ' || p.provolatile::text || ' ' || coalesce(p.proconfig[1], '-')
     from pg_proc p where p.oid = 'public.mes_entreprises()'::regprocedure),
  'true s search_path=""',
  'mes_entreprises() : security definer, stable, search_path vide');
select is(
  (select p.prosecdef::text || ' ' || coalesce(p.proconfig[1], '-')
     from pg_proc p where p.oid = 'public.creer_entreprise_a_l_inscription()'::regprocedure),
  'true search_path=""',
  'déclencheur d''inscription : security definer, search_path vide');
select is(has_function_privilege('anon', 'public.mes_entreprises()', 'execute'), false, 'mes_entreprises() : fermée à anon');
select is(has_function_privilege('authenticated', 'public.creer_entreprise_a_l_inscription()', 'execute'), false, 'déclencheur d''inscription : inappelable par un compte');

delete from auth.users where id = :'b';
select is_empty(format($$ select 1 from membres where user_id = %L $$, :'b'), 'supprimer le compte efface son appartenance');
delete from entreprises where id = :'entreprise_b';
select is(
  (select count(*) from (
     select entreprise_id from membres union all select entreprise_id from clients
     union all select entreprise_id from produits union all select entreprise_id from brouillons
     union all select entreprise_id from numerotation union all select entreprise_id from factures
     union all select entreprise_id from paiements union all select entreprise_id from relances
   ) t where entreprise_id = :'entreprise_b'),
  0::bigint,
  'supprimer l''entreprise efface ses lignes dans toutes les tables');

select * from finish();
rollback;
