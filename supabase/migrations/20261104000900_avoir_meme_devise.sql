-- Un avoir est dans la devise de la facture qu'il corrige (Ruling 49).
--
-- La vue de suivi (migration 000300) et le contrôle des paiements (migration 000200) déduisent du reste
-- dû d'une facture le TTC des avoirs qui la citent (`facture_origine_id`), sans conversion : un avoir en
-- USD qui citerait une facture en EUR retrancherait des dollars d'un montant en euros, et le tableau de
-- bord, qui ne mélange jamais les devises (migration 000800), afficherait un reste faux. La base le
-- refuse donc à l'écriture, quel que soit l'écrivain : `emettre` le refuse avant (422 `AVOIR_DEVISE`),
-- `importer` ne rattache pas un tel avoir, et ce déclencheur vaut contre un défaut de leur code comme
-- contre `service_role`.
--
-- Seuls les avoirs (`public.est_un_avoir`, la seule liste de la base) sont visés : une facture
-- rectificative (384) cite la facture qu'elle corrige sans que rien ne s'en déduise. Une facture ne se
-- modifie pas (déclencheur `factures_figees`) : contrôler l'insertion suffit. La facture citée est
-- toujours de la même entreprise (clé étrangère composite de la migration 000100).
--
-- Droits de l'appelant : seuls `service_role` et le propriétaire (connexions directes des Edge
-- Functions) écrivent dans `factures`, et tous deux la lisent. Chemin de recherche vide, noms qualifiés.
create function public.controler_avoir() returns trigger
language plpgsql
set search_path = ''
as $corps$
begin
  if public.est_un_avoir(new.type_code) and exists (
    select 1 from public.factures o
     where o.entreprise_id = new.entreprise_id and o.id = new.facture_origine_id
       and o.devise <> new.devise
  ) then
    raise exception 'AVOIR_DEVISE';
  end if;
  return new;
end;
$corps$;

create trigger factures_avoir_devise
  before insert on public.factures
  for each row
  when (new.facture_origine_id is not null)
  execute function public.controler_avoir();

-- Une fonction de déclencheur ne s'appelle pas d'elle-même, mais on ne laisse aucun accès ouvert.
revoke execute on function public.controler_avoir() from public, anon, authenticated;
