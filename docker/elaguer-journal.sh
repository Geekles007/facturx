#!/bin/sh
# Efface du journal des statistiques les lignes de plus de 13 mois : la durée que la politique de
# confidentialité annonce (§ 5). Appelé chaque nuit par crond.
#
# La date d'une ligne est celle que nginx écrit entre crochets, suivie d'un espace et d'un
# guillemet. Rien de ce qui la précède ne peut l'imiter : l'adresse est tronquée par nginx, et
# $remote_user, que le visiteur choisit, ne peut pas contenir de guillemet (nginx l'écrit \x22).
# Une ligne sans date lisible part aussi : GoAccess l'écarte de toute façon.
set -eu

LOG=/var/log/nginx/access.log
MOIS=13

[ -s "$LOG" ] || exit 0

TRAVAIL=$(mktemp)
trap 'rm -f "$TRAVAIL"' EXIT

# nginx écrit chaque ligne d'un seul coup : à cette taille, le fichier finit sur une ligne entière.
taille=$(wc -c <"$LOG")
head -c "$taille" "$LOG" | awk -v aujourdhui="$(date +%Y%m%d)" -v mois="$MOIS" '
BEGIN {
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", noms, " ")
    for (i = 1; i <= 12; i++) numero[noms[i]] = i
    a = int(aujourdhui / 10000)
    m = int(aujourdhui / 100) % 100 - mois
    while (m < 1) { m += 12; a-- }
    limite = a * 10000 + m * 100 + aujourdhui % 100
}
match($0, /\[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9:]+ [-+][0-9]+\] "/) {
    d = substr($0, RSTART + 1, 11)
    if (substr(d, 8, 4) * 10000 + numero[substr(d, 4, 3)] * 100 + substr(d, 1, 2) >= limite) print
}
' >"$TRAVAIL"

# Les lignes que nginx a ajoutées pendant le tri restent, telles quelles.
tail -c +"$((taille + 1))" "$LOG" >>"$TRAVAIL"
# Réécrire le même fichier, sans le remplacer : nginx l'a ouvert en ajout et continue d'y écrire.
# Seule une ligne écrite entre ces deux commandes, à quelques microsecondes près, serait perdue.
cat "$TRAVAIL" >"$LOG"
