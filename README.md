# @geekles/facturx

SDK **TypeScript pur** — zéro dépendance native, compatible edge/serverless — pour **générer, embarquer et extraire** des factures **Factur-X** au profil **EN 16931**, avec les règles françaises intégrées.

> État : **session 5 / adoption** — boucle complète (modèle typé, validation, XML CII validé XSD, lecture XML → `Invoice`, PDF/A-3), **guide réforme** et **trois exemples exécutables** (émission, réception, handler HTTP). Prochaines étapes : nature de l'opération & SIREN acheteur obligatoire, publication npm, veraPDF.

## Vision

Une facture électronique française conforme ne devrait pas exiger une dépendance Java, un service SaaS ou une lecture de 300 pages de norme. `@geekles/facturx` expose :

- un type `Invoice` **annoté champ par champ** avec le Business Term EN 16931 (`BT-xx`) et, quand elle s'applique, la règle française (Code de commerce, CGI) ;
- une **arithmétique monétaire exacte** (entiers en centimes, `bigint` en intermédiaire, un seul arrondi commercial) ;
- une **validation qui n'arrange jamais rien** : les totaux fournis sont vérifiés et chaque écart remonte avec son code de règle, le chemin du champ, l'attendu et le reçu ;
- une **génération XML CII** par templating typé (ordre XSD garanti par construction, échappement manuel testé, sortie compacte déterministe) ;
- une **lecture XML → `Invoice`** (`fromCiiXml`) tolérante aux profils et aux préfixes, sécurisée (pas de DTD), qui valide par défaut et localise chaque erreur par un chemin CII ;
- un **embarquement PDF/A-3** (`embedFacturX`) qui écrit pièce jointe, `/AF`, XMP `pdfaid` + schéma `fx`, `Info` aligné et `/ID`, de façon idempotente et reproductible, et une **extraction** (`extractFacturX`) tolérante aux noms ZUGFeRD ;
- une seule dépendance runtime, `pdf-lib`, chargée uniquement par l'entrée `./pdf` (l'entrée principale reste sans dépendance).

## Réforme 2026-2027 : où ce SDK se place

Réception obligatoire pour **toutes** les entreprises au 1er septembre 2026, émission en 2026 (grandes entreprises/ETI) puis 2027 (PME/micro), transit par une **plateforme agréée**. Le SDK est la brique **format + conformité** (produire, vérifier, lire du Factur-X) ; la plateforme agréée est la brique **transport** (envoi, statuts, e-reporting), hors périmètre. Guide complet, checklist et écarts connus : [docs/reforme.md](docs/reforme.md).

## Exemples exécutables

| Exemple | Ce qu'il montre |
|---|---|
| [examples/emit-node](examples/emit-node) | modèle applicatif JSON (montants en chaînes) → `Invoice` → validation → PDF Factur-X sur disque |
| [examples/receive-node](examples/receive-node) | dossier de PDF reçus → tableau (ok / invalide / sans Factur-X) + `received.json`, anomalies localisées |
| [examples/http-handler](examples/http-handler) | `(Request) => Response` Web standard, `POST /emit` et `POST /receive`, copiable dans Next.js, Hono, Workers, Deno |

```bash
pnpm install && pnpm build
pnpm --filter example-emit-node start
pnpm --filter example-receive-node start -- --demo
pnpm --filter example-http-handler start
```

## Périmètre v1

**Inclus** : profil EN 16931 (`urn:cen.eu:en16931:2017`), facture commerciale (380), TVA multi-taux, remises/frais ligne et document, exonérations (E, AE, K, G, O, Z), mentions FR (SIREN/SIRET/TVA, date ou période de livraison, pénalités de retard, indemnité forfaitaire de 40 €, escompte), moyens de paiement virement/prélèvement.

**Hors périmètre** : avoirs (381), Order-X, UBL, rendu PDF de la facture, conversion d'un PDF quelconque en PDF/A, envoi à une plateforme (PA/PDP/PPF), autres profils Factur-X (MINIMUM, BASIC, EXTENDED).

## Installation

```bash
pnpm add @geekles/facturx
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
} from '@geekles/facturx';

const draft: InvoiceDraft = {
  id: 'F-2026-0001',
  issueDate: '2026-09-11',
  typeCode: '380',
  currency: 'EUR',
  seller: { name: 'Atelier Exemple SAS', siren: '443061841', vatId: 'FR64443061841',
            address: { line1: '12 rue de la Facture', postCode: '75011', city: 'Paris', countryCode: 'FR' } },
  buyer:  { name: 'Client Démo SARL', siren: '732829320',
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
import { toCiiXml } from '@geekles/facturx';

const xml = toCiiXml(invoice);                  // compact, validé avant génération
const debug = toCiiXml(invoice, { pretty: true, businessProcessId: 'A1' });
// { validate: false } pour générer malgré des anomalies (debug uniquement)
```

Le XML produit est conforme au XSD Factur-X EN 16931 (`urn:cen.eu:en16931:2017`, CII D16B). Pour rejouer la validation XSD en local, déposer les XSD dans `packages/facturx/test/schemas/` (voir son README) : le test `xsd.test.ts` les utilise via `xmllint`.

### PDF/A-3 : embarquer et extraire

```ts
import { embedFacturX, extractFacturX } from '@geekles/facturx/pdf';

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
import { fromCiiXml, parseCiiDocument } from '@geekles/facturx';
import { extractInvoice } from '@geekles/facturx/pdf';

const invoice = fromCiiXml(xmlString);                 // validée EN 16931 + FR, sinon FacturXValidationError
const { invoice: raw, guidelineId } = parseCiiDocument(xmlString); // tout profil, sans validation
const received = await extractInvoice(pdfBytes);       // PDF → { invoice, xml, filename, conformanceLevel } | undefined
```

Les erreurs de lecture sont typées et localisées : `FacturXParseError { code: 'MALFORMED' | 'NOT_CII' | 'MISSING' | 'FORMAT' | 'UNSUPPORTED', path }`, ex. `…/ram:IncludedSupplyChainTradeLineItem[2]/…/ram:LineTotalAmount`. Aucun `DOCTYPE` n'est accepté (pas de XXE). Une facture lue porte ses conditions de paiement en texte (`paymentTerms.text`) ; une facture rédigée avec le SDK peut utiliser les champs structurés FR, qui génèrent ce texte.

`embedFacturX` accepte `{ invoice }` (XML généré et validé) ou `{ xml }` (chaîne ou octets). Il **ne convertit pas** un PDF quelconque en PDF/A : il ajoute la pièce jointe `factur-x.xml` (`/AFRelationship /Alternative`), le tableau `/AF`, les métadonnées XMP (`pdfaid:part 3`, `pdfaid:conformance B`, schéma d'extension `fx`), aligne le dictionnaire `Info` et fixe l'identifiant `/ID`. Une pièce Factur-X déjà présente est remplacée, les autres pièces jointes sont conservées. Les erreurs sont typées : `FacturXPdfError { code: 'INVALID_PDF' | 'ENCRYPTED' | 'INVALID_XML' | 'UNSUPPORTED' }`.

### Monnaie

Aucun flottant : `cents(1234)` = 12,34 €, `quantity(15000)` = 1,5, `unitPrice(105000)` = 10,50 €, `percent('5.5')` = 550 points de base. Parsing/formatage exacts : `centsFromDecimal('12.34')`, `centsToString(c)`.

### Codes d'anomalie

`BR-*` / `BR-CO-*` / `BR-S-*`… = règles EN 16931 (numérotation officielle) · `FR-*` = règles françaises · `FORMAT-*` = formats (dates, IBAN, TVA…) · `CALC-*` = cohérences arithmétiques non normées. Voir [`docs/decisions.md`](docs/decisions.md).

## Développement

```bash
pnpm install
pnpm check       # lint + typecheck + test + build + exemples (typecheck + exécution)
```

Monorepo pnpm : `packages/facturx` (le SDK), `examples/*` (exemples exécutés en CI). Outils : TypeScript strict, tsup (ESM + CJS + d.ts), vitest, Biome, GitHub Actions (Node 22/24).

## Licence

MIT
