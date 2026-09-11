# Schémas XSD Factur-X (non versionnés)

Déposer ici les XSD du profil **EN 16931** du paquet Factur-X (FNFE-MPE, téléchargement gratuit sur https://fnfe-mpe.org) :

```
FACTUR-X_EN16931.xsd
FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd
FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd
FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd
```

Le test `test/xsd.test.ts` valide alors les golden files avec `xmllint --schema` (présent sur macOS et la plupart des Linux).
Sans XSD ou sans `xmllint`, le test est ignoré proprement.

# Conformité PDF/A-3b (veraPDF)

`test/pdfa.test.ts` passe le PDF produit par `embedFacturX` dans [veraPDF](https://verapdf.org) (`--flavour 3b`) et exige zéro règle violée. Il s'exécute si `verapdf` est dans le `PATH` ; `scripts/verapdf` est un shim qui lance l'image Docker officielle `ghcr.io/verapdf/cli`, sans Java :

```bash
PATH="$PWD/scripts:$PATH" pnpm --filter facturx-sdk test
```

La CI installe ce shim : une non-conformité bloque le build. Le profil ICC `test/fixtures/sRGB.icc` (sRGB compact, CC0, dépôt saucecontrol/Compact-ICC-Profiles) sert d'OutputIntent.
