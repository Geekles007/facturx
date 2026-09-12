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
