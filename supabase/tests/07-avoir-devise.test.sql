-- Un avoir est dans la devise de la facture qu'il corrige
-- (supabase/migrations/20261104000900_avoir_meme_devise.sql) : la base refuse (`AVOIR_DEVISE`) un avoir
-- dont `facture_origine_id` désigne une facture d'une autre devise ; la vue de suivi, le contrôle des
-- paiements et le tableau de bord déduisent les avoirs de la facture citée, et ne mélangent ainsi
-- jamais les devises.
--
-- Les factures sont écrites comme les Edge Functions les écrivent : en `service_role`, puis en
-- propriétaire (le rôle des connexions directes de `emettre` et `importer`). Les numéros sont propres
-- à ce test, et chaque facture est retrouvée par son entreprise.
begin;
select plan(13);

select tests.creer_utilisateur('a@test') as a \gset
select entreprise_id as entreprise_a from membres where user_id = :'a' \gset

-- Une facture à écrire : (numéro, type, devise, TTC, numéro de la facture citée).
create function pg_temp.facture(numero text, type_code text, devise text, ttc bigint, citee text)
returns text
language sql
as $$ select format(
  $f$ insert into public.factures (entreprise_id, numero, type_code, date_emission, client_nom, devise,
                                   ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin,
                                   sdk_version, facture_origine_id, origine, emise_par)
      select m.entreprise_id, %L, %L, (now() at time zone 'Europe/Paris')::date, 'client', %L,
             %s, %s, %s, '{}', '{}', '{}', %L, '0.0.0',
             (select o.id from public.factures o
               where o.entreprise_id = m.entreprise_id and o.numero = %L),
             'emise', m.user_id
        from public.membres m where m.user_id = %L $f$,
  numero, type_code, devise, ttc * 10 / 12, ttc, ttc, numero || '.pdf', citee,
  current_setting('test.a')) $$;
select set_config('test.a', :'a', true);

-- ---------------------------------------------------------------------------------------------
-- La fonction et son déclencheur
-- ---------------------------------------------------------------------------------------------
select ok(
  (select not prosecdef and proconfig @> array['search_path=""']
     from pg_proc where oid = to_regprocedure('public.controler_avoir()')),
  'controler_avoir : droits de l''appelant, chemin de recherche vide');
select ok(
  exists (select 1 from pg_trigger
           where tgrelid = 'public.factures'::regclass and tgname = 'factures_avoir_devise'
             and tgfoid = to_regprocedure('public.controler_avoir()') and not tgisinternal),
  'le déclencheur est posé sur factures');
select ok(not has_function_privilege('authenticated', to_regprocedure('public.controler_avoir()'), 'execute'), 'authenticated n''appelle pas controler_avoir');
select ok(not has_function_privilege('anon', to_regprocedure('public.controler_avoir()'), 'execute'), 'anon n''appelle pas controler_avoir');
-- Comme le contrôle des paiements et la vue, il passe par `est_un_avoir` : la liste n'est pas récrite.
select ok(
  (select def like '%est_un_avoir%' and def not like '%''381''%'
     from pg_get_functiondef(to_regprocedure('public.controler_avoir()')) as def),
  'controler_avoir passe par est_un_avoir');

-- ---------------------------------------------------------------------------------------------
-- En service_role, comme une Edge Function par l'API
-- ---------------------------------------------------------------------------------------------
set local role service_role;
select lives_ok(pg_temp.facture('AD-F-EUR', '380', 'EUR', 12000, null), 'une facture en EUR');
select throws_ok(pg_temp.facture('AD-AV-USD', '381', 'USD', 1200, 'AD-F-EUR'),
  'P0001', 'AVOIR_DEVISE', 'un avoir en USD qui cite une facture en EUR est refusé');
select throws_ok(pg_temp.facture('AD-AV-396', '396', 'GBP', 1200, 'AD-F-EUR'),
  'P0001', 'AVOIR_DEVISE', 'quel que soit le code d''avoir (396)');
select lives_ok(pg_temp.facture('AD-AV-EUR', '381', 'EUR', 1200, 'AD-F-EUR'),
  'un avoir en EUR qui cite la même facture est accepté');
-- Une facture rectificative (384) cite la facture qu'elle corrige sans être un avoir : la vue ne la
-- déduit pas, la règle ne la vise pas.
select lives_ok(pg_temp.facture('AD-R-USD', '384', 'USD', 1200, 'AD-F-EUR'),
  'une rectificative dans une autre devise n''est pas visée');
-- Sans facture citée, rien à comparer.
select lives_ok(pg_temp.facture('AD-AV-SEUL', '381', 'USD', 1200, null),
  'un avoir sans facture citée, dans n''importe quelle devise');
reset role;

-- ---------------------------------------------------------------------------------------------
-- En propriétaire, comme `emettre` et `importer` sur leur connexion directe
-- ---------------------------------------------------------------------------------------------
select throws_ok(pg_temp.facture('AD-AV-CHF', '261', 'CHF', 1200, 'AD-F-EUR'),
  'P0001', 'AVOIR_DEVISE', 'en propriétaire aussi');

-- Seul l'avoir en EUR est rattaché ; le reste dû de la facture n'est diminué que de lui.
select tests.agir_comme(:'a');
select results_eq(
  $$ select numero, devise, avoirs::int, reste_du::int from suivi_factures
      where numero in ('AD-F-EUR', 'AD-R-USD') order by numero $$,
  $$ values ('AD-F-EUR', 'EUR', 1200, 10800), ('AD-R-USD', 'USD', 0, 1200) $$,
  'la vue : la facture en EUR n''est diminuée que de l''avoir en EUR');
reset role;

select * from finish();
rollback;
