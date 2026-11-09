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
La norme dit la règle « non contrôlable applicativement » : une plateforme ne sait pas si l'adresse de livraison diffère de celle de l'acheteur. Le SDK, lui, voit que l'appelant l'a fournie : il exige alors BT-75/77/78/80, et la refuse pour une prestation de services (« ne sont pas à transmettre »). Pas de condition sur la date du 01/09/2027 : une adresse incomplète est une erreur de données dès aujourd'hui, et l'échéance n'ajoute rien de contrôlable côté SDK (elle rend l'adresse obligatoire quand elle diffère — ce que seul l'appelant sait). *Révisée par D66 : le refus pour une prestation de services est retiré.*

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

## 2026-09-12 — Session 17 : limites de taille et politique de sécurité

### D49. Limites en octets, vérifiées avant lecture, typées, surchargeables — jamais silencieuses
Le SDK lit des entrées non fiables ; la seule protection manquante contre l'épuisement mémoire était la taille. `DEFAULT_LIMITS` fixe XML 64 Mio, pièce jointe 20 Mio, pièces cumulées 100 Mo (le chiffre de BR-FR-19), PDF 100 Mio ; chaque limite est vérifiée **avant** tout décodage (pour une chaîne, sans l'encoder quand la réponse est certaine ; pour une pièce jointe, sur la longueur base64 avant décodage) et produit une erreur typée (`XmlParseError`, `FacturXParseError` / `FacturXPdfError` code `TOO_LARGE`, ou anomalie `BR-FR-19` à la validation). Tout est surchargeable par `{ limits }` (`fromCiiXml`, `parseCiiDocument`, `readCiiGuideline`, `validateInvoice`, `embedFacturX`, `extractFacturX`, `extractInvoice`) : un serveur mutualisé resserre, un traitement par lots élargit. `SECURITY.md` explicite le modèle de menace, les garanties et ce qui reste à l'application ; le signalement passe par le formulaire privé GitHub, activé sur le dépôt.

## 2026-09-12 — Session 18 : 1.0.0

### D50. Figer l'API : ce qui est stable, ce qui est bas niveau, ce qui ne l'est pas
Après dix-sept sessions, l'API n'a plus bougé depuis trois versions hormis un déplacement (BT-83). 1.0.0 retire le seul champ déprécié (`PaymentMeans.remittanceInformation`) et **nomme le contrat** dans le README : stable (modèle, validation avec codes et chemins, calcul, XML, PDF, limites), stable-bas-niveau (parseur, templating, XMP, base64 — exposés pour étendre, pas cachés), non contractuel (texte des messages, libellés générés). Une nouvelle règle de validation reste une version mineure : refuser une facture non conforme n'est pas une rupture, c'est le service rendu. Ce qui n'est *pas* dans 1.0 et le dit : le dépôt réel sur une plateforme agréée (compte à ouvrir), UBL, les autres profils en écriture, l'e-reporting.

## 2026-09-12 — Session 21 : le validateur en ligne

### D51. Valider dans le navigateur, avec les vrais schematrons, sans qu'aucun fichier ne parte
Le site gagne un outil (`/validateur/`) qui juge une facture déposée par l'utilisateur avec **exactement les jeux de règles de la CI** : le SDK (modèle, arithmétique, règles françaises) puis les trois schematrons officiels compilés en SEF, exécutés par le **runtime navigateur de Saxon-JS 2.7** — même version que le paquet npm utilisé en CI. Rien n'est transmis : une facture est une donnée commerciale, et « vos factures ne quittent pas votre navigateur » est à la fois la position la plus honnête et le seul argument qu'un validateur hébergé ne peut pas copier. Conséquence assumée : **veraPDF reste hors du validateur en ligne** (il exige Java, donc un serveur et un envoi de fichier) ; la page le dit au lieu de laisser croire à un contrôle PDF/A.

Trois choix techniques en découlent. Les SEF pèsent ~5 Mo chacun mais ~0,1 Mo compressés : ils sont servis en `.gz` et décompressés par `DecompressionStream`, ce qui rend le poids indépendant de la configuration gzip de l'hébergeur (et le code accepte aussi un serveur qui décompresse déjà, en reniflant l'en-tête gzip). Le runtime Saxon et `pdf-lib` ne sont chargés qu'au premier usage réel (script injecté à la demande, `import()` dynamique) : la page coûte ~24 Ko avant qu'on dépose quoi que ce soit. Les ressources (runtime, SEF, base de codes) sont **non versionnées**, comme les schémas de test, et produites par `pnpm validator:fetch` avec vérification d'empreinte du fichier Saxonica ; la licence Saxon-JS, qui autorise la redistribution dans une application mais exige la notice, est copiée à côté du runtime et citée sur la page.

Le verdict distingue trois états par juge : conforme, non conforme, **non exécuté** — et un juge non exécuté interdit d'annoncer la conformité. Les trois tolérances de la CI (PEPPOL-EN16931-R008, CII-SR-450, CII-SR-475) sont affichées comme tolérées **avec leur raison**, jamais masquées. Le XPath verbeux des schematrons est réduit à sa forme lisible pour l'affichage.

### D52. Un bundle pour le site, des sources hors du dossier déployé
Le site restait sans build ; le validateur en impose un. Les sources vivent dans `site-src/` (hors du dossier rsyncé), `pnpm site:build` produit `site/validateur/app.js` avec esbuild, et la sortie n'est pas versionnée — le dépôt ne porte aucun bundle illisible. `pnpm site:check` (types, tests, bundle) entre dans `pnpm check` et dans la CI, pour que l'outil ne pourrisse pas en silence. Le déploiement devient : `pnpm build && pnpm validator:fetch && pnpm site:build`, puis rsync.

### D53. L'outil a révélé un trou dans les erreurs typées du SDK
Un PDF tronqué que `pdf-lib` accepte de charger (en-tête valide, catalogue absent) faisait remonter un `TypeError` brut au lieu d'une `FacturXPdfError` — la promesse « erreurs typées » tombait précisément sur le cas le plus courant d'un outil public : un fichier abîmé. `extractFacturX` enveloppe désormais toute l'exploration du document : code `INVALID_PDF`, cause conservée. Une interface publique est un banc d'essai que les tests unitaires ne remplacent pas.

### D54. Une facture d'exemple produite par le SDK, irréprochable ou rien
Le validateur ne pouvait pas démontrer sa lecture de PDF : ses exemples étaient des XML. Le site
publie désormais un **PDF/A-3 Factur-X complet, généré par le SDK lui-même** à chaque construction
(`scripts/example-invoice.mjs`) : facture de services française, mentions légales, adresse
électronique 0225, cadre S1 — verdict vert sur les quatre juges, sans même une tolérance, et
PDF/A-3b confirmé par veraPDF. Sortie déterministe (date fixée), donc deux constructions donnent
le même octet.

Fabriquer ce fichier a exigé deux corrections que seul un contrôle de conformité révèle. Le
sous-ensemble de polices de pdf-lib laisse une référence au glyphe `.notdef`, refusée par
ISO 19005-3 6.2.11.8-1 : les polices sont embarquées entières. Surtout, l'espace fine insécable
(U+202F) employée comme séparateur de milliers **n'existe pas dans Geist** ; elle devenait un
`.notdef` invisible à l'écran mais fatal pour PDF/A. D'où un garde-fou : le générateur refuse de
dessiner un caractère absent de la police, plutôt que de produire un fichier qui *semble* correct.
Les ligatures sont désactivées, pdf-lib écrivant les glyphes substitués sans reprendre leurs
avances (« palette » s'affichait « palett e »).

### D55. Un jumeau fautif, dont les défauts sont écrits sur le document et vérifiés par un test
Éprouver une chaîne de réception demande aussi un fichier qui doit être **rejeté**. Le site publie
donc un second PDF/A-3, volontairement non conforme, portant quatre défauts que des émetteurs
commettent réellement : total TTC incohérent (BR-CO-15), adresse électronique de l'acheteur absente
(BR-FR-12), mentions légales de retard absentes (BR-FR-05), SIREN de l'acheteur absent (BR-FR-11).
Les défauts sont dans **les données de la facture, pas dans le fichier** : le PDF reste un PDF/A-3
valide et parfaitement lisible, pour que la chaîne testée atteigne bien l'étape de validation au lieu
de trébucher avant.

Deux garde-fous. Le PDF affiche un bandeau « exemple volontairement non conforme » et la liste de ses
défauts : personne ne peut le prendre pour une facture réelle. Et un test compare cette liste aux
codes que le validateur relève effectivement — la première version annonçait BR-CO-16, qui ne se
déclenche pas quand le net à payer suit le TTC faux, et attribuait l'absence de SIREN à aucune règle
alors qu'il s'agit de BR-FR-11. Un document d'exemple qui ment sur ce qu'il démontre est pire
qu'aucun document.

## 2026-09-30 — Session 22 : thèmes de rendu

### D56. Une mise en page, deux peintres
Le rendu est coupé en deux : `composeInvoice` calcule la page — positions, tailles, couleurs, pagination — et produit une liste d'instructions de dessin (texte, filet, aplat, image), que `paintLayout` traduit en opérateurs pdf-lib. `layoutInvoice` expose la première moitié. Un aperçu (SVG, canvas) peint depuis ce résultat emploie les coordonnées et les mesures du PDF — celles de fontkit, avec les fonctionnalités OpenType qu'emploiera pdf-lib — et ne peut donc pas en diverger. Chaque instruction porte le chemin du champ qu'elle représente, dans la syntaxe des anomalies de `validateInvoice` : un clic sur l'aperçu et une anomalie désignent le même champ, par le même texte. Alternative écartée : pdf.js pour afficher le vrai PDF — un mégaoctet de plus, un aperçu inerte, et aucune correspondance bloc → champ.

### D57. Un thème change l'apparence, jamais le contenu
Six modèles, chacun un jeu de neuf réglages (`RenderStyle`) surchargeables un par un, plus une couleur d'accent. Les options d'affichage (`display`) ne portent que sur ce qui est facultatif : aucune ne masque une mention obligatoire, et le bon de commande comme la facture d'origine restent écrits même quand les références facultatives sont cachées. La couleur est bornée par la lisibilité : le texte posé sur l'aplat devient blanc ou encre selon le meilleur contraste, le texte écrit dans la teinte est assombri jusqu'à 4,5:1 (WCAG AA) — pas de transparence, des teintes pleines calculées d'avance, ce que PDF/A-3 accepte sans condition. Les six modèles passent veraPDF en CI, logo PNG transparent compris.

### D58. La page porte toutes les mentions que le modèle contient
La 1.5 dessinait l'essentiel ; une facture française exige plus. La page écrit désormais la nature de l'opération, la date **ou la période** de livraison, l'adresse de livraison, le bon de commande, la facture d'origine, le détail de la TVA par taux, les mentions d'exonération — le texte BT-120, à défaut le libellé du code VATEX, de sorte qu'une franchise en base porte « TVA non applicable, art. 293 B du CGI » même quand seul le code a été fourni —, l'option sur les débits, la date d'exigibilité, « Autofacturation », les acomptes déduits, les coordonnées de paiement. Les trois mentions de paiement restent celles de `resolveNotes`, la source du XML ; le paragraphe BT-20 généré n'est plus imprimé (sa date ISO se lisait mal, et l'échéance figure en tête). La note `BAR` n'est pas imprimée : elle s'adresse à la plateforme. `layoutInvoice` rend la liste des mentions écrites : ce que le lecteur voit est vérifiable.

### D59. Typographie : un caractère, un glyphe, et jamais de `.notdef`
Les ligatures et alternatives contextuelles sont désactivées au rendu comme à la mesure (`FONT_FEATURES`) : pdf-lib écrit les glyphes substitués sans leurs avances, et le script d'exemple du site le contournait déjà seul (D54). Un caractère absent de la police fait lever `GLYPH_MISSING` — au lieu d'un glyphe vide, invisible à l'écran et refusé par PDF/A —, mais la mise en page le signale sans lever (`missingGlyphs`), pour qu'un éditeur l'affiche au bon champ. Les signes typographiques ont un repli simple (apostrophe courbe, tirets, espaces fines, `€` → `EUR`) : le sens ne change pas, et une police sobre reste utilisable. Les séparateurs de milliers sont choisis selon la police (espace fine insécable, sinon insécable, sinon espace). WOFF et WOFF2 sont refusés : fontkit les lit, mais pdf-lib les embarquerait tels quels comme programme TrueType.

## 2026-09-30 — Session 23 : le Studio

### D60. Le Studio : une vitrine qui n'emploie que l'API publique
Le site gagne `/studio/` : composer une facture, la personnaliser, la contrôler, la télécharger. Il n'appelle que l'API publique du SDK, et son onglet « Code » écrit le programme exact qui refait la facture à l'écran ; ce qu'il sait faire, le SDK le sait — c'est ce qui en fait un aperçu honnête des possibilités, et c'est pourquoi les thèmes sont entrés dans le SDK plutôt que dans le Studio. Mêmes principes que le validateur (D51) : tout s'exécute dans le navigateur, entreprise, clients, catalogue, historique et numérotation vivent dans IndexedDB, et un seul signal sans contenu part par PDF produit, pour le décompte. Preact (4 Ko) plutôt que du DOM à la main : un éditeur de cette taille, avec ses listes dynamiques, le justifie ; le SDK, lui, reste sans dépendance. Les polices proposées sont des TTF statiques sous licence OFL, copiées depuis npm à la construction, avec leurs licences. L'aperçu peint en SVG la mise en page du SDK (D56) et pose chaque texte à la largeur mesurée (`textLength`), ce qui neutralise les arrondis du moteur du navigateur. Les schematrons, le runtime XSLT et le compteur du validateur sont empruntés sans copie ; la page anglaise partage tout avec la française.

### D61. Le formulaire garde la saisie, la facture vient du SDK
Le formulaire conserve les chaînes tapées (« 1 234,5 ») : un nombre à moitié écrit n'est jamais corrigé sous les doigts. La traduction en `Invoice` passe par `fromDecimal`, `computeLineNetAmount` et `computeTotals` — les montants affichés sont ceux du SDK, au centime — et relève chaque saisie illisible avec le chemin du champ. Un champ vide reste absent : c'est la validation qui dit ce qui manque, jamais le Studio qui invente. Une remise ou des frais du document sans taux explicite sont répartis entre les taux de TVA des lignes, au prorata des bases, le reste d'arrondi allant à la plus grosse ; EN 16931 exige un taux par remise, et un utilisateur ne pense pas « une remise par taux ».

### D62. Émettre, c'est figer
Une facture émise rejoint l'historique avec son PDF, et ne se modifie plus : l'éditeur passe en lecture seule, et la correction passe par un avoir (type 381, facture d'origine en référence) — ce que la loi attend. La numérotation avance d'un cran à chaque émission ; si le numéro émis suit le gabarit avec un rang plus élevé que prévu, la séquence repart de lui, jamais en arrière, et un numéro déjà émis est refusé. « Facturer le solde » d'un acompte appelle `withDeposits` : cadre `*4`, acomptes référencés et déduits.

## 2026-09-30 — Session 24 : QR code de paiement SEPA

### D63. Le QR code redit la facture, et se tait quand elle ne s'y prête pas
Le format retenu est celui de l'EPC (EPC069-12, « GiroCode ») : lu par les applications bancaires de la zone SEPA, et le seul commun à tous les pays de l'euro. Version 002 (BIC facultatif), UTF-8, correction M, comme le demande le format. Rien n'est ajouté à ce que porte la facture : le compte du premier virement (BT-81 = 30, 42 ou 58) dont l'IBAN est valide, le montant à payer (BT-115), la référence de paiement (BT-83) — en champ structuré si c'est une référence ISO 11649, libre sinon —, à défaut le numéro de facture, que le vendeur rapprochera. Le bénéficiaire est le titulaire du compte (BT-85), sinon le bénéficiaire (BT-59), sinon le vendeur : depuis la vérification du bénéficiaire (VoP, octobre 2025), la banque du payeur compare ce nom à celui du compte. Pas de QR code sur un avoir, hors euro, sans montant à payer, sans IBAN valide, ni au-delà des 331 octets du format : `sepaQrPayload` en donne la raison plutôt que de produire un code qu'une banque refuserait. L'option est désactivée par défaut, dans le SDK — un rendu existant ne change pas — comme dans le Studio : le format est très répandu en Allemagne, en Autriche et au Benelux, moins dans les applications bancaires françaises, et un code que la banque du client ne lit pas encombre la page pour rien. Le Studio le propose dans Apparence › Afficher, et dit sous l'interrupteur ce que contient le code, ou pourquoi il manque. La liste des pays SEPA n'est pas codée en dur : elle évolue, et une exclusion à tort vaudrait pire qu'un refus de la banque.

### D64. Un encodeur QR intégré, dessiné en vectoriel
Une dépendance pour quelques centaines de lignes d'ISO/IEC 18004 aurait été la première du SDK hors pdf-lib : l'encodeur est écrit dans le dépôt, en mode octet seulement, les quarante versions et les quatre niveaux. Il est vérifié contre une implémentation indépendante — à masque égal, le symbole de la bibliothèque `qrcode`, bit pour bit, sur toutes les versions et tous les niveaux — et chaque symbole des tests est relu par jsQR, un décodeur tiers, en dépendance de développement seulement. La mise en page porte les modules (`LayoutQrCode`) ; le PDF les peint en un seul tracé rempli, une suite de modules par rectangle — des rectangles remplis un à un laisseraient un liseré clair entre voisins à l'écran — : net à toute échelle, sans image ni transparence, PDF/A-3b selon veraPDF. Le symbole mesure un pouce, davantage si les données l'exigent pour qu'un module ne descende pas sous 0,4 mm, et sa zone de silence de quatre modules est réservée par la mise en page ; un test vérifie qu'aucun trait ne s'y pose, dans les six modèles. Le PDF rastérisé par poppler, comme l'aperçu SVG du Studio rastérisé par le navigateur, se décode en le contenu attendu.

## 2026-10-09 — Session 25 : les règles du profil de la facture

### D65. Le validateur juge chaque fichier avec les règles de son profil, en France_RFE v1.4.0.04
Le validateur appliquait à tout fichier les règles du profil EN 16931 : le CEN, le Factur-X EN 16931 et BR-FR. Or chaque profil a ses règles. En EXTENDED-CTC-FR, BR-26 à BR-28 sont désactivées : le prix net n'est exigé que sur les lignes de détail. En BASIC WL, la facture n'a pas de lignes, donc pas de BR-16. Les exemples officiels du FNFE-MPE, conformes chacun aux règles de leur profil, sortaient donc tous « non conformes » de l'outil, avec BR-26, BR-27, BR-CO-04 ou BR-16. Le signalement est venu d'un lecteur qui avait fait tourner les schematrons de la v1.4.0.04.

Les jeux de règles viennent désormais tous de **France_RFE**, au commit déjà épinglé pour le CDAR, qui est le tag v1.4.0.04 (XP Z12-012 V1.4). mustangproject ne fournit plus que les XSD. Le validateur lit le BT-24 et choisit d'après la table des identifiants acceptés par les bases de codes Factur-X officielles :

| Profil (BT-24) | Juges |
|---|---|
| EN 16931 | SDK, CEN, Factur-X EN 16931, BR-FR |
| Basic WL (`factur-x` ou `zugferd`) | Factur-X BASIC WL, BR-FR |
| Extended (`factur-x` ou `zugferd`) | Factur-X EXTENDED, BR-FR |
| EXTENDED-CTC-FR | EXTENDED-CTC-FR CII, BR-FR |

Le CEN accompagne le Factur-X en EN 16931 parce que les deux ne se recouvrent pas : BR-CL-23, les codes d'unité, n'est que dans le CEN (France_RFE #84). Un profil absent de la table (Minimum, Basic, XRechnung…) **n'est pas jugé** : le rapport le dit au lieu de rendre un faux verdict avec les règles d'un autre profil. Hors EN 16931, le juge SDK est **non applicable** : ce statut ne compte pas dans le verdict, contrairement à « non exécuté », qui interdit toujours d'annoncer la conformité.

Le schematron BR-FR est le même dans chaque dossier de profil. Il existe en deux variantes : la principale, où les 171 règles sont `fatal`, et `_WARNING`, qui en rétrograde 145 en avertissements comme le faisait la V1.3.0. La principale est retenue. Le verdict n'en dépend pas, puisque toute anomalie non tolérée fait échouer, mais une plateforme agréée refusera ces factures, et le libellé « bloquant » le dit.

Côté SDK, rien ne change. Ses fichiers de référence passent la v1.4.0.04 avec les mêmes trois tolérances, et le CEN est identique octet pour octet. Le Factur-X passe de 1.09 à 1.09.2. Deux contrôles le tiennent en CI :
- les vingt exemples officiels (`test/schemas/exemples/`, récupérés au même commit) passent par le vrai `analyze()` avec les vrais SEF, et doivent être reconnus sous le profil de leur dossier puis acceptés ;
- l'exemple EXTENDED-CTC-FR à sous-lignes doit relever BR-26 sous le CEN.

Une mutation qui renvoie l'EXTENDED-CTC-FR vers les règles EN 16931 fait échouer les cinq exemples de ce profil.

Les jeux de règles sont publiés sous `schemas/<tag>/`. nginx les garde un an en cache, selon le principe « le nom change quand le contenu change ». Sans ce dossier versionné, `BR-FR-Flux2-CII.sef.json.gz`, inchangé de nom mais pas de contenu, aurait servi la V1.3.0 aux visiteurs déjà venus. Un test vérifie que la version demandée par le site est celle que `validator:fetch` dépose. Les SEF Extended et EXTENDED-CTC-FR (0,37 et 0,18 Mo compressés) ne sont téléchargés que si l'on dépose un fichier de ce profil ; le parcours EN 16931 garde son poids.

### D66. BR-FR-14 : le SDK n'interdit plus l'adresse de livraison d'une prestation de services
D42 refusait une adresse de livraison (BG-15) sur une prestation de services. La norme dit en effet ces données « pas à transmettre » pour les services, mais elle déclare la règle « non contrôlable applicativement ». Le schematron BR-FR officiel (France_RFE v1.4.0.04) ne contient d'ailleurs aucune assertion BR-FR-14. Les exemples du FNFE-MPE, qui a piloté la norme, font l'inverse : les six exemples EN 16931 en cadre S1 portent tous une adresse de livraison complète, et passent les trois schematrons officiels. Le SDK était donc seul à les refuser. `validateInvoice` les déclarait non conformes, et `fromCiiXml`, qui valide par défaut, refusait de lire une facture reçue que toute la chaîne officielle accepte.

La règle garde ce qui est contrôlable sans ambiguïté : une adresse fournie doit être complète (BT-75, BT-77, BT-78, BT-80), quelle que soit la nature de l'opération. Le Studio ne l'interdit plus, mais conseille de ne l'indiquer pour une prestation que si elle a un sens, un lieu d'intervention par exemple. Assouplir une règle ne refuse rien de ce qui passait : pas de rupture pour les intégrateurs.

Garde-fou : `site-src/validateur/official.test.ts` passe les exemples officiels EN 16931 au SDK, et n'y tolère que leurs données fictives (`BIC_MONCOMPTE`, un numéro de TVA à quatorze chiffres). Une règle du SDK plus stricte que la chaîne officielle y apparaîtra.

## 2026-10-09 — Session 26 : la franchise en base

### D67. BR-FR-CO-16 : ce que le fichier déclare de la franchise, et le SIREN en BT-32
L'annexe A V1.4 de XP Z12-012 (onglet « BR-France CTC ») définit BR-FR-CO-16. Une facture en franchise en base porte un détail de TVA en catégorie E (BT-118) avec le code `VATEX-FR-FRANCHISE` (BT-121). Si le vendeur n'a pas de numéro de TVA, il répète son SIREN en BT-32. L'annexe la marque « règle non vérifiable » : rien dans le fichier ne dit si le vendeur est réellement en franchise. Aucun schematron ne la porte, ni France_RFE v1.4.0.04, ni le CEN, ni Factur-X.

Le SDK contrôle ce que le fichier déclare. Le code `VATEX-FR-FRANCHISE` n'accompagne que la catégorie E. Une facture qui l'emploie, d'un vendeur sans numéro de TVA (BT-31), doit porter en BT-32 (`seller.taxRegistrationId`) le SIREN du vendeur. Il ne cherche pas à deviner une franchise quand le code manque, par exemple d'après le texte « 293 B » du motif : la norme dit elle-même que seul le vendeur le sait.

Le cas visé est la micro-entreprise sans numéro de TVA. Sans cette règle, le SDK acceptait sa facture et le schematron CEN la refusait (BR-E-02 : en catégorie E, il faut BT-31, BT-32 ou BT-63). Le test `schematron.test.ts` tient les deux verdicts ensemble : SIREN en BT-32, accepté par le SDK et les trois schematrons ; rien en BT-32, refusé par le SDK (BR-FR-CO-16) comme par le CEN (BR-E-02).

Le Studio l'a révélé : son test de franchise en base, un vendeur sans numéro de TVA ni BT-32, affirmait une facture sans anomalie, alors que le CEN la refuse. Le Studio ne remplit pas BT-32 à la place de l'utilisateur, conformément à D61 (la validation dit ce qui manque, le Studio n'invente rien). L'anomalie pointe sur le champ « Identifiant fiscal local », et la section repliée qui le contient s'ouvre au clic.

BR-E-02 reste non implémentée dans le SDK pour les autres exonérations E. Une exonération qui n'est pas la franchise, sans identifiant fiscal du vendeur, passe le SDK et pas le CEN : c'est un écart connu, à traiter à part. *Traité par D68.* *Règle assouplie par D69 : seul le BT-32 absent est bloqué.*

### D68. Les identifiants fiscaux selon la catégorie de TVA : toute la famille, sous les noms officiels
BR-E-02 n'était qu'un cas d'un trou plus large. Chaque catégorie de TVA a ses règles 02 (lignes), 03 (remises) et 04 (frais de document). Elles disent quels identifiants fiscaux la facture doit porter, ou ne doit pas porter. Le SDK n'en appliquait aucune, et le CEN les appliquait toutes. Un vendeur sans numéro de TVA en S, Z, E ou G, un acheteur sans numéro de TVA en K, un numéro de TVA en O : autant de factures que le SDK disait conformes et que le CEN refusait.

`validate/tax-ids.ts` les applique toutes :

| Catégorie | Exigence |
|---|---|
| S, Z, E, AE, L, M | BT-31 ou BT-32 du vendeur |
| AE | en plus, BT-48 ou BT-47 (SIREN) de l'acheteur |
| K, G | BT-31 du vendeur, BT-32 ne suffit pas ; en K, BT-48 de l'acheteur |
| O | ni BT-31 du vendeur ni BT-48 de l'acheteur |

Le schematron déclenche la règle par élément. Son remède étant sur une partie, le SDK émet une anomalie par règle, sur le champ à corriger (`seller.vatId`, `buyer.vatId`). Le représentant fiscal (BT-63) n'est pas modélisé : il n'entre pas dans les conditions. En franchise en base, BR-FR-CO-16 dit déjà quoi porter en BT-32 : BR-E-02 ne s'y ajoute pas.

**Noms officiels.** Ces règles portent les identifiants de la norme : `BR-IC-…` pour K (livraison intracommunautaire), `BR-AF-…` pour L (IGIC), `BR-AG-…` pour M (IPSI). Les règles par catégorie déjà publiées (`BR-K-05`, `BR-L-10`…) emploient à tort la lettre de la catégorie. Les codes d'anomalie font partie de l'API stable, et les renommer est une rupture : c'est une décision à part. Les nouveaux codes, eux, naissent justes. *Le CEN 1.3.17 renomme BR-AF et BR-AG : voir D70.*

**Vérification.** Les cas du fixture `test/fixtures/tax-categories.ts` portent leurs verdicts, écrits à la main. Le SDK y est confronté (`tax-identifiers.test.ts`), le schematron CEN aussi (`schematron.test.ts`) : les dix-huit cas donnent exactement les mêmes règles des deux côtés. Hors périmètre, connus : BR-IC-11 et BR-IC-12, date et pays de livraison d'une livraison intracommunautaire.


### D69. Retour de FacturX API sur le fix04 : BR-FR-CO-04, BR-FR-CO-16 assouplie, ChargeIndicator en UBL
Après le passage à France_RFE v1.4.0.04 (D65), FacturX API a relevé d'autres pièges du correctif fix04. Chacun a été vérifié dans les schematrons, dans l'annexe A V1.4 et sur le SDK.

**BR-FR-CO-04.** Une facture rectificative (384) cite une et une seule facture antérieure (BT-25). Le schematron BR-FR v1.4.0.04 compte toutes les références d'en-tête : le filtre qui ne gardait que les références complètes (numéro et date) y est mis en commentaire. Le SDK n'appliquait pas la règle. Une 384 sans référence, ou avec deux, passait `validateInvoice`, et la plateforme la refusait. Le SDK compte désormais, comme le schematron, toutes les entrées de `references.precedingInvoices`. Les autres rectificatives (471 à 473) restent refusées par BR-CL-01 tant qu'elles ne sont pas adoptées. Le test `schematron.test.ts` confronte les deux verdicts pour 0, 1 et 2 références.

**BR-FR-CO-16 assouplie.** La règle est « non vérifiable » et aucun schematron ne la porte. Dans l'annexe A, la règle de gestion G1.47 permet aussi à un vendeur en franchise sans numéro de TVA d'employer la catégorie Z. La plateforme transcode d'ailleurs E + `VATEX-FR-FRANCHISE` en Z avant de transmettre à l'administration (BR-FR-MAP-08/09). D67 bloquait deux cas que la chaîne officielle accepte :
- un BT-32 autre que le SIREN ;
- le code `VATEX-FR-FRANCHISE` hors de la catégorie E.

Comme pour BR-FR-14 (D66), le SDK ne refuse plus ce que la chaîne officielle accepte. BR-FR-CO-16 ne signale plus que le vendeur sans numéro de TVA ni BT-32, que le CEN refuse aussi (BR-E-02), avec son SIREN pour remède. En Z, BR-Z-02 (D68) couvre le même cas. Le SDK n'a pas de niveau « avertissement » : en ajouter un changerait l'API, et ce n'est plus utile ici. Il ne se fie toujours pas au texte « TVA non applicable », employé aussi en autoliquidation.

**ChargeIndicator en UBL.** L'indicateur remise/frais est un xs:boolean : « 1 » et « 0 » y valent « true » et « false ». La lecture UBL tenait pour une remise tout ce qui n'était pas « true », si bien qu'un frais marqué « 1 » devenait une remise. Elle lit désormais les quatre valeurs et refuse les autres par une `FacturXParseError` FORMAT, avec le chemin du champ. En CII, le schematron Factur-X n'accepte que « true » et « false », sans identifiant de règle à afficher. La lecture CII refusait déjà « 0 » et « 1 », avec le chemin du champ, et l'écriture n'émet que « true » et « false ».

**Déjà en place.** Le validateur reconnaît l'identifiant BT-24 d'EXTENDED-CTC-FR à part de celui de Factur-X EXTENDED (D65).


### D70. CEN 1.3.17 : BR-AF et BR-AG deviennent BR-IP et BR-IG, le SDK attend France_RFE
FacturX API a signalé que la version 1.3.17 des artefacts de validation EN 16931 renomme les règles de l'IGIC et de l'IPSI (ConnectingEurope/eInvoicing-EN16931#519). Elle est publiée le 12 octobre 2026 (tag `validation-1.3.17`).

**Le piège.** Les nouvelles lettres ne suivent pas le nom des taxes : `BR-IP-…` couvre l'IGIC (L, ex-`BR-AF-…`) et `BR-IG-…` l'IPSI (M, ex-`BR-AG-…`). C'est l'inverse de ce qu'on lit d'instinct.

**Mesuré.** Le CEN 1.3.17, compilé depuis la publication de ConnectingEurope, a jugé les factures de référence (CII et UBL) et les dix-huit cas d'identifiants fiscaux de D68, à côté du 1.3.16 épinglé. Seul écart : les cas L et M, où `BR-AF-02` devient `BR-IP-02` et `BR-AG-02` devient `BR-IG-02`. Sur ces cas, rien d'autre ne bouge.

**Mesuré sur tout le reste.** Les deux versions ont ensuite jugé 93 documents : le corpus tiers (KoSIT et mustangproject, PDF compris), les exemples officiels de France_RFE, les golden et les 32 exemples livrés avec la 1.3.17. Aucun ne porte de catégorie L ou M, le renommage n'y paraît donc pas. 83 rendent exactement le même verdict. Les 10 autres ne changent que d'avertissements : aucune règle bloquante n'apparaît ni ne disparaît.
- Neuf factures EXTENDED et EXTENDED-CTC-FR récoltent CII-SR-036 et CII-SR-038 (`ParentLineID` et `LineStatusReasonCode` « should not be present »). La 1.3.17 corrige leur XPath (ConnectingEurope #521) : elles visaient la ligne, où ces éléments n'apparaissent jamais, et visent désormais son document de ligne, où le profil EXTENDED porte ses sous-lignes. C'est sans effet sur le validateur, qui ne juge pas ces profils avec le CEN (D65), ni sur le SDK, qui n'émet aucun de ces éléments.
- `golden/full.xml` perd CII-SR-475. La 1.3.17 corrige le contexte de la règle (#508) : elle comptait ensemble les BT-123 de toutes les pièces jointes 916, elle les compte désormais pièce par pièce. C'est le faux avertissement que la CI et le validateur tolèrent aujourd'hui (BR-FR-17 veut une description par pièce).

**Le SDK garde BR-AF et BR-AG.** Deux raisons :
- la chaîne de référence est France_RFE v1.4.0.04 (D65). Elle embarque le CEN 1.3.16, donc BR-AF et BR-AG, et le FNFE-MPE n'a rien publié depuis. Renommer seul ferait parler au SDK une autre langue que le validateur en ligne et que les artefacts officiels de la réforme ;
- renommer un code d'anomalie est une rupture (D68), donc une version majeure.

**Quand basculer.** Au passage à une France_RFE qui embarque la 1.3.17. Le test seul ne suffit pas à le savoir : il n'échoue qu'une fois `FNFE_COMMIT` relevé à la main dans `scripts/fetch-schemas.mjs`. Le workflow « Veille France_RFE » (`.github/workflows/france-rfe.yml`) compare donc chaque lundi la branche principale de France_RFE au commit épinglé, et ouvre une issue s'il a bougé, avec la version du CEN embarquée dans le titre (`pnpm rfe:check` fait la même comparaison en local). Une fois le commit relevé, `schematron.test.ts` confronte les cas L et M au nouveau CEN et échoue sur `BR-IP-02` et `BR-IG-02`.

**Ce que fera la 2.0, en une fois.**
- `BR-AF-02` à `04` deviennent `BR-IP-02` à `04`, et `BR-AG-02` à `04` deviennent `BR-IG-02` à `04` : `tax-ids.ts`, `TaxIdRuleFamily`, `TAX_ID_RULE` et le fixture.
- La décision laissée ouverte par D68 : les règles par catégorie prennent leur nom officiel. `BR-K-…` devient `BR-IC-…`, `BR-L-…` devient `BR-IP-…` et `BR-M-…` devient `BR-IG-…`, pour les règles 01 et 05 à 10. Deux ruptures de suite sur les mêmes familles seraient pires qu'une.
- Le taux de l'IPSI. Le SDK exige un taux supérieur à zéro en M (`BR-M-05` à `07`, `CALC-TAX-RATE`), alors que le CEN accepte zéro (`>= 0`, en 1.3.16 comme en 1.3.17). L'écart est sans effet aujourd'hui, puisque BR-FR-15 refuse déjà toute facture en L ou en M. À aligner avec le reste.
- La tolérance de CII-SR-475, que la 1.3.17 ne lève plus à tort : à retirer de `test/helpers/schematron.ts`, de `site-src/validateur/analyze.ts` et de ses libellés dans `i18n.ts`.


### D71. Huit règles BR-FR v1.4.0.04 que la plateforme appliquait et le SDK pas
Depuis le passage à France_RFE v1.4.0.04 (D65), le guide listait les règles du schematron BR-FR que le SDK ne vérifiait pas. Pour chacune, une facture fautive passait `validateInvoice` et la plateforme la refusait. Huit tiennent dans le modèle, et le SDK les applique désormais :

| Règle | Le SDK refuse | Champ signalé |
|---|---|---|
| BR-FR-31 | deux notes `BAR` portant un traitement | `notes` |
| BR-FR-32 | un identifiant de schéma `0002` ou `0231` qui n'a pas exactement 9 chiffres | `*.globalIds[i].value`, `payee.legalId`, `payee.globalId.value` |
| BR-FR-CO-03 | un avoir de remise globale (262) sans contrat (BT-12) ou sans période complète (BG-14) | `references.contract`, `delivery.period` |
| BR-FR-CO-05 | un avoir (261, 381, 396) sans facture antérieure datée (BT-25, BT-26) | `references.precedingInvoices` |
| BR-FR-CO-07 | une échéance antérieure à la date de facture, hors acompte et facture déjà payée | `paymentTerms.dueDate` |
| BR-FR-CO-08 | une facture d'acompte (386) en cadre B4, S4 ou M4 | `typeCode` |
| BR-FR-CO-09 | une facture déjà payée (B2, S2, M2) dont le montant payé n'est pas le TTC, dont le net à payer n'est pas nul, ou sans échéance | `totals.prepaidAmount`, `totals.amountDueForPayment`, `paymentTerms.dueDate` |
| BR-FR-CO-10 | un identifiant global sans schéma, ou un schéma répété dans une partie | `*.globalIds[i].scheme`, `payee.globalId.scheme` |

**Le test du schematron, pas seulement l'énoncé.** Chaque règle reprend le test tel qu'il est écrit, limites comprises :
- BR-FR-31 ne compte que les notes `BAR` dont le contenu figure dans sa liste, B2CINT compris. La note que génère `processing` s'efface devant une note `BAR` fournie, elle ne s'y ajoute jamais : seules les notes fournies peuvent se doubler.
- BR-FR-32 vise tout identifiant de schéma `0002` ou `0231`. Pour le SIREN du vendeur et de l'acheteur, BR-FR-10 et 11 le disaient déjà, plus strictes (clé de Luhn) : le SDK n'ajoute pas une seconde anomalie. Le SIREN du bénéficiaire (BT-61), lui, n'était vérifié nulle part.
- BR-FR-CO-05 admet aussi une référence sur chaque ligne, que le modèle EN 16931 ne porte pas : seule la référence d'en-tête compte. BR-FR-CO-05, 07 et 08 citent aussi les types 500, 502 et 503, que BR-CL-01 refuse déjà.
- BR-FR-CO-09 compare des montants : un montant payé (BT-113) absent n'égale pas le TTC. Une facture déjà payée doit donc porter son paiement.
- BR-FR-CO-10 : le SIRET s'écrit en identifiant global `0009`, il compte donc parmi les schémas de la partie. Un identifiant global sans schéma s'écrit avec un `schemeID` vide, que BR-FR-CO-10 laisse passer et que le CEN refuse (BR-CL-10). Le SDK le signale en BR-FR-CO-10, la règle qui énonce l'exigence.

**Vérification.** Les 31 cas de `test/fixtures/french-v14.ts` portent leurs verdicts, écrits à la main avant le code. Le SDK y est confronté (`validate.test.ts`), et la chaîne officielle aussi (`schematron.test.ts`, les trois schematrons) : chaque cas relève exactement les mêmes règles des deux côtés. Sur les exemples EN 16931 officiels de France_RFE, le SDK ne relève toujours que leurs données fictives (`official.test.ts`) : aucune des huit règles n'est plus stricte que la chaîne officielle.

**Ce que des tests entérinaient.** Cinq tests tenaient pour valides une facture déjà payée (S2) sans montant payé, ou un avoir (381) sans facture d'origine, deux factures que la plateforme refuse. Ils passent maintenant par deux fixtures, `paidInvoice()` et `creditNote()`.

**Restent.** BR-FR-CO-12 et BR-FR-CO-14/15 demandent des éléments hors modèle (BT-6, BT-111, BG-11). Un écart de BR-FR-20 est apparu en chemin : le SDK vérifie `processing`, pas le contenu d'une note `BAR` fournie dans `notes`, et il ne connaît pas encore B2CINT, ajouté par la V1.4. Les deux vont ensemble, puisque vérifier le contenu sans connaître B2CINT refuserait une valeur que la chaîne officielle accepte. Le libellé de B2CINT reste à sourcer avant de l'ajouter à `ProcessingCode`.


### D72. BR-FR v1.4.0.03 contre v1.4.0.04 : le corpus ne bouge pas, deux échéances faisaient planter la .03
FacturX API a demandé l'effet du correctif fix04 (France_RFE v1.4.0.03 → v1.4.0.04, 3 et 4 septembre 2026) sur le corpus de D70. Le SDK n'a jamais embarqué la .03 : il est passé de BR-FR V1.3.0 à la v1.4.0.04 (D65).

**Ce que le fix04 change en BR-FR.**
- BR-FR-CO-07 et CO-09 lisent toutes les échéances (BT-9). Le profil EXTENDED admet plusieurs `SpecifiedTradePaymentTerms`, donc plusieurs `DueDateDateTime`. La .03 les passait à `string()`, qui n'en accepte qu'une.
- Les montants et les dates sont comparés en `xs:decimal` au lieu de `number()` : CO-09, MV-05, MV-09, MV-10 et le contrôle de date.
- BR-FR-MV-10 compte les sous-lignes GROUP, en plus des DETAIL, dans sa tolérance de 0,01 par sous-ligne.
- BR-FR-20 cite B2CINT dans son message. Le test l'acceptait déjà en .03.
- En UBL, d'autres corrections : notes sans sujet, présence du BT-23, XPath de l'échéance d'un avoir.

**Mesuré sur les 93 documents.** Les schematrons BR-FR CII et UBL des deux tags, compilés depuis France_RFE, ont jugé les 93 documents de D70 : 93 verdicts identiques, règle par règle, sans erreur d'exécution. La v1.4.0.04 compilée pour la mesure juge comme le SEF épinglé du projet sur tous les documents CII.

**Ce que le corpus n'atteint pas.** Ce zéro dit surtout que le corpus passe à côté du fix04 :
- aucun document ne porte deux échéances, 61 en portent une ;
- aucun n'est en cadre B2, S2 ou M2 (facture déjà payée), donc BR-FR-CO-09 ne s'y applique pas ;
- sept sont en cadre S8 ou B9 avec des lignes GROUP, mais aucune de ces lignes GROUP n'est elle-même une sous-ligne.

**Cas ciblés.** Chaque variante part d'un exemple officiel de France_RFE en EXTENDED-CTC-FR, accepté par les deux versions, et n'y change qu'un point.

| Variante | v1.4.0.03 | v1.4.0.04 |
|---|---|---|
| UC13 (B1) avec une seconde échéance, postérieure à la facture | erreur XPTY0004, aucun verdict | acceptée |
| UC13 avec une seconde échéance, antérieure à la facture | erreur XPTY0004, aucun verdict | BR-FR-CO-07 |
| UC13 en cadre B2, deux échéances | erreur XPTY0004, aucun verdict | acceptée |
| UC10 (S8), ligne 3 passée en GROUP sous la ligne 1, TTC de la ligne 1 décalé de 0,02 | BR-FR-MV-10 | acceptée |

Les témoins rendent le même verdict des deux côtés : UC13 et UC10 tels quels, UC13 en B2 avec une seule échéance, UC10 avec le seul décalage de 0,02 (deux sous-lignes DETAIL, donc 0,02 de tolérance).

**Le vrai changement.** En .03, une facture CII à plusieurs échéances faisait échouer tout le schematron BR-FR : la chaîne officielle ne rendait aucun verdict, quel que soit le reste de la facture. La .04 la juge. Les autres corrections CII ne touchent que des cas limites : la tolérance d'arrondi de MV-10 et la précision des comparaisons. Les corrections UBL n'ont pas été éprouvées par des cas ciblés.

**Effet sur le SDK : aucun.** Le SDK n'émet qu'une échéance (`paymentTerms.dueDate`), en profil EN 16931, sans sous-lignes. Ses règles BR-FR-CO-07 et CO-09 (D71) reprennent le test de la .04, et le validateur en ligne juge en .04 depuis D65.

## 2026-11-03 — Session 27 : les comptes et le suivi des factures

### D73. Les comptes : ce que devient « rien n'est transmis »
D51 posait que rien ne quitte le navigateur. Cela reste vrai là où l'utilisateur ne crée pas de compte : le validateur en ligne est entièrement local, et le Studio sans compte aussi (IndexedDB, comme avant). Un compte est un choix, jamais un préalable.

Avec un compte, les données sont sur un serveur : brouillons, clients, catalogue, factures émises, paiements. Elles sont hébergées dans l'UE (Supabase, Paris) et chiffrées au repos par l'hébergeur, mais **lisibles par le service**. Ce n'est pas un chiffrement de bout en bout, et il ne peut pas en être un : le serveur lit la facture pour l'émettre, la numéroter, calculer ce qu'il reste dû et envoyer une relance. La promesse change donc de forme sans disparaître : elle se tient par mode, et c'est l'utilisateur qui fait le choix, à la création du compte, qui exige l'acceptation des CGU.

**`supabase/` passe en AGPL-3.0-or-later**, le reste du dépôt restant en MIT. Le service est ouvert : schéma, règles d'accès, fonctions d'émission et de relance sont dans ce dépôt public, et l'abonnement vendra l'hébergement et la plateforme agréée, pas le code. Sous une licence permissive, un concurrent pourrait héberger ce service sans rien publier de ses modifications. L'AGPL l'en empêche dès qu'il l'offre à des tiers par le réseau. Le SDK et le Studio, eux, restent libres d'usage. `supabase/LICENSE` porte le texte, et `LICENSE` à la racine dit quel dossier relève de quelle licence.

**Le SDK est copié dans les fonctions, pas pris sur npm.** `pnpm compte:preparer` copie `packages/facturx/dist/` et les modules partagés du Studio dans `supabase/functions/_vendor/` (non versionné), avant les tests et le déploiement. La fonction emploie ainsi exactement le SDK du bundle du Studio, sans attendre une publication, et ne dépend pas de la façon dont le bundler des fonctions traite un import hors de leur dossier. Les dépendances de `supabase/functions/deno.json` suivent celles du SDK, à la version exacte, et un test le vérifie. Chaque facture garde la version du SDK qui l'a produite.

### D74. Le rendu PDF dans une Edge Function : 280 ms au p95 pour 50 lignes, l'émission rend dans sa requête (provisoire)
L'émission d'une facture (tâche 8) numérote, écrit en base et rend le PDF Factur-X dans la même requête : une facture émise a toujours son PDF. C'est possible si `renderInvoicePdf` + `embedFacturX` tiennent très en deçà du budget de CPU d'une Edge Function. Sinon, le rendu passe en différé (tâche 9). On a donc mesuré avant de construire.

**Budget relevé.** La page des limites des Edge Functions (supabase.com/docs/guides/functions/limits, lue le 6 novembre 2026) donne 2 s de temps de CPU par requête, hors attentes d'entrées-sorties asynchrones, et 256 Mo de mémoire. Ces deux limites ne varient pas selon le plan. Le runtime local reprend les mêmes constantes : l'image 1.77.9 que lance le CLI 3.0.0 est réglée à 2 000 ms de CPU (limite douce à 1 000 ms) et à 256 Mo. Son comportement n'est pas forcément celui du service hébergé.

**Ce qui a été mesuré.** Une fonction jetable, servie par `supabase functions serve` (Docker sur un Mac, pile locale démarrée), puis supprimée sans être commitée. Elle construit la facture d'exemple de `scripts/example-invoice.mjs` (2 lignes) et la même à 50 lignes (la paire de lignes répétée 25 fois, totaux recalculés par `computeTotals`). Polices Geist (regular et semibold, passées en base64 dans le corps de la requête), options de rendu par défaut du Studio (modèle classic, A4, français), profil sRGB. Le chronomètre (`performance.now()`) entoure `renderInvoicePdf` + `embedFacturX` ; le décodage des polices (de 16,5 à 45 ms sur les 26 requêtes des séries) est hors chronomètre.

Vingt rendus de chaque facture ne tiennent pas dans une requête : un essai à 40 rendus a été coupé par le runtime (statut 546, `WORKER_LIMIT`), limite douce franchie 1,0 s après le début de la requête, limite dure à 3,0 s, alors qu'elle est réglée à 2 000 ms de CPU. La limite douce semble cumulée par worker, qui est retiré dès qu'il a consommé environ 1 s de CPU : d'où, dans les séries, une requête sur deux environ sur un worker neuf. La mesure se fait en dix requêtes de trois rendus par facture. Le premier rendu d'un worker neuf (le froid) est compté à part. Médiane et p95 portent sur les vingt premiers rendus à chaud, dans l'ordre des requêtes (le p95 est la 19e valeur triée sur 20).

| Facture | PDF | Médiane | p95 | Max | Froid (1er rendu d'un worker neuf, 3 essais) |
|---|---|---|---|---|---|
| 2 lignes | 1 page, 140 049 octets | 136,7 ms | 170,2 ms | 212,0 ms | 314,5 ms (de 287,2 à 353,3) |
| 50 lignes | 3 pages, 149 255 octets | 209,3 ms | 280,3 ms | 280,7 ms | 396,0 ms (de 395,0 à 400,2) |

Les valeurs hautes du chaud (280,3 et 280,7 ms) sont des deuxièmes rendus d'un worker neuf, que le JIT n'a pas fini de chauffer : la mesure est plutôt pessimiste.

Vue du client, la première requête sur un worker neuf (un seul rendu) dure de 0,56 à 0,65 s pour 2 lignes et de 0,69 à 0,72 s pour 50 lignes. Deux essais préliminaires, faits avec le même code de rendu mais avant la forme finale de la fonction et hors des séries, ont été plus lents : le tout premier appel après la création du conteneur (un rendu de 50 lignes) a pris 613,8 ms, soit 1,6 s vu du client, et le premier rendu du worker neuf qui a suivi la coupure de l'essai à 40 rendus (lot de trois rendus de 50 lignes) 500,7 ms. Leurs sorties brutes sont en annexe de `docs/compte.md`. Le tas (`heapUsed`) reste entre 22,8 et 34,5 Mo sur les 26 requêtes des séries, loin des 256 Mo.

**Lecture.** Les deux tiers du temps d'une facture de 50 lignes sont déjà dépensés pour une facture de 2 lignes : le coût est surtout fixe, et 48 lignes de plus coûtent environ 70 ms. La cause (les polices embarquées entières, sans doute) n'a pas été profilée.

**Décision.** Le seuil posé pour la mesure locale est un p95 de la facture de 50 lignes sous 500 ms, le quart du budget, pour la marge entre ce Mac et les machines de Supabase. Avec 280,3 ms (14 % du budget) il est tenu. Le froid reste lui aussi sous 500 ms dans les trois essais dédiés (400,2 ms au plus, 20 % du budget), et le p95 des 30 rendus de la série de 50 lignes, froids compris, est de 398,4 ms. Les deux essais préliminaires dépassent 500 ms (613,8 ms, soit 31 % du budget, et 500,7 ms) sans approcher le budget : le seuil de 500 ms vise le p95 à chaud, le froid se regarde à part. **L'émission rend le PDF dans la même requête que la transaction : la tâche 8 s'applique telle quelle, la tâche 9 est sautée.**

**Provisoire, à confirmer sur le projet déployé, avant l'ouverture des comptes.** Rien n'a été mesuré en ligne : pas de projet distant à ce stade. La confirmation se fait avec une fonction de mesure jetable et son outil (`supabase/mesure-rendu/`), pas à pas dans `docs/compte.md` (« Confirmer D74 sur le projet déployé »). Elle suit le protocole de la mesure locale, non celui de la fiche d'origine (20 rendus dans une requête) : celui-là dépasse le budget par construction, un « CPU time exceeded » y serait certain et ferait basculer à tort sur la tâche 9. Protocole, pour la facture de 50 lignes comme pour celle de 2 :
- froid : une requête d'un seul rendu sur un worker neuf, trois fois. Le temps compté est celui du démarrage du worker et de l'import des modules, plus le rendu : en production, chaque émission est un rendu seul, et une part tombe sur un worker neuf. En local, sur une machine chargée, l'import a pris environ 277 ms de CPU et le premier rendu 577 ms, près de 850 ms en tout ;
- chaud : au moins 20 rendus, répartis sur plusieurs requêtes de trois rendus au plus ; on ne compte que les rendus de rang 1 ou plus (le rang est le nombre de rendus déjà faits par le worker), et le p95 est la ⌈0,95·n⌉-ième valeur triée. La fonction renvoie les durées brutes et le rang de chaque rendu, l'agrégation se fait hors d'elle ;
- « CPU time exceeded » : il ne tranche que sur une requête d'un seul rendu. Un lot qui l'atteint doit être réduit, jusqu'à un rendu, avant d'en tirer quoi que ce soit ;
- configurations : Geist (126 et 128 Ko) comme référence, puis Inter (342 Ko), et les cas extrêmes : une police importée de 2 Mo, un logo de 1 Mo, et un logo PNG de 2 000 × 2 000 pixels, le plafond des logos (le poids d'un fichier ne borne pas le coût de son décodage ; un PNG de 4 000 × 4 000 dépassait 500 Mo en natif), chacune avec son froid et ses 20 rendus à chaud ;
- rafale : cinq émissions simultanées d'une même entreprise par `emettre`, CPU et mémoire ;
- mémoire : le corps de 10 Mio de la pire forme admise connue (`supabase/functions/tests/decodage-large.ts`), envoyé à `importer` et à `emettre`. Un 546 ou « Memory limit exceeded » montrerait que la limite de 256 Mo porte sur la mémoire résidente (≈ 290 Mio mesurés en local, dont ≈ 96 de bibliothèques) : le plafond du corps baisserait alors.

**Règle : si, pour la facture de 50 lignes et dans l'une de ces configurations, le p95 à chaud dépasse la moitié du budget (1 s), ou si un rendu seul sur un worker neuf, import des modules compris, atteint 1 s, ou si un « CPU time exceeded » frappe une requête d'un seul rendu, la tâche 9 s'applique alors.** Si seuls les cas extrêmes échouent (police de 2 Mo, logos), plafonner leur poids ou leurs dimensions est une autre réponse que la tâche 9 : c'est une décision de produit, à prendre au vu des chiffres.

Cette mesure laisse aussi de côté, et la confirmation doit le regarder :
- la configuration de rendu : seule classic / A4 / français a été mesurée ; les autres gabarits, un long pied de page, des libellés propres et de longues descriptions de lignes ne l'ont pas été ;
- le reste de la requête d'émission (lecture du corps, validation, appels à la base et au stockage), dont seules les parties calculées comptent dans le budget ;
- le CPU lui-même : `performance.now()` donne du temps écoulé, et le runtime local a franchi sa limite douce de 1 s sur des requêtes de 0,9 s environ, signe que le démarrage du worker et le chargement des modules comptent aussi.

## 2026-11-08 — Session 28 : le compte en production

### D75. Supabase au plan Free, à Francfort : une seule sauvegarde, chaque nuit, chez Scaleway
La spec prévoyait un projet au plan Pro, en région Paris (`eu-west-3`) (§ 4, § 11). Le projet de production est `facturx`, créé le 28 septembre 2026 dans l'organisation `metchera`, au plan Free, en région `eu-central-1` (Francfort). L'éditeur est un particulier et le service, gratuit, n'a pas de recette : le plan Pro (25 $ par mois, plus le calcul d'un second projet si l'organisation entière y passait) n'est pas engagé. Une région ne se change pas sur un projet existant, et le palier gratuit n'admet que deux projets actifs, déjà pris : Francfort reste. Les données restent dans l'UE, chez le même prestataire ; seule la ville change.

**Ce que le plan Free retire, et ce qui le compense** (supabase.com/pricing et la documentation, lues le 8 novembre 2026) :
- *Pas de sauvegarde chez Supabase*, quand le plan Pro en garde 7 quotidiennes. L'archive chiffrée chez Scaleway devient la seule, et passe d'hebdomadaire à quotidienne (`sauvegarde.yml`, `23 2 * * *`) : la perte du projet coûte au plus un jour de factures, pas une semaine. La rétention reste de 12 semaines, soit 84 archives au lieu de 12. Les fichiers des buckets, que les sauvegardes de Supabase ne contiennent pas, y sont déjà.
- *La pause* d'un projet trop peu actif sur 7 jours, après un courriel. Les CGU ne promettent aucune disponibilité ; le guide dit comment l'éviter et la lever (90 jours pour le faire).
- *Des quotas* : 500 Mo de base par projet, et pour toute l'organisation 1 Go de fichiers et 5 Go de trafic sortant par mois. Au-delà, l'organisation entière est restreinte (lecture seule, 402).
- *Le contrôle des mots de passe divulgués*, réservé au plan Pro : l'avertissement du *Security Advisor* est attendu.
- *Les journaux de la plateforme* ne sont gardés qu'un jour, au lieu de 7.

**Les textes sont repris sans changer de version.** La politique de confidentialité, l'accord de sous-traitance, les CGU et le Studio disent Francfort, la copie chiffrée de chaque nuit comme seule sauvegarde, et un jour pour les journaux de l'hébergeur. La version reste `2026-11` : les passages qui parlent du compte ne sont publiés qu'avec les variables de Supabase (`docs/compte.md`, 1.9), que le site n'a pas encore (`/cgu/` répond 404 le 8 novembre 2026). Personne ne les a donc acceptés dans leur forme précédente.

**Le passage au plan Pro reste ouvert**, sans migration : transférer le projet vers une organisation Pro. Il rendrait les sauvegardes de Supabase, le contrôle des mots de passe et 7 jours de journaux ; la politique de confidentialité (§ 5 et 7) et l'accord de sous-traitance seraient alors à reprendre. La sauvegarde de chaque nuit chez Scaleway resterait.

## 2026-11-09 — Session 29 : les e-mails

### D76. Les e-mails : un cadre sans ressource distante, la langue dans le compte, les modèles par l'API de gestion
facturx envoie deux sortes d'e-mails, tous par Brevo (`docs/compte.md`, 1.3). Ceux du compte (confirmation de l'adresse, mot de passe oublié, changement d'adresse) partaient de Supabase Auth avec ses modèles par défaut : en anglais, sans mise en forme (« Confirm your signup / Follow this link to confirm your user »). La relance, composée par `relancer`, était le texte relu par l'utilisateur, échappé, en paragraphes dans un `<body>` en Arial. Un e-mail en anglais et sans forme, venu d'un service que la personne découvre, ressemble à du hameçonnage ; une relance sans cadre fait brouillon chez le client qui la reçoit. Trois choix y répondent.

**Un cadre sans ressource distante, écrit une seule fois.** `site-src/shared/courriel.ts` dessine le document : des tableaux et des styles en ligne (ce que Gmail et Outlook affichent, celui de bureau compris, qui rend par le moteur de Word), la pile de polices du système, les couleurs du site, un mode sombre pour les messageries qui l'appliquent, le lien écrit en clair sous le bouton. Il ne charge rien : ni image, ni police, ni feuille de style. Rien ne se télécharge à l'ouverture, donc rien qui ressemble à un pixel de suivi, et rien ne manque quand la messagerie bloque les images. Le même module sert les cinq e-mails du compte et la relance, et formate les montants et les dates (`Intl`, `fr-FR` ou `en-GB`) pour l'encadré de la relance comme pour le texte que le Studio prépare : ils disent exactement la même chose. La relance s'ouvre sur le nom de l'entreprise, non sur « facturx » : le client voit qui le relance, pas l'outil. L'encadré (numéro, reste dû, échéance) est lu côté serveur, dans la facture, et non dans la demande ; le pied dit « Envoyé par *Entreprise* avec facturx. Pour lui écrire, répondez à cet e-mail. » Le texte reste celui que l'utilisateur a relu. Le dialogue ne montre pas d'aperçu : une ligne, sous le message, dit ce que le serveur ajoute. Ce que la base consigne d'une relance (destinataire, objet, texte) ne change pas.

**La langue vit dans le compte.** Supabase compose l'e-mail sur le serveur, à partir des données du compte : il ne sait pas dans quelle langue la personne a ouvert le Studio. Le Studio écrit donc `langue` (`fr` ou `en`, la sienne) dans les métadonnées du compte (`user_metadata`) : à l'inscription, au changement d'adresse (dans le même appel) et à l'ouverture avec une session active, si elle diffère de celle du compte ; un échec de cette dernière écriture est ignoré, l'interface n'attend pas. Supabase n'admet qu'un modèle par type d'e-mail : chaque modèle porte les deux langues, commence par `{{ $en := eq (printf "%v" .Data.langue) "en" }}`, donne l'anglais sous `{{ if $en }}` et le français sinon. Le français est la langue par défaut, celle d'un compte créé avant ce chantier. `printf "%v"` rend la comparaison sûre quelle que soit la valeur (absente, d'un autre type, mise par l'utilisateur) : une erreur dans un modèle Go, et Supabase n'envoie rien, l'inscription ne se confirme plus. Pour la même raison, les modèles n'affichent que `.ConfirmationURL`, `.Email`, `.NewEmail` et `.Token`, jamais `.Data`, que l'utilisateur modifie lui-même ; aucun ne dit combien de temps vaut son lien ou son code, durée qui est un réglage du projet et peut changer sans toucher au texte. L'objet de chaque e-mail est choisi de la même façon, par la langue. La relance prend la langue du texte que le Studio a préparé (il l'envoie avec la demande), à défaut celle de la facture, puis le français.

**Les modèles par l'API de gestion, ni à la main, ni par `config push`.** Les cinq modèles sont des fichiers du dépôt, `supabase/templates/` : du HTML versionné, généré par `pnpm emails:construire` à partir de `site-src/courriels/compte.ts`, qui se relit dans une PR et dont un test vérifie qu'il est à jour. `config.toml` les donne à la pile locale, qui les montre dans Mailpit. En production, l'étape « Modèles d'e-mails » de `compte-deploy.yml` (`pnpm emails:deployer`) envoie les objets et les modèles par `PATCH https://api.supabase.com/v1/projects/<ref>/config/auth`, avec pour seules clés les dix `mailer_subjects_<modèle>` et `mailer_templates_<modèle>_content`, puis relit la configuration (`GET`) et la compare clé par clé ; elle échoue si elles diffèrent. La réponse de l'API est la configuration d'authentification entière, mot de passe SMTP compris, et le journal d'une Action est public comme le dépôt : le script n'affiche jamais un corps de réponse, seulement les codes HTTP et, au besoin, les noms des clés qui diffèrent. Un modèle modifié dans le tableau de bord est écrasé au déploiement suivant ; le guide le dit (`docs/compte.md`, 1.4, 5).

**Ce qui est écarté.**
- *Un logo en image.* Une image distante est bloquée par défaut dans bien des messageries et laisse un trou, et son chargement dit à son serveur que l'e-mail a été ouvert, ce qui est le mécanisme d'un pixel de suivi. Les e-mails du compte ont en tête le mot « facturx », en texte.
- *Les modèles hébergés chez Brevo.* Ils vivraient hors du dépôt, loin de la revue et du test, et n'atteindraient pas les e-mails de Supabase Auth, qui partent par SMTP avec leur contenu déjà composé.
- *`supabase config push`.* Il écrirait dans le projet hébergé tout `config.toml`, soit les réglages de la pile locale (adresses en `localhost`, Mailpit, deux e-mails par heure) par-dessus la production. Le guide l'interdisait déjà (1.4) ; l'API de gestion permet de n'envoyer que dix clés.
- *Un modèle par langue.* Supabase n'en admet qu'un par type d'e-mail.
- *Le suivi des clics et des ouvertures de Brevo.* Il réécrirait le lien de confirmation, qu'un service de suivi peut consommer avant la personne, et ajouterait un pixel à des e-mails qui n'en portent pas. Le guide demande de le désactiver (1.3, 8), et l'étape 1.10 vérifie que le lien du bouton commence par l'adresse de Supabase.

**Hors de ce chantier.** Le modèle d'invitation (facturx n'invite personne), les notifications de sécurité de Supabase (mot de passe ou adresse modifiés : elles ne sont pas activées, et les activer serait une autre décision) et le contenu des trois niveaux de relance.

**L'objet suit la langue : la CI l'a vérifié.** Que Supabase évalue `.Data.langue` dans l'**objet** de l'e-mail, et pas seulement dans son corps, restait à prouver. Le test `site-src/studio/compte/courriels-pile.test.ts` envoie les cinq e-mails du compte à la pile locale du job `compte` de la CI (CLI Supabase 3.0.0) et les lit dans Mailpit. Il est passé le 9 novembre 2026, ses neuf cas compris (PR 18, run 42613110617). Supabase accepte les cinq modèles. L'e-mail de confirmation arrive en anglais, objet compris, quand `langue` vaut `en`, et en français sinon : `fr`, absente, ou d'un autre type qu'une chaîne. Les quatre autres arrivent chacun dans la langue demandée : mot de passe oublié en anglais, changement d'adresse en anglais aux deux adresses, lien de connexion et code de vérification en français. `cgu` reste dans les métadonnées après une écriture de `data`. Le repli prévu, un objet bilingue (« Confirmez votre adresse e-mail · Confirm your email address »), n'est donc pas appliqué. Les tests de `relancer` sont passés au même run : l'encadré, la langue demandée, celle de la facture, le refus d'une langue invalide. Reste à voir en production, à l'étape 1.10 du guide : le rendu dans Gmail (web et mobile, clair et sombre), l'e-mail anglais d'une inscription depuis `/en/studio/`, le lien du bouton non réécrit par Brevo, et la relance reçue avec son encadré, son pied et son PDF.

**La politique de confidentialité est reprise sans changer de version.** Elle ajoute la langue de l'interface aux données du compte (finalité : écrire les e-mails du compte dans la langue de la personne), et le numéro, le reste dû et l'échéance de la facture à ce que Brevo reçoit pour une relance. La version reste `2026-11`, comme en D75 : au 9 novembre 2026, aucun utilisateur hors l'éditeur n'a accepté ces textes. La base d'authentification de production comptait deux comptes : l'essai de l'éditeur, créé ce jour-là, et un compte du 7 octobre 2026 qui n'a jamais accepté de CGU de facturx (ni `cgu` dans ses métadonnées, ni entreprise). Une autre application gardait ce dernier connecté. Il a été supprimé le 9 novembre, avec son identité, ses sessions et ses jetons. Il ne reste que l'essai de l'éditeur.

## 2026-11-09 — Session 30 : les comptes ouverts sans sauvegarde

### D77. Les comptes restent ouverts sans sauvegarde, en attendant
D75 faisait de l'archive chiffrée de chaque nuit chez Scaleway la seule sauvegarde des comptes, et le guide demandait de la mettre en service, restauration d'essai comprise, avant de les ouvrir (`docs/compte.md`, 1.12 et 1.13). Or le site propose les comptes depuis l'étape 1.9 : quiconque y arrive peut en créer un. Le 9 novembre 2026, l'éditeur a choisi de ne rien ajouter au projet pour l'instant, ni prestataire ni coût (ni Scaleway, ni le plan Pro de Supabase), et de laisser les comptes ouverts : recueillir de premiers utilisateurs, puis faire évoluer la plateforme selon leur intérêt. La sauvegarde est reportée, pas abandonnée : elle se met en place quand l'avancée du projet l'exige.

**Ce que cela veut dire.** Les données des comptes ne sont que chez Supabase, au plan Free, qui n'en garde aucune copie. Une perte du projet (incident, erreur de manipulation, compte Supabase perdu) perdrait les factures émises, leurs PDF, les paiements et les relances. Ce qui en protège l'utilisateur, c'est l'export : « Exporter mes données » remet une archive zip, avec un fichier JSON portable et tous les PDF, et les CGU lui demandent déjà de le faire régulièrement, la conservation légale de ses factures lui incombant.

**Les textes disent ce qui est.** La politique de confidentialité, l'accord de sous-traitance et les CGU, en français et en anglais, ne promettent plus de copie chaque nuit : Scaleway sort des prestataires et des sous-traitants ultérieurs, la ligne « Sauvegardes » de la politique dit qu'il n'y en a aucune à ce jour et renvoie à l'export, et les CGU le disent à côté de l'absence d'engagement de disponibilité. La version reste `2026-11`, comme en D75 et D76 : au 9 novembre 2026, la production comptait deux comptes, tous deux des essais de l'éditeur. Les textes d'avant ce changement sont ceux du commit `830dfef`.

**Ce qui reste prêt.** `scripts/sauvegarde.sh`, `scripts/restaurer.sh` et `sauvegarde.yml`, qui ne fait rien tant que la variable `SAUVEGARDE_ACTIVE` n'est pas posée ; la procédure (`docs/compte.md`, 1.12, sections 3 et 4) ; la paire de clés age, créée sur la machine de l'éditeur. La documentation de Scaleway, relue le 9 novembre 2026, admet ce que 1.12 prévoyait : le verrouillage d'objets en mode *compliance* (activable désormais sur un bucket existant), une rétention par défaut, l'expiration des versions non courantes et des marqueurs orphelins. Elle ne dit pas si un dépôt sous rétention exige un `Content-MD5`, que le client S3 de `sauvegarde.sh` n'envoie pas : 1.12 demande de l'essayer avant le premier dépôt. Le stockage coûte environ 0,016 € par Go et par mois (Standard Multi-AZ, Paris) : quelques centimes par an au volume d'aujourd'hui, mais une carte de paiement chez un prestataire de plus.

**La reprendre, c'est aussi reprendre les textes.** Scaleway redevient un sous-traitant ultérieur : l'accord de sous-traitance prévoit que tout ajout soit publié sous un nouveau numéro de version, ce qui change `CGU_VERSION` (`site-src/studio/compte/index.ts`) et se publie avant le premier dépôt. Le passage au plan Pro de Supabase, qui rendrait 7 sauvegardes quotidiennes chez Supabase, en serait une autre voie (D75).

### D78. L'accord de sous-traitance confronté à l'article 28, et le registre des traitements
Le 9 novembre 2026, l'éditeur a demandé si la relecture des textes par un juriste (`docs/compte.md`, 1.13) était nécessaire. Aucune loi ne l'impose ; elle reste prévue, mais plus tard (avant un service payant, beaucoup de comptes, une société créée ou une première réclamation). En attendant, l'accord de sous-traitance a été confronté, clause par clause, à l'article 28 du RGPD et au modèle de clauses de la CNIL (`cnil.fr/fr/sous-traitance-exemple-de-clauses`). Ce n'est pas l'avis d'un juriste ; cela repère ce qui manquait.

**Ce qui était en place** : objet, nature, durée, données et personnes concernées (28.3) ; instructions documentées (28.3.a) ; confidentialité (b) ; mesures de sécurité (c) ; aide pour les droits des personnes (e), les violations et les analyses d'impact (f) ; restitution et effacement (g) ; preuves et audits (h) ; obligations de l'utilisateur ; accord écrit, accepté à l'inscription avec sa version (28.9).

**Ce qui est ajouté, en français et en anglais :**
- *Les changements de sous-traitants s'annoncent* (28.2) : par e-mail, à l'adresse de chaque compte, au moins 30 jours avant de prendre effet, avec le droit de s'y opposer. Les publier sur la page ne suffisait pas : le Studio n'enregistre la version des CGU qu'à l'inscription, et rien ne prévient d'une nouvelle. À l'échelle d'aujourd'hui, l'e-mail part à la main.
- *La responsabilité pour les sous-traitants ultérieurs* (28.4) : facturx reste responsable envers l'utilisateur de leurs manquements. La loi le dit de toute façon ; l'accord le dit aussi.
- *Les transferts hors de l'UE* (28.3.a, chapitre V). L'accord de traitement des données de Supabase, lu le 9 novembre 2026, fait de **Supabase Pte. Ltd.** (Singapour) le sous-traitant, et de Supabase Inc. (États-Unis) le support et l'exploitation ; les données, hébergées à Francfort, peuvent être lues depuis ces deux pays quand ces tâches l'exigent, sous les clauses contractuelles types de la décision 2021/914 que cet accord reprend, et dont il fait valoir l'acceptation des conditions de Supabase comme signature. La politique de confidentialité et l'accord nommaient « Supabase Inc., société américaine » : ils nomment désormais les deux sociétés et ces transferts. L'accord dit aussi que facturx ne transfère rien hors de l'UE de sa propre initiative, et qu'il préviendrait avant un traitement imposé par le droit.
- *Un délai pour les violations* : l'utilisateur est prévenu par e-mail au plus tard 48 heures après que facturx en a connaissance, avec la nature de la violation, les données et personnes touchées, les conséquences probables et les mesures prises (le modèle de la CNIL fixe un délai en heures ; l'utilisateur a lui-même 72 heures pour notifier).
- *« Immédiatement »* : une instruction qui paraît contraire au RGPD est signalée sans attendre (28.3, dernier alinéa).

**Hors de l'accord.** Le registre des traitements (article 30), que facturx doit tenir comme responsable et comme sous-traitant, est écrit : `docs/registre.md`. Il note ce qui reste à vérifier : une copie datée de l'accord de Supabase et l'abonnement à ses annonces de sous-traitants, et l'accord de Brevo, que cette relecture n'a pas pu lire. Reste aussi la sauvegarde : l'article 32 demande de pouvoir rétablir les données après un incident, ce que D77 reporte. C'est la question à poser en premier à un juriste.

**La version reste `2026-11`**, comme en D75, D76 et D77 : au 9 novembre 2026, seuls des comptes d'essai de l'éditeur l'ont acceptée. Désormais, la reprise de la sauvegarde (Scaleway, nouveau sous-traitant ultérieur) demande d'annoncer la nouvelle version 30 jours avant le premier dépôt.
