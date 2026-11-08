-- La purge de nuit (spec § 7 et § 12) : chaque nuit, `pg_cron` fait appeler par `pg_net` l'Edge Function
-- `purger`, qui efface les comptes dont la suppression a été demandée il y a plus de 30 jours et les PDF
-- déposés sans facture depuis plus d'un jour (Storage, Auth et base : tout se passe dans la fonction, que
-- la base se contente de réveiller).
--
-- Cette migration ne contient aucun secret. L'adresse de la fonction et son secret sont lus dans le Vault
-- (`vault.decrypted_secrets`) à chaque exécution de la tâche, sous les noms `purger_url` et
-- `purger_secret` ; l'exploitation les crée à la mise en production (docs/compte.md, tâche 23), avec le
-- même secret que celui de la fonction (`PURGE_SECRET`, `supabase secrets set`). Ils n'existent pas en
-- local, où la tâche n'a rien à faire : la migration passe sans eux, et la tâche, si elle tournait, échouerait
-- en le disant dans `cron.job_run_details` plutôt que de ne rien faire sans que personne le sache.

-- `pg_cron` s'installe dans `pg_catalog` et crée son schéma `cron` ; `pg_net` dans `extensions`, où
-- Supabase range les siennes, et crée `net`.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 3 h 17 (UTC) : une heure creuse, hors des minutes rondes où les tâches des autres projets se
-- déclenchent. `cron.schedule` avec un nom existant remplace la tâche : rejouer la migration ne la double
-- pas.
--
-- `timeout_milliseconds` : `pg_net` abandonne la requête au bout de 5 secondes par défaut, bien avant
-- qu'une passe qui efface des comptes ait fini. Il laisse la fonction aller au bout (la limite d'une Edge
-- Function est de 150 secondes, 400 sur un plan payant) et n'est que le temps que la base attend la
-- réponse, qu'elle garde dans `net._http_response`.
select cron.schedule(
  'purger-chaque-nuit',
  '17 3 * * *',
  $tache$
  do $corps$
  declare
    v_url text;
    v_secret text;
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'purger_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'purger_secret';
    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
      raise exception 'Vault : purger_url et purger_secret doivent exister pour que la purge de nuit parte';
    end if;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-purge-secret', v_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  end
  $corps$
  $tache$
);
