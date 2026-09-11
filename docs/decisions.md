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
