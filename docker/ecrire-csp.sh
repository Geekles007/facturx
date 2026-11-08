#!/bin/sh
# Écrit la CSP du site : le gabarit docker/csp.conf, avec l'origine du projet Supabase.
#
# Lancé à la CONSTRUCTION de l'image (voir le Dockerfile), pas au démarrage. L'URL est celle que
# `pnpm site:build` grave dans le bundle du Studio (argument FACTURX_SUPABASE_URL). Lue au
# démarrage, une variable d'exécution pourrait en différer : le Studio appellerait une origine que
# la CSP interdit (compte muet), ou la CSP en permettrait une que personne n'appelle. Écrites à
# partir du même argument, les deux disent la même chose.
#
# Usage : ecrire-csp.sh URL [GABARIT [SORTIE]]
#   URL      origine du projet (https://<projet>.supabase.co), ou rien : image sans compte
#   GABARIT  /etc/nginx/csp.gabarit par défaut
#   SORTIE   /etc/nginx/csp.conf par défaut, inclus par docker/nginx.conf
set -eu

gabarit="${2:-/etc/nginx/csp.gabarit}"
sortie="${3:-/etc/nginx/csp.conf}"

refuser() {
    echo "csp : FACTURX_SUPABASE_URL doit être une origine (https://<projet>.supabase.co), reçu « $url » — construction abandonnée" >&2
    exit 1
}

# Les espaces autour et les barres finales ne changent pas l'origine.
url=$(printf '%s' "${1-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's|/*$||')

# L'adresse est insérée telle quelle dans un en-tête et dans la configuration nginx : un espace, un
# point-virgule ou un guillemet y ajouterait une directive que personne n'a écrite. On n'admet donc
# que les caractères d'une origine, avant même de regarder sa forme.
case "$url" in
    *[!A-Za-z0-9.:/-]*) refuser ;;
esac
if [ -n "$url" ]; then
    printf '%s\n' "$url" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' || refuser
fi

if [ -z "$url" ]; then
    # Sans compte, connect-src se réduit à 'self' : ni espace ni jeton vide en trop.
    csp=$(sed 's| \${FACTURX_SUPABASE_URL}||' "$gabarit")
else
    csp=$(sed 's|\${FACTURX_SUPABASE_URL}|'"$url"'|' "$gabarit")
fi

# Un jeton qui resterait dans l'en-tête serait envoyé tel quel aux navigateurs.
case "$csp" in
    *'${'*) echo "csp : un jeton du gabarit n'a pas été remplacé — construction abandonnée" >&2; exit 1 ;;
esac

printf '%s\n' "$csp" >"$sortie"
echo "csp : connect-src 'self'${url:+ $url}" >&2
