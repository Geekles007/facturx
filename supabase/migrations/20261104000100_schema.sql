-- Schéma du compte (spec § 6, sécurité § 11) : les tables, la RLS, et l'entreprise que l'inscription
-- crée avec le compte.
--
-- Principes :
--   - toute table métier porte `entreprise_id`, et chaque règle passe par `mes_entreprises()` ;
--   - la RLS est activée partout, et les privilèges sont retirés puis accordés un à un : sans règle
--     d'écriture ni privilège, un compte ne peut rien écrire (TRUNCATE compris, que la RLS ne retient
--     pas) ;
--   - les montants sont en centimes (`bigint`), les dates d'affaires en `date`.
-- Les déclencheurs qui figent les factures, tiennent la numérotation et contrôlent les paiements
-- viennent avec la migration suivante.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.entreprises (
  id uuid primary key default gen_random_uuid(),
  -- `CompanyProfile` du Studio.
  profil jsonb not null,
  -- L'apparence que le Studio conserve en local sous la clé `appearance-default`.
  apparence_defaut jsonb,
  cree_le timestamptz not null default now(),
  suppression_demandee_le timestamptz
);

create table public.membres (
  entreprise_id uuid not null references public.entreprises on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'titulaire' check (role = 'titulaire'),
  cgu_version text not null check (cgu_version <> ''),
  cgu_acceptees_le timestamptz not null default now(),
  primary key (entreprise_id, user_id)
);
-- `mes_entreprises()` cherche par `user_id`, que la clé primaire ne couvre pas.
create index membres_user_id_idx on public.membres (user_id);

-- Les `id` de `clients` et `produits` sont des `uid` du Studio, d'où le type `text`.
create table public.clients (
  id text primary key,
  entreprise_id uuid not null references public.entreprises on delete cascade,
  -- `FormParty`.
  party jsonb not null,
  nom text not null,
  email text,
  modifie_le timestamptz not null default now()
);
create index clients_entreprise_id_idx on public.clients (entreprise_id);

create table public.produits (
  id text primary key,
  entreprise_id uuid not null references public.entreprises on delete cascade,
  -- `ProductRecord` sans `uid`.
  fiche jsonb not null,
  nom text not null,
  modifie_le timestamptz not null default now()
);
create index produits_entreprise_id_idx on public.produits (entreprise_id);

create table public.brouillons (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises on delete cascade,
  form jsonb not null,
  appearance jsonb,
  version int not null default 1,
  modifie_le timestamptz not null default now()
);
create index brouillons_entreprise_id_idx on public.brouillons (entreprise_id);

create table public.numerotation (
  entreprise_id uuid primary key references public.entreprises on delete cascade,
  gabarit text not null,
  prochain int not null check (prochain >= 1),
  annuelle boolean not null,
  annee int not null
);

-- Une facture émise ne change plus (déclencheur de la migration suivante). Ses montants sont ceux de
-- `invoice.totals` : `ht` (BT-109), `ttc` (BT-112) et `net_a_payer` (BT-115).
--
-- Trois références n'ont volontairement pas de clé étrangère, parce que la facture ne doit jamais
-- être touchée par ce qui l'entoure : `client_id` (le client peut être supprimé, `client_nom` et
-- `client_email` gardent ce qui figurait sur la facture), `brouillon_id` (le brouillon est supprimé à
-- l'émission, et la clé unique rend l'émission rejouable sans doublon) et `emise_par` (un compte
-- supprimé laisse la trace de qui a émis). `brouillon_id` est nul pour une facture importée.
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises on delete cascade,
  numero text not null,
  type_code text not null check (type_code ~ '^[0-9]{3}$'),
  date_emission date not null,
  date_echeance date,
  client_id text,
  client_nom text not null,
  client_email text,
  devise text not null check (devise ~ '^[A-Z]{3}$'),
  ht bigint not null,
  ttc bigint not null,
  net_a_payer bigint not null,
  invoice jsonb not null,
  form jsonb not null,
  appearance jsonb not null,
  pdf_chemin text not null,
  sdk_version text not null,
  facture_origine_id uuid,
  brouillon_id uuid unique,
  origine text not null check (origine in ('emise', 'importee')),
  emise_le timestamptz not null default now(),
  emise_par uuid not null,
  unique (entreprise_id, numero),
  -- Cible des clés étrangères composites : une référence ne sort jamais de son entreprise.
  unique (entreprise_id, id),
  foreign key (entreprise_id, facture_origine_id) references public.factures (entreprise_id, id)
);
create index factures_origine_idx on public.factures (entreprise_id, facture_origine_id);

-- Jamais supprimé, seulement annulé (`annule_le`). `cree_par` est `not null` : le déclencheur de la
-- migration suivante le fixe à `auth.uid()`.
create table public.paiements (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises on delete cascade,
  facture_id uuid not null,
  date date not null,
  montant bigint not null check (montant > 0),
  moyen text not null check (moyen in ('virement', 'cheque', 'especes', 'carte', 'prelevement', 'autre')),
  note text,
  cree_le timestamptz not null default now(),
  cree_par uuid not null,
  annule_le timestamptz,
  foreign key (entreprise_id, facture_id) references public.factures (entreprise_id, id) on delete cascade
);
create index paiements_facture_idx on public.paiements (entreprise_id, facture_id);

-- Écrite par l'Edge Function `relancer` seulement ; une relance refusée par le service d'envoi
-- (`etat = 'refusee'`) n'a pas de `message_id`.
create table public.relances (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises on delete cascade,
  facture_id uuid not null,
  niveau int not null check (niveau between 1 and 3),
  envoyee_le timestamptz not null default now(),
  destinataire text not null,
  objet text not null,
  corps text not null,
  message_id text,
  etat text not null check (etat in ('envoyee', 'refusee')),
  foreign key (entreprise_id, facture_id) references public.factures (entreprise_id, id) on delete cascade
);
create index relances_facture_idx on public.relances (entreprise_id, facture_id);

-- ---------------------------------------------------------------------------------------------
-- Les entreprises d'un compte
-- ---------------------------------------------------------------------------------------------

-- `security definer` : elle lit `membres` sans repasser par ses règles, qui l'appellent. Le chemin de
-- recherche vide empêche qu'un objet du même nom, créé dans un autre schéma, la détourne : tous les
-- noms du corps sont qualifiés.
create function public.mes_entreprises() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $corps$
  select m.entreprise_id from public.membres m where m.user_id = (select auth.uid())
$corps$;

revoke execute on function public.mes_entreprises() from public, anon;
grant execute on function public.mes_entreprises() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Inscription : le compte reçoit son entreprise
-- ---------------------------------------------------------------------------------------------

-- Crée l'entreprise (profil vide, comme `defaultCompany()` du Studio), le membre titulaire et la
-- numérotation. Sans l'acceptation des CGU dans les métadonnées de l'inscription
-- (`options.data.cgu`), l'inscription est refusée : l'insertion dans `auth.users` échoue, et l'API
-- d'authentification répond par une erreur de base de données.
--
-- Ce que `defaultCompany()` produit de non constant, c'est l'`uid` du moyen de paiement (l'heure et un
-- compteur) : il est figé à `u0`. Le Studio complète de toute façon le profil lu par ses valeurs par
-- défaut, et donne un `uid` neuf à chaque facture.
create function public.creer_entreprise_a_l_inscription() returns trigger
language plpgsql
security definer
set search_path = ''
as $corps$
declare
  v_cgu text := nullif(btrim(new.raw_user_meta_data ->> 'cgu'), '');
  v_entreprise uuid;
begin
  if v_cgu is null then
    raise exception 'CGU_ABSENTES';
  end if;

  insert into public.entreprises (profil)
  values ('{
    "seller": {
      "name": "", "tradingName": "", "siren": "", "siret": "", "vatId": "",
      "taxRegistrationId": "", "legalInfo": "",
      "address": {
        "line1": "", "line2": "", "line3": "", "postCode": "", "city": "",
        "countrySubdivision": "", "countryCode": "FR"
      },
      "contact": { "name": "", "phone": "", "email": "" },
      "electronicAddress": { "value": "", "scheme": "0225" },
      "routingCode": "",
      "consumer": false
    },
    "paymentMeans": [{
      "uid": "u0", "typeCode": "58", "text": "", "iban": "", "bic": "", "accountName": "",
      "mandateReference": "", "creditorId": "", "debitedIban": ""
    }],
    "defaults": {
      "operationCategory": "services", "vat": "S:20", "currency": "EUR", "paymentDays": 30,
      "endOfMonth": false, "latePenaltyRate": "10", "recoveryIndemnity": "40",
      "vatOnDebits": false, "notes": []
    }
  }'::jsonb)
  returning id into v_entreprise;

  insert into public.membres (entreprise_id, user_id, role, cgu_version)
  values (v_entreprise, new.id, 'titulaire', v_cgu);

  -- L'année courante est celle de Paris : à minuit, la nuit du 31 décembre, UTC retarde.
  insert into public.numerotation (entreprise_id, gabarit, prochain, annuelle, annee)
  values (
    v_entreprise,
    'F-{AAAA}-{NNNN}',
    1,
    true,
    extract(year from now() at time zone 'Europe/Paris')::int
  );

  return new;
end;
$corps$;

-- Une fonction de déclencheur ne s'appelle pas d'elle-même, mais on ne laisse aucun accès ouvert.
revoke execute on function public.creer_entreprise_a_l_inscription() from public, anon, authenticated;

create trigger creer_entreprise_a_l_inscription
  after insert on auth.users
  for each row execute function public.creer_entreprise_a_l_inscription();

-- ---------------------------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------------------------

-- Supabase accorde tout à `anon` et `authenticated` sur chaque table créée : on le retire, puis on
-- n'accorde que ce que les règles ci-dessous visent. `service_role` (les Edge Functions) garde ses
-- droits et ne passe pas par la RLS.
revoke all on
  public.entreprises, public.membres, public.clients, public.produits, public.brouillons,
  public.numerotation, public.factures, public.paiements, public.relances
from anon, authenticated;

grant select on
  public.entreprises, public.membres, public.clients, public.produits, public.brouillons,
  public.numerotation, public.factures, public.paiements, public.relances
to authenticated;

grant insert, update, delete on public.clients, public.produits, public.brouillons to authenticated;

-- Une entreprise ne se crée ni ne se supprime depuis le navigateur, et seuls son profil et son
-- apparence par défaut s'y modifient (`suppression_demandee_le` passe par une Edge Function).
-- (Le `revoke all` ci-dessus a déjà retiré le `update` de la table entière.)
grant update (profil, apparence_defaut) on public.entreprises to authenticated;

-- Le gabarit, `annuelle` et `prochain` se règlent depuis le Studio ; le déclencheur de la migration
-- suivante interdit de reculer `prochain` et de changer `annee`.
grant update on public.numerotation to authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS : refus par défaut, chaque règle passe par `mes_entreprises()`
-- ---------------------------------------------------------------------------------------------

alter table public.entreprises enable row level security;
alter table public.membres enable row level security;
alter table public.clients enable row level security;
alter table public.produits enable row level security;
alter table public.brouillons enable row level security;
alter table public.numerotation enable row level security;
alter table public.factures enable row level security;
alter table public.paiements enable row level security;
alter table public.relances enable row level security;

-- Lecture : toutes les tables.
create policy entreprises_lecture on public.entreprises
  for select to authenticated using (id in (select public.mes_entreprises()));
create policy membres_lecture on public.membres
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy clients_lecture on public.clients
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy produits_lecture on public.produits
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy brouillons_lecture on public.brouillons
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy numerotation_lecture on public.numerotation
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy factures_lecture on public.factures
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy paiements_lecture on public.paiements
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));
create policy relances_lecture on public.relances
  for select to authenticated using (entreprise_id in (select public.mes_entreprises()));

-- Écriture libre : clients, produits, brouillons.
create policy clients_insertion on public.clients
  for insert to authenticated with check (entreprise_id in (select public.mes_entreprises()));
create policy clients_modification on public.clients
  for update to authenticated
  using (entreprise_id in (select public.mes_entreprises()))
  with check (entreprise_id in (select public.mes_entreprises()));
create policy clients_suppression on public.clients
  for delete to authenticated using (entreprise_id in (select public.mes_entreprises()));

create policy produits_insertion on public.produits
  for insert to authenticated with check (entreprise_id in (select public.mes_entreprises()));
create policy produits_modification on public.produits
  for update to authenticated
  using (entreprise_id in (select public.mes_entreprises()))
  with check (entreprise_id in (select public.mes_entreprises()));
create policy produits_suppression on public.produits
  for delete to authenticated using (entreprise_id in (select public.mes_entreprises()));

create policy brouillons_insertion on public.brouillons
  for insert to authenticated with check (entreprise_id in (select public.mes_entreprises()));
create policy brouillons_modification on public.brouillons
  for update to authenticated
  using (entreprise_id in (select public.mes_entreprises()))
  with check (entreprise_id in (select public.mes_entreprises()));
create policy brouillons_suppression on public.brouillons
  for delete to authenticated using (entreprise_id in (select public.mes_entreprises()));

-- Mise à jour seule : entreprises (colonnes limitées par les privilèges) et numérotation.
create policy entreprises_modification on public.entreprises
  for update to authenticated
  using (id in (select public.mes_entreprises()))
  with check (id in (select public.mes_entreprises()));
create policy numerotation_modification on public.numerotation
  for update to authenticated
  using (entreprise_id in (select public.mes_entreprises()))
  with check (entreprise_id in (select public.mes_entreprises()));

-- Aucune règle d'écriture ici pour `membres`, `factures`, `relances` et `paiements` (les paiements
-- ont les leurs à la migration suivante) : les factures et les relances s'écrivent depuis les Edge
-- Functions seulement.
