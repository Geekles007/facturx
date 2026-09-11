# Décisions d'architecture — `facturx-sdk`

Journal des choix structurants, dans l'ordre où ils ont été pris. Une ligne de justification par décision ; on ne rouvre pas sans nouvel argument.

## 2026-09-11 — Session 1 : squelette et modèle de données

### D1. Périmètre v1 : profil EN 16931 uniquement, sans abstraction multi-profils
Un seul profil couvre 100 % du besoin cible (facturation B2B française) ; une abstraction MINIMUM/BASIC/EXTENDED coûterait des indirections sans utilisateur.

### D2. Représentation monétaire : entiers « branded », zéro dépendance
`Cents` (2 déc.), `Quantity`/`UnitPrice` (4 déc., tolérance EN 16931 sur BT-129/BT-146), `Rate` en points de base (2000 = 20 %) ; produits intermédiaires en `bigint`, **un seul** point d'arrondi (`divRoundHalfAwayFromZero`, arrondi commercial). Alternatives écartées : `number` (flottant, écarts de dernier centime), `big.js`/`dinero.js` (dépendance runtime dans le cœur alors que la contrainte est zéro dépendance hors pdf-lib).

### D3. Erreurs : accumulation + assertion
`validateInvoice()` renvoie **toutes** les anomalies (`Issue { code, path, message, expected?, actual? }`) sans lever ; `assertValidInvoice()` lève une `FacturXValidationError` agrégée. Un formulaire côté UI a besoin de la liste complète ; un pipeline serveur veut une exception. `path` suit la syntaxe d'accès JS (`lines[2].netAmount`) pour être directement exploitable côté formulaire.

### D4. Les totaux sont fournis par l'appelant et vérifiés, jamais recalculés en silence
`Invoice.totals` et `Invoice.taxBreakdown` sont obligatoires ; `computeTotals(draft)` est un helper **explicite** que l'appelant choisit d'utiliser. Une facture est un document juridique : le SDK ne doit jamais « corriger » un montant à l'insu de l'émetteur.

### D5. Codes d'anomalie : numérotation EN 16931 quand elle existe, préfixes maison sinon
`BR-*`, `BR-CO-*`, `BR-CL-*`, `BR-S-*`… reprennent la numérotation officielle du schematron EN 16931. Les règles françaises (`FR-*`), formats (`FORMAT-*`) et calculs non normés (`CALC-LINE-NET`, `CALC-TAX-RATE`) portent des préfixes explicites plutôt qu'une numérotation `BR-FR-xx` inventée. L'alignement sur les identifiants officiels du schematron Factur-X FR se fera à la session XML, une fois le schematron exécuté sur nos fixtures.

### D6. Règles françaises appliquées uniquement si le vendeur est établi en France
Condition : `seller.address.countryCode === 'FR'`. Un vendeur étranger émettant vers la France n'a ni SIREN ni obligation L441-9 ; les règles EN 16931 restent appliquées à tous.

### D7. Mentions de paiement FR : champs structurés + texte BT-20 généré
`PaymentTerms` exige `latePenaltyRate`, `recoveryIndemnity` (40 €) et `earlyPaymentDiscount` (objet ou `'none'`, pour forcer la mention « pas d'escompte »). `buildPaymentTermsText()` compose le BT-20 en français ; `text` permet de l'écraser. Une chaîne libre seule n'offrirait aucune garantie de conformité.

### D8. Dates : chaînes ISO `YYYY-MM-DD` typées par littéral de gabarit
`IsoDate = \`${number}-${number}-${number}\`` bloque à la compilation les formats grossièrement faux ; la validation vérifie ensuite la date calendaire réelle. Pas d'objet `Date` (fuseaux horaires, sérialisation) ni de lib.

### D9. Listes de codes : unions ouvertes (`string & {}`) pour les listes longues, fermées pour les listes courtes
Les unités UN/ECE, motifs de remise/frais, schémas EAS sont ouverts (autocomplétion sans blocage) ; catégories TVA et type de document sont fermés (validés à l'exécution).

### D10. Outillage : pnpm workspace, tsup (ESM + CJS + d.ts), vitest, Biome, CI Node 22/24
TypeScript **5.x épinglé** : `tsup`/`rollup-plugin-dts` ne gèrent pas encore le compilateur natif TS 7. `platform: 'neutral'` dans tsup pour garantir la compatibilité edge/serverless.

### D11. Hors périmètre v1 (explicitement)
Avoirs (381), Order-X, UBL, rendu PDF de la facture (on n'embarque que dans un PDF fourni), envoi à une plateforme (PDP/PPF), représentant fiscal (BG-11), devise de TVA différente (BT-6), factures à plusieurs devises.

## 2026-09-11 — Session 2 : génération XML CII

### D12. Templating typé maison : arbre `el()` + sérialiseur, pas de lib XML
`el(name, ...children)` ignore `undefined`/`null`/`false` et aplatit les tableaux : les éléments optionnels s'écrivent en une expression conditionnelle, sans branche ni mutation, et l'ordre XSD est celui du code source. Le sérialiseur (~60 lignes) est déterministe et testé seul. Une lib générique (xmlbuilder2, fast-xml-parser) ajouterait 50–200 ko et n'apporterait ni le typage ni la garantie d'ordre.

### D13. Échappement manuel + rejet des caractères interdits XML 1.0
`&`, `<`, `>` en texte, `"` en plus dans les attributs. Tout caractère hors de l'ensemble `Char` de XML 1.0 (contrôles C0 sauf tab/LF/CR, surrogates isolés, U+FFFE/FFFF) lève une `XmlError` avec le code point et la position, plutôt que d'être remplacé en silence — un libellé corrompu ne doit pas produire un XML « presque bon ».

### D14. `toCiiXml` valide par défaut, opt-out explicite `validate: false`
Cohérent avec D4 : aucun XML n'est produit à partir de montants incohérents sans que l'appelant l'ait demandé noir sur blanc. L'opt-out sert au debug et aux fixtures d'erreur.

### D15. Sortie compacte par défaut, `pretty` en option
Le XML est destiné à être embarqué dans un PDF/A-3 : chaque octet compte. `pretty: true` sert à la lecture, aux diffs et aux golden files.

### D16. Conformité XSD testée avec `xmllint`, XSD non versionnés
Les XSD Factur-X (FNFE-MPE) ne sont pas redistribués dans le dépôt : ils sont git-ignorés dans `test/schemas/` et le test s'ignore proprement s'ils manquent (ou sans `xmllint`). Aucune dépendance de parsing XML n'est ajoutée, même en dev. Les trois golden files ont été validés localement contre `FACTUR-X_EN16931.xsd`.

### D17. Choix de mapping CII
SIRET → `ram:GlobalID schemeID="0009"` ; SIREN → `ram:SpecifiedLegalOrganization/ram:ID schemeID="0002"` ; TVA → `ram:SpecifiedTaxRegistration/ram:ID schemeID="VA"` ; BT-7 (date d'exigibilité, document) répété dans chaque `ram:ApplicableTradeTax` ; `references.project` alimente `ID` et `Name` de `SpecifiedProcuringProject` (les deux sont obligatoires dans le XSD) ; le premier prélèvement fournit BT-89/BT-90, la première référence de paiement fournit BT-83. Quantités et prix : 4 décimales tronquées des zéros finaux au-delà de 2 (`2.00`, `0.1234`).

## 2026-09-11 — Session 3 : embarquement / extraction PDF/A-3

### D18. Entrée séparée `facturx-sdk/pdf`, `pdf-lib` en dépendance classique
`pdf-lib` est la seule dépendance runtime, déclarée en `dependencies` (zéro friction à l'installation) mais importée uniquement par `src/pdf/` et marquée `external` au build : `dist/index.js` ne la référence pas. Une `peerDependency` optionnelle aurait été plus « pure » au prix d'erreurs d'import obscures ; un fork (`@cantoo/pdf-lib`) n'apporte rien d'indispensable ici.

### D19. Contrat PDF/A-3 : le SDK rend Factur-X un PDF déjà PDF/A, il ne convertit pas
Convertir un PDF quelconque en PDF/A (polices non embarquées, transparence, chiffrement, JavaScript…) est hors de portée d'une lib légère et hors périmètre. `embedFacturX` ajoute ce qui distingue un Factur-X : pièce jointe `factur-x.xml` (`/EmbeddedFile`, `/Subtype /text#2Fxml`, `Params/ModDate`, `Filespec` avec `F`, `UF`, `Desc`, `EF/F` + `EF/UF`, `/AFRelationship /Alternative`), tableau `/AF`, XMP (`pdfaid:part 3`, `conformance B`, schéma d'extension `fx`), dictionnaire `Info` aligné sur le XMP, identifiant de fichier `/ID`. L'option `outputIntent { iccProfile }` ajoute l'`OutputIntent` sRGB si absent — souvent la seule pièce manquante — sans embarquer de profil ICC dans le bundle (licence et taille).

### D20. Pièce jointe manuelle plutôt que `pdfDoc.attach()`
`attach()` n'écrit ni `EF/UF` ni ne permet de remplacer une pièce existante avant la sauvegarde. L'implémentation maison reconstruit l'arbre de noms `EmbeddedFiles` à plat et trié (entrées existantes conservées, pièces Factur-X précédentes retirées de l'arbre et de `/AF`) : l'opération est idempotente.

### D21. Sortie reproductible
`options.date` fixe toutes les dates (Info, XMP, pièce jointe) et l'identifiant `/ID` est une empreinte FNV-1a 128 bits du PDF d'entrée, du XML et de la date : deux appels identiques produisent les mêmes octets — testable par comparaison binaire. Le XMP est réutilisé tel quel du templating `el()` (D12) ; le flux `Metadata` n'est pas compressé.

### D22. Extraction tolérante, typée, sans parsing XML
`extractFacturX` cherche `factur-x.xml` puis, en repli, `zugferd-invoice.xml` / `xrechnung.xml` (insensible à la casse) dans l'arbre de noms **et** dans `/AF`, décode le flux (Flate via pdf-lib) et lit `fx:ConformanceLevel` / `fx:DocumentType` dans le XMP par expression régulière (éléments ou attributs). Le XML est renvoyé brut ; le parsing XML → `Invoice` est une session ultérieure. Un PDF chiffré ou illisible lève `FacturXPdfError { code }`.

### D23. Validation PDF/A externe : veraPDF, à brancher
Le test structurel couvre les points que veraPDF vérifie sur les pièces jointes et les métadonnées (ISO 19005-3 §6.8, §6.6, §6.1.3). Une validation complète exige veraPDF (Java 11+) et un PDF d'entrée réellement PDF/A ; à ajouter sur le modèle du test xmllint (ignoré si `verapdf` absent) quand l'outil sera disponible sur la machine de dev.

## 2026-09-11 — Session 4 : lecture XML CII → `Invoice`

### D24. Mini-parseur XML maison, sécurisé par construction
~250 lignes : déclaration, commentaires, PI, CDATA, entités prédéfinies et numériques, attributs, namespaces résolus par URI (un document écrit avec `n1:` ou un namespace par défaut est lu comme `rsm:`/`ram:`). **Tout `DOCTYPE` est refusé** (XXE, expansion d'entités), les entités inconnues aussi, la profondeur est bornée (256). Erreurs `XmlParseError { line, column }`. Une lib (fast-xml-parser, @xmldom) ajouterait une dépendance runtime et, pour certaines, une surface DTD à désactiver.

### D25. `PaymentTerms` : texte BT-20 OU champs structurés
Le XML ne porte que le texte des conditions (BT-20). `latePenaltyRate`, `recoveryIndemnity` et `earlyPaymentDiscount` deviennent optionnels ; la règle FR exige **soit** un `text` non vide, **soit** les trois champs (les champs présents sont toujours vérifiés). Une facture rédigée avec le SDK garde la voie structurée (texte généré) ; une facture lue porte le texte. Alternatives écartées : un type `ParsedInvoice` distinct (deux modèles à maintenir, pas d'aller-retour direct) ; une heuristique sur le texte (fragile). `DirectDebit.mandateReference` devient optionnel pour la même raison (BT-89 et BT-90 sont dispersés dans le CII).

### D26. Lecture tolérante, validation stricte, jamais d'arrondi
`parseCiiDocument` lit **tout profil** Factur-X (EXTENDED ⊇ EN 16931 ⊇ BASIC ⊇ MINIMUM), ignore les éléments inconnus et expose `guidelineId` ; les chaînes obligatoires absentes deviennent `''` et sont signalées par la validation (BR-06, BR-11…), tandis que la structure et les nombres indispensables manquants lèvent `FacturXParseError { code, path }` — le chemin utilise les préfixes canoniques `rsm/ram/udt/qdt` avec index de ligne (`…LineItem[2]/…`). Une décimale de trop (`12.345` pour un montant) est une erreur `FORMAT`, pas un arrondi. `fromCiiXml` valide par défaut (miroir de `toCiiXml`), `validate: false` pour lire un MINIMUM tel quel.

### D27. Aller-retour garanti par les tests
`fromCiiXml(toCiiXml(x))` est `deepEqual` à `x` sur les trois fixtures (aux mentions FR structurées près, devenues texte), et `toCiiXml(fromCiiXml(xml)) === xml`. Conséquence de modélisation : `remittanceInformation` (BT-83, document-level en CII) est lu sur le **premier** moyen de paiement ; le mandat/ICS (BT-89/BT-90) sur le premier moyen de type prélèvement. `extractInvoice(pdf)` = `extractFacturX` + `fromCiiXml`.

## 2026-09-11 — Session 5 : guide réforme et exemples

### D28. Positionnement : SDK pour développeurs, brique « format + conformité »
Cible confirmée : les devs qui doivent rendre une application conforme à la réforme (réception 2026 pour tous, émission 2026/2027). Le SDK produit, vérifie et lit du Factur-X ; la plateforme agréée assure le transport, les statuts et l'e-reporting. Pas de cible non-dev : un produit grand public serait construit *sur* le SDK, pas dedans. `docs/reforme.md` documente cette frontière et liste honnêtement les écarts du modèle (nature de l'opération, TVA sur les débits, SIREN acheteur) plutôt que de les improviser.

### D29. Exemples exécutés en CI, sans framework
Trois paquets `examples/*` dans le workspace (`workspace:*`, `tsx`), typecheckés **et exécutés** par `pnpm check` : un exemple qui ne tourne plus casse la CI. Le handler HTTP n'utilise que `Request`/`Response`/`FormData` (Web standard) — copiable dans Next.js, Hono, Workers, Deno sans dépendance et cohérent avec la promesse edge du SDK. Une vraie app Next.js aurait coûté ~300 Mo de `node_modules` et lié l'exemple à un framework ; des snippets non exécutés auraient dérivé.

## 2026-09-11 — Session 6 : mentions de la réforme

### D30. SIREN acheteur exigé, B2C déclaré explicitement
`FR-BUYER-SIREN` sur absence pour un acheteur établi en France, sauf `buyer.consumer: true`. Déduire le B2C de l'absence d'identifiant aurait vidé la règle de son sens ; l'exiger toujours aurait bloqué les factures B2C que les mêmes applications émettent. Le drapeau est `true`-only : on ne « déclare » pas un professionnel, on déclare une exception.

### D31. Nature de l'opération → cadre de facturation BT-23, mapping signalé « à confirmer »
`operationCategory: 'goods' | 'services' | 'mixed'` est exigée pour un vendeur FR et écrite dans `BusinessProcessSpecifiedDocumentContextParameter/ID` sous la forme `B1` / `S1` / `M1` (dépôt d'une facture par le fournisseur), lue en retour depuis toute valeur `B*` / `S*` / `M*`. Ce mapping suit les spécifications externes DGFiP telles que comprises à la rédaction ; il n'a pas été vérifié contre un validateur de plateforme agréée : **à confirmer avant production**. Garde-fou : `businessProcessId` explicite prime toujours (autofacturation `*2`, autres cadres), sans attendre une version du SDK.

### D32. TVA sur les débits → BT-8 = 5, sans note automatique
`vatOnDebits: true` écrit `DueDateTypeCode` = `5` (date de facture, UNTDID 2005) dans chaque ventilation et ajoute la règle BR-CO-03 (exclusif de BT-7). Le SDK n'injecte pas de note textuelle « Option pour le paiement de la TVA d'après les débits » dans le XML : les `notes` sont des données de l'appelant, et une note injectée casserait l'aller-retour ; la mention lisible relève du PDF visuel, comme les autres mentions légales.

### D33. Avoirs (381) : même modèle, montants positifs
`typeCode: '380' | '381'`, sans type distinct ni règles supplémentaires : en CII EN 16931, un avoir est une facture de type 381 aux montants positifs, la facture d'origine étant référencée en BG-3 (`references.precedingInvoices`). Les règles arithmétiques et FR s'appliquent à l'identique. Les types 384 (rectificative) et 389 (autofacturation) restent refusés (BR-CL-01).

## 2026-09-11 — Session 7 : publication

### D34. Nom npm `facturx-sdk`
`@geekles/facturx` était impossible (le scope `@geekles` appartient à un autre compte npm) et `facturx` est refusé par la protection anti-typosquat de npm (trop proche de `factur-x`, une lib existante). `facturx-sdk` est libre, non scopé, et dit ce que c'est. Le dépôt GitHub, le dossier `packages/facturx` et les identifiants internes gardent `facturx`.

### D35. Publication manuelle avec OTP, pas de token en CI (pour l'instant)
Le compte npm est en 2FA `auth-and-writes` : le `publish` est lancé par le mainteneur avec son code OTP (`docs/release.md`). Un workflow de release sur tag (token granulaire « bypass 2FA » ou trusted publishing OIDC) sera envisagé quand la cadence de versions le justifiera ; le trusted publishing exige que le paquet existe déjà, ce qui est désormais le cas.

## 2026-09-11 — Session 8 : workflow de release

### D36. Trusted publishing npm (OIDC) déclenché par tag
Aucun secret dans le dépôt : le workflow obtient un jeton OIDC (`id-token: write`) que npm échange contre une autorisation de publier, et signe une attestation de provenance visible sur npmjs.com. Un token granulaire aurait été un secret à faire tourner ; un `workflow_dispatch` aurait fait committer un bot. Le tag reste le geste humain ; tout le reste (check, garde-fous, publish, release GitHub) est reproductible. `npm publish` est utilisé directement (et non `pnpm publish`) : c'est le client que npm documente pour l'OIDC, et le paquet n'a pas de dépendance `workspace:*`. Retour d'expérience du premier run : `setup-node` avec `registry-url` écrit un `.npmrc` avec un token fictif et `always-auth` (déprécié) — retiré ; et les échecs d'échange OIDC ne sont journalisés qu'en `--loglevel verbose`, d'où ce niveau dans le workflow (filtré) avec `pipefail`. Enfin, npm compare le propriétaire du dépôt **à la casse près** avec le claim OIDC (`Geekles007`, pas `geekles007`) : le workflow `oidc-debug.yml` imprime les claims pour lever ce genre de doute. Première publication réussie par ce canal : 0.1.1.

### D37. Garde-fous avant publication, pas de bump automatique
`scripts/release-check.mjs` refuse un tag qui ne correspond pas aux deux `package.json`, une section de CHANGELOG absente, un CHANGELOG de paquet désynchronisé, ou une version déjà publiée. `pnpm bump` fait les écritures mécaniques mais **exige** que la section du CHANGELOG existe déjà : on ne publie pas sans avoir écrit ce qui change. Les source maps sont retirées du paquet (tarball ÷ 3, plus d'avertissements « source map manquante » chez les utilisateurs de bundlers).

## 2026-09-11 — Session 9 : conformité PDF/A-3b par veraPDF

### D38. veraPDF via Docker, test bloquant, fixture sans police
veraPDF est le validateur de référence PDF/A ; il exige Java 11+, absent de la machine de dev. L'image officielle `ghcr.io/verapdf/cli` le fait tourner sans Java, localement (shim `scripts/verapdf`, Docker Desktop) comme en CI (le shim est mis dans le `PATH`, l'image tirée avant les tests). Le test (`test/pdfa.test.ts`) valide un PDF d'entrée **sans texte** (un rectangle vectoriel) : aucune police à embarquer, donc chaque règle ISO 19005-3 évaluée porte sur ce que le SDK ajoute — pièce jointe, `/AF`, XMP, `Info`, `/ID`, `OutputIntent` (profil sRGB compact CC0 de 456 octets, `test/fixtures/sRGB.icc`). Résultat au premier passage : **conforme 3b, zéro règle violée** (veraPDF 1.31). Un contrôle négatif (Helvetica non embarquée) échoue bien, ce qui valide le harnais. Le test est bloquant en CI et ignoré proprement sans `verapdf` dans le `PATH`. Le contrat D19 reste inchangé : le SDK ne convertit pas un PDF quelconque en PDF/A ; il garantit désormais, preuve à l'appui, que sa couche ne casse pas un PDF/A d'entrée.

## 2026-09-11 — Session 10 : confirmation du mapping et conformité AFNOR

### D39. BT-23 et BT-8 confirmés par la norme AFNOR XP Z12-012, source normative retenue
Sources : fiche DGFiP « données de facture et correspondance des flux » (catégorie de l'opération → BT-23, option débits → BT-8, SIREN client → BT-47) et norme AFNOR XP Z12-012 (juillet 2025, hébergée par impots.gouv), qui liste en BR-FR-08 les treize cadres de facturation (B1, S1, M1, B2, S2, M2, B4, S4, M4, S5, S6, B7, S7) et précise en BR-FR-MAP-03 que l'option TVA sur les débits s'exprime « en BT-8 avec les valeurs 5 en CII et 3 en UBL ». Le modèle gagne `businessProcess` (les treize codes, validé et cohérent avec `operationCategory`) ; `businessProcessId` de `toCiiXml` reste une valeur brute forcée pour les cas hors liste. Le texte de la norme n'est pas reproduit dans le dépôt (droits AFNOR) ; seules les règles sont résumées.

### D40. Mentions de paiement : notes BG-1 codées PMD / PMT / AAB, générées depuis les champs structurés
Découverte de la session : BR-FR-05 exige « au moins 3 notes (BG-1) » avec les codes `PMT` (indemnité de 40 €), `PMD` (pénalités) et `AAB` (escompte), chacune une seule fois (BR-FR-06). Nos mentions n'étaient que dans le texte BT-20 — lisible mais non conforme. Désormais `resolveNotes()` complète les notes fournies par les notes légales manquantes, générées depuis `paymentTerms` (une seule source de phrases pour BT-20, BG-1 et la relecture) ; la validation exige exactement une note par code, qu'elle soit générée ou fournie. Alternative écartée : laisser l'appelant écrire les trois notes (chaque intégrateur réinventerait les libellés).

### D41. Relecture : les notes au format du SDK redeviennent des champs structurés
`parseLegalNotes()` reconnaît les trois phrases générées par le SDK et reconstitue `latePenaltyRate`, `recoveryIndemnity`, `earlyPaymentDiscount`, en retirant ces notes (régénérées à l'identique) et le BT-20 s'il est le texte généré. Résultat : `fromCiiXml(toCiiXml(x))` est **strictement égal** à `x` (plus `businessProcess`, désormais toujours relu). Des notes d'un autre émetteur sont conservées telles quelles, sans champs structurés. Les codes `FR-SELLER-SIREN`, `FR-BUYER-SIREN`, `FR-*-SIRET`, `FR-OPERATION-CATEGORY` deviennent `BR-FR-10`, `BR-FR-11`, `BR-FR-09`, `BR-FR-08` ; `FR-VAT-ID`, `FR-DELIVERY` et les contrôles de valeurs (`FR-LATE-PENALTY`…) restent, faute d'identifiant AFNOR. Changement d'API → version 0.2.0.

## 2026-09-11 — Session 11 : BR-FR-14 et BR-FR-04

### D42. BR-FR-14 : la présence de `delivery.address` vaut déclaration d'une adresse différente
La norme dit la règle « non contrôlable applicativement » : une plateforme ne sait pas si l'adresse de livraison diffère de celle de l'acheteur. Le SDK, lui, voit que l'appelant l'a fournie : il exige alors BT-75/77/78/80, et la refuse pour une prestation de services (« ne sont pas à transmettre »). Pas de condition sur la date du 01/09/2027 : une adresse incomplète est une erreur de données dès aujourd'hui, et l'échéance n'ajoute rien de contrôlable côté SDK (elle rend l'adresse obligatoire quand elle diffère — ce que seul l'appelant sait).

### D43. BR-FR-04 : neuf types de document, les codes « en attente » refusés
`typeCode` accepte les codes de BR-FR-04 déjà présents dans la liste EN 16931 (380, 384, 386, 389, 393, 381, 261, 262, 396), avec libellés et helpers `isCreditNoteType` / `isSelfBilledType`. Les sept codes marqués « en attente de l'intégration par la maintenance EN 16931 » (500, 501, 471–473, 502, 503) restent refusés : un validateur EN 16931 standard les rejette aujourd'hui, et l'API pourra les ajouter sans rupture. Aucune règle spécifique par type n'est ajoutée (la norme n'en définit pas ici), sauf un garde-fou maison : une facture définitive après acompte (cadre `*4`) doit référencer ses acomptes (`FR-DEPOSIT-REFERENCE`). Nouvelles règles pouvant refuser des factures hier valides → version 0.3.0.

## 2026-09-11 — Session 12 : acomptes

### D44. `withDeposits` : le lien acompte → définitive est une fonction, pas une convention
Le cas d'usage repose sur trois données dispersées (cadre `*4`, références BT-25/26, BT-113) que chaque intégrateur aurait dû assembler à la main — et la validation ne peut vérifier que la cohérence interne d'une facture, pas que le montant déduit correspond aux acomptes réellement émis. `withDeposits(draft, deposits)` prend les factures d'acompte typées, pose le cadre déduit de la nature de l'opération, complète les références sans doublon et calcule `prepaidAmount` = Σ TTC ; l'appelant garde la main sur `computeTotals`. Refus typés (`DepositError`) : pas d'acompte, type ≠ 386, devise différente, nature d'opération absente. Ajout d'API → 0.4.0.

## 2026-09-11 — Session 13 : adresses électroniques et traitement attendu

### D45. Le périmètre est déclaré (`processing`), pas deviné
BR-FR-12/13 rendent l'adresse électronique obligatoire « dès lors que la facture doit être transmise », ce que seul l'émetteur sait ; la norme elle-même rattache les contrôles (BR-FR-21/22) à la note `BAR` de BR-FR-20. Le modèle gagne donc `processing` (`B2B`, `B2BINT`, `B2C`, `OUTOFSCOPE`, `ARCHIVEONLY`), écrit comme note `BAR` avec les notes légales et relu en champ. En `B2B`, l'adresse 0225 du destinataire (acheteur, ou vendeur en autofacturation) est exigée et doit **commencer par le SIREN** — la formulation contrôlable de la norme, qui laisse passer un SIRET ; le helper `electronicAddress0225` produit la forme canonique `SIREN` / `SIREN_XXX`. Les formats (BR-FR-23 à 26, e-mail pour `EM`) s'appliquent toujours ; les autres schémas EAS restent acceptés sans liste fermée (longue, évolutive). `routingCode` (0224) est écrit en `ram:ID schemeID="0224"`, l'identifiant privé qualifié de la norme, distinct du `GlobalID` 0009 du SIRET.

## 2026-09-12 — Session 14 : pièces jointes BG-24

### D46. Pièces jointes dans le XML seulement, octets en `Uint8Array`, base64 maison
BG-24 porte le document en base64 dans le XML — c'est ce que lisent les plateformes ; les joindre aussi au PDF/A-3 aurait doublé les octets et rouvert la validation veraPDF pour un bénéfice de confort. L'API prend et rend des `Uint8Array` (cohérent avec `./pdf`) ; l'encodeur/décodeur base64 (RFC 4648, espaces tolérés comme `xs:base64Binary`) est écrit sans `Buffer` ni `btoa` pour rester edge-compatible. Validation : BR-52 (identifiant, nom de fichier), BR-CL-24 (types MIME fermés), `FORMAT-BINARY`, BR-FR-18 (une seule `LISIBLE`) ; les qualificatifs BR-FR-17 sont typés mais non exclusifs, comme la norme (« peuvent être utilisés »).

## 2026-09-12 — Session 15 : validation par les schematrons officiels

### D47. Trois schematrons officiels en CI, exécutés avec Saxon-JS, tolérance explicite et motivée
Les règles que le SDK implémente à la main (EN 16931, Factur-X, BR-FR) sont désormais **contre-vérifiées par les validateurs de référence** : schematron CEN EN 16931 (syntaxe CII), schematron du profil Factur-X EN 16931 et schematron officiel des règles françaises **BR-FR Flux 2 V1.3.0** (XP Z12-012), récupérés depuis mustangproject à un commit épinglé (`pnpm schemas:fetch`, git-ignorés) et exécutés en Node avec Saxon-JS — pas de Java, même commande en local et en CI. Tout `failed-assert` fait échouer le test, quel que soit son niveau (le schematron français ne produit que des `warning`), sauf trois avertissements tolérés et documentés dans le test : PEPPOL-EN16931-R008 (élément vide : `ApplicableHeaderTradeDelivery` est obligatoire dans le XSD), CII-SR-450 (SIRET en `GlobalID 0009` + code de routage en `ID 0224`, tel que la norme française le prescrit), CII-SR-475 (une description par pièce jointe, exigée par BR-FR-17).

Ce que le premier passage a révélé — et corrigé : **CII-SR-461** (une seule `TaxPointDate` : le SDK la répétait dans chaque ventilation), **CII-SR-467** (tous les moyens de paiement portent le même code BT-81 en CII : nouvelle règle de validation), **BR-FR-12** (le schematron officiel exige l'adresse électronique de l'acheteur inconditionnellement : la règle du SDK, jusque-là limitée au `B2B`, s'aligne, sauf pour un particulier). Enseignement de méthode : mon premier lecteur de rapport SVRL dépendait de l'ordre des attributs et avait affiché « tout vert » à tort ; les contrôles négatifs (TTC faux, note PMT retirée, SIREN retiré) l'ont démasqué — un harnais se valide toujours par un échec provoqué.

## 2026-09-12 — Session 16 : fichiers tiers

### D48. Lire les factures des autres : fidélité mesurée, pertes explicites, profils étrangers en lecture typée
Trente fichiers produits par d'autres outils (corpus ZUGFeRD, suite KoSIT en CII et Factur-X, échantillons Factur-X FR de mustangproject), récupérés à des commits épinglés (`pnpm samples:fetch`, git-ignorés). Pour chaque fichier EN 16931 : lecture, **fidélité** (identifiant, lignes, cinq totaux relus dans la source par regex), **ré-émission** validée par le XSD et n'introduisant **aucune assertion CEN absente de la source** (les échantillons eux-mêmes ne sont pas tous parfaits : BR-CL-25 sur un schéma EAS), et **aucun élément signifiant perdu** — un élément vide n'est pas une perte ; les groupes hors modèle sont listés dans le test (BG-11 représentant fiscal, BG-18 carte, BG-32 caractéristiques, BT-158, BT-6, BT-128). Les profils MINIMUM / BASIC / EXTENDED sont lus sans plantage : succès ou `FacturXParseError` avec chemin ; `readCiiGuideline()` identifie le profil sans lire la facture, pour router une réception.

Ce que ces fichiers ont révélé, et qui est corrigé : les identifiants de parties autres que SIRET et code de routage étaient perdus (BT-29/46 `ram:ID` sans schéma, `GlobalID` GLN/GTIN, BT-60-1) → `identifiers`, `globalIds`, `Payee.globalId` ; une pièce jointe sans contenu (attributs seuls) était perdue ; la référence de paiement BT-83, donnée de facture, était modélisée sur le moyen de paiement et disparaissait sans BG-16 → `Invoice.remittanceInformation` (l'ancien champ reste lu à l'écriture, déprécié). Changement d'API → 0.8.0.
