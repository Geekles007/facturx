# Site

Deux pages : la présentation (`index.html`) et le **validateur en ligne** (`validateur/`), qui exécute les schematrons officiels dans le navigateur de l'utilisateur — aucun fichier n'est transmis.

## Déployer avec Coolify

Le dépôt contient un [`Dockerfile`](../Dockerfile) prêt à l'emploi : il installe les dépendances,
construit le SDK, récupère le runtime Saxon-JS et les schematrons, bundle le validateur, puis sert
le tout avec nginx ([`docker/nginx.conf`](../docker/nginx.conf)).

Dans Coolify : **+ New → Resource → Public Repository**, dépôt `https://github.com/Geekles007/facturx`,
branche `main`, **Build Pack : Dockerfile**, **Port Exposes : 80**, puis le domaine
`https://facturx.ibird.dev` et *Deploy*. Rien d'autre à régler : ni commande de build, ni dossier de
publication, ni variable d'environnement.

Trois points à connaître.

La construction a besoin du **réseau** : elle télécharge le runtime Saxon-JS depuis `saxonica.com`
et les schematrons officiels depuis `raw.githubusercontent.com`. L'empreinte du runtime est épinglée,
donc un fichier modifié en amont fait échouer la construction au lieu de passer inaperçu.

Elle consomme de la **mémoire** au moment de générer les types du SDK. Sur un très petit serveur
chargé, prévoir du swap ou un serveur de build dédié dans Coolify.

Le conteneur ne sert que des fichiers statiques : aucune donnée n'y transite, le validateur
s'exécutant entièrement chez le visiteur.

Vérifier localement avant de pousser :

```bash
docker build -t facturx-site . && docker run --rm -p 8080:80 facturx-site
```

## Mesurer la fréquentation (GoAccess)

L'image embarque [GoAccess](https://goaccess.io) : il lit le journal d'accès de nginx et en tire un
rapport HTML — pages vues, référents, pays, navigateurs, codes de retour. **Rien n'est ajouté aux
pages** : pas de script, pas de cookie, pas de tiers, donc pas de bandeau de consentement à afficher,
et la promesse du validateur (« rien n'est envoyé ») reste littéralement vraie.

Le rapport est servi sur `/stats/`, protégé par mot de passe, et régénéré toutes les cinq minutes.

### Activer

Une variable d'environnement à définir dans Coolify :

| Variable | Effet |
|---|---|
| `STATS_PASSWORD` | active `/stats/` et fixe le mot de passe. **Non définie, la page renvoie 404** — un tableau de bord ouvert à tous serait pire que pas de tableau de bord. |
| `STATS_USER` | nom d'utilisateur, `stats` par défaut. |

Et un volume persistant sur **`/var/log/nginx`**, sans quoi l'historique repart de zéro à chaque
redéploiement : c'est le journal qui porte les données, le rapport n'en est qu'un rendu, refait
toutes les cinq minutes.

### Ce que le rapport compte, et ce qu'il ne compte pas

Les robots d'indexation sont exclus (`--ignore-crawlers`) : sans cela, le nombre de visites serait
flatteur et faux.

Les adresses IP sont **tronquées de leur dernier octet à l'écriture même du journal** : le fichier
analysé ne contient jamais d'adresse complète, il n'y a donc rien à purger et aucune durée de
conservation à surveiller. Contrepartie assumée : deux visiteurs partageant un même `/24` comptent
pour un seul, le nombre de visiteurs uniques est donc légèrement sous-estimé. Le journal
d'exploitation envoyé à Coolify, lui, garde les adresses complètes — il est éphémère et sert au
diagnostic, pas à la mesure.

Derrière le proxy de Coolify, toutes les requêtes arrivent avec l'adresse du proxy ; la
configuration nginx rétablit l'adresse réelle depuis `X-Forwarded-For`, sans quoi le rapport
n'afficherait qu'un seul visiteur pour la Terre entière.

Le journal entier est relu à chaque régénération. Aucun état n'est conservé entre deux passages,
donc aucune visite ne peut être comptée deux fois.

### Consulter

`https://facturx.ibird.dev/stats/`, utilisateur `stats` et le mot de passe choisi. Consulter la page
n'alimente pas les compteurs.

### Si quelque chose cloche

Les statistiques sont un agrément, le site est l'essentiel : toute la mise en place peut échouer
sans empêcher nginx de démarrer, et la configuration est vérifiée par `nginx -t` **pendant la
construction de l'image** — une erreur fait échouer la construction, jamais le site en production.
Le message affiché au démarrage du conteneur dit dans quel état se trouvent les statistiques.

## Déployer sans Coolify (rsync)

### 1. Construire

```bash
pnpm install    # la première fois, ou après un `git pull`
pnpm site:dist
```

`pnpm site:dist` enchaîne `pnpm build` (le SDK, dont dépend le bundle), `pnpm validator:fetch`
(runtime Saxon-JS et jeux de règles compressés, mis en cache après le premier appel) et
`pnpm site:build` (bundle esbuild du validateur et exemples). Le contrôle `pnpm site:check`
(types, tests, bundle) fait partie de `pnpm check` et tourne en CI.

### 2. Envoyer

```bash
rsync -av --delete --exclude '.DS_Store' --exclude 'README.md' site/ utilisateur@hote:/chemin/vers/www/
```

`--delete` retire du serveur les fichiers disparus localement, dont les anciens fragments de bundle,
qui portent une empreinte dans leur nom. `README.md` est de la documentation de développement :
sans l'exclure, elle serait lisible publiquement.

### 3. Servir

Aucune configuration particulière n'est nécessaire : les jeux de règles sont servis pré-compressés
et le navigateur les décompresse lui-même, que le serveur ajoute ou non `Content-Encoding`. Reprendre
[`docker/nginx.conf`](../docker/nginx.conf), qui règle les deux points qui comptent : la redirection
de `/validateur` vers `/validateur/` (sans quoi les chemins relatifs de la page remontent d'un cran)
et la compression, qui fait passer le bundle d'environ 430 Ko à 195 Ko.

## Vérifier après déploiement

```bash
curl -sI https://facturx.ibird.dev/validateur | sed -n '1p;/[Ll]ocation/p'
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://facturx.ibird.dev/validateur/vendor/SaxonJS2.rt.js
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://facturx.ibird.dev/validateur/schemas/EN16931-CII-validation.sef.json.gz
```

La première commande doit renvoyer une redirection 301 vers `/validateur/`.

Puis, dans un navigateur : ouvrir `/validateur/`, cliquer « essayer une facture conforme » et
attendre le verdict « Conforme aux quatre jeux de règles ». Cela exerce d'un coup le bundle,
le runtime XSLT, les trois jeux de règles et la base de codes.

## Ce qui est versionné, ce qui ne l'est pas

Versionnés : les pages (`index.html`, `validateur/index.html`), les styles, `app.js` de la page d'accueil, les polices Geist (licence SIL OFL) et le favicon. Les sources du validateur sont dans `site-src/`, hors du dossier déployé.

Générés (ignorés par git, à reconstruire avant chaque déploiement) : `validateur/app.js` et ses fragments, `validateur/vendor/` (runtime Saxon-JS et sa licence), `validateur/schemas/` (schematrons compilés, base de codes) et `validateur/exemples/` — dont `facture-exemple.pdf` et `facture-exemple-non-conforme.pdf`, deux PDF/A-3 Factur-X produits par le SDK à chaque construction (`scripts/example-invoice.mjs`, testés dans `pnpm site:check`).

## À tenir à jour

Les chiffres de la page d'accueil (tests, règles BR-FR, fichiers tiers, version npm) sont écrits en dur dans `index.html` ; les mettre à jour à chaque release.

Le JavaScript de la page d'accueil est optionnel : sans lui, tout le contenu reste lisible. Le validateur, lui, a besoin de JavaScript pour lire le fichier et faire tourner les schematrons ; la page le dit dans un `<noscript>`. `prefers-reduced-motion` désactive les animations partout.
