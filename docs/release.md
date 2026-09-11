# Publier une version

Procédure manuelle, volontairement courte (< 5 min). Prérequis : `npm login` fait sur la machine (`npm whoami` répond), droits de publication sur le scope `@geekles`.

1. Mettre à jour `CHANGELOG.md` (racine) : section `## [x.y.z] — AAAA-MM-JJ` + lien en bas de fichier ; copier dans `packages/facturx/CHANGELOG.md`.
2. Aligner la version : `packages/facturx/package.json` et `package.json` (racine).
3. Vérifier : `pnpm check` (lint, typecheck, tests, build, exemples).
4. Inspecter le tarball : `cd packages/facturx && pnpm pack --dry-run` — `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, rien d'autre.
5. Publier : `pnpm publish --filter facturx-sdk --access public` (depuis la racine ; `--dry-run` d'abord si doute).
6. Tag et release : `git tag -a vx.y.z -m "vx.y.z" && git push origin vx.y.z`, puis `gh release create vx.y.z --notes-from-tag` (ou coller la section du CHANGELOG).
7. Vérifier : `npm view facturx-sdk version` et `npx -y -p facturx-sdk@x.y.z node -e "console.log(require('facturx-sdk/package.json').version)"`.

Le `README.md` du paquet est la page npm : il est court et pointe vers le dépôt ; le README racine reste la documentation complète.
