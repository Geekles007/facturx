#!/bin/sh
# Régénère la page des compteurs, servie sur /stats/compteurs.html : jour par jour, les PDF
# produits par le Studio et les fichiers soumis au validateur. Appelé par goaccess-report.sh, donc
# au démarrage puis toutes les cinq minutes.
#
# GoAccess compte, ce script met en page. GoAccess ne reçoit que les lignes d'un compteur : son
# panneau des visiteurs par jour devient alors le décompte de ce compteur, jour par jour. Mêmes
# règles que le rapport principal — robots écartés, lignes illisibles rejetées —, donc mêmes
# chiffres : additionnés, les jours redonnent la ligne du compteur dans « Requested Files ».
set -eu

LOG=/var/log/nginx/access.log
OUT=/var/lib/goaccess/compteurs.html
OUT_EN_COURS=/var/lib/goaccess/.compteurs-en-cours.html

TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT
mkdir -p /var/lib/goaccess

# Les jours d'un compteur, un par ligne : « compteur AAAAMMJJ requêtes visiteurs ».
jours() {
    compteur=$1
    chemin=$2
    [ -s "$LOG" ] || return 0
    # Le chemin est cherché là où nginx écrit la ligne de requête, juste après l'horodatage, méthode
    # comprise : nginx échappe les guillemets d'un référent ou d'un navigateur (\x22), qui ne
    # peuvent donc pas l'imiter ; une requête HEAD ne compte pas non plus. grep rend 1 quand rien
    # ne correspond — ce n'est pas une erreur, juste un compteur qui n'a pas encore servi.
    grep -F "] \"GET $chemin HTTP/" "$LOG" >"$TRAVAIL/$compteur.log" || [ $? -eq 1 ]
    [ -s "$TRAVAIL/$compteur.log" ] || return 0
    # --max-items : sans lui, GoAccess s'arrête à 366 jours, et l'historique perdrait son début.
    goaccess - --log-format=COMBINED --ignore-crawlers --no-progress --max-items=100000 -o csv \
        <"$TRAVAIL/$compteur.log" >"$TRAVAIL/$compteur.csv"
    # Panneau « visitors » : les requêtes en 4ᵉ colonne, les visiteurs en 6ᵉ, le jour en dernière.
    # GoAccess termine ses lignes CSV par CRLF : le \r s'en va avec les guillemets.
    awk -F, -v compteur="$compteur" \
        '$3 == "\"visitors\"" { gsub(/["\r]/, ""); print compteur, $NF, $4, $6 }' \
        "$TRAVAIL/$compteur.csv"
}

{
    jours studio /studio/compteur/facture
    jours validateur /validateur/compteur/controle
} >"$TRAVAIL/jours"

# Premier jour du journal conservé (« 10/Sep/2026 », tel que nginx l'écrit) : la page dit jusqu'où
# remonte l'historique — et, s'il repart de zéro à chaque déploiement, que le volume manque.
DEBUT_JOURNAL=
if [ -s "$LOG" ]; then
    DEBUT_JOURNAL=$(head -n 1 "$LOG" | cut -d'[' -f2 | cut -d: -f1)
fi

cat >"$TRAVAIL/rendu.awk" <<'AWK'
BEGIN {
    split("janvier février mars avril mai juin juillet août septembre octobre novembre décembre", MOIS, " ")
    split("dim. lun. mar. mer. jeu. ven. sam.", JOURS, " ")
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", ABREGES, " ")
    for (i = 1; i <= 12; i++) NUMERO[ABREGES[i]] = i
    aujourdhui = strftime("%Y%m%d")
    il_y_a_6 = strftime("%Y%m%d", midi(aujourdhui) - 6 * 86400)
    il_y_a_29 = strftime("%Y%m%d", midi(aujourdhui) - 29 * 86400)
}

# « compteur AAAAMMJJ requêtes visiteurs », et rien d'autre : seuls des nombres et des dates
# vérifiés atteignent la page, jamais un octet du journal tel quel.
$1 ~ /^(studio|validateur)$/ && $2 ~ /^[0-9]+$/ && length($2) == 8 && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ {
    ajoute($2, $1, $3, $4)
    ajoute(substr($2, 1, 6), $1, $3, $4)
    ajoute("tout", $1, $3, $4)
    if ($2 == aujourdhui) ajoute("aujourdhui", $1, $3, $4)
    if ($2 >= il_y_a_6 && $2 <= aujourdhui) ajoute("7 jours", $1, $3, $4)
    if ($2 >= il_y_a_29 && $2 <= aujourdhui) ajoute("30 jours", $1, $3, $4)
    if ($3 + 0 > PIC[$1] + 0) PIC[$1] = $3 + 0
    if (premier == "" || $2 < premier) premier = $2
    if ($2 > dernier) dernier = $2
}

END {
    printf "<p class=\"maj\">Mis à jour le %s, toutes les cinq minutes.", strftime("%d/%m/%Y à %H:%M")
    if (debut_journal ~ /^[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]$/ && (substr(debut_journal, 4, 3) in NUMERO))
        printf " Journal d'accès conservé depuis le %s.", date_longue(substr(debut_journal, 8, 4) sprintf("%02d", NUMERO[substr(debut_journal, 4, 3)]) substr(debut_journal, 1, 2))
    print "</p>"

    if (premier == "") {
        print "<p class=\"vide\">Aucun décompte enregistré pour l'instant. La page se remplira au premier PDF produit par le Studio, ou au premier fichier soumis au validateur.</p>"
        exit
    }

    print "<div class=\"defile\"><table class=\"resume\">"
    print "<caption>En bref</caption>"
    entetes("Période")
    print "<tbody>"
    ligne("Aujourd'hui", "aujourdhui", " data-periode=\"aujourdhui\"", "row", 0)
    ligne("7 derniers jours", "7 jours", " data-periode=\"7-jours\"", "row", 0)
    ligne("30 derniers jours", "30 jours", " data-periode=\"30-jours\"", "row", 0)
    ligne("Depuis le " date_longue(premier), "tout", " data-periode=\"tout\"", "row", 0)
    print "</tbody></table></div>"

    # Tous les jours, ceux sans rien compris : un jour vide est une information, pas un trou.
    print "<div class=\"defile\"><table>"
    print "<caption>Jour par jour</caption>"
    entetes("Jour")
    mois = ""
    for (j = (dernier > aujourdhui ? dernier : aujourdhui); j >= premier; j = veille(j)) {
        if (substr(j, 1, 6) != mois) {
            if (mois != "") print "</tbody>"
            mois = substr(j, 1, 6)
            print "<tbody>"
            ligne(MOIS[substr(mois, 5, 2) + 0] " " substr(mois, 1, 4), mois,
                " class=\"mois\" data-mois=\"" mois "\"", "rowgroup", 0)
        }
        ligne(JOURS[strftime("%w", midi(j)) + 1] " " quantieme(j), j, " data-jour=\"" j "\"", "row", 1)
    }
    print "</tbody></table></div>"
}

function ajoute(cle, compteur, requetes, visiteurs) {
    N[cle, compteur] += requetes
    V[cle, compteur] += visiteurs
}

# Midi, heure locale, d'un jour AAAAMMJJ : de midi en midi, l'heure d'été ne fait ni sauter ni
# doubler un jour.
function midi(jour) {
    return mktime(substr(jour, 1, 4) " " substr(jour, 5, 2) " " substr(jour, 7, 2) " 12 00 00")
}

function veille(jour) {
    return strftime("%Y%m%d", midi(jour) - 86400)
}

function quantieme(jour) {
    return substr(jour, 7, 2) == "01" ? "1er" : substr(jour, 7, 2) + 0
}

function date_longue(jour) {
    return quantieme(jour) " " MOIS[substr(jour, 5, 2) + 0] " " substr(jour, 1, 4)
}

# 12345 → « 12 345 », groupé par une espace fine insécable, comme les montants du SDK.
function nombre(n,    chiffres, groupes) {
    chiffres = sprintf("%d", n)
    groupes = ""
    while (length(chiffres) > 3) {
        groupes = "&#8239;" substr(chiffres, length(chiffres) - 2) groupes
        chiffres = substr(chiffres, 1, length(chiffres) - 3)
    }
    return chiffres groupes
}

function entetes(premiere) {
    print "<colgroup><col class=\"jour\"><col class=\"n\"><col class=\"v\"><col class=\"n\"><col class=\"v\"></colgroup>"
    print "<thead>"
    print "<tr class=\"groupes\"><td></td><th scope=\"colgroup\" colspan=\"2\">Studio</th><th scope=\"colgroup\" colspan=\"2\">Validateur</th></tr>"
    print "<tr><th scope=\"col\">" premiere "</th><th scope=\"col\">Factures</th><th scope=\"col\">Visiteurs</th><th scope=\"col\">Contrôles</th><th scope=\"col\">Visiteurs</th></tr>"
    print "</thead>"
}

# Une ligne de tableau. Ses nombres sont repris en attributs data-, lisibles sans analyser le
# tableau : c'est ce que vérifie la CI (.github/workflows/image.yml).
function ligne(entete, cle, attributs, portee, barre) {
    printf "<tr%s data-studio=\"%d\" data-validateur=\"%d\"><th scope=\"%s\">%s</th>%s%s</tr>\n",
        attributs, N[cle, "studio"], N[cle, "validateur"], portee, entete,
        cellules(cle, "studio", barre), cellules(cle, "validateur", barre)
}

# Les deux cellules d'un compteur : le nombre, puis ses visiteurs. Sur une ligne de jour, une barre
# rapporte le nombre au jour le plus chargé de la colonne ; le nombre reste écrit en entier.
function cellules(cle, compteur, barre,    n, v, style) {
    n = N[cle, compteur] + 0
    v = V[cle, compteur] + 0
    style = barre && n > 0 ? sprintf(" style=\"--part:%.3f\"", n / PIC[compteur]) : ""
    return sprintf("<td class=\"n%s\"%s><span>%s</span></td><td class=\"v%s\">%s</td>",
        n ? "" : " zero", style, nombre(n), v ? "" : " zero", nombre(v))
}
AWK

{
    cat <<'HTML'
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<!-- Ni police, ni icône, ni feuille de style à charger : consulter les statistiques ne doit pas
     les alimenter, et la moindre ressource externe laisserait sa ligne dans le journal. -->
<link rel="icon" href="data:,">
<title>Compteurs · facturx.ibird.dev</title>
<style>
:root {
  --bg: #fafafa;
  --fg: #0a0a0a;
  --muted: #666;
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.16);
  --accent: #2f4bd8;
  --barre: rgba(47, 75, 216, 0.22);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000;
    --fg: #ededed;
    --muted: #a1a1a1;
    --border: rgba(255, 255, 255, 0.1);
    --border-strong: rgba(255, 255, 255, 0.2);
    --accent: #6b86ff;
    --barre: rgba(107, 134, 255, 0.42);
  }
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 400 15px / 1.5 "Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 46rem;
  margin: 0 auto;
  padding: 2.5rem 1rem 4rem;
}
a {
  color: var(--accent);
  text-underline-offset: 2px;
}
h1 {
  margin: 0.5rem 0 0.25rem;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.retour {
  margin: 0;
  font-size: 14px;
}
.maj,
.vide,
.notes {
  color: var(--muted);
}
.maj {
  margin: 0 0 2rem;
}
.defile {
  overflow-x: auto;
  margin-bottom: 2.5rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
/* Mêmes largeurs pour les deux tableaux : leurs colonnes tombent l'une sous l'autre. */
@media (min-width: 521px) {
  table {
    table-layout: fixed;
  }
  col.jour {
    width: 28%;
  }
  col.n {
    width: 23%;
  }
  col.v {
    width: 13%;
  }
}
caption {
  padding-bottom: 0.5rem;
  text-align: left;
  font-size: 17px;
  font-weight: 600;
}
th,
td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: right;
  font-weight: 400;
  white-space: nowrap;
}
th:first-child {
  text-align: left;
}
.resume tbody th,
tr.mois th {
  white-space: normal;
}
thead th {
  color: var(--muted);
  font-size: 13px;
}
thead .groupes th {
  color: var(--fg);
  text-align: center;
  font-weight: 500;
  border-bottom-color: var(--border-strong);
}
thead .groupes td {
  border-bottom: 0;
}
:is(th, td):nth-child(4),
thead .groupes th:nth-child(3) {
  padding-left: 1.5rem;
}
tr.mois > * {
  padding-top: 1.25rem;
  font-weight: 600;
  border-bottom-color: var(--border-strong);
}
td.n {
  position: relative;
}
/* La barre part de la gauche de la cellule, arrondie à son extrémité seulement, et s'arrête avant
   la place du nombre (3,5 em : quatre chiffres) : elle ne passe jamais dessous. */
td.n[style]::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0.5rem;
  width: calc((100% - 1rem - 3.5em) * var(--part));
  height: 12px;
  margin-top: -6px;
  border-radius: 0 4px 4px 0;
  background: var(--barre);
}
:is(th, td):nth-child(4)[style]::before {
  left: 1.5rem;
  width: calc((100% - 2rem - 3.5em) * var(--part));
}
td.n span {
  position: relative;
}
td.v,
td.zero {
  color: var(--muted);
}
.notes {
  font-size: 14px;
}
.notes p {
  margin: 0 0 0.75rem;
}
code {
  font: 13px ui-monospace, "SF Mono", Menlo, monospace;
}
@media (max-width: 520px) {
  body {
    font-size: 14px;
  }
  th,
  td {
    padding: 0.3rem 0.3rem;
  }
  :is(th, td):nth-child(4),
  thead .groupes th:nth-child(3) {
    padding-left: 0.75rem;
  }
  /* Trop étroit pour une barre lisible à côté du nombre : les chiffres suffisent. */
  td.n[style]::before {
    display: none;
  }
  thead th {
    font-size: 12px;
  }
}
</style>
</head>
<body>
<main>
<header>
<p class="retour"><a href="./">← Rapport complet</a></p>
<h1>Compteurs, jour par jour</h1>
</header>
HTML
    awk -v debut_journal="$DEBUT_JOURNAL" -f "$TRAVAIL/rendu.awk" "$TRAVAIL/jours"
    cat <<'HTML'
<div class="notes">
<p><strong>Factures</strong> : les PDF Factur-X produits par le Studio, émis ou téléchargés sans
émettre, pages française et anglaise réunies. <strong>Contrôles</strong> : les fichiers soumis au
validateur, exemples compris.</p>
<p><strong>Visiteurs</strong> : au sens de GoAccess, une adresse tronquée et un navigateur
distincts, un jour donné. Sur plusieurs jours, un visiteur qui revient compte une fois par jour.</p>
<p>Les robots sont écartés, comme dans le <a href="./">rapport complet</a> : les totaux sont ceux
des lignes <code>/studio/compteur/facture</code> et <code>/validateur/compteur/controle</code> de
son panneau Requested Files.</p>
</div>
</main>
</body>
</html>
HTML
} >"$OUT_EN_COURS"

# Remplacement atomique, comme pour le rapport : jamais de page à moitié écrite servie à un lecteur.
mv "$OUT_EN_COURS" "$OUT"
