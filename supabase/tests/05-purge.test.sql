-- La tâche de nuit (supabase/migrations/20261104000600_purge.sql) : `pg_cron` appelle l'Edge Function
-- `purger` par `pg_net`, avec l'adresse et le secret que le Vault garde (`purger_url`, `purger_secret`).
--
-- La tâche planifiée est exécutée ici telle que la base la porte (`cron.job.command`), dans la
-- transaction du test : la requête que `pg_net` met en file n'est visible que d'elle, et le `rollback`
-- final l'annule, de sorte que rien ne part vraiment. Les secrets du Vault sont créés dans la même
-- transaction, après avoir écarté ceux que la base pourrait déjà porter (l'exploitation les crée à la
-- mise en production).
begin;
select plan(17);

-- Aucune migration ne sème de secret : sur une base que les seules migrations ont montée (la pile locale,
-- la CI), le Vault ne porte ni `purger_url` ni `purger_secret`. À vérifier avant d'écarter ceux d'une
-- mise en production, ce que fait le nettoyage qui suit. (Le fichier de la migration, lui, est lu par un
-- test des fonctions : une base ne connaît pas les fichiers qui l'ont montée.)
select is(
  (select count(*)::int from vault.secrets where name in ('purger_url', 'purger_secret')),
  0,
  'les migrations ne créent ni purger_url ni purger_secret dans le Vault');

-- Hermétique : ni les secrets d'une mise en production, ni une requête déjà en file.
delete from vault.secrets where name in ('purger_url', 'purger_secret');
delete from net.http_request_queue;

-- La tâche planifiée telle qu'elle est écrite, exécutée dans la session du test.
create function pg_temp.lancer_la_tache() returns void
language plpgsql
as $$
declare
  v_commande text;
begin
  select command into strict v_commande from cron.job where jobname = 'purger-chaque-nuit';
  execute v_commande;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- La planification
-- ---------------------------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron est activé');
select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net est activé');
select is(
  (select count(*)::int from cron.job where jobname = 'purger-chaque-nuit'),
  1,
  'une seule tâche purger-chaque-nuit');
select is(
  (select schedule from cron.job where jobname = 'purger-chaque-nuit'),
  '17 3 * * *',
  'purger-chaque-nuit : chaque nuit à 3 h 17');
select ok(
  (select active and database = current_database() from cron.job where jobname = 'purger-chaque-nuit'),
  'purger-chaque-nuit : active, dans cette base');

-- ---------------------------------------------------------------------------------------------
-- Aucun secret dans la migration : la tâche lit le Vault au moment de l'exécution
-- ---------------------------------------------------------------------------------------------
select matches(
  (select command from cron.job where jobname = 'purger-chaque-nuit'),
  'net\.http_post',
  'la tâche appelle net.http_post');
select matches(
  (select command from cron.job where jobname = 'purger-chaque-nuit'),
  'vault\.decrypted_secrets.*purger_url|purger_url.*vault\.decrypted_secrets',
  'l''adresse vient de vault.decrypted_secrets (purger_url)');
select matches(
  (select command from cron.job where jobname = 'purger-chaque-nuit'),
  'purger_secret',
  'le secret vient du Vault (purger_secret)');
select doesnt_match(
  (select command from cron.job where jobname = 'purger-chaque-nuit'),
  'https?://|eyJ',
  'la tâche ne porte ni adresse ni jeton en clair');

-- ---------------------------------------------------------------------------------------------
-- À l'exécution
-- ---------------------------------------------------------------------------------------------
-- Les secrets du Vault absents (la pile locale) : la tâche échoue en le disant, la migration n'en a
-- pas souffert. Un échec visible dans `cron.job_run_details` vaut mieux qu'une purge qui ne part pas
-- sans que personne le sache.
select throws_ok(
  $$ select pg_temp.lancer_la_tache() $$,
  'P0001',
  null,
  'sans purger_url ni purger_secret dans le Vault, la tâche échoue');
select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'et aucune requête n''est mise en file');

-- Un seul des deux ne suffit pas.
select vault.create_secret('https://exemple.test/functions/v1/purger', 'purger_url');
select throws_ok(
  $$ select pg_temp.lancer_la_tache() $$,
  'P0001',
  null,
  'sans purger_secret, la tâche échoue');

-- Les deux présents : une requête POST part vers l'adresse, avec le secret en en-tête.
select vault.create_secret('secret-de-test-pgtap', 'purger_secret');
select lives_ok(
  $$ select pg_temp.lancer_la_tache() $$,
  'avec les deux secrets, la tâche s''exécute');
select results_eq(
  $$ select method::text, url, headers ->> 'x-purge-secret' from net.http_request_queue $$,
  $$ values ('POST', 'https://exemple.test/functions/v1/purger', 'secret-de-test-pgtap') $$,
  'une requête POST est mise en file, vers purger_url, avec x-purge-secret');
select ok(
  (select timeout_milliseconds from net.http_request_queue) >= 60000,
  'la requête attend la réponse plus longtemps que les 5 secondes par défaut de pg_net');
select doesnt_match(
  (select command from cron.job where jobname = 'purger-chaque-nuit'),
  'secret-de-test-pgtap',
  'le secret du Vault n''est copié dans aucune tâche');

select * from finish();
rollback;
