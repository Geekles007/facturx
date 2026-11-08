-- Pendant le délai de grâce d'une suppression de compte (spec § 12), l'entreprise ne dépose plus de
-- fichier : la règle d'insertion de `fichiers` (migration 000400) refuse aussi quand la suppression de
-- l'entreprise du dossier est demandée.
--
-- Sans cela, un membre encore connecté pourrait déposer un logo entre le moment où la purge a vidé le
-- dossier de l'entreprise et celui où elle supprime ses utilisateurs ; l'objet resterait dans le bucket,
-- hors de portée de la passe des orphelins, qui ne regarde que `factures`. La lecture, le remplacement
-- dans le dossier et la suppression restent permis : le Studio n'offre plus que l'export, et l'annulation
-- de la suppression rend la main.
--
-- La règle lit `suppression_demandee_le` sous la RLS du compte, qui lit l'entreprise dont il est membre :
-- un dossier qui n'est pas le sien est déjà refusé par la première condition. Même nom, même rôle, même
-- commande que l'ancienne règle : seule la condition s'allonge.

drop policy fichiers_ajout on storage.objects;

create policy fichiers_ajout on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
    and not exists (
      select 1 from public.entreprises en
       where en.id::text = (storage.foldername(name))[1]
         and en.suppression_demandee_le is not null
    )
  );
