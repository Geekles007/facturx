-- Suivi des paiements, tableau de bord et indicateurs (spec § 6 et § 8) : la base calcule, le Studio
-- n'additionne rien lui-même.
--
--   - `suivi_factures` : une ligne par facture qui n'est pas un avoir, avec ce qui est encaissé, ce que
--     les avoirs déduisent, le reste dû et le statut de paiement ;
--   - `tableau_de_bord(debut, fin)` : les cinq chiffres du tableau de bord ;
--   - `indicateurs(mois)` : les mesures du service (spec § 2), pour `service_role` seulement.
--
-- La vue et le tableau de bord s'exécutent avec les droits de l'appelant : la RLS de `factures` et de
-- `paiements` les borne à l'entreprise du compte, sans qu'ils aient à la connaître.

-- ---------------------------------------------------------------------------------------------
-- La vue de suivi
-- ---------------------------------------------------------------------------------------------

-- Pour chaque facture qui n'est pas un avoir (`public.est_un_avoir`, définie avec le contrôle des
-- paiements, qui emploie la même liste) :
--   - `encaisse` : les paiements non annulés ;
--   - `avoirs` : le TTC des avoirs qui la citent (`facture_origine_id`) ;
--   - `reste_du` : `net_a_payer − encaisse − avoirs`, négatif quand on a trop reçu ;
--   - `statut`, dans l'ordre de priorité de la spec :
--       `payee` si le reste dû est nul, `a_rembourser` s'il est négatif, `en_retard` si l'échéance est
--       passée, `payee_en_partie` s'il y a de l'encaissé, `a_payer` sinon.
--     L'ordre compte : une facture soldée après son échéance est payée, pas en retard. Une facture sans
--     échéance n'est jamais en retard ; l'échéance du jour ne l'est pas encore ;
--   - `jours_retard` : l'âge de l'échéance, pour une facture `en_retard` seulement. La spec parle de
--     « jours de retard » sans définir la colonne : une facture payée, à rembourser ou dans les temps
--     n'est pas en retard, elle a donc `null` plutôt qu'un nombre qui se lirait comme un retard.
--
-- « Aujourd'hui » est la date de Paris : le serveur tourne en UTC, et à 00 h 30 à Paris, `current_date`
-- est encore la veille. La date ne dépend pas non plus du fuseau de la session, que `at time zone`
-- ignore.
--
-- Les sommes sont des `bigint` : `sum` rend un `numeric`, d'où les conversions, et `coalesce` pour
-- qu'une facture sans paiement ni avoir ait 0 et non `null`.
create view public.suivi_factures
with (security_invoker = true)
as
with calcul as (
  select
    f.id as facture_id, f.entreprise_id, f.numero, f.type_code, f.date_emission, f.date_echeance,
    f.client_id, f.client_nom, f.client_email, f.devise, f.ht, f.ttc, f.net_a_payer,
    e.encaisse, a.avoirs,
    f.net_a_payer - e.encaisse - a.avoirs as reste_du,
    j.jour
  from (select (now() at time zone 'Europe/Paris')::date as jour) j
  cross join public.factures f
  cross join lateral (
    select coalesce(sum(p.montant), 0)::bigint as encaisse
      from public.paiements p
     where p.entreprise_id = f.entreprise_id and p.facture_id = f.id and p.annule_le is null
  ) e
  cross join lateral (
    select coalesce(sum(av.ttc), 0)::bigint as avoirs
      from public.factures av
     where av.entreprise_id = f.entreprise_id and av.facture_origine_id = f.id
       and public.est_un_avoir(av.type_code)
  ) a
  where not public.est_un_avoir(f.type_code)
),
etat as (
  select
    c.*,
    case
      when c.reste_du = 0 then 'payee'
      when c.reste_du < 0 then 'a_rembourser'
      when c.date_echeance < c.jour then 'en_retard'
      when c.encaisse > 0 then 'payee_en_partie'
      else 'a_payer'
    end as statut
  from calcul c
)
select
  s.facture_id, s.entreprise_id, s.numero, s.type_code, s.date_emission, s.date_echeance,
  s.client_id, s.client_nom, s.client_email, s.devise, s.ht, s.ttc, s.net_a_payer,
  s.encaisse, s.avoirs, s.reste_du, s.statut,
  case when s.statut = 'en_retard' then s.jour - s.date_echeance end as jours_retard
from etat s;

-- ---------------------------------------------------------------------------------------------
-- Le tableau de bord
-- ---------------------------------------------------------------------------------------------

-- Les cinq chiffres de la spec § 8, en centimes, sur la période `[debut, fin]` (bornes incluses) :
--   - `facture_ht` : le HT des factures émises dans la période, moins celui des avoirs émis dans la
--     période. Il vient de `factures` et non de la vue, qui ne retient pas les avoirs ;
--   - `encaisse` : les paiements non annulés dont la date tombe dans la période ;
--   - `reste_a_encaisser`, `retard_montant`, `retard_nombre` : l'état à date, quelle que soit la
--     période, d'après la vue (donc à la date de Paris). Seul un reste dû positif est à encaisser : une
--     facture à rembourser n'en fait pas partie.
-- Une période sans facture ni paiement rend des zéros, pas des `null`, et toujours une ligne.
-- Les montants s'additionnent sans conversion de devise : le Studio laisse choisir la devise d'une
-- facture, et une facture en USD s'ajoute à l'EUR. Une ventilation par devise reste à décider.
--
-- `security invoker` (c'est aussi la valeur par défaut, écrite ici pour qu'on la lise) : la RLS s'applique,
-- le compte ne compte que son entreprise. `search_path` est vide, tous les noms sont qualifiés.
create function public.tableau_de_bord(debut date, fin date)
returns table (
  facture_ht bigint, encaisse bigint, reste_a_encaisser bigint, retard_montant bigint, retard_nombre int
)
language sql
stable
security invoker
set search_path = ''
as $corps$
  select
    (select coalesce(sum(case when public.est_un_avoir(f.type_code) then -f.ht else f.ht end), 0)::bigint
       from public.factures f
      where f.date_emission between debut and fin),
    (select coalesce(sum(p.montant), 0)::bigint
       from public.paiements p
      where p.annule_le is null and p.date between debut and fin),
    coalesce(sum(s.reste_du) filter (where s.reste_du > 0), 0)::bigint,
    coalesce(sum(s.reste_du) filter (where s.statut = 'en_retard'), 0)::bigint,
    (count(*) filter (where s.statut = 'en_retard'))::int
  from public.suivi_factures s
$corps$;

-- ---------------------------------------------------------------------------------------------
-- Les indicateurs du service
-- ---------------------------------------------------------------------------------------------

-- Spec § 2 : calculés en SQL sur la base, sans traceur. Pour le mois de la date donnée (Paris : les
-- bornes sont minuit, heure de Paris, du premier jour du mois et du suivant) :
--   - `comptes_crees` : les entreprises créées dans le mois ;
--   - `comptes_actifs` : celles qui ont émis au moins une facture dans le mois ;
--   - `factures_emises` : les factures émises dans le mois, avoirs compris ;
--   - `relances_envoyees` : les relances que le service d'envoi a acceptées (`etat = 'envoyee'`) ; une
--     relance refusée n'a rien envoyé.
-- « Émise » est `origine = 'emise'` : une facture importée (spec § 10) existait avant le compte, et la
-- reprise d'un historique ne mesure pas l'usage du Studio. L'instant est `emise_le`, celui du serveur.
--
-- `security definer` : la fonction lit toutes les entreprises, ce qu'aucun compte ne peut faire. Elle
-- n'est donc appelable que par `service_role` (privilèges plus bas), et son chemin de recherche est vide.
create function public.indicateurs(mois date)
returns table (comptes_crees int, comptes_actifs int, factures_emises int, relances_envoyees int)
language sql
stable
security definer
set search_path = ''
as $corps$
  with bornes as (
    select
      date_trunc('month', mois::timestamp) at time zone 'Europe/Paris' as debut,
      (date_trunc('month', mois::timestamp) + interval '1 month') at time zone 'Europe/Paris' as fin
  )
  select
    (select count(*) from public.entreprises e, bornes b
      where e.cree_le >= b.debut and e.cree_le < b.fin)::int,
    (select count(distinct f.entreprise_id) from public.factures f, bornes b
      where f.origine = 'emise' and f.emise_le >= b.debut and f.emise_le < b.fin)::int,
    (select count(*) from public.factures f, bornes b
      where f.origine = 'emise' and f.emise_le >= b.debut and f.emise_le < b.fin)::int,
    (select count(*) from public.relances r, bornes b
      where r.etat = 'envoyee' and r.envoyee_le >= b.debut and r.envoyee_le < b.fin)::int
$corps$;

-- ---------------------------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------------------------

-- Supabase accorde tout à `anon` et `authenticated` sur chaque objet créé dans `public` : on retire, puis
-- on n'accorde que ce qui sert. La vue se lit, elle ne s'écrit pas ; `anon` n'en a pas l'usage.
revoke all on public.suivi_factures from anon, authenticated;
grant select on public.suivi_factures to authenticated;

-- Réservé aux comptes : appelée par `service_role`, que la RLS ne borne pas, la fonction rendrait le total
-- de toutes les entreprises, et aucun appelant légitime n'en a besoin. Supabase accorde `execute` à
-- `service_role` d'office (privilèges par défaut) : il faut donc le retirer expressément.
revoke execute on function public.tableau_de_bord(date, date) from public, anon, service_role;
grant execute on function public.tableau_de_bord(date, date) to authenticated;

-- Les indicateurs ne sont pas ceux d'un compte : ni `public`, ni `anon`, ni `authenticated`.
revoke execute on function public.indicateurs(date) from public, anon, authenticated;
grant execute on function public.indicateurs(date) to service_role;
