# @geekles/facturx

SDK **TypeScript pur** — zéro dépendance native, compatible edge/serverless — pour **générer, embarquer et extraire** des factures **Factur-X** au profil **EN 16931**, avec les règles françaises intégrées.

> État : **session 1 / squelette** — modèle de données typé, monnaie entière, validation et calcul des totaux. Génération XML CII et embarquement PDF (pdf-lib) : sessions suivantes.

## Vision

Une facture électronique française conforme ne devrait pas exiger une dépendance Java, un service SaaS ou une lecture de 300 pages de norme. `@geekles/facturx` expose :

- un type `Invoice` **annoté champ par champ** avec le Business Term EN 16931 (`BT-xx`) et, quand elle s'applique, la règle française (Code de commerce, CGI) ;
- une **arithmétique monétaire exacte** (entiers en centimes, `bigint` en intermédiaire, un seul arrondi commercial) ;
- une **validation qui n'arrange jamais rien** : les totaux fournis sont vérifiés et chaque écart remonte avec son code de règle, le chemin du champ, l'attendu et le reçu ;
- à venir : `toXml()` (CII par templating typé, échappement testé), `embed()` / `extract()` (PDF/A-3 via pdf-lib, entrée séparée).

## Périmètre v1

**Inclus** : profil EN 16931 (`urn:cen.eu:en16931:2017`), facture commerciale (380), TVA multi-taux, remises/frais ligne et document, exonérations (E, AE, K, G, O, Z), mentions FR (SIREN/SIRET/TVA, date ou période de livraison, pénalités de retard, indemnité forfaitaire de 40 €, escompte), moyens de paiement virement/prélèvement.

**Hors périmètre** : avoirs (381), Order-X, UBL, rendu PDF de la facture, envoi à une plateforme (PA/PDP/PPF), autres profils Factur-X (MINIMUM, BASIC, EXTENDED).

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

### Monnaie

Aucun flottant : `cents(1234)` = 12,34 €, `quantity(15000)` = 1,5, `unitPrice(105000)` = 10,50 €, `percent('5.5')` = 550 points de base. Parsing/formatage exacts : `centsFromDecimal('12.34')`, `centsToString(c)`.

### Codes d'anomalie

`BR-*` / `BR-CO-*` / `BR-S-*`… = règles EN 16931 (numérotation officielle) · `FR-*` = règles françaises · `FORMAT-*` = formats (dates, IBAN, TVA…) · `CALC-*` = cohérences arithmétiques non normées. Voir [`docs/decisions.md`](docs/decisions.md).

## Développement

```bash
pnpm install
pnpm check       # lint + typecheck + test + build
```

Monorepo pnpm : `packages/facturx` (le SDK). Outils : TypeScript strict, tsup (ESM + CJS + d.ts), vitest, Biome, GitHub Actions (Node 22/24).

## Licence

MIT
