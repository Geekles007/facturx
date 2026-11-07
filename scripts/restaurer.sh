#!/usr/bin/env bash
# Restaure une archive de scripts/sauvegarde.sh dans une base dont les migrations viennent d'être
# rejouées, et vide : la pile locale après `supabase db reset`, ou un projet neuf après `supabase db
# push`. Le pas à pas est dans docs/compte.md (« Restaurer une sauvegarde »).
#
#   scripts/restaurer.sh <archive.tar.age> --cle <clé privée age> --pile-locale
#   scripts/restaurer.sh <archive.tar.age> --cle <clé privée age>      (cible dans RESTAURATION_*)
#
# --pile-locale lit l'adresse de la base et les clés S3 de la pile locale (`supabase status`), sans les
# afficher. Sinon : RESTAURATION_DB_URL, RESTAURATION_S3_ENDPOINT, RESTAURATION_S3_REGION,
# RESTAURATION_S3_ACCESS_KEY_ID et RESTAURATION_S3_SECRET_ACCESS_KEY désignent la cible.
#
# 1. Déchiffre et ouvre l'archive dans un dossier temporaire privé, effacé en toute sortie.
# 2. Refuse une cible qui a déjà un compte, une entreprise ou un fichier, ou à laquelle manque une
#    migration de la sauvegarde : rien n'est écrit.
# 3. Rejoue les données en une seule transaction, déclencheurs suspendus (`session_replication_role =
#    replica`). Une restauration logique les rejouerait sinon : le déclencheur de l'inscription créerait
#    une seconde entreprise par compte, et le contrôle des paiements refuserait des lignes valides (un
#    paiement saisi avant l'avoir qui solde sa facture dépasse, relu après lui, le reste dû :
#    PAIEMENT_EXCESSIF). Les données viennent d'un même instantané : elles sont déjà cohérentes.
# 4. Renvoie les fichiers dans les buckets `factures` (PDF) et `fichiers`, avec leur type : ce bucket
#    n'admet que PNG, JPEG et TTF, reconnus à leurs premiers octets comme à l'envoi depuis le Studio.
# 5. Recompte lignes et objets et les compare au manifeste de l'archive.
set -euo pipefail
umask 077

echec() {
  echo "restauration : $*" >&2
  exit 1
}

racine=$(cd "$(dirname "$0")/.." && pwd -P)
archive=''
cle=''
pile_locale=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cle)
      [[ $# -ge 2 ]] || echec '--cle attend le fichier de la clé privée age.'
      cle="$2"
      shift 2
      ;;
    --pile-locale)
      pile_locale=1
      shift
      ;;
    -*) echec "option inconnue : $1" ;;
    *)
      [[ -z "$archive" ]] || echec 'une seule archive à la fois.'
      archive="$1"
      shift
      ;;
  esac
done
[[ -n "$archive" && -f "$archive" ]] || echec 'archive .tar.age absente (premier argument).'
[[ -n "$cle" && -f "$cle" ]] || echec 'clé privée age absente (--cle <fichier>).'

manquants=()
for outil in age aws jq psql tar od; do
  command -v "$outil" >/dev/null 2>&1 || manquants+=("$outil")
done
[[ ${#manquants[@]} -eq 0 ]] || echec "outils absents : ${manquants[*]}."

if [[ -n "$pile_locale" ]]; then
  command -v supabase >/dev/null 2>&1 || echec 'CLI supabase absent.'
  while IFS='=' read -r nom valeur; do
    valeur="${valeur%\"}"
    valeur="${valeur#\"}"
    case "$nom" in
      DB_URL) RESTAURATION_DB_URL="$valeur" ;;
      STORAGE_S3_URL) RESTAURATION_S3_ENDPOINT="$valeur" ;;
      S3_PROTOCOL_REGION) RESTAURATION_S3_REGION="$valeur" ;;
      S3_PROTOCOL_ACCESS_KEY_ID) RESTAURATION_S3_ACCESS_KEY_ID="$valeur" ;;
      S3_PROTOCOL_ACCESS_KEY_SECRET) RESTAURATION_S3_SECRET_ACCESS_KEY="$valeur" ;;
    esac
  done < <(cd "$racine" && supabase status -o env 2>/dev/null)
  case "${RESTAURATION_DB_URL:-}" in
    *@127.0.0.1:* | *@localhost:*) ;;
    *) echec 'la pile locale ne répond pas (supabase start), ou son adresse n’est pas locale.' ;;
  esac
fi
manquants=()
for nom in RESTAURATION_DB_URL RESTAURATION_S3_ENDPOINT RESTAURATION_S3_REGION \
  RESTAURATION_S3_ACCESS_KEY_ID RESTAURATION_S3_SECRET_ACCESS_KEY; do
  [[ -n "${!nom:-}" ]] || manquants+=("$nom")
done
[[ ${#manquants[@]} -eq 0 ]] || echec "variables absentes ou vides : ${manquants[*]}."

travail=$(mktemp -d "${TMPDIR:-/tmp}/restauration.XXXXXX")
trap 'rm -rf "$travail"' EXIT
clair="$travail/clair"
mkdir -p "$clair"

# Le client S3, réglé comme celui de la sauvegarde (adresses en chemin, sommes de contrôle seulement
# quand l'opération les exige), avec les seules clés de la cible.
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
cible_s3() {
  AWS_ACCESS_KEY_ID="$RESTAURATION_S3_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$RESTAURATION_S3_SECRET_ACCESS_KEY" \
    aws --endpoint-url "$RESTAURATION_S3_ENDPOINT" --region "$RESTAURATION_S3_REGION" "$@"
}
cible_sql() {
  psql "$RESTAURATION_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"
}
# Le nombre d'objets du bucket. Sur un bucket vide, l'AWS CLI n'écrit en général rien : `jq -s` lit
# alors un tableau vide et donne 0 (sans `-s`, jq ne sortirait rien). L'échec de l'appel est vérifié à
# part : dans `$(…)`, `set -e` ne joue pas, et une sortie vide passerait pour un bucket vide.
nombre_objets() {
  local sortie n
  sortie=$(cible_s3 s3api list-objects-v2 --bucket "$1" --output json) ||
    echec "bucket $1 : liste impossible."
  n=$(jq -s '(.[0].Contents // []) | length' <<<"$sortie")
  [[ "$n" =~ ^[0-9]+$ ]] || echec "bucket $1 : liste illisible."
  echo "$n"
}
# La section [titre] du manifeste, sans lignes vides.
section() {
  awk -v titre="[$1]" '$0 == titre { dedans = 1; next } /^\[/ { dedans = 0 } dedans && NF' \
    "$clair/manifeste.txt"
}

# --- 1. L'archive.
echo 'restauration : déchiffrement'
age -d -i "$cle" "$archive" | tar -xf - -C "$clair"
for fichier in manifeste.txt donnees.sql; do
  [[ -f "$clair/$fichier" ]] || echec "l'archive n'a pas $fichier : ce n'est pas une sauvegarde de facturx."
done
sed -n '1,4p' "$clair/manifeste.txt"

# --- 2. La cible : migrations au moins égales, et vide.
appliquees=$(cible_sql -c 'select version from supabase_migrations.schema_migrations order by version')
absentes=$(comm -23 <(section migrations | sort) <(sort <<<"$appliquees"))
[[ -z "$absentes" ]] ||
  echec "migrations de la sauvegarde absentes de la cible : $(tr '\n' ' ' <<<"$absentes")— rejouez-les d'abord."
en_plus=$(comm -13 <(section migrations | sort) <(sort <<<"$appliquees"))
[[ -z "$en_plus" ]] ||
  echo "restauration : la cible a des migrations plus récentes que la sauvegarde : $(tr '\n' ' ' <<<"$en_plus")"
occupee=$(cible_sql -c 'select (select count(*) from auth.users) + (select count(*) from public.entreprises)')
[[ "$occupee" == 0 ]] ||
  echec 'la cible a déjà des comptes ou des entreprises : restaurez dans une base vide (supabase db reset, ou un projet neuf).'
for bucket in factures fichiers; do
  n=$(nombre_objets "$bucket")
  [[ "$n" == 0 ]] || echec "le bucket $bucket de la cible n'est pas vide : rien n'a été écrit."
done

# --- 3. Les données, en une transaction, déclencheurs suspendus.
echo 'restauration : base'
cible_sql -c 'set session_replication_role = replica' -1 -f "$clair/donnees.sql" >/dev/null

# --- 4. Les fichiers, rangés par type puis envoyés type par type.
echo 'restauration : buckets'
tries="$travail/tries"
if [[ -d "$clair/stockage/fichiers" ]]; then
  while IFS= read -r -d '' fichier; do
    relatif="${fichier#"$clair/stockage/fichiers/"}"
    entete=$(head -c 4 "$fichier" | od -An -tx1 | tr -d ' \n')
    case "$entete" in
      89504e47) type=png ;;
      ffd8ff*) type=jpeg ;;
      00010000 | 74727565) type=ttf ;;
      *) echec "fichiers/$relatif : ni PNG, ni JPEG, ni TTF ; le bucket le refuserait." ;;
    esac
    mkdir -p "$(dirname "$tries/$type/$relatif")"
    mv "$fichier" "$tries/$type/$relatif"
  done < <(find "$clair/stockage/fichiers" -type f -print0)
fi
envoyer() { # <dossier> <bucket> <type MIME>
  [[ -d "$1" ]] || return 0
  cible_s3 s3 sync "$1" "s3://$2" --content-type "$3" --only-show-errors --no-progress
}
envoyer "$clair/stockage/factures" factures application/pdf
envoyer "$tries/png" fichiers image/png
envoyer "$tries/jpeg" fichiers image/jpeg
envoyer "$tries/ttf" fichiers font/ttf

# --- 5. Le compte : lignes et objets, contre le manifeste.
ecarts=0
while read -r table attendu; do
  [[ -n "$table" ]] || continue
  trouve=$(cible_sql -c "select count(*) from $table")
  if [[ "$trouve" != "$attendu" ]]; then
    echo "restauration : $table : $attendu lignes sauvegardées, $trouve restaurées" >&2
    ecarts=$((ecarts + 1))
  fi
done <<<"$(section lignes)"
while read -r bucket attendu; do
  [[ -n "$bucket" ]] || continue
  trouve=$(nombre_objets "$bucket")
  if [[ "$trouve" != "$attendu" ]]; then
    echo "restauration : bucket $bucket : $attendu objets sauvegardés, $trouve restaurés" >&2
    ecarts=$((ecarts + 1))
  fi
done <<<"$(section objets)"
[[ "$ecarts" == 0 ]] || echec "$ecarts écart(s) avec le manifeste."
echo "restauration : terminée, conforme au manifeste ($(section lignes | wc -l | tr -d ' ') tables, buckets factures et fichiers)"
