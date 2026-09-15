# facturx-sdk

[![npm](https://img.shields.io/npm/v/facturx-sdk)](https://www.npmjs.com/package/facturx-sdk) [![site](https://img.shields.io/badge/site-facturx.ibird.dev-b0413e)](https://facturx.ibird.dev/) [![CI](https://github.com/Geekles007/facturx/actions/workflows/ci.yml/badge.svg)](https://github.com/Geekles007/facturx/actions/workflows/ci.yml) ![licence MIT](https://img.shields.io/npm/l/facturx-sdk)

SDK **TypeScript pur** — zéro dépendance native, compatible edge/serverless — pour **générer, embarquer et extraire** des factures **Factur-X** au profil **EN 16931**, avec les règles françaises intégrées.

> État : **1.2.0** — boucle complète (modèle typé, validation, XML CII validé XSD, lecture XML → `Invoice`, PDF/A-3 validé veraPDF), **statuts du cycle de vie** (validation par les règles de gestion officielles, message CDV validé contre le XSD CDAR D22B), guide réforme, exemples exécutables, et les **règles françaises de la norme AFNOR XP Z12-012** (toutes les règles `BR-FR` vérifiables hors ligne), **contre-vérifiées par les schematrons officiels CEN, Factur-X et BR-FR V1.3.0 en CI**. **Publié sur npm : `facturx-sdk`.**

## Vision

Une facture électronique française conforme ne devrait pas exiger une dépendance Java, un service SaaS ou une lecture de 300 pages de norme. `facturx-sdk` expose :

- un type `Invoice` **annoté champ par champ** avec le Business Term EN 16931 (`BT-xx`) et, quand elle s'applique, la règle française (Code de commerce, CGI) ;
- une **arithmétique monétaire exacte** (entiers en centimes, `bigint` en intermédiaire, un seul arrondi commercial) ;
- une **validation qui n'arrange jamais rien** : les totaux fournis sont vérifiés et chaque écart remonte avec son code de règle, le chemin du champ, l'attendu et le reçu ;
- une **génération XML CII** par templating typé (ordre XSD garanti par construction, échappement manuel testé, sortie compacte déterministe) ;
- une **lecture XML → `Invoice`** (`fromCiiXml`) tolérante aux profils et aux préfixes, sécurisée (pas de DTD), qui valide par défaut et localise chaque erreur par un chemin CII ;
- un **embarquement PDF/A-3** (`embedFacturX`) qui écrit pièce jointe, `/AF`, XMP `pdfaid` + schéma `fx`, `Info` aligné et `/ID`, de façon idempotente et reproductible, et une **extraction** (`extractFacturX`) tolérante aux noms ZUGFeRD ;
- une seule dépendance runtime, `pdf-lib`, chargée uniquement par l'entrée `./pdf` (l'entrée principale reste sans dépendance).

## Réforme 2026-2027 : où ce SDK se place

Réception obligatoire pour **toutes** les entreprises au 1er septembre 2026, émission en 2026 (grandes entreprises/ETI) puis 2027 (PME/micro), transit par une **plateforme agréée**. Le SDK est la brique **format + conformité** : produire, vérifier et lire du Factur-X, et depuis la 1.1.0 **valider et sérialiser les statuts du cycle de vie**. La plateforme agréée garde la brique **transport** — déposer les factures et les statuts, l'e-reporting, l'annuaire — hors périmètre. Guide complet, checklist et écarts connus : [docs/reforme.md](docs/reforme.md).

## Validateur en ligne

**[facturx.ibird.dev/validateur](https://facturx.ibird.dev/validateur/)** — déposez un PDF Factur-X ou un XML CII : le SDK le relit en objet typé, puis les trois schematrons officiels (EN 16931 CEN, Factur-X, BR-FR de la norme XP Z12-012) rendent leur verdict, avec le code de règle et l'emplacement exact de chaque anomalie.

Tout s'exécute **dans le navigateur** : aucun fichier n'est transmis. Les jeux de règles sont ceux de la CI de ce dépôt. Le contrôle PDF/A-3 par veraPDF n'y figure pas — il exige Java, donc un serveur ; il reste exécuté ici à chaque commit.

## Exemples exécutables

| Exemple | Ce qu'il montre |
|---|---|
| [examples/emit-node](examples/emit-node) | modèle applicatif JSON (montants en chaînes) → `Invoice` → validation → PDF Factur-X sur disque |
| [examples/receive-node](examples/receive-node) | dossier de PDF reçus → tableau (ok / invalide / sans Factur-X) + `received.json`, anomalies localisées |
| [examples/http-handler](examples/http-handler) | `(Request) => Response` Web standard, `POST /emit` et `POST /receive`, copiable dans Next.js, Hono, Workers, Deno |
| [examples/deposit-node](examples/deposit-node) | deux factures d'acompte (386) puis la facture définitive (cadre `S4`) liée par `withDeposits` : références, acomptes déduits, erreur si l'on oublie |

```bash
pnpm install && pnpm build
pnpm --filter example-emit-node start
pnpm --filter example-receive-node start -- --demo
pnpm --filter example-http-handler start
pnpm --filter example-deposit-node start
```

## Stabilité et versions

À partir de **1.0.0**, le paquet suit SemVer : une rupture d'API n'arrive que dans une version majeure.

- **Stable** : le modèle `Invoice` et ses sous-types, les helpers monétaires, `validateInvoice` / `assertValidInvoice` et les **codes et chemins** d'anomalie, `computeTotals`, `withDeposits`, `toCiiXml` / `fromCiiXml` / `parseCiiDocument` / `readCiiGuideline`, `embedFacturX` / `extractFacturX` / `extractInvoice`, `DEFAULT_LIMITS` et l'option `{ limits }`.
- **Stable mais bas niveau** (exposé pour étendre le SDK, à utiliser en connaissance de cause) : `parseXml`, `el` / `elA` / `serializeXml`, `toCiiTree`, `buildXmp`, `loadPdf`, base64.
- **Non contractuel** : le texte des messages d'anomalie (les codes et chemins le sont), les libellés générés des notes légales (leur présence et leur code le sont).
- Une règle ajoutée peut refuser une facture acceptée avant : c'est une version **mineure**, annoncée dans le CHANGELOG — la conformité prime sur la compatibilité.

## Sécurité

Les entrées (XML, PDF) sont traitées comme non fiables : pas de DTD ni d'entité externe, profondeur et tailles bornées (`DEFAULT_LIMITS`, surchargeables par `{ limits }`), erreurs typées `TOO_LARGE`, aucune exécution de contenu. Détails et signalement : [SECURITY.md](SECURITY.md).

## Périmètre v1

**Inclus** : profil EN 16931 (`urn:cen.eu:en16931:2017`), facture commerciale (380), TVA multi-taux, remises/frais ligne et document, exonérations (E, AE, K, G, O, Z), mentions FR (SIREN/SIRET/TVA, date ou période de livraison, pénalités de retard, indemnité forfaitaire de 40 €, escompte), moyens de paiement virement/prélèvement.

**Inclus aussi** : avoirs (381, 261, 262, 396), acomptes (386), rectificatives (384), documents auto-facturés (389) et affacturés (393), nature de l'opération (`operationCategory` → BT-23), option TVA sur les débits (`vatOnDebits` → BT-8), SIREN acheteur exigé avec drapeau `buyer.consumer` pour le B2C.

**Statuts du cycle de vie** (depuis la 1.1.0) : les quatre statuts transmissibles au portail public (200 Déposée, 210 Refusée, 212 Encaissée, 213 Rejetée — l'annexe 2 des spécifications externes n'en connaît pas d'autres pour une facture), les 40 motifs de refus normalisés, les règles de gestion vérifiées une à une (`validateLifecycleStatus`), et la sérialisation du message CDV (`toCdvXml`) validée contre le XSD **CDAR D22B** d'UN/CEFACT. Un message CDV est émis par une plateforme : cette partie s'adresse à qui en construit une.

**Hors périmètre** : Order-X, UBL, autofacturation, rendu PDF de la facture, conversion d'un PDF quelconque en PDF/A, envoi à une plateforme agréée, e-reporting, autres profils Factur-X (MINIMUM, BASIC, EXTENDED).

## Installation

```bash
pnpm add facturx-sdk
```

## Usage

```ts
import {
  assertValidInvoice,
  cents,
  computeTotals,
  type InvoiceDraft,
  percent,
  quantity,
  unitPrice,
  validateInvoice,
} from 'facturx-sdk';

const draft: InvoiceDraft = {
  id: 'F-2026-0001',
  issueDate: '2026-09-11',
  typeCode: '380',
  currency: 'EUR',
  operationCategory: 'services',                        // biens / services / mixte (réforme)
  seller: { name: 'Atelier Exemple SAS', siren: '443061841', vatId: 'FR64443061841',
            address: { line1: '12 rue de la Facture', postCode: '75011', city: 'Paris', countryCode: 'FR' } },
  buyer:  { name: 'Client Démo SARL', siren: '732829320', electronicAddress: { value: '732829320', scheme: '0225' },
            address: { postCode: '69002', city: 'Lyon', countryCode: 'FR' } },
  delivery: { date: '2026-09-10' },
  lines: [{
    id: '1', name: 'Prestation de conseil',
    quantity: quantity(20000), unitCode: 'DAY',          // 2,0000 jours
    unitPrice: unitPrice(1000000),                        // 100,0000 €
    netAmount: cents(20000),                              // 200,00 € — fourni ET vérifié
    tax: { category: 'S', rate: percent('20') },
  }],
  paymentTerms: {
    dueDate: '2026-10-11',
    latePenaltyRate: percent('10'),
    recoveryIndemnity: cents(4000),
    earlyPaymentDiscount: 'none',
  },
  paymentMeans: [{ typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189' } }],
};

// Totaux et ventilation TVA calculés EXPLICITEMENT (jamais en silence)
const invoice = { ...draft, ...computeTotals(draft) };

const result = validateInvoice(invoice);
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`[${issue.code}] ${issue.path}: ${issue.message}`);
    // ex. [BR-CO-15] totals.taxInclusiveAmount: Total TTC (BT-112) ≠ BT-109 + BT-110 : attendu 240.00.
  }
}

assertValidInvoice(invoice); // lève FacturXValidationError { issues } sinon
```

### XML CII

```ts
import { toCiiXml } from 'facturx-sdk';

const xml = toCiiXml(invoice);                  // compact, validé avant génération
const debug = toCiiXml(invoice, { pretty: true, businessProcessId: 'A1' });
// { validate: false } pour générer malgré des anomalies (debug uniquement)
```

Le XML produit est conforme au XSD Factur-X EN 16931 (`urn:cen.eu:en16931:2017`, CII D16B) et passe **sans assertion en échec les schematrons officiels** CEN EN 16931, profil Factur-X et règles françaises BR-FR Flux 2 V1.3.0. Le lecteur est éprouvé sur **30 fichiers tiers** (corpus ZUGFeRD / KoSIT, Factur-X FR) : lus, ré-émis conformes, sans perte d'élément signifiant. Pour rejouer ces validations en local : `pnpm schemas:fetch && pnpm samples:fetch` (fichiers git-ignorés, voir `packages/facturx/test/schemas/README.md`).

### PDF/A-3 : embarquer et extraire

```ts
import { embedFacturX, extractFacturX } from 'facturx-sdk/pdf';

// pdfBytes : un PDF déjà conforme PDF/A (polices embarquées, non chiffré), Uint8Array | ArrayBuffer
const facturx = await embedFacturX(pdfBytes, { invoice }, {
  date: new Date('2026-09-11T10:00:00Z'),          // optionnel : sortie reproductible
  title: 'Facture F-2026-0001',                      // optionnel : Info/Title + dc:title
  outputIntent: { iccProfile: srgbIccBytes },        // optionnel : OutputIntent sRGB si absent
});

const found = await extractFacturX(facturx);
// { xml, bytes, filename: 'factur-x.xml', conformanceLevel: 'EN 16931', documentType: 'INVOICE' } | undefined
```

### Lire une facture reçue

```ts
import { fromCiiXml, parseCiiDocument } from 'facturx-sdk';
import { extractInvoice } from 'facturx-sdk/pdf';

const invoice = fromCiiXml(xmlString);                 // validée EN 16931 + FR, sinon FacturXValidationError
const { invoice: raw, guidelineId } = parseCiiDocument(xmlString); // tout profil, sans validation
const received = await extractInvoice(pdfBytes);       // PDF → { invoice, xml, filename, conformanceLevel } | undefined
```

Les mentions de paiement françaises (pénalités, indemnité de 40 €, escompte) sont écrites dans les **notes BG-1 codées `PMD` / `PMT` / `AAB`** exigées par la norme AFNOR (BR-FR-05), générées depuis les champs structurés de `paymentTerms` ; le texte BT-20 reste le libellé complet. Les erreurs de lecture sont typées et localisées : `FacturXParseError { code: 'MALFORMED' | 'NOT_CII' | 'MISSING' | 'FORMAT' | 'UNSUPPORTED', path }`, ex. `…/ram:IncludedSupplyChainTradeLineItem[2]/…/ram:LineTotalAmount`. Aucun `DOCTYPE` n'est accepté (pas de XXE). Une facture lue porte ses conditions de paiement en texte (`paymentTerms.text`) ; une facture rédigée avec le SDK peut utiliser les champs structurés FR, qui génèrent ce texte.

La couche ajoutée par `embedFacturX` est **validée PDF/A-3b par veraPDF** en CI (zéro règle violée sur un PDF d'entrée sans police ; voir `test/pdfa.test.ts`). `embedFacturX` accepte `{ invoice }` (XML généré et validé) ou `{ xml }` (chaîne ou octets). Il **ne convertit pas** un PDF quelconque en PDF/A : il ajoute la pièce jointe `factur-x.xml` (`/AFRelationship /Alternative`), le tableau `/AF`, les métadonnées XMP (`pdfaid:part 3`, `pdfaid:conformance B`, schéma d'extension `fx`), aligne le dictionnaire `Info` et fixe l'identifiant `/ID`. Une pièce Factur-X déjà présente est remplacée, les autres pièces jointes sont conservées. Les erreurs sont typées : `FacturXPdfError { code: 'INVALID_PDF' | 'ENCRYPTED' | 'INVALID_XML' | 'UNSUPPORTED' }`.

### Monnaie

Aucun flottant : `cents(1234)` = 12,34 €, `quantity(15000)` = 1,5, `unitPrice(105000)` = 10,50 €, `percent('5.5')` = 550 points de base. Parsing/formatage exacts : `centsFromDecimal('12.34')`, `centsToString(c)`.

### Codes d'anomalie

`BR-*` / `BR-CO-*` / `BR-S-*`… = règles EN 16931 (numérotation officielle) · `BR-FR-*` = règles françaises de la norme AFNOR XP Z12-012 · `FR-*` = autres règles françaises (Code de commerce, CGI) · `FORMAT-*` = formats (dates, IBAN, TVA…) · `CALC-*` = cohérences arithmétiques non normées. Voir [`docs/decisions.md`](docs/decisions.md).

## Développement

```bash
pnpm install
pnpm check       # lint + typecheck + test + build + site (types, tests, bundle) + exemples
```

Monorepo pnpm : `packages/facturx` (le SDK), `examples/*` (exemples exécutés en CI), `site/` + `site-src/` (la page et le validateur en ligne ; construction, déploiement Coolify ou rsync et vérifications dans [site/README.md](site/README.md)). Publication : tag `vX.Y.Z` → workflow de release (trusted publishing npm), voir [docs/release.md](docs/release.md). Outils : TypeScript strict, tsup (ESM + CJS + d.ts), vitest, Biome, GitHub Actions (Node 22/24).

## Licence

MIT
