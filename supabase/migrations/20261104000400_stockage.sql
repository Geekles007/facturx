-- Stockage (spec § 6 et § 11) : les PDF émis, les logos et polices de l'utilisateur, et les polices du
-- Studio.
--
--   - `factures` (privé) : un PDF par facture émise, sous `{entreprise_id}/{facture_id}.pdf`. Les membres
--     de l'entreprise le lisent, donc le téléchargent et signent eux-mêmes son URL par l'API Storage, pour
--     la durée qu'ils choisissent : les 60 secondes de la spec valent pour les URL que le Studio demande,
--     la base ne les impose pas. Aucun compte n'y écrit : seules les Edge Functions, en `service_role`,
--     déposent et suppriment ;
--   - `fichiers` (privé, 2 Mo, PNG, JPEG et TTF) : le logo et la police de l'entreprise, sous
--     `{entreprise_id}/…`. Les membres y lisent, déposent, remplacent et suppriment ;
--   - `polices` (public) : les polices du Studio, déposées au déploiement par `pnpm compte:polices`
--     (`service_role`). Tout le monde les lit, personne d'autre n'y écrit.
--
-- Les règles s'appliquent à `storage.objects` pour les rôles `anon` et `authenticated` ; `service_role`
-- les ignore. Sans règle d'écriture, un compte ne peut rien écrire : c'est le cas de `factures` et de
-- `polices`, et de tout ce qui n'est pas `fichiers`.
--
-- Le dossier d'un objet se compare en texte et ne se convertit pas en `uuid` : un objet dont le premier
-- dossier n'est pas un uuid ferait lever `22P02` à la conversion, et avec elle échouer la lecture du
-- bucket pour tous les comptes. Le dossier est le premier segment du nom ; un nom sans dossier a un
-- dossier nul, qui ne correspond à rien.
--
-- La taille et le type des fichiers sont contrôlés par l'API Storage d'après les limites du bucket,
-- pas par une écriture en SQL. Elle s'en tient au type annoncé par l'envoi : la signature des octets
-- d'un logo ou d'une police se vérifie avant, jamais d'après l'extension (spec § 11).

-- ---------------------------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------------------------

-- `file_size_limit` est en octets : 2 Mo valent ici 2 × 1024 × 1024. Le logo (1 Mo au plus) est borné
-- plus finement à l'envoi.
-- `on conflict` : un bucket créé à la main (console, API) avant cette migration reçoit les mêmes réglages.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('factures', 'factures', false, null, null),
  ('fichiers', 'fichiers', false, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'font/ttf']),
  ('polices', 'polices', true, null, null)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------------------------
-- Règles de storage.objects
-- ---------------------------------------------------------------------------------------------

-- `factures` : lecture par les membres de l'entreprise du dossier. Pas de règle d'écriture.
create policy factures_lecture on storage.objects
  for select to authenticated
  using (
    bucket_id = 'factures'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  );

-- `fichiers` : lecture, dépôt, remplacement et suppression par les membres de l'entreprise du dossier.
-- `with check` de la modification : un objet ne se déplace ni chez une autre entreprise, ni hors des
-- dossiers d'entreprise, ni dans un autre bucket (`factures` y abriterait un faux PDF, `polices` le
-- publierait).
create policy fichiers_lecture on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  );

create policy fichiers_ajout on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  );

create policy fichiers_modification on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  )
  with check (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  );

create policy fichiers_suppression on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fichiers'
    and (storage.foldername(name))[1] in (select e::text from public.mes_entreprises() e)
  );

-- `polices` : lecture publique, y compris sans session. Le bucket est public : l'API sert aussi ses
-- fichiers par leur adresse, sans passer par cette règle ; elle ouvre la liste aux clients de l'API.
create policy polices_lecture on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'polices');
