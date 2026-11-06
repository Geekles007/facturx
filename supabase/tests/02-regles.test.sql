-- Règles que la base impose quoi que fasse le client (supabase/migrations/20261104000200_regles.sql) :
-- factures, relances et paiements figés, numérotation qui ne recule pas, version des brouillons,
-- contrôles des paiements.
--
-- Ce qui est hors de portée d'un compte (la facture figée, le saut d'année de la numérotation) s'essaie
-- en `service_role`, comme les Edge Functions. Les privilèges de colonne arrêtent un compte avant les
-- déclencheurs : un `update paiements set montant = 1` y lève 42501, et PAIEMENT_ANNULATION vise les
-- écritures qui échappent au compte.
-- Comme dans 01-isolation : psql n'interpole pas `:a` dans une chaîne `$$ … $$`, d'où
-- `format($$ … %L … $$, :'a')`. Et `tests.agir_comme` laisse les revendications du jeton en place après
-- `reset role` : `auth.uid()` répondrait encore, d'où `select set_config('request.jwt.claims', '', true)`
-- avant les écritures sans compte.
begin;
select plan(111);

-- Deux comptes, A et B, chacun avec son entreprise (créée par le déclencheur d'inscription).
select tests.creer_utilisateur('a@test') as a \gset
select tests.creer_utilisateur('b@test') as b \gset
select entreprise_id as entreprise_a from membres where user_id = :'a' \gset
select entreprise_id as entreprise_b from membres where user_id = :'b' \gset

-- « Aujourd'hui » et « demain » à Paris, que le déclencheur de paiement compare à la date du paiement.
select (now() at time zone 'Europe/Paris')::date as paris,
       (now() at time zone 'Europe/Paris')::date + 1 as paris_demain \gset

\set f 00000000-0000-0000-0000-00000000fa01
\set f2 00000000-0000-0000-0000-00000000fa02
\set f_acompte 00000000-0000-0000-0000-00000000fa03
\set f_jetable 00000000-0000-0000-0000-00000000fa04
\set f_verrou 00000000-0000-0000-0000-00000000fa05
\set f_cree 00000000-0000-0000-0000-00000000fa06
\set avoir 00000000-0000-0000-0000-00000000fa81
\set avoir_f2 00000000-0000-0000-0000-00000000fa82
\set avoir_261 00000000-0000-0000-0000-00000000fa83
\set avoir_262 00000000-0000-0000-0000-00000000fa84
\set fb 00000000-0000-0000-0000-00000000fb01
\set b1 00000000-0000-0000-0000-00000000ba01
\set b2 00000000-0000-0000-0000-00000000ba02
\set b3 00000000-0000-0000-0000-00000000bb01

-- Les fixtures, posées par le propriétaire (aucun jeton en cours : `auth.uid()` est nul).
--   f : 12 000 net à payer, 2 000 d'avoir (381) qui la cite : 10 000 à encaisser ;
--   f2 : 5 000, avec un avoir 396 de 1 000 : 4 000 ;
--   f_acompte : une facture d'acompte (386), qui se paie comme une autre ;
--   f_jetable : celle que la purge supprime ; f_verrou : celle dont on observe le verrou ; f_cree : celle
--   des essais sur `cree_par` ;
--   avoir_261 et avoir_262 : des avoirs sans facture citée.
insert into factures (id, entreprise_id, numero, type_code, date_emission, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      origine, emise_par) values
  (:'f', :'entreprise_a', 'F-2026-0001', '380', '2026-11-01', 'client A', 'EUR', 10000, 12000, 12000, '{}', '{}', '{}', 'a1.pdf', '0.0.0', 'emise', :'a'),
  (:'f2', :'entreprise_a', 'F-2026-0002', '380', '2026-11-01', 'client A', 'EUR', 4167, 5000, 5000, '{}', '{}', '{}', 'a2.pdf', '0.0.0', 'emise', :'a'),
  (:'f_acompte', :'entreprise_a', 'F-2026-0003', '386', '2026-11-01', 'client A', 'EUR', 2500, 3000, 3000, '{}', '{}', '{}', 'a3.pdf', '0.0.0', 'emise', :'a'),
  (:'f_jetable', :'entreprise_a', 'F-2026-0004', '380', '2026-11-01', 'client A', 'EUR', 100, 120, 120, '{}', '{}', '{}', 'a4.pdf', '0.0.0', 'emise', :'a'),
  (:'f_verrou', :'entreprise_a', 'F-2026-0005', '380', '2026-11-01', 'client A', 'EUR', 1000, 1200, 1200, '{}', '{}', '{}', 'a5.pdf', '0.0.0', 'emise', :'a'),
  (:'f_cree', :'entreprise_a', 'F-2026-0006', '380', '2026-11-01', 'client A', 'EUR', 100, 120, 120, '{}', '{}', '{}', 'a6.pdf', '0.0.0', 'emise', :'a'),
  (:'fb', :'entreprise_b', 'F-2026-0001', '380', '2026-11-01', 'client B', 'EUR', 10000, 12000, 12000, '{}', '{}', '{}', 'b1.pdf', '0.0.0', 'emise', :'b');
insert into factures (id, entreprise_id, numero, type_code, date_emission, client_nom, devise,
                      ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                      facture_origine_id, origine, emise_par) values
  (:'avoir', :'entreprise_a', 'A-2026-0001', '381', '2026-11-02', 'client A', 'EUR', 1667, 2000, 2000, '{}', '{}', '{}', 'a81.pdf', '0.0.0', :'f', 'emise', :'a'),
  (:'avoir_f2', :'entreprise_a', 'A-2026-0002', '396', '2026-11-02', 'client A', 'EUR', 833, 1000, 1000, '{}', '{}', '{}', 'a82.pdf', '0.0.0', :'f2', 'emise', :'a'),
  (:'avoir_261', :'entreprise_a', 'A-2026-0003', '261', '2026-11-02', 'client A', 'EUR', 100, 120, 120, '{}', '{}', '{}', 'a83.pdf', '0.0.0', null, 'emise', :'a'),
  (:'avoir_262', :'entreprise_a', 'A-2026-0004', '262', '2026-11-02', 'client A', 'EUR', 100, 120, 120, '{}', '{}', '{}', 'a84.pdf', '0.0.0', null, 'emise', :'a');
insert into brouillons (id, entreprise_id, form, modifie_le) values
  (:'b1', :'entreprise_a', '{}', '2000-01-01'),
  (:'b2', :'entreprise_a', '{}', '2000-01-01'),
  (:'b3', :'entreprise_b', '{}', '2000-01-01');
insert into relances (entreprise_id, facture_id, niveau, destinataire, objet, corps, etat) values
  (:'entreprise_a', :'f', 1, 'a@client.test', 'o', 'c', 'envoyee'),
  (:'entreprise_b', :'fb', 1, 'b@client.test', 'o', 'c', 'envoyee');
-- Écrits sans compte : `cree_par` est celui qu'on donne.
insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par) values
  (:'entreprise_a', :'f_acompte', '2026-11-02', 1000, 'virement', :'a'),
  (:'entreprise_b', :'fb', '2026-11-02', 5000, 'virement', :'b');

-- ---------------------------------------------------------------------------------------------
-- Factures, relances et paiements figés (service_role : les Edge Functions)
-- ---------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok(format($$ update factures set ttc = 1 where id = %L $$, :'f'), 'P0001', 'FACTURE_FIGEE', 'facture : update refusé');
select throws_ok(format($$ update factures set pdf_chemin = 'autre.pdf' where id = %L $$, :'f'), 'P0001', 'FACTURE_FIGEE', 'facture : le chemin du PDF est figé aussi');
select throws_ok($$ update factures set client_nom = 'x' $$, 'P0001', 'FACTURE_FIGEE', 'factures : update sans where refusé');
select throws_ok(format($$ delete from factures where id = %L $$, :'f'), 'P0001', 'FACTURE_FIGEE', 'facture : delete refusé');
select throws_ok($$ delete from factures $$, 'P0001', 'FACTURE_FIGEE', 'factures : delete sans where refusé');
-- (Avec ses tables liées : sans elles, la clé étrangère refuserait le truncate avant tout déclencheur.)
select throws_ok($$ truncate factures, paiements, relances $$, 'P0001', 'FACTURE_FIGEE', 'factures : truncate refusé');
select throws_ok($$ update relances set corps = 'x' $$, 'P0001', 'RELANCE_FIGEE', 'relances : update refusé');
select throws_ok($$ delete from relances $$, 'P0001', 'RELANCE_FIGEE', 'relances : delete refusé');
select throws_ok($$ truncate relances $$, 'P0001', 'RELANCE_FIGEE', 'relances : truncate refusé');
select throws_ok($$ delete from paiements $$, 'P0001', 'PAIEMENT_FIGE', 'paiements : delete refusé');
select throws_ok($$ truncate paiements $$, 'P0001', 'PAIEMENT_FIGE', 'paiements : truncate refusé');
-- La purge d'un compte supprimé s'annonce dans sa transaction, et le drapeau s'éteint avec elle.
select lives_ok(
  format($$ set local facturx.purge = 'on'; delete from factures where id = %L; set local facturx.purge = 'off' $$, :'f_jetable'),
  'purge autorisée');
select is_empty(format($$ select 1 from factures where id = %L $$, :'f_jetable'), 'la facture purgée a disparu');
select lives_ok(
  format($$ set local facturx.purge = 'on'; update factures set pdf_chemin = 'purge.pdf' where id = %L; set local facturx.purge = 'off' $$, :'f2'),
  'purge : update autorisé aussi');
select is((select pdf_chemin from factures where id = :'f2'), 'purge.pdf', 'purge : et il a bien eu lieu');
select throws_ok(format($$ delete from factures where id = %L $$, :'f2'), 'P0001', 'FACTURE_FIGEE', 'après la purge, la facture est de nouveau figée');
select throws_ok(format($$ update factures set ttc = 1 where id = %L $$, :'f2'), 'P0001', 'FACTURE_FIGEE', 'après la purge, update refusé aussi');
-- Supprimer une entreprise qui a des factures, des relances ou des paiements est refusé hors purge
-- (la suppression en cascade passe par les mêmes déclencheurs).
select throws_matching(
  format($$ delete from entreprises where id = %L $$, :'entreprise_b'),
  '^(FACTURE|RELANCE|PAIEMENT)_FIGEE?$',
  'entreprise : la suppression en cascade ne passe pas hors purge');

-- ---------------------------------------------------------------------------------------------
-- Numérotation qui ne recule pas (service_role : hors de la portée d'un compte)
-- ---------------------------------------------------------------------------------------------
select throws_ok($$ update numerotation set annee = 2000 $$, 'P0001', 'NUMEROTATION_ANNEE', 'numérotation : annee fixée hors émission');
select throws_ok($$ update numerotation set prochain = 0 $$, 'P0001', 'NUMEROTATION_RECUL', 'numérotation : prochain ne recule pas (sans where)');
select lives_ok(format($$ update numerotation set prochain = 138 where entreprise_id = %L $$, :'entreprise_b'), 'numérotation : prochain avance');
select lives_ok(format($$ update numerotation set gabarit = 'G-{NNNN}' where entreprise_id = %L $$, :'entreprise_b'), 'numérotation : le gabarit se change sans toucher au rang');
select throws_ok(format($$ update numerotation set prochain = 137 where entreprise_id = %L $$, :'entreprise_b'), 'P0001', 'NUMEROTATION_RECUL', 'numérotation : 138 ne redescend pas à 137');
-- L'émission (Edge Function) annonce ses écritures : à la nouvelle année, `prochain` repart à 1.
select lives_ok(
  format($$ set local facturx.emission = 'on'; update numerotation set prochain = 1, annee = 2027 where entreprise_id = %L; set local facturx.emission = 'off' $$, :'entreprise_b'),
  'émission : nouvelle année, la suite repart à 1');
select results_eq(
  format($$ select prochain, annee from numerotation where entreprise_id = %L $$, :'entreprise_b'),
  $$ values (1, 2027) $$,
  'émission : le rang et l''année ont changé');
select throws_ok(format($$ update numerotation set annee = 2026 where entreprise_id = %L $$, :'entreprise_b'), 'P0001', 'NUMEROTATION_ANNEE', 'après l''émission, annee est de nouveau figée');
select throws_ok(format($$ update numerotation set prochain = 0 where entreprise_id = %L $$, :'entreprise_b'), 'P0001', 'NUMEROTATION_RECUL', 'après l''émission, prochain ne recule plus');

-- ---------------------------------------------------------------------------------------------
-- En tant que A : numérotation et brouillons
-- ---------------------------------------------------------------------------------------------
reset role;
select tests.agir_comme(:'a');
select throws_ok($$ update numerotation set prochain = 0 $$, 'P0001', 'NUMEROTATION_RECUL');
select lives_ok($$ update numerotation set prochain = 138 $$, 'reprendre une suite existante');
select throws_ok($$ update numerotation set prochain = 137 $$, 'P0001', 'NUMEROTATION_RECUL', 'une suite reprise ne recule pas');
select lives_ok($$ update numerotation set prochain = 138 $$, 'rester au même rang n''est pas reculer');
select results_eq($$ select prochain from numerotation $$, $$ values (138) $$, 'prochain de A : 138');
-- Le gabarit, `annuelle` et `prochain` se règlent depuis le Studio, mais `annee` n'appartient qu'à
-- l'émission : le privilège de colonne l'arrête avant le déclencheur.
select throws_ok($$ update numerotation set annee = 2000 $$, '42501', null, 'annee : refusée à un compte');

-- Brouillons : `version` et `modifie_le` sont tenus par la base.
select results_eq(format($$ select version from brouillons where id = %L $$, :'b1'), $$ values (1) $$, 'brouillon neuf : version 1');
select lives_ok(format($$ update brouillons set form = '{"x":1}' where id = %L $$, :'b1'), 'brouillon : update');
select results_eq(format($$ select version from brouillons where id = %L $$, :'b1'), $$ values (2) $$, 'version incrémentée après update');
select ok((select modifie_le = now() from brouillons where id = :'b1'), 'modifie_le : l''heure de l''enregistrement');
-- Le client ne choisit ni la version ni l'heure.
select lives_ok(format($$ update brouillons set version = 99, modifie_le = '2001-01-01' where id = %L $$, :'b1'), 'brouillon : version et heure proposées par le client');
select results_eq(
  format($$ select version, modifie_le = now() from brouillons where id = %L $$, :'b1'),
  $$ values (3, true) $$,
  'la base garde la main sur version et modifie_le');
select lives_ok($$ update brouillons set form = '{"sans":"where"}' $$, 'brouillons : update sans where');
select results_eq(
  $$ select id::text, version from brouillons order by id $$,
  format($$ values (%L, 4), (%L, 2) $$, :'b1', :'b2'),
  'chaque brouillon touché passe à la version suivante');

-- ---------------------------------------------------------------------------------------------
-- En tant que A : paiements
-- ---------------------------------------------------------------------------------------------
-- f : 12 000 − 2 000 d'avoir = 10 000.
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 10001, 'virement') $$, :'f', :'entreprise_a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'paiement : au-delà du net à payer moins les avoirs');
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 10000, 'virement') $$, :'f', :'entreprise_a'),
  'paiement : le reste dû exactement');
select id as p1 from paiements where facture_id = :'f' and montant = 10000 \gset
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'especes') $$, :'f', :'entreprise_a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'paiement : le total encaissé compte');
select results_eq(
  format($$ select cree_par, annule_le from paiements where id = %L $$, :'p1'),
  format($$ values (%L::uuid, null::timestamptz) $$, :'a'),
  'cree_par : le compte connecté, non annulé');
-- Les quatre types d'avoir ne se paient pas ; la facture d'acompte (386), si.
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'avoir', :'entreprise_a'),
  'P0001', 'PAIEMENT_AVOIR', 'paiement : pas sur un avoir 381');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'avoir_261', :'entreprise_a'),
  'P0001', 'PAIEMENT_AVOIR', 'paiement : pas sur un avoir 261');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'avoir_262', :'entreprise_a'),
  'P0001', 'PAIEMENT_AVOIR', 'paiement : pas sur un avoir 262');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'avoir_f2', :'entreprise_a'),
  'P0001', 'PAIEMENT_AVOIR', 'paiement : pas sur un avoir 396');
-- f_acompte : 3 000, dont 1 000 déjà encaissés (fixture).
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 2000, 'carte') $$, :'f_acompte', :'entreprise_a'),
  'paiement : une facture d''acompte se paie comme une autre');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'carte') $$, :'f_acompte', :'entreprise_a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'paiement : l''encaissé écrit sans compte compte aussi');
-- La date : pas dans le futur. La facture f est déjà soldée : seule la date peut être en cause, et elle
-- passe avant le montant.
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date + 2, 1, 'cheque') $$, :'f', :'entreprise_a'),
  'P0001', 'PAIEMENT_DATE', 'paiement : pas dans le futur');
-- Minuit à Paris : la date du jour est celle de Paris, quel que soit le fuseau de la session. Dans l'un
-- ou l'autre de ces deux fuseaux, `current_date` serait la veille de Paris ou son lendemain pendant une
-- partie de la journée, et au moins l'un des deux essais l'attraperait à toute heure.
set local timezone = 'Pacific/Pago_Pago';
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, %L, 1, 'virement') $$, :'f2', :'entreprise_a', :'paris'),
  'paiement : la date du jour à Paris est admise (session en retard sur Paris)');
set local timezone = 'Pacific/Kiritimati';
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, %L, 1, 'virement') $$, :'f2', :'entreprise_a', :'paris_demain'),
  'P0001', 'PAIEMENT_DATE', 'paiement : demain à Paris est refusé (session en avance sur Paris)');
reset timezone;
-- f2 : 5 000 − 1 000 d'avoir (396) = 4 000, dont 1 déjà encaissé.
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 3999, 'virement') $$, :'f2', :'entreprise_a'),
  'paiement : jusqu''au reste dû, avoir 396 déduit');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'f2', :'entreprise_a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'paiement : un centime de plus est refusé');
-- Annuler un paiement le retire du total encaissé.
select lives_ok(format($$ update paiements set annule_le = now() where id = %L $$, :'p1'), 'annuler un paiement');
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 10000, 'cheque') $$, :'f', :'entreprise_a'),
  'paiement : un paiement annulé ne compte plus');
select id as p3 from paiements where facture_id = :'f' and montant = 10000 and annule_le is null \gset
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'cheque') $$, :'f', :'entreprise_a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'paiement : le remplaçant compte');

-- Annulation seule : un compte n'a de privilège que sur `annule_le`, et ne la remet pas à null.
select throws_ok(format($$ update paiements set montant = 1 where id = %L $$, :'p3'), '42501', null, 'paiement : montant hors privilège');
select throws_ok(format($$ update paiements set annule_le = null where id = %L $$, :'p1'), 'P0001', 'PAIEMENT_ANNULATION', 'paiement : une annulation ne se défait pas');
select throws_ok($$ update paiements set annule_le = null $$, 'P0001', 'PAIEMENT_ANNULATION', 'paiements : une annulation ne se défait pas, sans where');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, annule_le) values (%L, %L, current_date, 1, 'virement', now()) $$, :'f_cree', :'entreprise_a'),
  '42501', null, 'paiement : un paiement ne naît pas annulé');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, cree_le) values (%L, %L, current_date, 1, 'virement', '2001-01-01') $$, :'f_cree', :'entreprise_a'),
  '42501', null, 'paiement : cree_le n''est pas au choix du compte');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, cree_par) values (%L, %L, current_date, 1, 'virement', %L) $$, :'f_cree', :'entreprise_a', :'b'),
  '42501', null, 'paiement : cree_par n''est pas au choix du compte');
select throws_ok($$ delete from paiements $$, '42501', null, 'paiements : aucune suppression');
select throws_ok($$ truncate paiements $$, '42501', null, 'paiements : aucun truncate');

-- Chez l'autre entreprise : 42501 d'abord, jamais un message sur la facture de B. Chaque essai serait
-- aussi excessif ou daté du futur, et PAIEMENT_AVOIR si la facture visée était un avoir.
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date + 5, 99999999, 'virement') $$, :'fb', :'entreprise_b'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'A paie une facture de B, déclarée chez B : 42501');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date + 5, 99999999, 'virement') $$, :'fb', :'entreprise_a'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'A paie une facture de B, déclarée chez A : 42501');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, '00000000-0000-0000-0000-0000000000ff', :'entreprise_a'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'une facture qui n''existe pas : le même 42501');

-- Sans WHERE, la règle `select` ne départage plus rien : seule la règle de mise à jour tient B à
-- l'écart (relu en propriétaire, plus bas).
select lives_ok($$ update paiements set annule_le = now() $$, 'paiements : annuler sans where');

-- ---------------------------------------------------------------------------------------------
-- En tant que B
-- ---------------------------------------------------------------------------------------------
reset role;
select tests.agir_comme(:'b');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date + 5, 99999999, 'virement') $$, :'f', :'entreprise_a'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'B paie une facture de A, déclarée chez A : 42501');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date + 5, 99999999, 'virement') $$, :'f', :'entreprise_b'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'B paie une facture de A, déclarée chez B : 42501');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'avoir', :'entreprise_b'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'B paie un avoir de A : 42501, pas PAIEMENT_AVOIR');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, '00000000-0000-0000-0000-0000000000ff', :'entreprise_b'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'une facture qui n''existe pas, chez B : le même 42501');
-- Chez soi, les mêmes règles s'appliquent : fb a 5 000 encaissés (fixture) sur 12 000.
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 7000, 'virement') $$, :'fb', :'entreprise_b'),
  'B paie sa facture');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'fb', :'entreprise_b'),
  'P0001', 'PAIEMENT_EXCESSIF', 'B : le reste dû de sa facture, pas celui de A');

-- ---------------------------------------------------------------------------------------------
-- Retour en propriétaire
-- ---------------------------------------------------------------------------------------------
reset role;
-- L'annulation sans where de A n'a rien touché chez B ; tous les paiements de A sont annulés.
select is(
  (select count(*) from paiements where entreprise_id = :'entreprise_b' and annule_le is not null),
  0::bigint,
  'B : aucun paiement annulé par l''update sans where de A');
select is(
  (select count(*) from paiements where entreprise_id = :'entreprise_a' and annule_le is null),
  0::bigint,
  'A : tous ses paiements sont annulés');
select is(
  (select count(*) from paiements where entreprise_id = :'entreprise_a'),
  6::bigint,
  'A : aucun paiement n''a disparu');
select is(
  (select version from brouillons where id = :'b3'),
  1,
  'le brouillon de B n''a pas bougé');

-- La règle d'insertion tient seule, sans le déclencheur (qui répond 42501 avant elle, au même texte).
alter table paiements disable trigger paiements_avant_insertion;
select tests.agir_comme(:'a');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'fb', :'entreprise_b'),
  '42501', 'new row violates row-level security policy for table "paiements"', 'règle RLS : A n''insère pas chez B, même sans le déclencheur');
reset role;
alter table paiements enable trigger paiements_avant_insertion;

-- cree_par : le compte connecté, quoi qu'on propose. Sans compte, la valeur donnée est conservée
-- (fixtures ci-dessus, et service_role).
select results_eq(
  format($$ select cree_par from paiements where facture_id = %L and montant = 1000 $$, :'f_acompte'),
  format($$ values (%L::uuid) $$, :'a'),
  'sans compte : cree_par est celui qui est donné');
select set_config('request.jwt.claims', json_build_object('sub', :'a', 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, cree_par) values (%L, %L, current_date, 1, 'virement', %L) $$, :'f_cree', :'entreprise_a', :'b'),
  'paiement avec un cree_par proposé (propriétaire, jeton de A)');
select results_eq(
  format($$ select cree_par from paiements where facture_id = %L $$, :'f_cree'),
  format($$ values (%L::uuid) $$, :'a'),
  'cree_par : celui du jeton, pas celui qu''on propose');
select set_config('request.jwt.claims', '', true);

-- service_role : sans compte, les règles valent quand même ; une facture introuvable est refusée par la
-- clé étrangère, non par un faux 42501.
set local role service_role;
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, cree_par) values (%L, %L, current_date, 10001, 'virement', %L) $$, :'f', :'entreprise_a', :'a'),
  'P0001', 'PAIEMENT_EXCESSIF', 'service_role : les règles de paiement valent aussi');
select throws_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen, cree_par) values ('00000000-0000-0000-0000-0000000000ff', %L, current_date, 1, 'virement', %L) $$, :'entreprise_a', :'a'),
  '23503', null, 'service_role : une facture introuvable relève de la clé étrangère');
-- Un paiement, une annulation : seule `annule_le` change. Tout autre champ, y compris ceux qu'un compte
-- ne peut déjà pas écrire, est refusé.
select throws_ok(
  format($$ update paiements set %s where id = %L $$, t.affectation, :'p3'),
  'P0001', 'PAIEMENT_ANNULATION', 'paiement : ' || t.colonne || ' ne change pas')
  from (values
    ('montant', 'montant = montant + 1'),
    ('date', 'date = date - 1'),
    ('moyen', 'moyen = ''especes'''),
    ('note', 'note = ''autre note'''),
    ('cree_le', 'cree_le = cree_le - interval ''1 day'''),
    ('cree_par', 'cree_par = gen_random_uuid()'),
    ('id', 'id = gen_random_uuid()'),
    ('annule_le avec une autre colonne', 'annule_le = now() + interval ''1 hour'', note = ''x''')
  ) as t(colonne, affectation);
select lives_ok(format($$ update paiements set montant = montant where id = %L $$, :'p3'), 'paiement : réécrire la même valeur ne change rien');

-- ---------------------------------------------------------------------------------------------
-- Le verrou de la facture pendant le contrôle (deux paiements simultanés se suivent)
-- ---------------------------------------------------------------------------------------------
reset role;
create extension pgrowlocks with schema extensions;
select is_empty(
  format($$ select 1 from extensions.pgrowlocks('public.factures') r join public.factures f on f.ctid = r.locked_row where f.id = %L $$, :'f_verrou'),
  'aucun verrou sur la facture avant le paiement');
select tests.agir_comme(:'a');
select lives_ok(
  format($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (%L, %L, current_date, 1, 'virement') $$, :'f_verrou', :'entreprise_a'),
  'paiement sur la facture observée');
reset role;
-- « For Update », non le « For Key Share » que la clé étrangère poserait seule : un second paiement attend
-- la fin de la transaction du premier, puis recompte.
select results_eq(
  format($$ select r.modes from extensions.pgrowlocks('public.factures') r join public.factures f on f.ctid = r.locked_row where f.id = %L $$, :'f_verrou'),
  $$ values (array['For Update']) $$,
  'le contrôle verrouille la facture (for update)');

-- ---------------------------------------------------------------------------------------------
-- Catalogue : privilèges, fonctions, règles
-- ---------------------------------------------------------------------------------------------
select policies_are('public', 'paiements', array['paiements_lecture', 'paiements_insertion', 'paiements_annulation'], 'paiements : lecture, insertion, annulation, et aucune suppression');
select is(
  (select string_agg(a.attname::text collate "default", ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.paiements'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')),
  'date, entreprise_id, facture_id, montant, moyen, note',
  'paiements : un compte écrit ces six colonnes à l''insertion');
select is(
  (select string_agg(a.attname::text collate "default", ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.paiements'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')),
  'annule_le',
  'paiements : un compte ne met à jour que annule_le');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('refuser_hors_purge', 'tenir_numerotation', 'versionner_brouillon', 'controler_paiement', 'controler_annulation_paiement')
      and p.proconfig = array['search_path=""']),
  5::bigint,
  'fonctions de déclencheur : chemin de recherche vide');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('refuser_hors_purge', 'tenir_numerotation', 'versionner_brouillon', 'controler_paiement', 'controler_annulation_paiement')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint,
  'fonctions de déclencheur : inappelables par un compte');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.controler_paiement()'::regprocedure),
  true,
  'le contrôle des paiements est security definer : il verrouille la facture sans en avoir le droit');
-- L'horloge ne se simule pas : l'essai de fuseau plus haut distingue Paris de `current_date`, mais pas de
-- l'heure UTC (qui ne diffère de Paris qu'entre 22 h et minuit UTC). La zone se lit donc dans la fonction.
select matches(
  (select p.prosrc from pg_proc p where p.oid = 'public.controler_paiement()'::regprocedure),
  'now\(\) at time zone ''Europe/Paris''',
  'la date du jour d''un paiement est celle de Paris');

-- ---------------------------------------------------------------------------------------------
-- Purge d'une entreprise : factures, relances et paiements partent avec elle
-- ---------------------------------------------------------------------------------------------
select lives_ok(
  format($$ set local facturx.purge = 'on'; delete from entreprises where id = %L; set local facturx.purge = 'off' $$, :'entreprise_b'),
  'purge : la suppression de l''entreprise passe en cascade');
select is(
  (select count(*) from (
     select entreprise_id from factures union all select entreprise_id from paiements
     union all select entreprise_id from relances
   ) t where entreprise_id = :'entreprise_b'),
  0::bigint,
  'purge : plus aucune facture, relance ni paiement de B');
select is(
  (select count(*) from factures where entreprise_id = :'entreprise_a'),
  9::bigint,
  'purge : celles de A sont intactes');
-- Et le gel est revenu avec la fin de la purge.
select throws_ok(
  format($$ delete from factures where id = %L $$, :'f'),
  'P0001', 'FACTURE_FIGEE', 'la purge terminée, les factures sont de nouveau figées');
-- Dernier cas, qui vide des tables : le truncate de la purge passe.
select lives_ok($$ set local facturx.purge = 'on'; truncate relances; set local facturx.purge = 'off' $$, 'purge : truncate autorisé');

select * from finish();
rollback;
