# Décisions d'architecture — `@geekles/facturx`

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
