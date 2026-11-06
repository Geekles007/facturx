-- Suivi des paiements, tableau de bord et indicateurs (supabase/migrations/20261104000300_suivi.sql).
--
-- Les dates sont relatives à J, « aujourd'hui » à Paris, que `pg_temp.j(n)` donne (J + n) : le test ne
-- dépend pas du jour où il tourne. Les montants sont en centimes ; HT et TTC sont ceux de la fiche, et le
-- net à payer vaut le TTC (sauf S-1 et AV-262, plus bas).
--
-- Les factures sont posées en `service_role`, comme les Edge Functions, puis relues sous la RLS : la vue
-- et le tableau de bord se lisent en tant que A, B, C ou D, jamais en propriétaire, qui verrait tout.
--   - A : la fiche (F-1 à F-7, l'avoir A-1) ;
--   - B : une autre entreprise, qui a des factures, un paiement et un retard dans la même période ;
--   - C : un avoir de chaque code, les cas de priorité entre statuts, les bornes d'une période ;
--   - D : un compte sans aucune facture ;
--   - E1 à E4 : les dates de création, d'émission et de relance des indicateurs, en mars 2001.
-- Comme dans 01 et 02 : psql n'interpole pas `:a` dans une chaîne `$$ … $$`, d'où
-- `format($$ … %L … $$, :'a')`.
begin;
select plan(73);

-- J + n. Dans une fonction temporaire plutôt qu'en variable psql : les requêtes `$$ … $$` ne reçoivent
-- aucune interpolation, et celle-ci tourne sous n'importe quel rôle.
create function pg_temp.j(n int default 0) returns date
language sql stable
as $$ select (now() at time zone 'Europe/Paris')::date + n $$;

-- Les indicateurs du mois en cours avant toute donnée de ce test : une base locale peut en contenir
-- d'autres, et la fin du test compare par différence.
select comptes_crees as avant_crees, comptes_actifs as avant_actifs, factures_emises as avant_emises,
       relances_envoyees as avant_relances
  from indicateurs(date_trunc('month', pg_temp.j()::timestamp)::date) \gset

select tests.creer_utilisateur('a@test') as a,
       tests.creer_utilisateur('b@test') as b,
       tests.creer_utilisateur('c@test') as c,
       tests.creer_utilisateur('d@test') as d,
       tests.creer_utilisateur('e1@test') as e1,
       tests.creer_utilisateur('e2@test') as e2,
       tests.creer_utilisateur('e3@test') as e3,
       tests.creer_utilisateur('e4@test') as e4 \gset
select (select entreprise_id from membres where user_id = :'a') as entreprise_a,
       (select entreprise_id from membres where user_id = :'b') as entreprise_b,
       (select entreprise_id from membres where user_id = :'c') as entreprise_c,
       (select entreprise_id from membres where user_id = :'e1') as entreprise_e1,
       (select entreprise_id from membres where user_id = :'e2') as entreprise_e2,
       (select entreprise_id from membres where user_id = :'e3') as entreprise_e3,
       (select entreprise_id from membres where user_id = :'e4') as entreprise_e4 \gset

-- ---------------------------------------------------------------------------------------------
-- Les factures (service_role)
-- ---------------------------------------------------------------------------------------------

-- Une ligne par facture : (entreprise, compte, numéro, type, émission en jours depuis J, échéance en
-- jours depuis J, HT, TTC, numéro de la facture citée, net à payer). Les avoirs et les factures qui en
-- citent une sont posés après leurs cibles.
--   F-5 est payée, puis créditée : dans l'autre ordre, le déclencheur de paiement la refuserait ;
--   F-3 est en retard de 30 jours, F-6 n'a pas d'échéance ;
--   AV-381 à AV-396 : un avoir de chaque code, chacun sur sa facture C-1 à C-4 (C-1 en a deux) ;
--   R-1 : une facture rectificative (384) qui cite C-4, et n'est pas un avoir ;
--   P-1 à P-5 : en retard avec un acompte ; échéance aujourd'hui ; en retard mais soldée ; en retard mais
--   créditée au-delà du dû (AV-P4) ; en retard mais soldée par un avoir (AV-P5) ;
--   P-6 et P-7 : à un centime près, de part et d'autre de zéro (créditée de 1 de trop, payée à 1 près) ;
--   P-8 et P-9 : un reste positif après un avoir, sans que l'avoir ne change le statut : non échue avec un
--   paiement (payee_en_partie), échue sans paiement (en_retard, avec ses jours de retard) ;
--   S-1 : une facture de solde, dont le net à payer (9 000) est celui du TTC (12 000) moins un acompte
--   déjà versé : c'est le net à payer qui compte ; AV-262 a de même un net à payer sans rapport avec son
--   TTC (300) : c'est le TTC d'un avoir qui se déduit.
-- Le net à payer est le TTC, sauf quand la colonne `net` le donne.
create temp table fx (
  entreprise uuid, compte uuid, numero text, type_code text, emission int, echeance int,
  ht bigint, ttc bigint, citee text, net bigint
);
insert into fx values
  (:'entreprise_a', :'a', 'F-1', '380', -1, 10, 10000, 12000, null),
  (:'entreprise_a', :'a', 'F-2', '380', -1, 10, 10000, 12000, null),
  (:'entreprise_a', :'a', 'F-3', '380', -100, -30, 10000, 12000, null),
  (:'entreprise_a', :'a', 'F-4', '380', -1, 10, 5000, 6000, null),
  (:'entreprise_a', :'a', 'F-5', '380', -1, 10, 5000, 6000, null),
  (:'entreprise_a', :'a', 'F-6', '380', -300, null, 1000, 1200, null),
  (:'entreprise_a', :'a', 'F-7', '386', -1, 10, 2000, 2400, null),
  (:'entreprise_a', :'a', 'A-1', '381', -1, null, 1000, 1200, 'F-5'),
  (:'entreprise_b', :'b', 'FB-1', '380', -1, 10, 7000, 8400, null),
  (:'entreprise_b', :'b', 'FB-2', '380', -100, -30, 4000, 4800, null),
  (:'entreprise_c', :'c', 'C-1', '380', -1, 10, 10000, 12000, null),
  (:'entreprise_c', :'c', 'C-2', '380', -1, 10, 5000, 6000, null),
  (:'entreprise_c', :'c', 'C-3', '380', -1, 10, 2500, 3000, null),
  (:'entreprise_c', :'c', 'C-4', '380', -1, 10, 1000, 1200, null),
  (:'entreprise_c', :'c', 'AV-381', '381', -1, null, 1000, 1200, 'C-1'),
  (:'entreprise_c', :'c', 'AV-381b', '381', -1, null, 200, 240, 'C-1'),
  (:'entreprise_c', :'c', 'AV-261', '261', -1, null, 500, 600, 'C-2'),
  (:'entreprise_c', :'c', 'AV-396', '396', -1, null, 100, 120, 'C-4'),
  (:'entreprise_c', :'c', 'R-1', '384', -1, 10, 100, 120, 'C-4'),
  (:'entreprise_c', :'c', 'P-1', '380', -60, -1, 1000, 1200, null),
  (:'entreprise_c', :'c', 'P-2', '380', -60, 0, 1000, 1200, null),
  (:'entreprise_c', :'c', 'P-3', '380', -60, -5, 1000, 1200, null),
  (:'entreprise_c', :'c', 'P-4', '380', -60, -5, 5000, 6000, null),
  (:'entreprise_c', :'c', 'P-5', '380', -60, -5, 3000, 3600, null),
  (:'entreprise_c', :'c', 'AV-P4', '381', -59, null, 334, 400, 'P-4'),
  (:'entreprise_c', :'c', 'AV-P5', '381', -59, null, 3000, 3600, 'P-5'),
  (:'entreprise_c', :'c', 'P-6', '380', -200, 10, 100, 120, null),
  (:'entreprise_c', :'c', 'P-7', '380', -200, 10, 100, 120, null),
  (:'entreprise_c', :'c', 'AV-P6', '381', -199, null, 1, 1, 'P-6'),
  (:'entreprise_c', :'c', 'P-8', '380', -150, 10, 8334, 10000, null),
  (:'entreprise_c', :'c', 'AV-P8', '381', -149, null, 1667, 2000, 'P-8'),
  (:'entreprise_c', :'c', 'P-9', '380', -150, -10, 5000, 6000, null),
  (:'entreprise_c', :'c', 'AV-P9', '381', -149, null, 834, 1000, 'P-9');
insert into fx (entreprise, compte, numero, type_code, emission, echeance, ht, ttc, citee, net) values
  (:'entreprise_c', :'c', 'S-1', '380', -200, 10, 10000, 12000, null, 9000),
  (:'entreprise_c', :'c', 'AV-262', '262', -1, null, 250, 300, 'C-3', 0);
grant select on fx to service_role;

set local role service_role;
insert into factures (entreprise_id, numero, type_code, date_emission, date_echeance, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      origine, emise_par)
select x.entreprise, x.numero, x.type_code, pg_temp.j(x.emission), pg_temp.j(x.echeance),
       'client ' || x.numero, 'EUR', x.ht, x.ttc, coalesce(x.net, x.ttc), '{}', '{}', '{}',
       x.numero || '.pdf', '0.0.0', 'emise', x.compte
  from fx x
 where x.citee is null;

-- Les paiements (date en jours depuis J) : le déclencheur de paiement (…000200_regles.sql) les contrôle
-- comme ceux d'un compte. Celui de F-1 est annulé aussitôt : ni la vue ni le tableau de bord ne le comptent.
insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par)
select f.entreprise_id, f.id, pg_temp.j(v.jour), v.montant, 'virement', f.emise_par
  from (values
    ('F-1', -1, 3000), ('F-2', -1, 5000), ('F-4', -1, 6000), ('F-5', -1, 6000), ('F-7', -1, 2400),
    ('FB-1', -1, 1000),
    ('P-1', -30, 500), ('P-3', -30, 1200), ('P-4', -30, 6000),
    ('P-6', -200, 120), ('P-7', -200, 119), ('P-8', -150, 3000)
  ) as v(numero, jour, montant)
  join factures f on f.numero = v.numero;
update paiements set annule_le = now() where facture_id = (select id from factures where numero = 'F-1');

insert into factures (entreprise_id, numero, type_code, date_emission, date_echeance, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      facture_origine_id, origine, emise_par)
select x.entreprise, x.numero, x.type_code, pg_temp.j(x.emission), pg_temp.j(x.echeance),
       'client ' || x.numero, 'EUR', x.ht, x.ttc, coalesce(x.net, x.ttc), '{}', '{}', '{}',
       x.numero || '.pdf', '0.0.0', o.id, 'emise', x.compte
  from fx x
  join factures o on o.entreprise_id = x.entreprise and o.numero = x.citee;

-- Les indicateurs de mars 2001 (aucune autre donnée n'y touche). Le mois est celui de Paris, borne
-- de début incluse et borne de fin exclue : 2001-02-28 23:00 UTC est le 1er mars à minuit à Paris (heure
-- d'hiver), 2001-03-31 22:00 UTC le 1er avril à minuit (heure d'été). Pour l'UTC, ces deux instants
-- tomberaient dans février et dans mars.
--   E1 : créée le 15 mars ; X-1 et l'avoir X-2 émis en mars, trois relances de X-1 ;
--   E2 : créée à minuit pile le 1er mars ; en mars, une facture seulement importée, et la première émise
--        tombe à minuit pile le 1er avril : créée en mars, inactive en mars, active en avril ;
--   E3 : créée en février ; Z-0 émise une seconde avant le 1er mars (février), Z-1 à minuit pile
--        (mars) ; la relance de Z-1 a la même heure ;
--   E4 : créée à minuit pile le 1er avril ; rien d'autre.
-- Parmi les relances de X-1 : une envoyée le 11 mars, une refusée le 12, une envoyée à minuit pile le
-- 1er avril (hors mars).
update entreprises set cree_le = v.cree_le
  from (values
    (:'entreprise_e1'::uuid, '2001-03-15 12:00+00'::timestamptz),
    (:'entreprise_e2'::uuid, '2001-02-28 23:00+00'::timestamptz),
    (:'entreprise_e3'::uuid, '2001-02-10 12:00+00'::timestamptz),
    (:'entreprise_e4'::uuid, '2001-03-31 22:00+00'::timestamptz)
  ) as v(id, cree_le)
 where entreprises.id = v.id;
insert into factures (entreprise_id, numero, type_code, date_emission, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      origine, emise_par, emise_le)
select v.entreprise, v.numero, '380', (v.emise_le at time zone 'Europe/Paris')::date, 'client', 'EUR',
       1000, 1200, 1200, '{}', '{}', '{}', v.numero || '.pdf', '0.0.0', v.origine, v.compte, v.emise_le
  from (values
    (:'entreprise_e1'::uuid, :'e1'::uuid, 'X-1', 'emise', '2001-03-10 10:00+00'::timestamptz),
    (:'entreprise_e2'::uuid, :'e2'::uuid, 'Y-1', 'importee', '2001-03-12 10:00+00'::timestamptz),
    (:'entreprise_e2'::uuid, :'e2'::uuid, 'Y-2', 'emise', '2001-03-31 22:00+00'::timestamptz),
    (:'entreprise_e3'::uuid, :'e3'::uuid, 'Z-0', 'emise', '2001-02-28 22:59:59+00'::timestamptz),
    (:'entreprise_e3'::uuid, :'e3'::uuid, 'Z-1', 'emise', '2001-02-28 23:00+00'::timestamptz)
  ) as v(entreprise, compte, numero, origine, emise_le);
insert into factures (entreprise_id, numero, type_code, date_emission, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      facture_origine_id, origine, emise_par, emise_le)
select entreprise_id, 'X-2', '381', '2001-03-20', 'client', 'EUR', 1000, 1200, 1200, '{}', '{}', '{}',
       'X-2.pdf', '0.0.0', id, 'emise', emise_par, '2001-03-20 10:00+00'
  from factures where numero = 'X-1';
insert into relances (entreprise_id, facture_id, niveau, envoyee_le, destinataire, objet, corps, etat)
select f.entreprise_id, f.id, 1, v.envoyee_le, 'client@test', 'objet', 'corps', v.etat
  from (values
    ('X-1', '2001-03-11 09:00+00'::timestamptz, 'envoyee'),
    ('X-1', '2001-03-12 09:00+00'::timestamptz, 'refusee'),
    ('X-1', '2001-03-31 22:00+00'::timestamptz, 'envoyee'),
    ('Z-1', '2001-02-28 23:00+00'::timestamptz, 'envoyee')
  ) as v(numero, envoyee_le, etat)
  join factures f on f.numero = v.numero;
reset role;

-- Le décor est bien celui qu'on croit : le paiement de F-1 est annulé.
select is(
  (select count(*) from paiements p join factures f on f.id = p.facture_id
    where f.numero = 'F-1' and p.annule_le is not null),
  1::bigint, 'décor : le paiement de F-1 est annulé');

-- ---------------------------------------------------------------------------------------------
-- La vue : forme et privilèges
-- ---------------------------------------------------------------------------------------------
select has_view('public', 'suivi_factures', 'la vue existe');
select columns_are('public', 'suivi_factures', array[
  'facture_id', 'entreprise_id', 'numero', 'type_code', 'date_emission', 'date_echeance', 'client_id',
  'client_nom', 'client_email', 'devise', 'ht', 'ttc', 'net_a_payer', 'encaisse', 'avoirs', 'reste_du',
  'statut', 'jours_retard'], 'les colonnes de la fiche');
select col_type_is('public', 'suivi_factures', 'ht', 'bigint', 'ht : bigint');
select col_type_is('public', 'suivi_factures', 'ttc', 'bigint', 'ttc : bigint');
select col_type_is('public', 'suivi_factures', 'net_a_payer', 'bigint', 'net_a_payer : bigint');
select col_type_is('public', 'suivi_factures', 'encaisse', 'bigint', 'encaisse : bigint');
select col_type_is('public', 'suivi_factures', 'avoirs', 'bigint', 'avoirs : bigint');
select col_type_is('public', 'suivi_factures', 'reste_du', 'bigint', 'reste_du : bigint');
select col_type_is('public', 'suivi_factures', 'jours_retard', 'integer', 'jours_retard : integer');
-- La liste des avoirs, définie une fois avec le contrôle des paiements (…000200_regles.sql) : les quatre
-- codes, aucun des types voisins (corrective 384, acompte 386, 389 et 393), et `false` pour un type absent.
select results_eq(
  $$ select code, public.est_un_avoir(code)
       from (values ('381'), ('261'), ('262'), ('396'), ('380'), ('384'), ('386'), ('389'), ('393'), (null)) as v(code) $$,
  $$ values ('381', true), ('261', true), ('262', true), ('396', true), ('380', false), ('384', false),
            ('386', false), ('389', false), ('393', false), (null, false) $$,
  'est_un_avoir : les quatre codes d''avoir, aucun autre, false pour null');
-- Et personne ne la réécrit : le contrôle des paiements, la vue et le tableau de bord passent par
-- `est_un_avoir` (trois sources lues dans le catalogue, une absente rendrait faux).
select ok(
  (select count(*) = 3 and bool_and(coalesce(v.def, '') like '%est_un_avoir%' and coalesce(v.def, '') not like '%''381''%')
     from (values
       (pg_get_functiondef(to_regprocedure('public.controler_paiement()'))),
       (pg_get_viewdef(to_regclass('public.suivi_factures'))),
       (pg_get_functiondef(to_regprocedure('public.tableau_de_bord(date, date)')))
     ) as v(def)),
  'la liste des avoirs n''est écrite qu''une fois : ni le contrôle des paiements, ni la vue, ni le tableau de bord ne la répètent');
select ok(has_function_privilege('authenticated', to_regprocedure('public.est_un_avoir(text)'), 'execute'), 'authenticated appelle est_un_avoir');
select ok(not has_function_privilege('anon', to_regprocedure('public.est_un_avoir(text)'), 'execute'), 'anon n''appelle pas est_un_avoir');
-- (`to_reg…` rend null pour un objet absent : l'assertion échoue au lieu de faire échouer le fichier.)
select ok(
  (select coalesce(reloptions @> array['security_invoker=true'], false)
     from pg_class where oid = to_regclass('public.suivi_factures')),
  'la vue s''exécute avec les droits de l''appelant : la RLS s''applique');
select ok(has_table_privilege('authenticated', to_regclass('public.suivi_factures'), 'select'), 'authenticated lit la vue');
select ok(
  not has_table_privilege('authenticated', to_regclass('public.suivi_factures'), 'insert, update, delete, truncate'),
  'authenticated n''écrit pas dans la vue');
select ok(not has_table_privilege('anon', to_regclass('public.suivi_factures'), 'select'), 'anon ne lit pas la vue');
select ok(
  (select not prosecdef from pg_proc where oid = to_regprocedure('public.tableau_de_bord(date, date)')),
  'tableau_de_bord : security invoker');
select ok(has_function_privilege('authenticated', to_regprocedure('public.tableau_de_bord(date, date)'), 'execute'), 'authenticated appelle tableau_de_bord');
select ok(not has_function_privilege('anon', to_regprocedure('public.tableau_de_bord(date, date)'), 'execute'), 'anon n''appelle pas tableau_de_bord');
-- `service_role` n'est pas borné par la RLS : il aurait le total de toutes les entreprises.
select ok(not has_function_privilege('service_role', to_regprocedure('public.tableau_de_bord(date, date)'), 'execute'), 'service_role n''appelle pas tableau_de_bord');
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
     from pg_proc where oid = to_regprocedure('public.indicateurs(date)')),
  'indicateurs : security definer, chemin de recherche vide');
select ok(not has_function_privilege('anon', to_regprocedure('public.indicateurs(date)'), 'execute'), 'anon n''appelle pas indicateurs');
select ok(not has_function_privilege('authenticated', to_regprocedure('public.indicateurs(date)'), 'execute'), 'authenticated n''appelle pas indicateurs');
select ok(has_function_privilege('service_role', to_regprocedure('public.indicateurs(date)'), 'execute'), 'service_role appelle indicateurs');

-- ---------------------------------------------------------------------------------------------
-- En tant que A : la fiche
-- ---------------------------------------------------------------------------------------------
select tests.agir_comme(:'a');
select results_eq($$ select numero, statut from suivi_factures order by numero $$,
  $$ values ('F-1','a_payer'),('F-2','payee_en_partie'),('F-3','en_retard'),('F-4','payee'),('F-5','a_rembourser'),('F-6','a_payer'),('F-7','payee') $$,
  'les statuts de la fiche');
select is((select reste_du from suivi_factures where numero = 'F-5'), -1200::bigint, 'F-5 : 1 200 à rembourser');
select is((select count(*)::int from suivi_factures where type_code = '381'), 0, 'les avoirs ne sont pas suivis');
-- Encaissé, avoirs, reste dû et jours de retard, facture par facture. F-1 a un paiement annulé de 3 000 :
-- il ne compte pas. Seule F-3 est en retard (échéance J−30) ; F-6 n'a pas d'échéance.
select results_eq(
  $$ select numero, encaisse::int, avoirs::int, reste_du::int, jours_retard from suivi_factures order by numero $$,
  $$ values ('F-1', 0, 0, 12000, null), ('F-2', 5000, 0, 7000, null), ('F-3', 0, 0, 12000, 30),
            ('F-4', 6000, 0, 0, null), ('F-5', 6000, 1200, -1200, null), ('F-6', 0, 0, 1200, null),
            ('F-7', 2400, 0, 0, null) $$,
  'encaissé, avoirs, reste dû et jours de retard');
select results_eq(
  $$ select numero, type_code, date_emission - pg_temp.j(), date_echeance - pg_temp.j(), client_nom, devise, ht::int, ttc::int, net_a_payer::int
       from suivi_factures where numero in ('F-3', 'F-6', 'F-7') order by numero $$,
  $$ values ('F-3', '380', -100, -30, 'client F-3', 'EUR', 10000, 12000, 12000),
            ('F-6', '380', -300, null, 'client F-6', 'EUR', 1000, 1200, 1200),
            ('F-7', '386', -1, 10, 'client F-7', 'EUR', 2000, 2400, 2400) $$,
  'la vue recopie les colonnes de la facture');
-- La vue ne montre que A : B et C ont des factures dans la même base.
select is((select count(*)::int from suivi_factures), 7, 'A : sept factures suivies');
select is(
  (select count(*)::int from suivi_factures where entreprise_id <> :'entreprise_a'),
  0, 'A ne voit aucune facture d''une autre entreprise');
select is(
  (select count(*)::int from suivi_factures where numero in ('FB-1', 'FB-2', 'C-1', 'P-1')),
  0, 'A ne voit ni FB-1, ni FB-2, ni les factures de C');

-- facturé HT sur [J−3, J] : 10000 + 10000 + 5000 + 5000 + 2000 − 1000 (A-1) ; encaissé : 5000 + 6000 + 6000 + 2400
-- reste à encaisser : F-1 12000 + F-2 7000 + F-3 12000 + F-6 1200 ; en retard : F-3
-- B a des factures, un paiement et un retard dans la même période : si le tableau de bord les comptait,
-- ces chiffres changeraient.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-3), pg_temp.j()) $$,
  $$ values (31000::bigint, 19400::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'tableau de bord de A sur [J−3, J]');
-- Les bornes d'une période comptent : J−1 est à la fois le début et la fin (les paiements et les
-- émissions de A y sont tous) ; une période qui s'arrête à J−2 ne compte pas J−1 ; F-6 est émise à J−300
-- (début inclus) et F-3 à J−100 (fin incluse). L'état à date ne dépend pas de la période.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-1), pg_temp.j(-1)) $$,
  $$ values (31000::bigint, 19400::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'période réduite à J−1 : début et fin inclus');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-300), pg_temp.j(-2)) $$,
  $$ values (11000::bigint, 0::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'période [J−300, J−2] : F-3 et F-6, ni émission ni paiement de J−1');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-299), pg_temp.j(-100)) $$,
  $$ values (10000::bigint, 0::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'période [J−299, J−100] : F-3 seule, F-6 est avant le début');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(), pg_temp.j()) $$,
  $$ values (0::bigint, 0::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'période [J, J] sans facture : des zéros, et l''état à date inchangé');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-300), pg_temp.j()) $$,
  $$ values (42000::bigint, 19400::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'période [J−300, J] : tout A');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(), pg_temp.j(-1)) $$,
  $$ values (0::bigint, 0::bigint, 32200::bigint, 12000::bigint, 1) $$,
  'une fin qui précède le début : une ligne de zéros, l''état à date inchangé');

-- Toujours en tant que A : les indicateurs sont ceux du service, pas ceux d'un compte.
select throws_ok($$ select * from indicateurs(date_trunc('month', current_date)::date) $$, '42501', null, 'authenticated : pas d''indicateurs');

-- ---------------------------------------------------------------------------------------------
-- En tant que B
-- ---------------------------------------------------------------------------------------------
-- FB-1 : 8 400 dont 1 000 encaissés ; FB-2 : 4 800, en retard de 30 jours.
reset role;
select tests.agir_comme(:'b');
select results_eq(
  $$ select numero, statut, encaisse::int, reste_du::int, jours_retard from suivi_factures order by numero $$,
  $$ values ('FB-1', 'payee_en_partie', 1000, 7400, null), ('FB-2', 'en_retard', 0, 4800, 30) $$,
  'B : ses deux factures, et elles seules');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-3), pg_temp.j()) $$,
  $$ values (7000::bigint, 1000::bigint, 12200::bigint, 4800::bigint, 1) $$,
  'tableau de bord de B : rien de A');

-- ---------------------------------------------------------------------------------------------
-- En tant que C : un avoir de chaque code, les priorités entre statuts
-- ---------------------------------------------------------------------------------------------
reset role;
select tests.agir_comme(:'c');
-- Aucun avoir n'est suivi, quel que soit son code ; chacun pèse dans `avoirs` et `reste_du` de la
-- facture qu'il cite : AV-381 et AV-381b sur C-1 (1 200 + 240), AV-261 sur C-2, AV-262 sur C-3, AV-396 sur
-- C-4. R-1 (384) cite C-4 mais n'est pas un avoir : il est suivi, et ne pèse pas sur C-4. Le reste dû de
-- S-1 est son net à payer (9 000), pas son TTC ; AV-262 pèse 300 (son TTC) et non son net à payer (0).
select is((select count(*)::int from suivi_factures where numero like 'AV-%'), 0, 'aucun avoir dans la vue');
select is(
  (select count(*)::int from suivi_factures where type_code in ('381', '261', '262', '396')),
  0, 'aucun code d''avoir dans la vue');
select is((select count(*)::int from suivi_factures), 15, 'C : quinze factures suivies');
select results_eq(
  $$ select numero, statut, encaisse::int, avoirs::int, reste_du::int, jours_retard from suivi_factures order by numero $$,
  $$ values ('C-1', 'a_payer', 0, 1440, 10560, null),
            ('C-2', 'a_payer', 0, 600, 5400, null),
            ('C-3', 'a_payer', 0, 300, 2700, null),
            ('C-4', 'a_payer', 0, 120, 1080, null),
            ('P-1', 'en_retard', 500, 0, 700, 1),
            ('P-2', 'a_payer', 0, 0, 1200, null),
            ('P-3', 'payee', 1200, 0, 0, null),
            ('P-4', 'a_rembourser', 6000, 400, -400, null),
            ('P-5', 'payee', 0, 3600, 0, null),
            ('P-6', 'a_rembourser', 120, 1, -1, null),
            ('P-7', 'payee_en_partie', 119, 0, 1, null),
            ('P-8', 'payee_en_partie', 3000, 2000, 5000, null),
            ('P-9', 'en_retard', 0, 1000, 5000, 10),
            ('R-1', 'a_payer', 0, 0, 120, null),
            ('S-1', 'a_payer', 0, 0, 9000, null) $$,
  'C : avoirs, reste dû et statuts, dans l''ordre de priorité');
-- Les priorités, dans la requête ci-dessus : P-1 en retard avec un acompte (en_retard avant
-- payee_en_partie) ; P-2 à l'échéance d'aujourd'hui (pas encore en retard) ; P-3 soldée après l'échéance
-- (payee avant en_retard) ; P-4 créditée au-delà du dû après l'échéance (a_rembourser avant en_retard) ;
-- P-5 soldée par un avoir, sans paiement (payee) ; P-6 et P-7 à un centime de zéro, d'un côté puis de
-- l'autre ; P-8 non échue, avec un paiement et un avoir qui laissent 5 000 (payee_en_partie : l'avoir ne
-- la fait pas retomber à payer) ; P-9 échue de 10 jours, avec un avoir qui laisse 5 000 (en_retard, et
-- ses 10 jours de retard). L'acompte hors retard, sans avoir, est F-2 de A.

-- facturé HT sur [J−1, J] : C-1 10000 + C-2 5000 + C-3 2500 + C-4 1000 + R-1 100, moins les avoirs HT
-- 1000 + 200 + 500 + 250 + 100 (chaque code, au signe près : un code qui sortirait de la liste ferait
-- changer le total de 2 × son montant) ; encaissé : rien (les paiements de C sont à J−30) ;
-- reste à encaisser : 10560 + 5400 + 2700 + 1080 + 700 + 1200 + 1 (P-7) + 5000 (P-8) + 5000 (P-9) + 120
-- + 9000 (S-1) ; en retard : P-1 (700) et P-9 (5000).
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-1), pg_temp.j()) $$,
  $$ values (16550::bigint, 0::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−1, J] : les quatre codes d''avoir se retranchent');
-- [J−60, J−59] : P-1 à P-5 (11000) moins AV-P4 et AV-P5 émis à J−59 (334 + 3000), bornes incluses.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-60), pg_temp.j(-59)) $$,
  $$ values (7666::bigint, 0::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−60, J−59] : début et fin inclus');
-- Les paiements de J−30 sont hors d'une période qui finit à J−31 : la fin compte pour eux aussi.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-60), pg_temp.j(-31)) $$,
  $$ values (7666::bigint, 0::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−60, J−31] : les paiements de J−30 sont après la fin');
-- [J−31, J−29] : les trois paiements de J−30 (500 + 1200 + 6000), aucune émission.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-31), pg_temp.j(-29)) $$,
  $$ values (0::bigint, 7700::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−31, J−29] : les paiements de la période');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-30), pg_temp.j(-30)) $$,
  $$ values (0::bigint, 7700::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'paiements : une période d''un jour, début et fin inclus');
-- [J−200, J−199] : P-6, P-7 et S-1 (HT 100 + 100 + 10000, et non le TTC de S-1), moins AV-P6 (1) ; les
-- deux paiements de J−200 (120 + 119), à la borne de début.
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-200), pg_temp.j(-199)) $$,
  $$ values (10199::bigint, 239::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−200, J−199] : le HT, pas le TTC');
-- [J−150, J−149] : P-8 (8334) et P-9 (5000) moins AV-P8 et AV-P9 (1667 + 834) ; le paiement de P-8 (3000).
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-150), pg_temp.j(-149)) $$,
  $$ values (10833::bigint, 3000::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'tableau de bord de C sur [J−150, J−149] : factures et avoirs avec un reste positif');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-29), pg_temp.j()) $$,
  $$ values (16550::bigint, 0::bigint, 40761::bigint, 5700::bigint, 2) $$,
  'paiements : ceux de la veille du début ne sont pas comptés');

-- « Aujourd'hui » est celui de Paris, quel que soit le fuseau de la session : dans l'un ou l'autre de
-- ces deux fuseaux, `current_date` serait la veille de Paris ou son lendemain pendant une partie de la
-- journée, et au moins l'un des deux essais l'attraperait à toute heure. P-1 (échéance J−1) est en retard
-- d'un jour, P-2 (échéance J) ne l'est pas encore.
set local timezone = 'Pacific/Pago_Pago';
select results_eq(
  $$ select numero, statut, jours_retard from suivi_factures where numero in ('P-1', 'P-2') order by numero $$,
  $$ values ('P-1', 'en_retard', 1), ('P-2', 'a_payer', null) $$,
  'Paris : session en retard sur Paris, la vue garde le jour de Paris');
select results_eq($$ select retard_montant, retard_nombre from tableau_de_bord(pg_temp.j(-1), pg_temp.j()) $$,
  $$ values (5700::bigint, 2) $$,
  'Paris : session en retard sur Paris, le tableau de bord aussi');
set local timezone = 'Pacific/Kiritimati';
select results_eq(
  $$ select numero, statut, jours_retard from suivi_factures where numero in ('P-1', 'P-2') order by numero $$,
  $$ values ('P-1', 'en_retard', 1), ('P-2', 'a_payer', null) $$,
  'Paris : session en avance sur Paris, la vue garde le jour de Paris');
select results_eq($$ select retard_montant, retard_nombre from tableau_de_bord(pg_temp.j(-1), pg_temp.j()) $$,
  $$ values (5700::bigint, 2) $$,
  'Paris : session en avance sur Paris, le tableau de bord aussi');
reset timezone;

-- ---------------------------------------------------------------------------------------------
-- En tant que D : un compte sans facture
-- ---------------------------------------------------------------------------------------------
reset role;
select tests.agir_comme(:'d');
select is((select count(*)::int from suivi_factures), 0, 'D : rien à suivre');
select results_eq($$ select * from tableau_de_bord(pg_temp.j(-3), pg_temp.j()) $$,
  $$ values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0) $$,
  'tableau de bord sans facture : des zéros, pas des null');

-- ---------------------------------------------------------------------------------------------
-- Sans compte : anon n'a rien
-- ---------------------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$ select * from suivi_factures $$, '42501', null, 'anon : pas de vue');
select throws_ok($$ select * from tableau_de_bord(pg_temp.j(-3), pg_temp.j()) $$, '42501', null, 'anon : pas de tableau de bord');
select throws_ok($$ select * from indicateurs('2001-03-01') $$, '42501', null, 'anon : pas d''indicateurs');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Indicateurs (service_role)
-- ---------------------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from tableau_de_bord(pg_temp.j(-3), pg_temp.j()) $$, '42501', null, 'service_role : pas de tableau de bord');
-- Mars 2001 : comptes créés E1 et E2 (minuit pile le 1er mars à Paris) ; actifs E1 et E3 (E2 n'a émis
-- qu'en avril, et importé en mars) ; émises X-1, X-2 (un avoir compte) et Z-1 ; relances envoyées du
-- 11 mars et de minuit pile le 1er mars, sans la refusée ni celle de minuit pile le 1er avril.
select results_eq($$ select * from indicateurs('2001-03-01') $$,
  $$ values (2, 2, 3, 2) $$,
  'indicateurs de mars 2001');
select results_eq($$ select * from indicateurs('2001-03-17') $$,
  $$ values (2, 2, 3, 2) $$,
  'indicateurs : un jour du mois vaut le mois entier');
select results_eq($$ select * from indicateurs('2001-04-20') $$,
  $$ values (1, 1, 1, 1) $$,
  'indicateurs d''avril 2001 : E4 créée, E2 active, Y-2 émise, une relance');
select results_eq($$ select * from indicateurs('2001-02-01') $$,
  $$ values (1, 1, 1, 0) $$,
  'indicateurs de février 2001 : E3 créée et active, Z-0 émise, aucune relance');
select results_eq($$ select * from indicateurs('2001-05-01') $$,
  $$ values (0, 0, 0, 0) $$,
  'indicateurs : un mois vide donne des zéros, pas des null');
-- Le mois en cours à Paris, par différence avec le relevé d'avant les données : les comptes de A, B, C et D
-- sont créés maintenant (E1 à E4 ont été remontés à 2001), ceux de A, B et C ont émis, et toutes les
-- factures de `fx` portent l'heure d'émission d'aujourd'hui ; aucune relance n'est d'aujourd'hui.
select results_eq(
  format($$ select comptes_crees - %s, comptes_actifs - %s, factures_emises - %s, relances_envoyees - %s
              from indicateurs(date_trunc('month', pg_temp.j()::timestamp)::date) $$,
         :avant_crees, :avant_actifs, :avant_emises, :avant_relances),
  format($$ values (4, 3, %s, 0) $$, (select count(*) from fx)),
  'indicateurs : le mois en cours, au compte près');
-- Sous un autre fuseau de session, le même résultat.
set local timezone = 'Pacific/Kiritimati';
select results_eq($$ select * from indicateurs('2001-03-01') $$,
  $$ values (2, 2, 3, 2) $$,
  'indicateurs : le fuseau de la session n''y change rien');
reset timezone;
reset role;

select * from finish();
rollback;
