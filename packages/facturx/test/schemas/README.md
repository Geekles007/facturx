# Schémas et schematrons officiels (non versionnés)

Ce dossier reçoit les fichiers de validation externes, récupérés par :

```bash
pnpm schemas:fetch
```

depuis le dépôt [ZUGFeRD/mustangproject](https://github.com/ZUGFeRD/mustangproject) (Apache 2.0) à un **commit épinglé** dans `scripts/fetch-schemas.mjs` :

| Fichiers | Origine | Test |
|---|---|---|
| `FACTUR-X_EN16931*.xsd` | XSD Factur-X EN 16931 (FNFE-MPE) | `xsd.test.ts` via `xmllint` |
| `EN16931-CII-validation.xslt` | schematron CEN EN 16931, syntaxe CII | `schematron.test.ts` via Saxon-JS |
| `FACTUR-X_EN16931.xslt` + `_codedb.xml` | schematron du profil Factur-X EN 16931 | idem |
| `20260216_BR-FR-Flux2-Schematron-CII_V1.3.0.xsl` | schematron des règles françaises BR-FR (AFNOR XP Z12-012) | idem |

Les XSLT sont compilées en `*.sef.json` par `xslt3` à la récupération. Sans ces fichiers (ou sans `xmllint`), les tests correspondants sont ignorés ; la CI les récupère (cache) et les rend bloquants.

# Conformité PDF/A-3b (veraPDF)

`test/pdfa.test.ts` passe le PDF produit par `embedFacturX` dans [veraPDF](https://verapdf.org) (`--flavour 3b`) et exige zéro règle violée. Il s'exécute si `verapdf` est dans le `PATH` ; `scripts/verapdf` est un shim qui lance l'image Docker officielle `ghcr.io/verapdf/cli`, sans Java :

```bash
PATH="$PWD/scripts:$PATH" pnpm --filter facturx-sdk test
```

Le profil ICC `test/fixtures/sRGB.icc` (sRGB compact, CC0, dépôt saucecontrol/Compact-ICC-Profiles) sert d'OutputIntent.

# Fichiers tiers (non versionnés)

`pnpm samples:fetch` récupère dans `test/samples/` (git-ignoré) des factures produites par d'autres outils — corpus [ZUGFeRD/corpus](https://github.com/ZUGFeRD/corpus) (Apache-2.0, suite KoSIT en CII et Factur-X) et échantillons Factur-X FR de mustangproject — à des commits épinglés dans `scripts/fetch-samples.mjs`. `test/third-party.test.ts` les lit, vérifie la fidélité, les ré-émet et mesure les pertes ; ignoré sans ces fichiers.
