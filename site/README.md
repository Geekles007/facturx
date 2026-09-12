# Site

Deux pages : la présentation (`index.html`) et le **validateur en ligne** (`validateur/`), qui exécute les schematrons officiels dans le navigateur de l'utilisateur — aucun fichier n'est transmis.

## Construire

```bash
pnpm build            # le SDK, dont dépend le bundle du validateur
pnpm validator:fetch  # runtime Saxon-JS + jeux de règles compressés (une fois, puis en cache)
pnpm site:build       # site-src/validateur/main.ts → site/validateur/app.js
```

`pnpm site:check` (types, tests, bundle) fait partie de `pnpm check` et de la CI.

## Déployer

```bash
rsync -av --delete site/ utilisateur@hote:/chemin/vers/www/
```

Aucune configuration serveur particulière : les jeux de règles sont servis pré-compressés et décompressés par le navigateur. Prévoir tout de même la compression des `.js` et `.css` si l'hébergeur ne l'active pas par défaut.

## Ce qui est versionné, ce qui ne l'est pas

Versionnés : les pages (`index.html`, `validateur/index.html`), les styles, `app.js` de la page d'accueil, les polices Geist (licence SIL OFL) et le favicon. Les sources du validateur sont dans `site-src/`, hors du dossier déployé.

Générés (ignorés par git, à reconstruire avant chaque déploiement) : `validateur/app.js` et ses fragments, `validateur/vendor/` (runtime Saxon-JS et sa licence), `validateur/schemas/` (schematrons compilés, base de codes), `validateur/exemples/`.

## À tenir à jour

Les chiffres de la page d'accueil (tests, règles BR-FR, fichiers tiers, version npm) sont écrits en dur dans `index.html` ; les mettre à jour à chaque release.

Le JavaScript de la page d'accueil est optionnel : sans lui, tout le contenu reste lisible. Le validateur, lui, a besoin de JavaScript pour lire le fichier et faire tourner les schematrons ; la page le dit dans un `<noscript>`. `prefers-reduced-motion` désactive les animations partout.
