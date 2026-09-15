# Changelog

Toutes les évolutions notables de `facturx-sdk`. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon [SemVer](https://semver.org/lang/fr/). Depuis 1.0.0, une rupture d'API n'arrive que dans une version majeure ; une nouvelle règle de validation est une version mineure.

## [Non publié]

### Ajouté
- **Ligne de commande `facturx`** (`npx facturx-sdk <commande>`, ou `facturx` après une installation globale) : `validate` contrôle une facture et nomme chaque anomalie par son code et son chemin, `info` la résume, `extract` en tire le XML embarqué. La syntaxe — Factur-X, CII ou UBL — est reconnue toute seule ; `--json` rend un rapport analysable.
- Codes de sortie contractuels : `0` conforme, `1` anomalies relevées, `2` fichier illisible, `64` usage incorrect. C'est par eux qu'une chaîne d'intégration décide de bloquer une facture, et ils sont testés comme tels.
- **Aucune dépendance nouvelle** : `node:fs` et ce que le paquet embarque déjà. Le moteur PDF n'est chargé que si l'on soumet un PDF. Les schematrons officiels ne sont pas exécutés — ils réclameraient Saxon-JS — et l'aide le dit en renvoyant au validateur en ligne.

## [1.3.0] — 2026-09-15

### Ajouté
- **Lecture UBL 2.1** (profil EN 16931) : `fromUblXml` et `parseUblDocument`, plus `UBL_NAMESPACES` et le code d'erreur `NOT_UBL`. Le socle de la réforme accepte trois syntaxes — Factur-X, CII nu et UBL — et la réception est obligatoire pour toutes les entreprises depuis le 1er septembre 2026 : sans UBL, un tiers du socle restait illisible. Lecture seule, délibérément : le SDK écrit du Factur-X, cible d'un émetteur français.
- Le XSD UBL 2.1 et le schematron **CEN EN 16931 UBL** rejoignent `pnpm schemas:fetch`, au même commit épinglé.
- **Lecture d'un message de cycle de vie** : `fromCdvXml` (statut validé) et `parseCdvDocument` (statut + enveloppe : profil, plateforme émettrice, parties, type et date de réception de la facture, numéro de séquence), plus `fromFormat204`, inverse de `toFormat204`. `toCdvXml` était la seule écriture sans lecture de l'API ; l'asymétrie est levée.
- Code d'erreur `NOT_CDAR` (`FacturXParseErrorCode`) quand la racine n'est pas `rsm:CrossDomainAcknowledgementAndResponse`.

### Modifié
- Documentation bilingue : [README.en.md](README.en.md) en anglais, bascule de langue en tête des deux, amorce anglaise sur la page npm. Factur-X et ZUGFeRD étant la même norme, le marché allemand pouvait déjà utiliser ce SDK sans pouvoir lire sa porte d'entrée. La description npm passe en anglais et mentionne ZUGFeRD.
- Le README du paquet npm annonçait encore les statuts comme hors périmètre — troisième endroit portant cette mention périmée.
- `toCdvXml` écrit désormais le cadre de facturation (`MDG-2`) quand `status.businessProcess` est renseigné : sans lui, la règle **G7.39** (motifs restreints au cadre `S6`) ne survivait pas à un aller-retour.

### Vérification
- Douze tests d'aller-retour et d'erreurs localisées. Le XSD ne juge que la structure : un code de statut écrit dans la mauvaise balise le validerait. Vérifié par mutation — remplacer `status.code` par une constante fait tomber quatre tests d'aller-retour, sans que les contrôles XSD ne bronchent.

## [1.2.0] — 2026-09-14

### Ajouté
- **Sérialisation du message de cycle de vie** : `toCdvXml(status, options)` produit un message CDV (flux 6) complet, et `toFormat204` l'horodatage UNTDID 204. Constantes `CDAR_NAMESPACES` et `CDV_PROFILES` (urn par objet, **G7.14**). Le message repose sur le **CDAR d'UN/CEFACT D22B** — *Cross Domain Acknowledgement and Response* —, pas sur un schéma français : le paquet DGFiP n'en contient donc aucun XSD.
- Le XML produit est **validé contre le XSD CDAR D22B officiel** en CI (`xmllint`), schéma récupéré par `pnpm schemas:fetch` depuis le miroir FNFE-MPE à un commit épinglé (l'UNECE refuse tout téléchargement automatisé).

### À savoir
- Un message CDV est émis par une **plateforme** : l'émetteur est identifié par un matricule PDP/PPF (qualifiant `0238`, rôle `WK` ou `DFH`). Une application de facturation ordinaire n'en possède pas — `toCdvXml` s'adresse à qui construit ou teste une plateforme.

## [1.1.0] — 2026-09-14

### Ajouté
- **Statuts du cycle de vie** (`lifecycle`) : `LifecycleStatus` typé, `validateLifecycleStatus` / `assertValidLifecycleStatus`, listes closes `LIFECYCLE_STATUS_CODES` (200 Déposée, 210 Refusée, 212 Encaissée, 213 Rejetée), `REFUSAL_REASON_LABELS` (40 motifs normalisés) et `AMOUNT_LABELS` (G7.12). Règles vérifiées : **G7.44** (statut transmissible), **G7.08** (motif sur 210/213), **G7.25** (commentaire sur 210), **G7.39** (motifs restreints au cadre S6), **G6.27** (montant encaissé en euros), **G7.17** (SIREN du fournisseur). Sources : dossier de spécifications externes DGFiP **v3.2**, annexe 2 « Format sémantique FE CDV — Flux 6 » et annexe 7 « Règles de gestion » v1.9.
- Anomalies de statut distinctes de celles des factures : `LifecycleIssue`, `LifecycleIssueCode`, `FacturXLifecycleError` — `Issue` et `IssueCode` restent réservés aux factures, leur contrat est inchangé.

## [1.0.2] — 2026-09-12

### Corrigé
- `extractFacturX` : un PDF tronqué que `pdf-lib` accepte de charger (en-tête valide, catalogue absent) levait une erreur non typée ; toute anomalie de structure rencontrée après le chargement est désormais une `FacturXPdfError` de code `INVALID_PDF`, cause conservée.

## [1.0.1] — 2026-09-12

### Modifié
- Site du projet : https://facturx.ibird.dev/ (champ `homepage`, README, page npm).

## [1.0.0] — 2026-09-12

Première version stable : API figée (voir « Stabilité et versions » dans le README).

### Retiré
- `PaymentMeans.remittanceInformation` (déprécié en 0.8.0) : utiliser `Invoice.remittanceInformation` (BT-83).

## [0.9.0] — 2026-09-12

### Ajouté
- Limites de taille (`DEFAULT_LIMITS`, option `{ limits }`) : XML 64 Mio, pièce jointe 20 Mio, pièces cumulées 100 Mo (BR-FR-19), PDF 100 Mio — vérifiées avant lecture, erreurs typées `TOO_LARGE` (`FacturXParseError`, `FacturXPdfError`) et anomalie `BR-FR-19` à la validation ; `validateInvoice(invoice, { limits })`.
- `SECURITY.md` : modèle de menace, garanties, signalement privé GitHub.

## [0.8.0] — 2026-09-12

### Ajouté
- Lecture de 30 fichiers tiers (corpus ZUGFeRD / KoSIT, Factur-X FR de mustangproject) en CI : fidélité, ré-émission conforme, aucune perte d'élément signifiant (`pnpm samples:fetch`, `test/third-party.test.ts`).
- `Party.identifiers` (BT-29/46 `ram:ID`), `Party.globalIds` (`GlobalID` hors SIRET), `Payee.globalId` (BT-60-1) : écrits et relus.
- `readCiiGuideline(xml)` : profil (BT-24) et cadre (BT-23) sans lire la facture.
- Pièce jointe sans contenu (attributs seuls) conservée à la lecture et à l'écriture.

### Modifié
- `Invoice.remittanceInformation` (BT-83) remplace `PaymentMeans.remittanceInformation`, déprécié mais encore lu à l'écriture ; la lecture renseigne désormais le niveau facture.

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

[1.3.0]: https://github.com/Geekles007/facturx/releases/tag/v1.3.0
[1.2.0]: https://github.com/Geekles007/facturx/releases/tag/v1.2.0
[1.1.0]: https://github.com/Geekles007/facturx/releases/tag/v1.1.0
[1.0.2]: https://github.com/Geekles007/facturx/releases/tag/v1.0.2
[1.0.1]: https://github.com/Geekles007/facturx/releases/tag/v1.0.1
[1.0.0]: https://github.com/Geekles007/facturx/releases/tag/v1.0.0
[0.9.0]: https://github.com/Geekles007/facturx/releases/tag/v0.9.0
[0.8.0]: https://github.com/Geekles007/facturx/releases/tag/v0.8.0
[0.7.0]: https://github.com/Geekles007/facturx/releases/tag/v0.7.0
[0.6.0]: https://github.com/Geekles007/facturx/releases/tag/v0.6.0
[0.5.0]: https://github.com/Geekles007/facturx/releases/tag/v0.5.0
[0.4.0]: https://github.com/Geekles007/facturx/releases/tag/v0.4.0
[0.3.0]: https://github.com/Geekles007/facturx/releases/tag/v0.3.0
[0.2.0]: https://github.com/Geekles007/facturx/releases/tag/v0.2.0
[0.1.1]: https://github.com/Geekles007/facturx/releases/tag/v0.1.1
[0.1.0]: https://github.com/Geekles007/facturx/releases/tag/v0.1.0
