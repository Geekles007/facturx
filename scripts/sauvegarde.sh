#!/usr/bin/env bash
# Sauvegarde chiffrée du compte (spec § 11 : en plus des sauvegardes quotidiennes du plan Pro, un dump
# hebdomadaire chiffré, déposé chez un autre hébergeur européen). Lancée chaque dimanche par
# .github/workflows/sauvegarde.yml ; on peut la lancer à la main, ou en local (docs/compte.md).
#
#   scripts/sauvegarde.sh                  dépose l'archive chez Scaleway (fr-par) et applique la rétention
#   scripts/sauvegarde.sh --dossier <d>    écrit l'archive, chiffrée de même, dans le dossier <d> (essai)
#
# 1. Les données de la base (`pg_dump --data-only`) : le schéma `public` entier, et dans `auth` les seules
#    tables `users` et `identities` (les comptes et leurs mots de passe hachés). Le schéma, lui, se
#    reconstruit par les migrations ; les sessions se rouvrent ; les secrets du Vault ne se déchiffrent
#    que dans leur projet. La restauration est celle de scripts/restaurer.sh.
# 2. Les buckets privés `factures` et `fichiers`, par l'API S3 de Supabase Storage. Le bucket public
#    `polices` se redépose par `pnpm compte:polices`.
# 3. Une seule archive tar, chiffrée par `age` pour la clé publique `AGE_RECIPIENT` : la clé privée
#    n'est ni dans le dépôt ni dans GitHub, et ce script ne peut pas relire ce qu'il écrit.
# 4. Le dépôt chez Scaleway Object Storage, vérifié par sa taille, puis la rétention : les archives de
#    plus de 12 semaines sont effacées, et seulement après le dépôt réussi d'une nouvelle.
#
# Variables (secrets du dépôt GitHub, voir docs/compte.md) :
#   SAUVEGARDE_DB_URL                URL Postgres du projet (pooler en mode session, sslmode=require)
#   SUPABASE_S3_ENDPOINT             https://<ref>.storage.supabase.co/storage/v1/s3
#   SUPABASE_S3_REGION               la région du projet (eu-west-3)
#   SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY    clés S3 du stockage Supabase
#   SCALEWAY_S3_BUCKET               le bucket des sauvegardes (sans --dossier)
#   SCALEWAY_S3_ACCESS_KEY_ID, SCALEWAY_S3_SECRET_ACCESS_KEY    clés Scaleway (sans --dossier)
#   AGE_RECIPIENT                    la ou les clés publiques age (age1…), séparées par des espaces
# Facultatives : PG_DUMP et PSQL (chemins des outils, de la version majeure du serveur ou plus),
# SCALEWAY_S3_ENDPOINT et SCALEWAY_S3_REGION (fr-par par défaut).
#
# Échoue bruyamment à la première étape qui échoue. Ce qui est en clair (le dump, les fichiers) ne vit
# que dans un dossier temporaire privé, effacé dès l'archive chiffrée et en toute sortie. Le journal ne
# dit ni secret ni contenu : le dépôt est public, ses journaux d'Actions aussi.
set -euo pipefail
umask 077

readonly SCALEWAY_S3_ENDPOINT="${SCALEWAY_S3_ENDPOINT:-https://s3.fr-par.scw.cloud}"
readonly SCALEWAY_S3_REGION="${SCALEWAY_S3_REGION:-fr-par}"
# Le dossier des archives dans le bucket, et leur durée de vie : 12 semaines.
readonly PREFIXE='facturx/'
readonly RETENTION_JOURS=84
readonly PG_DUMP="${PG_DUMP:-pg_dump}"
readonly PSQL="${PSQL:-psql}"
BUCKETS=(factures fichiers)

echec() {
  echo "sauvegarde : $*" >&2
  exit 1
}

dossier=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dossier)
      [[ $# -ge 2 ]] || echec '--dossier attend un chemin.'
      dossier="$2"
      shift 2
      ;;
    *) echec "argument inconnu : $1" ;;
  esac
done

# --- Ce qu'il faut avant de commencer : rien n'est lu ni écrit si quelque chose manque.
manquants=()
for outil in "$PG_DUMP" "$PSQL" aws age jq tar; do
  command -v "$outil" >/dev/null 2>&1 || manquants+=("$outil")
done
[[ ${#manquants[@]} -eq 0 ]] || echec "outils absents : ${manquants[*]}."

requises=(SAUVEGARDE_DB_URL SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION SUPABASE_S3_ACCESS_KEY_ID
  SUPABASE_S3_SECRET_ACCESS_KEY AGE_RECIPIENT)
[[ -n "$dossier" ]] || requises+=(SCALEWAY_S3_BUCKET SCALEWAY_S3_ACCESS_KEY_ID
  SCALEWAY_S3_SECRET_ACCESS_KEY)
manquants=()
for nom in "${requises[@]}"; do
  [[ -n "${!nom:-}" ]] || manquants+=("$nom")
done
[[ ${#manquants[@]} -eq 0 ]] || echec "variables absentes ou vides : ${manquants[*]}."

# Les destinataires de l'archive : des clés publiques. Une clé privée collée là par erreur serait
# écrite dans les secrets de GitHub ; on refuse sans la répéter.
destinataires=()
read -r -a cles <<<"$(tr ',\n' '  ' <<<"$AGE_RECIPIENT")"
for destinataire in ${cles[@]+"${cles[@]}"}; do
  case "$destinataire" in
    AGE-SECRET-KEY-*)
      echec 'AGE_RECIPIENT contient une clé PRIVÉE age : n’y mettre que la clé publique (age1…).'
      ;;
    age1*) destinataires+=(-r "$destinataire") ;;
    *) echec 'AGE_RECIPIENT : une clé publique age (age1…) attendue.' ;;
  esac
done
[[ ${#destinataires[@]} -gt 0 ]] || echec 'AGE_RECIPIENT : aucune clé publique.'

travail=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sauvegarde.XXXXXX")
trap 'rm -rf "$travail"' EXIT
clair="$travail/clair"
mkdir -p "$clair/stockage"

# --- Le client S3 (AWS CLI) pour les deux hébergeurs : adresses en chemin (l'API S3 de Supabase est sous
# /storage/v1/s3, elle n'a pas de sous-domaine par bucket), et sommes de contrôle seulement quand
# l'opération les exige (les versions récentes du CLI en ajoutent par défaut, que des services
# compatibles S3 refusent). Aucun profil local, aucune métadonnée de machine : les seules clés sont
# celles passées à chaque commande.
cat >"$travail/aws-config" <<'EOF'
[default]
s3 =
  addressing_style = path
request_checksum_calculation = when_required
response_checksum_validation = when_required
EOF
export AWS_CONFIG_FILE="$travail/aws-config"
export AWS_SHARED_CREDENTIALS_FILE=/dev/null
export AWS_EC2_METADATA_DISABLED=true
unset AWS_PROFILE AWS_SESSION_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

supabase_s3() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    aws --endpoint-url "$SUPABASE_S3_ENDPOINT" --region "$SUPABASE_S3_REGION" "$@"
}
scaleway_s3() {
  AWS_ACCESS_KEY_ID="$SCALEWAY_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SCALEWAY_S3_SECRET_ACCESS_KEY" \
    aws --endpoint-url "$SCALEWAY_S3_ENDPOINT" --region "$SCALEWAY_S3_REGION" "$@"
}

# --- 1. La base. Le rôle `postgres` est propriétaire des tables de `public` : la RLS ne filtre rien.
echo "sauvegarde : base ($("$PG_DUMP" --version))"
"$PG_DUMP" --dbname="$SAUVEGARDE_DB_URL" --data-only --no-owner --no-privileges \
  --table='public.*' --table=auth.users --table=auth.identities \
  --file="$clair/donnees.sql"

# Les lignes de chaque table, comptées dans le dump lui-même (entre `COPY … FROM stdin;` et `\.`) :
# le manifeste les donne, la restauration les recompte.
lignes=$(awk '
  /^COPY .* FROM stdin;$/ { table = $2; n = 0; next }
  table != "" && $0 == "\\." { print table, n; table = ""; next }
  table != "" { n++ }
' "$clair/donnees.sql")
for table in public.entreprises public.membres public.factures auth.users auth.identities; do
  grep -q "^$table " <<<"$lignes" || echec "le dump n'a pas la table $table : sauvegarde abandonnée."
done

# Les migrations appliquées : la restauration exige au moins celles-ci dans la base qu'elle remplit.
migrations=$("$PSQL" "$SAUVEGARDE_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c 'select version from supabase_migrations.schema_migrations order by version')
[[ -n "$migrations" ]] || echec 'aucune migration lue dans supabase_migrations.schema_migrations.'

# --- 2. Les buckets. On liste avant de copier : tout objet listé doit être arrivé (un objet déposé entre
# les deux peut s'ajouter, jamais en manquer).
objets=''
for bucket in "${BUCKETS[@]}"; do
  echo "sauvegarde : bucket $bucket"
  # Sur un bucket vide, l'AWS CLI n'écrit en général rien : `jq -s` lit alors un tableau vide et
  # donne 0 (sans `-s`, jq ne sortirait rien).
  attendus=$(supabase_s3 s3api list-objects-v2 --bucket "$bucket" --output json |
    jq -s '(.[0].Contents // []) | length')
  [[ "$attendus" =~ ^[0-9]+$ ]] || echec "bucket $bucket : liste illisible."
  mkdir -p "$clair/stockage/$bucket"
  supabase_s3 s3 sync "s3://$bucket" "$clair/stockage/$bucket" --only-show-errors --no-progress
  recus=$(find "$clair/stockage/$bucket" -type f | wc -l | tr -d ' ')
  [[ "$recus" -ge "$attendus" ]] ||
    echec "bucket $bucket : $attendus objets listés, $recus reçus. Sauvegarde abandonnée."
  objets+="$bucket $recus"$'\n'
done

# --- Le manifeste, dans l'archive : de quoi vérifier une restauration sans rien deviner.
{
  echo 'facturx — sauvegarde du compte'
  echo "date : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "pg_dump : $("$PG_DUMP" --version)"
  { grep -m1 '^-- Dumped from database version' "$clair/donnees.sql" || true; } | sed 's/^-- //'
  echo
  echo '[migrations]'
  echo "$migrations"
  echo
  echo '[lignes]'
  echo "$lignes"
  echo
  echo '[objets]'
  printf '%s' "$objets"
} >"$clair/manifeste.txt"

# --- 3. L'archive chiffrée ; le clair est effacé aussitôt.
nom="facturx-$(date -u +%Y-%m-%dT%H%M%SZ).tar.age"
archive="$travail/$nom"
tar -C "$clair" -cf - manifeste.txt donnees.sql stockage | age "${destinataires[@]}" -o "$archive"
rm -rf "$clair"
[[ "$(head -c 21 "$archive")" == 'age-encryption.org/v1' ]] || echec "l'archive n'est pas chiffrée par age."
taille=$(wc -c <"$archive" | tr -d ' ')

# --- 4. Le dépôt et la rétention.
if [[ -n "$dossier" ]]; then
  mkdir -p "$dossier"
  mv "$archive" "$dossier/$nom"
  echo "sauvegarde : $nom ($taille octets) écrite dans $dossier"
  exit 0
fi

cle="$PREFIXE$nom"
scaleway_s3 s3 cp "$archive" "s3://$SCALEWAY_S3_BUCKET/$cle" --only-show-errors --no-progress
depose=$(scaleway_s3 s3api head-object --bucket "$SCALEWAY_S3_BUCKET" --key "$cle" \
  --query ContentLength --output text)
[[ "$depose" == "$taille" ]] ||
  echec "dépôt : $taille octets envoyés, $depose dans le bucket. Rétention non appliquée."
echo "sauvegarde : $cle ($taille octets) déposée et vérifiée"

# Les archives de ce dossier dont la date (UTC) précède la limite. La nouvelle, déposée à l'instant, ne
# l'est jamais : il en reste toujours au moins une.
s=$(($(date -u +%s) - RETENTION_JOURS * 86400))
limite=$(date -u -d "@$s" +%F 2>/dev/null || date -u -r "$s" +%F)
anciennes=$(scaleway_s3 s3api list-objects-v2 --bucket "$SCALEWAY_S3_BUCKET" --prefix "$PREFIXE" \
  --output json |
  jq -rs --arg limite "$limite" '(.[0].Contents // [])[]
    | select((.Key | endswith(".tar.age")) and .LastModified[0:10] < $limite) | .Key')
effacees=0
while IFS= read -r ancienne; do
  [[ -n "$ancienne" && "$ancienne" != "$cle" ]] || continue
  scaleway_s3 s3 rm "s3://$SCALEWAY_S3_BUCKET/$ancienne" --only-show-errors
  effacees=$((effacees + 1))
done <<<"$anciennes"
echo "sauvegarde : rétention de $RETENTION_JOURS jours, $effacees archive(s) antérieure(s) au $limite effacée(s)"
