-- Règles que la base impose quoi que fasse le client (spec § 6, § 8 et § 11) : la facture émise ne
-- change plus, la numérotation ne recule pas, un paiement est contrôlé avant d'être écrit.
--
-- Deux drapeaux de transaction annoncent les rares écritures qui échappent à ces règles ; un
-- `set local` les limite à la transaction qui les pose :
--   - `facturx.purge = 'on'` : la transaction de purge d'un compte supprimé (spec § 12) ;
--   - `facturx.emission = 'on'` : l'Edge Function `emettre`, qui avance la numérotation.
-- L'API ne permet à aucun compte de poser un `set` : ces drapeaux sont ceux des connexions directes
-- des Edge Functions, et les déclencheurs valent surtout contre `service_role` et contre un défaut de
-- code.

-- ---------------------------------------------------------------------------------------------
-- Factures, relances et paiements : ce qui est écrit ne se réécrit pas
-- ---------------------------------------------------------------------------------------------

-- Le message à lever est l'argument du déclencheur (`FACTURE_FIGEE`, `RELANCE_FIGEE`, `PAIEMENT_FIGE`).
-- La suppression d'une entreprise efface ses lignes en cascade par ces mêmes déclencheurs : sans
-- `facturx.purge`, elle est refusée tant qu'elle a une facture, une relance ou un paiement.
-- Le drapeau est ignoré des rôles de l'API (`anon`, `authenticated`) : aucune route ne leur permet de
-- poser un `set`, mais si une fonction SQL dynamique devenait un jour atteignable, la règle doit tenir
-- seule. Le déclencheur s'exécute avec les droits de l'appelant : `current_user` est son rôle.
create function public.refuser_hors_purge() returns trigger
language plpgsql
set search_path = ''
as $corps$
begin
  if current_setting('facturx.purge', true) = 'on'
     and current_user not in ('anon', 'authenticated') then
    -- Un déclencheur de ligne rend la ligne qu'on lui a donnée (`new` pour un update, `old` pour un
    -- delete : rendre `null` annulerait l'opération) ; celui d'une instruction rend `null`.
    if tg_op = 'DELETE' then
      return old;
    elsif tg_op = 'UPDATE' then
      return new;
    end if;
    return null;
  end if;
  raise exception '%', tg_argv[0];
end;
$corps$;

-- `truncate` ne passe pas par les déclencheurs de ligne, et `service_role` le peut : les tables
-- figées ont donc aussi un déclencheur d'instruction.
create trigger factures_figees
  before update or delete on public.factures
  for each row execute function public.refuser_hors_purge('FACTURE_FIGEE');
create trigger factures_figees_vidage
  before truncate on public.factures
  for each statement execute function public.refuser_hors_purge('FACTURE_FIGEE');

create trigger relances_figees
  before update or delete on public.relances
  for each row execute function public.refuser_hors_purge('RELANCE_FIGEE');
create trigger relances_figees_vidage
  before truncate on public.relances
  for each statement execute function public.refuser_hors_purge('RELANCE_FIGEE');

-- Un paiement ne se supprime pas, il s'annule (son `update` a ses propres règles, plus bas).
create trigger paiements_figes
  before delete on public.paiements
  for each row execute function public.refuser_hors_purge('PAIEMENT_FIGE');
create trigger paiements_figes_vidage
  before truncate on public.paiements
  for each statement execute function public.refuser_hors_purge('PAIEMENT_FIGE');

-- ---------------------------------------------------------------------------------------------
-- Numérotation : on peut reprendre une suite plus haut, jamais plus bas
-- ---------------------------------------------------------------------------------------------

-- Hors émission, `prochain` ne diminue pas et `annee` ne change pas. L'émission (Edge Function) a le
-- droit de faire les deux : à la première facture de janvier, l'année avance et le rang repart à 1.
-- Un compte n'a de toute façon pas le privilège d'écrire `annee` ; ce garde-fou vise les écritures
-- faites hors de ce rôle. Comme pour la purge, le drapeau d'émission est ignoré des rôles de l'API :
-- sans cela, un `set` qui deviendrait atteignable laisserait un compte faire reculer `prochain`.
create function public.tenir_numerotation() returns trigger
language plpgsql
set search_path = ''
as $corps$
begin
  if current_setting('facturx.emission', true) is distinct from 'on'
     or current_user in ('anon', 'authenticated') then
    if new.prochain < old.prochain then
      raise exception 'NUMEROTATION_RECUL';
    end if;
    if new.annee is distinct from old.annee then
      raise exception 'NUMEROTATION_ANNEE';
    end if;
  end if;
  return new;
end;
$corps$;

create trigger numerotation_ne_recule_pas
  before update on public.numerotation
  for each row execute function public.tenir_numerotation();

-- ---------------------------------------------------------------------------------------------
-- Brouillons : la version croît à chaque enregistrement
-- ---------------------------------------------------------------------------------------------

-- Le Studio compare la version qu'il a lue à celle de la base pour repérer un enregistrement fait
-- depuis un autre onglet ; à chaque `update`, le client ne choisit donc ni la version ni l'heure (à
-- l'insertion, les valeurs par défaut s'appliquent et rien ne l'empêche d'en proposer d'autres).
create function public.versionner_brouillon() returns trigger
language plpgsql
set search_path = ''
as $corps$
begin
  new.version := old.version + 1;
  new.modifie_le := now();
  return new;
end;
$corps$;

create trigger brouillons_version
  before update on public.brouillons
  for each row execute function public.versionner_brouillon();

-- ---------------------------------------------------------------------------------------------
-- Paiements : ajout et annulation par les membres
-- ---------------------------------------------------------------------------------------------

-- Un compte écrit les six colonnes du formulaire. `id`, `cree_le` et `annule_le` ont leur valeur par
-- défaut, `cree_par` est fixé par le déclencheur : ni la trace de la saisie ni l'état d'annulation
-- ne sont au choix du compte. Et pour l'annulation, `annule_le` est la seule colonne modifiable.
grant insert (entreprise_id, facture_id, date, montant, moyen, note) on public.paiements to authenticated;
grant update (annule_le) on public.paiements to authenticated;

create policy paiements_insertion on public.paiements
  for insert to authenticated with check (entreprise_id in (select public.mes_entreprises()));
create policy paiements_annulation on public.paiements
  for update to authenticated
  using (entreprise_id in (select public.mes_entreprises()))
  with check (entreprise_id in (select public.mes_entreprises()));

-- Les avoirs sont les types 381, 261, 262 et 396 (spec § 6) : la seule liste de la base. Le contrôle des
-- paiements ci-dessous et la vue de suivi (migration suivante) l'appellent ; elle ne s'écrit nulle part
-- ailleurs, de sorte que ce qui est accepté à l'encaissement et ce que la vue affiche comme reste dû ne
-- peuvent pas diverger. Un type absent (`null`) n'est pas un avoir : `false`, jamais `null`, pour que
-- `not est_un_avoir(…)` ne perde pas de ligne.
-- Le corps ne nomme aucun objet : le chemin de recherche vide n'est là que par principe. `execute` suit
-- les fonctions appelées par les comptes (la vue de suivi l'appelle avec leurs droits) ; ni `public` ni
-- `anon`.
create function public.est_un_avoir(code text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $corps$
  select coalesce(code in ('381', '261', '262', '396'), false)
$corps$;

revoke execute on function public.est_un_avoir(text) from public, anon;
grant execute on function public.est_un_avoir(text) to authenticated, service_role;

-- Le contrôle d'un paiement avant son écriture.
--
-- `security definer` : il verrouille la facture (`for update`, ce que `authenticated` n'a pas le droit
-- de faire) et lit des paiements et des avoirs sans repasser par la RLS. Le chemin de recherche est
-- vide et tous les noms sont qualifiés.
--
-- Un déclencheur `before insert` s'exécute avant le contrôle `with check` de la RLS et avant les clés
-- étrangères. S'il répondait « excessif », « avoir » ou « date » pour la facture d'une autre
-- entreprise, il dirait à un compte que cette facture existe et ce qu'elle est. Il commence donc par
-- ce que la RLS aurait refusé : pour un compte connecté, l'entreprise déclarée doit être l'une des
-- siennes et la facture visée doit lui appartenir, sinon 42501 avec le texte de la RLS, que la facture
-- existe ailleurs ou non. Ce contrôle est fermé par défaut : il vaut pour tout rôle de l'API
-- (`authenticated`, `anon`), même sans `sub` dans le jeton (alors `mes_entreprises()` est vide : refus).
-- Sans compte ni rôle d'API (`service_role`, connexion directe), pas de RLS : une facture introuvable
-- est laissée à la clé étrangère. Le déclencheur est `security definer` : `current_user` y est son
-- propriétaire, d'où la lecture du rôle de l'appelant dans `role`, que `set role` fixe.
--
-- Ensuite, dans cet ordre : un avoir ne se paie pas, la date n'est pas dans le futur à Paris (le serveur
-- tourne en UTC : à 00 h 30 à Paris, `current_date` est encore la veille), et le total encaissé non
-- annulé ne dépasse pas le net à payer moins le TTC des avoirs qui citent la facture (spec § 8). Le
-- verrou fait se suivre deux paiements simultanés sur la même facture : le second recompte une fois le
-- premier validé. Les avoirs émis à ce moment-là attendent aussi, par la clé étrangère de
-- `facture_origine_id`. Cette sérialisation suppose le niveau d'isolation READ COMMITTED, celui de
-- PostgREST : chaque requête du déclencheur y prend un instantané neuf, après l'attente du verrou ; sous
-- REPEATABLE READ ou SERIALIZABLE, le recomptage ne verrait pas le paiement validé entre-temps.
create function public.controler_paiement() returns trigger
language plpgsql
security definer
set search_path = ''
as $corps$
declare
  c_refus constant text := 'new row violates row-level security policy for table "paiements"';
  v_compte uuid := (select auth.uid());
  v_api boolean := v_compte is not null or current_setting('role', true) in ('anon', 'authenticated');
  v_type text;
  v_net bigint;
  v_encaisse bigint;
  v_avoirs bigint;
begin
  if v_api and not coalesce(new.entreprise_id in (select public.mes_entreprises()), false) then
    raise exception '%', c_refus using errcode = '42501';
  end if;

  select f.type_code, f.net_a_payer into v_type, v_net
    from public.factures f
   where f.id = new.facture_id and f.entreprise_id = new.entreprise_id
     for update;
  if not found then
    if v_api then
      raise exception '%', c_refus using errcode = '42501';
    end if;
    return new;
  end if;

  if public.est_un_avoir(v_type) then
    raise exception 'PAIEMENT_AVOIR';
  end if;
  if new.date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'PAIEMENT_DATE';
  end if;

  select coalesce(sum(p.montant), 0) into v_encaisse
    from public.paiements p
   where p.entreprise_id = new.entreprise_id and p.facture_id = new.facture_id
     and p.annule_le is null;
  select coalesce(sum(a.ttc), 0) into v_avoirs
    from public.factures a
   where a.entreprise_id = new.entreprise_id and a.facture_origine_id = new.facture_id
     and public.est_un_avoir(a.type_code);
  if v_encaisse + new.montant > v_net - v_avoirs then
    raise exception 'PAIEMENT_EXCESSIF';
  end if;

  -- Le compte connecté, quoi qu'on propose ; sans compte, la valeur donnée est conservée.
  new.cree_par := coalesce(v_compte, new.cree_par);
  return new;
end;
$corps$;

create trigger paiements_avant_insertion
  before insert on public.paiements
  for each row execute function public.controler_paiement();

-- Un paiement ne change que par son annulation, et celle-ci est datée par le serveur, puis figée :
--   - aucune colonne autre que `annule_le` ne bouge. La comparaison porte sur toute la ligne sauf
--     `annule_le`, de sorte qu'une colonne ajoutée plus tard est protégée sans qu'on y pense ;
--   - au passage de `null` à une date, la date est l'heure du serveur, quelle que soit celle que le
--     client envoie : il ne choisit pas quand une annulation a eu lieu ;
--   - une fois posée, elle ne change plus et ne revient pas à `null` : réannuler un paiement déjà annulé
--     est une modification, donc refusé.
-- Un compte n'a le privilège que sur `annule_le` : ce garde-fou vise la date et les écritures hors de ce
-- rôle.
create function public.controler_annulation_paiement() returns trigger
language plpgsql
set search_path = ''
as $corps$
begin
  if to_jsonb(new) - 'annule_le' is distinct from to_jsonb(old) - 'annule_le' then
    raise exception 'PAIEMENT_ANNULATION';
  end if;
  if old.annule_le is not null then
    if new.annule_le is distinct from old.annule_le then
      raise exception 'PAIEMENT_ANNULATION';
    end if;
  elsif new.annule_le is not null then
    new.annule_le := now();
  end if;
  return new;
end;
$corps$;

create trigger paiements_avant_modification
  before update on public.paiements
  for each row execute function public.controler_annulation_paiement();

-- ---------------------------------------------------------------------------------------------
-- Privilèges des fonctions
-- ---------------------------------------------------------------------------------------------

-- Une fonction de déclencheur ne s'appelle pas d'elle-même, mais on ne laisse aucun accès ouvert.
revoke execute on function
  public.refuser_hors_purge(),
  public.tenir_numerotation(),
  public.versionner_brouillon(),
  public.controler_paiement(),
  public.controler_annulation_paiement()
from public, anon, authenticated;
