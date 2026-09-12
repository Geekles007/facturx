# Site

Deux pages : la présentation (`index.html`) et le **validateur en ligne** (`validateur/`), qui exécute les schematrons officiels dans le navigateur de l'utilisateur — aucun fichier n'est transmis.

## Déployer

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
et le navigateur les décompresse lui-même, que le serveur ajoute ou non `Content-Encoding`. Deux
points valent tout de même d'être vérifiés sur l'hôte.

```nginx
server {
    server_name facturx.ibird.dev;
    root /chemin/vers/www;
    index index.html;   # assure aussi la redirection /validateur → /validateur/

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/xml image/svg+xml text/plain;

    location /fonts/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location /validateur/vendor/  { add_header Cache-Control "public, max-age=31536000"; }
    location /validateur/schemas/ { add_header Cache-Control "public, max-age=31536000"; }
}
```

La redirection de `/validateur` vers `/validateur/` doit fonctionner, sans quoi les chemins relatifs
de la page remonteraient d'un cran ; nginx s'en charge dès qu'`index` est défini, et le JavaScript
rattrape le cas par sécurité. La compression concerne surtout le bundle du validateur, qui passe
d'environ 430 Ko à 180 Ko.

### 4. Vérifier

```bash
curl -sI https://facturx.ibird.dev/validateur/ | head -1
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://facturx.ibird.dev/validateur/vendor/SaxonJS2.rt.js
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://facturx.ibird.dev/validateur/schemas/EN16931-CII-validation.sef.json.gz
```

Puis, dans un navigateur : ouvrir `/validateur/`, cliquer « essayer une facture conforme » et
attendre le verdict « Conforme aux quatre jeux de règles ». Cela exerce d'un coup le bundle,
le runtime XSLT, les trois jeux de règles et la base de codes.

## Ce qui est versionné, ce qui ne l'est pas

Versionnés : les pages (`index.html`, `validateur/index.html`), les styles, `app.js` de la page d'accueil, les polices Geist (licence SIL OFL) et le favicon. Les sources du validateur sont dans `site-src/`, hors du dossier déployé.

Générés (ignorés par git, à reconstruire avant chaque déploiement) : `validateur/app.js` et ses fragments, `validateur/vendor/` (runtime Saxon-JS et sa licence), `validateur/schemas/` (schematrons compilés, base de codes), `validateur/exemples/`.

## À tenir à jour

Les chiffres de la page d'accueil (tests, règles BR-FR, fichiers tiers, version npm) sont écrits en dur dans `index.html` ; les mettre à jour à chaque release.

Le JavaScript de la page d'accueil est optionnel : sans lui, tout le contenu reste lisible. Le validateur, lui, a besoin de JavaScript pour lire le fichier et faire tourner les schematrons ; la page le dit dans un `<noscript>`. `prefers-reduced-motion` désactive les animations partout.
