# Publier une version

Publication automatisée par **trusted publishing** npm (OIDC) : aucun token, pas d'OTP, attestation de provenance. Le workflow [`release.yml`](../.github/workflows/release.yml) se déclenche sur un tag `vX.Y.Z`, rejoue `pnpm check`, vérifie les garde-fous, publie, puis crée la release GitHub avec les notes du CHANGELOG.

## Prérequis (une fois)

Sur npmjs.com → paquet `facturx-sdk` → *Settings* → *Trusted Publisher* → **GitHub Actions** :

| Champ | Valeur |
|---|---|
| Organization or user | `Geekles007` |
| Repository | `facturx` |
| Workflow filename | `release.yml` |
| Environment name | *(vide)* |

## À chaque version (4 étapes, ~3 min)

1. Écrire la section `## [X.Y.Z] — AAAA-MM-JJ` dans `CHANGELOG.md` (racine) et ajouter le lien `[X.Y.Z]: …/releases/tag/vX.Y.Z` en bas.
2. `pnpm bump X.Y.Z` — met à jour les deux `package.json`, copie le CHANGELOG dans le paquet, refuse si la section manque.
3. `pnpm check`, puis `git add -A && git commit -m "vX.Y.Z"`.
4. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z` → le workflow publie et crée la release.

`pnpm release:check vX.Y.Z` rejoue localement les garde-fous du workflow (versions alignées, CHANGELOG, version non publiée).

## Dépannage

- **`npm publish` refuse (E404 / OIDC)** : le trusted publisher n'est pas configuré, ou le nom du workflow diffère de `release.yml`.
- **Garde-fou en échec** : corriger, supprimer le tag (`git tag -d vX.Y.Z && git push origin :vX.Y.Z`), recommencer à l'étape 3.
- **Publication manuelle de secours** : `cd packages/facturx && npm publish --access public` (OTP demandé), puis `gh release create vX.Y.Z --notes-file <(node scripts/release-notes.mjs vX.Y.Z)`.
