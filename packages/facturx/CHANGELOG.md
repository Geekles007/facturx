# Changelog

Toutes les évolutions notables de `facturx-sdk`. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon [SemVer](https://semver.org/lang/fr/). Avant 1.0.0, une version mineure peut contenir des changements d'API.

## [0.2.0] — 2026-09-11

Conformité aux règles françaises de la norme **AFNOR XP Z12-012** (celle qu'appliquent les plateformes agréées). Changements d'API : codes d'anomalie renommés, notes légales générées dans le XML.

### Ajouté
- `businessProcess` (BT-23) : les 13 cadres de facturation de BR-FR-08 (`B1`…`S7`), validés et cohérents avec `operationCategory` ; `BUSINESS_PROCESS_CODES` avec libellés.
- Notes légales BR-FR-05/06 : `PMD` (pénalités), `PMT` (indemnité de 40 €), `AAB` (escompte) générées depuis `paymentTerms` dans les notes BG-1 (`resolveNotes`, `buildLegalNotes`) ; validation « une fois chacune » ; relecture en champs structurés (`parseLegalNotes`).
- Règles BR-FR-01/02 (numéro de facture), BR-FR-03 (années 2000–2099), BR-FR-15 (catégories de TVA), BR-FR-16 (taux autorisés) ; constantes `FRENCH_TAX_CATEGORY_CODES`, `FRENCH_VAT_RATES_BPS`, `LEGAL_NOTE_CODES`.
- `NoteSubjectCode` enrichi des codes BR-FR-07 (`ABL`, `AAI`, `SUR`, `ACC`, `CUS`, `BLU`, `BAR`, `DCL`, `TXD`).

### Modifié
- Codes d'anomalie : `FR-SELLER-SIREN` → `BR-FR-10`, `FR-BUYER-SIREN` → `BR-FR-11`, `FR-SELLER-SIRET` / `FR-BUYER-SIRET` → `BR-FR-09`, `FR-OPERATION-CATEGORY` → `BR-FR-08` ; mentions de paiement manquantes → `BR-FR-05` (au lieu de `FR-LATE-PENALTY`… qui ne signalent plus que des valeurs invalides).
- Un texte BT-20 seul ne satisfait plus les mentions FR : les notes `PMD`/`PMT`/`AAB` sont exigées (générées ou fournies).
- `fromCiiXml` relit BT-23 dans `businessProcess` et reconstitue `paymentTerms` depuis les notes au format du SDK : `fromCiiXml(toCiiXml(x))` est strictement égal à `x`.
- Mapping BT-23 (`B1`/`S1`/`M1`) et BT-8 (`5`) **confirmés** par la norme ; `B2`/`S2`/`M2` = facture déjà payée (et non autofacturation).

## [0.1.1] — 2026-09-11

### Publication
- Workflow de release sur tag `v*` : vérifications complètes, garde-fous de version, publication npm par trusted publishing (OIDC) avec attestation de provenance, release GitHub automatique.
- `pnpm bump X.Y.Z` et `pnpm release:check` pour préparer et vérifier une version.
- Paquet allégé : plus de source maps dans le tarball.

## [0.1.0] — 2026-09-11

Première version publiée : la boucle complète émission → réception pour le profil Factur-X EN 16931, sans dépendance runtime hors `pdf-lib` (entrée `./pdf` uniquement).

### Modèle
- Type `Invoice` et sous-types (`Party`, `Address`, `Line`, `TaxBreakdown`, `Totals`, `PaymentTerms`, `PaymentMeans`, `DocumentReferences`, `Delivery`), chaque champ annoté du Business Term EN 16931 et, le cas échéant, de la règle française.
- Monnaie en entiers « branded » : `Cents` (2 décimales), `Quantity` / `UnitPrice` (4 décimales), `Rate` (points de base) ; produits en `bigint`, arrondi commercial unique ; `fromDecimal` / `toDecimalString` sans flottant.
- Mentions de la réforme : `operationCategory` (biens / services / mixte → BT-23), `vatOnDebits` (→ BT-8), SIREN acheteur exigé avec `buyer.consumer` pour le B2C, avoirs (`typeCode` `381`).
- Conditions de paiement : champs FR structurés (pénalités, indemnité de 40 €, escompte → texte BT-20 généré) ou texte libre.

### Validation
- `validateInvoice` (accumulation) et `assertValidInvoice` (`FacturXValidationError { issues }`) : champs obligatoires, listes de codes, formats (SIREN/SIRET Luhn, clé TVA FR, IBAN mod 97, BIC, dates), cohérence arithmétique lignes → ventilation TVA → totaux (BR-CO-10 à 17), règles par catégorie TVA (BR-S/Z/E/AE/K/G/O), règles françaises (`FR-*`).
- Les totaux fournis sont vérifiés, jamais recalculés en silence ; `computeTotals` est un helper explicite.

### XML CII
- `toCiiXml` : templating typé, ordre XSD par construction, échappement manuel, sortie compacte déterministe (`pretty` en option), validation par défaut ; conforme au XSD officiel Factur-X EN 16931.
- `fromCiiXml` / `parseCiiDocument` : mini-parseur XML sans DTD (pas de XXE), namespaces résolus par URI, tout profil lu, `FacturXParseError { code, path }` ; aller-retour `fromCiiXml(toCiiXml(x)) ≡ x`.

### PDF/A-3 (`facturx-sdk/pdf`)
- `embedFacturX` : pièce jointe `factur-x.xml` (`/AFRelationship /Alternative`), `/AF`, XMP `pdfaid` + schéma `fx`, `Info` aligné, `/ID` reproductible, `OutputIntent` optionnel ; idempotent.
- `extractFacturX` / `extractInvoice` : lecture tolérante (`factur-x.xml`, repli ZUGFeRD / XRechnung), `FacturXPdfError { code }`.

### Documentation
- Guide de la réforme (`docs/reforme.md`), journal des décisions (`docs/decisions.md`), trois exemples exécutés en CI (émission Node, réception Node, handler HTTP Web standard).

[0.2.0]: https://github.com/Geekles007/facturx/releases/tag/v0.2.0
[0.1.1]: https://github.com/Geekles007/facturx/releases/tag/v0.1.1
[0.1.0]: https://github.com/Geekles007/facturx/releases/tag/v0.1.0
