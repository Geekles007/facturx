#!/bin/sh
# Prépare le rapport de fréquentation, puis passe la main à nginx.
#
# Règle de conduite : les statistiques sont un agrément, le site est l'essentiel. Tout ce qui suit
# peut échouer sans empêcher nginx de démarrer — d'où les « || » un peu partout et l'absence de
# « set -e ». L'image contient déjà un /etc/nginx/stats.conf qui renvoie 404 : même si ce script
# n'était jamais exécuté, la configuration nginx resterait valide et le site servirait.
set -u

STATS_USER="${STATS_USER:-stats}"

activer_stats() {
    mkdir -p /var/log/nginx /var/lib/goaccess || return 1
    htpasswd -bc /etc/nginx/.htpasswd "$STATS_USER" "$STATS_PASSWORD" >/dev/null 2>&1 || return 1

    cat >/etc/nginx/stats.conf <<'CONF' || return 1
location /stats/ {
    auth_basic "Statistiques facturx";
    auth_basic_user_file /etc/nginx/.htpasswd;
    alias /var/lib/goaccess/;
    index report.html;
    autoindex off;
    # Consulter les statistiques ne doit pas alimenter les statistiques.
    access_log off;
    add_header Cache-Control "no-store";
}
CONF

    # Un rapport présent dès le premier démarrage, plutôt qu'un 404 le temps du premier passage.
    /usr/local/bin/goaccess-report.sh || echo "stats : rapport initial non généré"
    crond -b -l 8 || echo "stats : crond indisponible, le rapport ne se régénérera pas tout seul"
    return 0
}

if [ -n "${STATS_PASSWORD:-}" ]; then
    if activer_stats; then
        echo "stats : /stats/ servi, utilisateur « $STATS_USER », rapport toutes les 5 min"
    else
        # Échec de la mise en place : on remet le 404 plutôt que de laisser une page à demi montée.
        echo 'location /stats/ { return 404; }' >/etc/nginx/stats.conf
        echo "stats : mise en place impossible, /stats/ désactivé — le site, lui, démarre"
    fi
else
    # Pas de mot de passe, pas de page : mieux vaut rien qu'un tableau de bord ouvert à tous.
    echo 'location /stats/ { return 404; }' >/etc/nginx/stats.conf
    echo "stats : désactivé (STATS_PASSWORD non défini)"
fi

# Enchaîner sur l'entrypoint de l'image nginx : il traite /docker-entrypoint.d/ et les gabarits.
exec /docker-entrypoint.sh "$@"
