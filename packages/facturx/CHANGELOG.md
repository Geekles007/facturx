# Changelog

Toutes les évolutions notables de `facturx-sdk`. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon [SemVer](https://semver.org/lang/fr/). Avant 1.0.0, une version mineure peut contenir des changements d'API.

## [0.7.0] — 2026-09-12

### Ajouté
- Validation par les **schematrons officiels** en CI et en local (`pnpm schemas:fetch`, Saxon-JS, sans Java) : CEN EN 16931 CII, profil Factur-X EN 16931, règles françaises BR-FR Flux 2 V1.3.0 — zéro assertion en échec sur tous les fichiers de référence.
- Règle CII-SR-467 : tous les moyens de paiement portent le même code (BT-81) en syntaxe CII.

### Modifié
- BR-FR-12 : l'adresse électronique de l'acheteur (BT-49) est exigée pour tout vendeur établi en France, sauf `buyer.consumer` (le schematron officiel l'exige inconditionnellement) ; en `B2B`, schéma 0225 et SIREN comme avant.
- CII-SR-461 : la date d'exigibilité (BT-7) n'est plus répétée dans chaque ventilation de TVA, une seule fois dans le XML.

## [0.6.0] — 2026-09-12

### Ajouté
- `attachments` (BG-24) : documents justificatifs embarqués en base64 (`file: { filename, mimeType, bytes }`) ou référencés par URI, écrits en `AdditionalReferencedDocument` TypeCode 916 et relus octet pour octet ; `ATTACHMENT_QUALIFIERS` (BR-FR-17), `ATTACHMENT_MIME_TYPES` (BR-CL-24).
- Règles BR-52, BR-CL-24, BR-FR-18 (une seule pièce `LISIBLE`), `FORMAT-BINARY`.
- `encodeBase64` / `decodeBase64` sans dépendance.

## [0.5.0] — 2026-09-11

### Ajouté
- `processing` (BR-FR-20) : traitement attendu (`B2B`, `B2BINT`, `B2C`, `OUTOFSCOPE`, `ARCHIVEONLY`), écrit comme note `BAR` et relu.
- `Party.routingCode` (code de routage 0224, BT-29/BT-46) écrit en `ram:ID schemeID="0224"` et relu ; règles BR-FR-24/26.
- `electronicAddress0225(siren, suffix?)` ; règles BR-FR-23/25 (caractères, 125 max), `FORMAT-EMAIL` pour le schéma `EM`.
- BR-FR-12/13/21/22 : en `B2B`, adresse 0225 obligatoire pour l'acheteur (ou le vendeur en autofacturation), commençant par son SIREN.

### Modifié
- Fixtures et golden files : adresses 0225 au format `SIREN` / `SIREN_XXX`.

## [0.4.0] — 2026-09-11

### Ajouté
- `withDeposits(draft, deposits)` : lie une facture définitive à ses factures d'acompte (type 386) — cadre `B4`/`S4`/`M4`, références BT-25/26 dédoublonnées, `prepaidAmount` = Σ TTC à passer à `computeTotals` ; `DepositError` typée.
- Exemple `examples/deposit-node` (deux acomptes puis définitive, relecture, erreur si l'on oublie de lier) ; section « Acomptes » du guide réforme ; golden file `deposit-final.xml` validé XSD.

## [0.3.0] — 2026-09-11

### Ajouté
- BR-FR-04 : `typeCode` accepte les neuf codes de la norme déjà intégrés à EN 16931 — 380, 384 (rectificative), 386 (acompte), 389 (auto-facturée), 393 (affacturée), 381, 261, 262, 396 (avoirs) ; `INVOICE_TYPE_LABELS`, `isCreditNoteType`, `isSelfBilledType`.
- BR-FR-14 : une adresse de livraison fournie doit comporter ligne 1, ville, code postal et pays ; refusée pour une prestation de services.
- `FR-DEPOSIT-REFERENCE` : une facture définitive après acompte (cadre `B4`/`S4`/`M4`) doit référencer ses factures d'acompte.

### Modifié
- Le message BR-CL-01 renvoie à BR-FR-04 ; les codes « en attente d'intégration EN 16931 » (500, 501, 471–473, 502, 503) restent refusés.

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

[0.7.0]: https://github.com/Geekles007/facturx/releases/tag/v0.7.0
[0.6.0]: https://github.com/Geekles007/facturx/releases/tag/v0.6.0
[0.5.0]: https://github.com/Geekles007/facturx/releases/tag/v0.5.0
[0.4.0]: https://github.com/Geekles007/facturx/releases/tag/v0.4.0
[0.3.0]: https://github.com/Geekles007/facturx/releases/tag/v0.3.0
[0.2.0]: https://github.com/Geekles007/facturx/releases/tag/v0.2.0
[0.1.1]: https://github.com/Geekles007/facturx/releases/tag/v0.1.1
[0.1.0]: https://github.com/Geekles007/facturx/releases/tag/v0.1.0
