# Schémas et schematrons officiels (non versionnés)

Ce dossier reçoit les fichiers de validation externes, récupérés par :

```bash
pnpm schemas:fetch
```

à des **commits épinglés** dans `scripts/fetch-schemas.mjs` :

| Fichiers | Origine | Test |
|---|---|---|
| `FACTUR-X_EN16931*.xsd`, `ubl/` | XSD Factur-X EN 16931 et UBL 2.1, [ZUGFeRD/mustangproject](https://github.com/ZUGFeRD/mustangproject) (Apache 2.0) | `xsd.test.ts`, `ubl-read.test.ts` via `xmllint` |
| `CrossDomainAcknowledgementAndResponse_*.xsd` | XSD CDAR D22B, [fnfempe/France_RFE](https://github.com/fnfempe/France_RFE) v1.4.0.04 (Apache 2.0) | `cdar.test.ts` via `xmllint` |
| `EN16931-CII-validation.xslt`, `EN16931-UBL-validation.xslt` | schematrons CEN EN 16931, syntaxes CII et UBL — France_RFE | `schematron.test.ts`, `third-party.test.ts`, `ubl-read.test.ts` via Saxon-JS |
| `FACTUR-X_EN16931.xslt`, `FACTUR-X_BASIC-WL.xslt`, `FACTUR-X_EXTENDED.xslt` + `_codedb.xml` | schematrons des profils Factur-X 1.09.2 — France_RFE | `schematron.test.ts` (EN 16931), `official.test.ts` (les trois) |
| `EXTENDED-CTC-FR-CII.xslt` | schematron du profil EXTENDED-CTC-FR (CII) — France_RFE | `official.test.ts` |
| `BR-FR-Flux2-Schematron-CII.xslt` | schematron des règles françaises BR-FR (AFNOR XP Z12-012 V1.4) — France_RFE | `schematron.test.ts`, `official.test.ts` |
| `exemples/` | exemples officiels de France_RFE, rangés par profil | `site-src/validateur/official.test.ts` |

Les XSLT sont compilées en `*.sef.json` par `xslt3` à la récupération ; `pnpm validator:fetch` publie ces SEF pour le validateur en ligne. `official.test.ts` vit dans `site-src/validateur/`, avec le validateur qu'il éprouve. Sans ces fichiers (ou sans `xmllint`), les tests correspondants sont ignorés ; la CI les récupère (cache) et les rend bloquants.

# Conformité PDF/A-3b (veraPDF)

`test/pdfa.test.ts` passe le PDF produit par `embedFacturX` dans [veraPDF](https://verapdf.org) (`--flavour 3b`) et exige zéro règle violée. Il s'exécute si `verapdf` est dans le `PATH` ; `scripts/verapdf` est un shim qui lance l'image Docker officielle `ghcr.io/verapdf/cli`, sans Java :

```bash
PATH="$PWD/scripts:$PATH" pnpm --filter facturx-sdk test
```

Le profil ICC `test/fixtures/sRGB.icc` (sRGB compact, CC0, dépôt saucecontrol/Compact-ICC-Profiles) sert d'OutputIntent.

# Fichiers tiers (non versionnés)

`pnpm samples:fetch` récupère dans `test/samples/` (git-ignoré) des factures produites par d'autres outils — corpus [ZUGFeRD/corpus](https://github.com/ZUGFeRD/corpus) (Apache-2.0, suite KoSIT en CII et Factur-X) et échantillons Factur-X FR de mustangproject — à des commits épinglés dans `scripts/fetch-samples.mjs`. `test/third-party.test.ts` les lit, vérifie la fidélité, les ré-émet et mesure les pertes ; ignoré sans ces fichiers.
