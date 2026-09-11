# facturx-sdk

SDK **TypeScript pur** pour **générer, valider, embarquer et lire** des factures **Factur-X** au profil **EN 16931**, avec les règles françaises de la réforme de la facturation électronique. Zéro dépendance native, compatible edge / serverless ; `pdf-lib` uniquement dans l'entrée `facturx/pdf`.

```bash
pnpm add facturx-sdk
```

## Émettre

```ts
import { assertValidInvoice, cents, computeTotals, percent, quantity, unitPrice, toCiiXml } from 'facturx-sdk';
import { embedFacturX } from 'facturx-sdk/pdf';

const draft = {
  id: 'F-2026-0001', issueDate: '2026-09-11', typeCode: '380', currency: 'EUR',
  operationCategory: 'services',
  seller: { name: 'Atelier Exemple SAS', siren: '443061841', vatId: 'FR64443061841',
            address: { line1: '12 rue de la Facture', postCode: '75011', city: 'Paris', countryCode: 'FR' } },
  buyer:  { name: 'Client Démo SARL', siren: '732829320', address: { postCode: '69002', city: 'Lyon', countryCode: 'FR' } },
  delivery: { date: '2026-09-10' },
  lines: [{ id: '1', name: 'Prestation de conseil', quantity: quantity(20000), unitCode: 'DAY',
            unitPrice: unitPrice(1000000), netAmount: cents(20000), tax: { category: 'S', rate: percent('20') } }],
  paymentTerms: { dueDate: '2026-10-11', latePenaltyRate: percent('10'), recoveryIndemnity: cents(4000), earlyPaymentDiscount: 'none' },
  paymentMeans: [{ typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189' } }],
} as const satisfies Parameters<typeof computeTotals>[0];

const invoice = { ...draft, ...computeTotals(draft) }; // totaux calculés explicitement, puis VÉRIFIÉS
assertValidInvoice(invoice);                           // FacturXValidationError { issues: [{ code, path, message }] }
const xml = toCiiXml(invoice);                         // CII EN 16931, conforme au XSD officiel
const pdfA3 = await embedFacturX(yourPdfBytes, { invoice }); // PDF/A-3 Factur-X (votre PDF doit déjà être PDF/A)
```

## Recevoir

```ts
import { fromCiiXml } from 'facturx-sdk';
import { extractInvoice } from 'facturx-sdk/pdf';

const received = await extractInvoice(pdfBytes); // { invoice, xml, filename, conformanceLevel } | undefined
const invoice = fromCiiXml(xmlString);           // validée ; FacturXParseError { code, path } si illisible
```

## Ce que fait le SDK, et ce qu'il ne fait pas

- ✅ Modèle `Invoice` annoté BT-xx + règles FR, monnaie en entiers (jamais de flottant), validation qui **ne corrige jamais en silence**, XML CII écriture/lecture, PDF/A-3 embed/extract, mentions de la réforme (SIREN acheteur, nature de l'opération, TVA sur les débits, avoirs).
- ❌ Envoi à une plateforme agréée, statuts, e-reporting, UBL, autres profils Factur-X, conversion d'un PDF quelconque en PDF/A.

Documentation complète, guide de la réforme, exemples exécutables et journal des décisions : **https://github.com/Geekles007/facturx**

## Licence

MIT
