#!/bin/sh
# Régénère le rapport GoAccess à partir du journal d'accès nginx.
# Appelé au démarrage puis toutes les cinq minutes par crond.
set -eu

LOG=/var/log/nginx/access.log
OUT=/var/lib/goaccess/report.html

mkdir -p /var/lib/goaccess

# Journal absent ou vide : garder une page lisible plutôt qu'une erreur GoAccess.
if [ ! -s "$LOG" ]; then
    [ -f "$OUT" ] || cat >"$OUT" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Statistiques</title>
<body style="font:16px system-ui;margin:4rem auto;max-width:40rem;padding:0 1rem">
<h1>Aucune visite enregistrée</h1>
<p>Le journal d'accès est vide. Le rapport se remplira à la première visite,
puis se régénérera toutes les cinq minutes.</p>
HTML
    exit 0
fi

# Le journal entier est relu à chaque fois : aucun état à tenir, donc aucun risque de compter
# deux fois la même visite. L'historique tient dans le fichier, que le volume rend persistant.
#
# --ignore-crawlers : sans lui, les robots d'indexation gonflent le nombre de visites.
# Les adresses sont déjà tronquées à l'écriture (log_format « anonyme » dans nginx.conf).
goaccess "$LOG" \
    --log-format=COMBINED \
    --ignore-crawlers \
    --html-report-title="facturx.ibird.dev" \
    -o "$OUT.tmp"

# Remplacement atomique : jamais de rapport à moitié écrit servi à un lecteur.
mv "$OUT.tmp" "$OUT"
