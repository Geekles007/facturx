-- Le tableau de bord, une ligne par devise (spec § 8, décision de l'utilisateur) : il ne mélange jamais
-- les devises. La première version (migration 000300) additionnait sans conversion une facture en USD et
-- une facture en EUR ; celle-ci rend, pour chaque devise présente, les cinq mêmes chiffres, sous les
-- mêmes noms et dans les mêmes types, précédés de la devise.
--
-- Le type rendu change : `create or replace` ne le permet pas, on supprime la fonction et on la recrée.
-- Ses privilèges partent avec elle : ils sont reposés à la fin, à l'identique.

drop function public.tableau_de_bord(date, date);

-- Pour chaque devise, en centimes, sur la période `[debut, fin]` (bornes incluses), comme avant :
--   - `facture_ht` : le HT des factures émises dans la période, moins celui des avoirs émis dans la
--     période, de cette devise ;
--   - `encaisse` : les paiements non annulés dont la date tombe dans la période, dans la devise de la
--     facture qu'ils règlent (un paiement n'a pas de devise à lui) ;
--   - `reste_a_encaisser`, `retard_montant`, `retard_nombre` : l'état à date, quelle que soit la
--     période, d'après la vue `suivi_factures` (donc à la date de Paris). Seul un reste dû positif est à
--     encaisser : une facture à rembourser n'en fait pas partie.
--
-- Une devise est présente quand elle a quelque chose à montrer : une facture ou un avoir émis dans la
-- période, un paiement dans la période, ou un reste dû positif aujourd'hui. Une devise dont tout est
-- réglé et rien n'est arrivé dans la période ne donne pas une ligne de zéros. Un compte sans rien de tout
-- cela n'a aucune ligne : c'est le Studio qui affiche alors des zéros, dans la devise du compte, qu'il
-- connaît et que la base ne connaît pas (le profil de l'entreprise). Dans une ligne, un chiffre sans
-- donnée vaut 0, jamais `null`. Les lignes sont rangées par code de devise.
--
-- `security invoker` (la valeur par défaut, écrite pour qu'on la lise) : la RLS de `factures`, de
-- `paiements` et de la vue s'applique, le compte ne compte que son entreprise. `search_path` est vide,
-- tous les noms sont qualifiés.
create function public.tableau_de_bord(debut date, fin date)
returns table (
  devise text,
  facture_ht bigint,
  encaisse bigint,
  reste_a_encaisser bigint,
  retard_montant bigint,
  retard_nombre int
)
language sql
stable
security invoker
set search_path = ''
as $corps$
  with emis as (
    select f.devise,
           sum(case when public.est_un_avoir(f.type_code) then -f.ht else f.ht end)::bigint as facture_ht
      from public.factures f
     where f.date_emission between debut and fin
     group by f.devise
  ),
  regle as (
    select f.devise, sum(p.montant)::bigint as encaisse
      from public.paiements p
      join public.factures f on f.entreprise_id = p.entreprise_id and f.id = p.facture_id
     where p.annule_le is null and p.date between debut and fin
     group by f.devise
  ),
  etat as (
    -- Une facture en retard a toujours un reste dû positif : le filtre les garde toutes.
    select s.devise,
           sum(s.reste_du)::bigint as reste_a_encaisser,
           coalesce(sum(s.reste_du) filter (where s.statut = 'en_retard'), 0)::bigint as retard_montant,
           (count(*) filter (where s.statut = 'en_retard'))::int as retard_nombre
      from public.suivi_factures s
     where s.reste_du > 0
     group by s.devise
  ),
  devises as (
    select e.devise from emis e
    union
    select c.devise from regle c
    union
    select x.devise from etat x
  )
  select d.devise,
         coalesce(e.facture_ht, 0)::bigint,
         coalesce(c.encaisse, 0)::bigint,
         coalesce(x.reste_a_encaisser, 0)::bigint,
         coalesce(x.retard_montant, 0)::bigint,
         coalesce(x.retard_nombre, 0)::int
    from devises d
    left join emis e on e.devise = d.devise
    left join regle c on c.devise = d.devise
    left join etat x on x.devise = d.devise
   order by d.devise
$corps$;

-- Réservé aux comptes, comme avant : appelée par `service_role`, que la RLS ne borne pas, la fonction
-- rendrait les totaux de toutes les entreprises, et aucun appelant légitime n'en a besoin. Supabase
-- accorde `execute` à `service_role` d'office (privilèges par défaut) : il faut le retirer expressément.
revoke execute on function public.tableau_de_bord(date, date) from public, anon, service_role;
grant execute on function public.tableau_de_bord(date, date) to authenticated;
