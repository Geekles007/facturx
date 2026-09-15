# facturx-sdk

*[Français](https://github.com/Geekles007/facturx/blob/main/README.md) · **English***

[![npm](https://img.shields.io/npm/v/facturx-sdk)](https://www.npmjs.com/package/facturx-sdk) [![site](https://img.shields.io/badge/site-facturx.ibird.dev-b0413e)](https://facturx.ibird.dev/) [![CI](https://github.com/Geekles007/facturx/actions/workflows/ci.yml/badge.svg)](https://github.com/Geekles007/facturx/actions/workflows/ci.yml) ![MIT licence](https://img.shields.io/npm/l/facturx-sdk)

A **pure TypeScript** SDK — no native dependencies, edge/serverless friendly — to **generate, embed and extract Factur-X** invoices at the **EN 16931** profile, with the French national rules built in.

**Factur-X is ZUGFeRD.** Same standard, two names: a hybrid file where a human-readable PDF/A-3 carries the machine-readable CII XML inside it. A file produced here is a valid ZUGFeRD 2.x EN 16931 file, and the reader is exercised against the German **ZUGFeRD / KoSIT** corpus in CI. What is specific to France is the *rule set* on top (`BR-FR`), not the format.

> Status: **1.2.0** — complete loop (typed model, validation, CII XML validated against the XSD, XML → `Invoice` reading, PDF/A-3 validated by veraPDF), **lifecycle statuses** (validated against the official business rules, CDV message validated against the UN/CEFACT CDAR D22B schema), executable examples, and the **French rules of the AFNOR XP Z12-012 standard** (every `BR-FR` rule that can be checked offline), **cross-checked in CI by the official CEN, Factur-X and BR-FR V1.3.0 schematrons**.

## Why

A compliant French electronic invoice should not require a Java dependency, a SaaS subscription, or reading 300 pages of specification. `facturx-sdk` gives you:

- an `Invoice` type **annotated field by field** with its EN 16931 Business Term (`BT-xx`) and, where it applies, the French rule behind it;
- **exact monetary arithmetic** — integer cents, `bigint` intermediates, a single commercial rounding, never a float;
- **validation that never quietly fixes anything**: the totals you supply are checked, and every discrepancy comes back with its rule code, the field path, what was expected and what was received;
- **CII XML generation** by typed templating: XSD element order guaranteed by construction, hand-written escaping that is tested, deterministic compact output;
- **XML → `Invoice` reading** (`fromCiiXml`) tolerant of profiles and namespace prefixes, safe by default (no DTD, so no XXE), validating unless told otherwise, and locating every error by a CII path;
- **PDF/A-3 embedding** (`embedFacturX`) that writes the attachment, `/AF`, the XMP `pdfaid` block plus the `fx` extension schema, an aligned `Info` dictionary and a stable `/ID`, idempotently and reproducibly — and **extraction** (`extractFacturX`) that tolerates ZUGFeRD attachment names;
- exactly one runtime dependency, `pdf-lib`, loaded only by the `./pdf` entry point. The main entry has none.

## Where this fits in the French reform

Receiving structured electronic invoices became mandatory for **every** VAT-registered business in France on **1 September 2026**; issuing them follows in 2026 (large companies) then 2027 (SMEs and micro-businesses). Invoices travel through an **accredited platform** (*plateforme agréée*, formerly PDP).

This SDK is the **format and compliance** brick: produce, check and read Factur-X, and since 1.1.0 validate and serialise **lifecycle statuses**. The accredited platform keeps the **transport** brick — submitting invoices and statuses, e-reporting, the directory — which is out of scope here.

The in-depth guide, a readiness checklist and the known gaps are in [docs/reforme.md](docs/reforme.md), in French: it is a commentary on French regulation, and translating it would risk saying something subtly different from the texts it cites.

## Online validator

**[facturx.ibird.dev/validateur](https://facturx.ibird.dev/validateur/)** — drop in a Factur-X PDF or a CII XML file. The SDK reads it back into a typed object, then the three official schematrons (CEN EN 16931, Factur-X, and the French BR-FR rules of XP Z12-012) return their verdict, each finding carrying its rule code and the exact location of the problem.

Everything runs **in your browser**: no file is uploaded anywhere. The rule sets are the ones this repository runs in CI. The veraPDF PDF/A-3 check is not there — it needs Java, therefore a server — but it runs here on every commit.

## Install

```bash
npm add facturx-sdk      # or pnpm / yarn / bun
```

## Quick start

```ts
import {
  assertValidInvoice,
  cents,
  computeTotals,
  type InvoiceDraft,
  percent,
  quantity,
  unitPrice,
} from 'facturx-sdk';

const draft: InvoiceDraft = {
  id: 'F-2026-0001',
  issueDate: '2026-09-11',
  typeCode: '380',                                       // commercial invoice
  currency: 'EUR',
  operationCategory: 'services',                         // goods / services / mixed (French reform)
  seller: {
    name: 'Atelier Exemple SAS',
    siren: '443061841',                                  // French company identifier, Luhn-checked
    vatId: 'FR64443061841',
    address: { line1: '12 rue de la Facture', postCode: '75011', city: 'Paris', countryCode: 'FR' },
  },
  buyer: {
    name: 'Client Démo SARL',
    siren: '732829320',
    electronicAddress: { value: '732829320', scheme: '0225' },
    address: { postCode: '69002', city: 'Lyon', countryCode: 'FR' },
  },
  delivery: { date: '2026-09-10' },
  lines: [{
    id: '1',
    name: 'Consulting',
    quantity: quantity(20000),                           // 2.0000 days
    unitCode: 'DAY',
    unitPrice: unitPrice(1000000),                       // 100.0000 €
    netAmount: cents(20000),                             // 200.00 € — supplied AND verified
    tax: { category: 'S', rate: percent('20') },
  }],
  paymentTerms: { dueDate: '2026-10-11', earlyPaymentDiscount: 'none' },
  paymentMeans: [{ typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189' } }],
};

// Totals and the VAT breakdown are computed EXPLICITLY, never behind your back.
const invoice = { ...draft, ...computeTotals(draft) };
assertValidInvoice(invoice); // throws FacturXValidationError { issues } otherwise
```

### CII XML

```ts
import { toCiiXml } from 'facturx-sdk';

const xml = toCiiXml(invoice);                          // compact, validated before generation
const debug = toCiiXml(invoice, { pretty: true });
// { validate: false } generates despite findings — for debugging only
```

The XML conforms to the Factur-X EN 16931 XSD (`urn:cen.eu:en16931:2017`, CII D16B) and passes the official CEN EN 16931, Factur-X profile and French BR-FR Flux 2 V1.3.0 schematrons **with zero failed assertions**. The reader is exercised on **30 third-party files** (ZUGFeRD / KoSIT corpus, French Factur-X samples): read, re-emitted, and compared without losing a meaningful element.

### PDF/A-3: embed and extract

```ts
import { embedFacturX, extractFacturX } from 'facturx-sdk/pdf';

// pdfBytes: a PDF that is ALREADY PDF/A-conformant (fonts embedded, not encrypted)
const facturx = await embedFacturX(pdfBytes, { invoice }, {
  date: new Date('2026-09-11T10:00:00Z'),               // optional: reproducible output
  title: 'Invoice F-2026-0001',
  outputIntent: { iccProfile: srgbIccBytes },            // optional: adds an sRGB OutputIntent
});

const found = await extractFacturX(facturx);
// { xml, bytes, filename, conformanceLevel, documentType } | undefined
```

`embedFacturX` **does not convert** an arbitrary PDF into PDF/A — your renderer must already produce one. It adds what makes a file Factur-X: the `factur-x.xml` attachment (`/AFRelationship /Alternative`), the `/AF` array, the XMP metadata (`pdfaid:part 3`, `conformance B`, `fx` extension schema), an aligned `Info` dictionary and a fixed `/ID`. The layer it adds is **validated as PDF/A-3b by veraPDF** in CI.

### Reading an invoice you received

```ts
import { fromCiiXml, parseCiiDocument } from 'facturx-sdk';
import { extractInvoice } from 'facturx-sdk/pdf';

const invoice = fromCiiXml(xmlString);                     // validated, or FacturXValidationError
const { invoice: raw, guidelineId } = parseCiiDocument(x);  // any profile, no validation
const received = await extractInvoice(pdfBytes);            // PDF → { invoice, xml, … } | undefined
```

The French socle accepts three syntaxes and the SDK reads all three: Factur-X (PDF/A-3), plain CII, and **UBL 2.1** (`fromUblXml`). The same invoice read from CII and from UBL yields the **same `Invoice` object** — that is what the tests assert, with the UBL reference file itself validated by the XSD and the CEN schematron.

Read errors are typed and located: `FacturXParseError { code: 'MALFORMED' | 'NOT_CII' | 'MISSING' | 'FORMAT' | 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_CDAR', path }`, for example `…/ram:IncludedSupplyChainTradeLineItem[2]/…/ram:LineTotalAmount`. No `DOCTYPE` is ever accepted.

### Lifecycle statuses

For the four statuses a platform reports to the French public portal, and the CDAR message that carries them:

```ts
import { validateLifecycleStatus, toCdvXml, fromCdvXml } from 'facturx-sdk';
```

The official annex lists exactly four for an invoice — `200` deposited, `210` refused by the buyer, `212` paid, `213` rejected on technical grounds — and a lifecycle referencing any other status is rejected by the portal. The message itself is not a French format: it is UN/CEFACT **CDAR D22B**, and the XML this SDK writes is validated against that schema in CI.

This part addresses whoever **builds a platform**: the sender of a CDV message is identified by a platform registration number, which an ordinary invoicing application does not have.

### Money

No floating point, anywhere. `cents(1234)` is 12.34 €, `quantity(15000)` is 1.5, `unitPrice(105000)` is 10.50 €, `percent('5.5')` is 550 basis points. Exact parsing and formatting with `centsFromDecimal('12.34')` and `centsToString(c)`.

### Finding codes

`BR-*`, `BR-CO-*`, `BR-S-*` are EN 16931 rules under their official numbering · `BR-FR-*` are the French rules of AFNOR XP Z12-012 · `FR-*` are other French rules (Commercial Code, Tax Code) · `FORMAT-*` are syntactic formats · `CALC-*` are arithmetic consistency checks with no official rule number · `G*` are the DGFiP business rules that apply to lifecycle statuses.

## Scope

**Included**: the EN 16931 profile, commercial invoices (380), multi-rate VAT, line and document level allowances and charges, exemptions (E, AE, K, G, O, Z), French mandatory statements, credit notes (381, 261, 262, 396), prepayments (386), corrective invoices (384), self-billed (389) and factored (393) documents, and lifecycle statuses.

**Out of scope**: Order-X, *writing* UBL, rendering the human-readable PDF, converting an arbitrary PDF to PDF/A, submitting anything to an accredited platform, e-reporting, and the other Factur-X profiles (MINIMUM, BASIC, EXTENDED — read tolerantly, written only at EN 16931).

## Stability

From **1.0.0** the package follows SemVer: a breaking API change only happens in a major version. Finding **codes and paths** are contractual; the human-readable message text is not. A newly added rule can reject an invoice that was accepted before — that ships as a **minor** version and is announced in the [CHANGELOG](CHANGELOG.md), because conformance comes before compatibility.

## Security

XML and PDF inputs are treated as untrusted: no DTD, no external entities, bounded depth and size (`DEFAULT_LIMITS`, overridable per call), typed `TOO_LARGE` errors, and no content is ever executed. Details and private reporting: [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm install
pnpm check       # lint + typecheck + tests + build + site + examples
```

A pnpm monorepo: `packages/facturx` is the SDK, `examples/*` run in CI, `site/` and `site-src/` are the landing page and the in-browser validator. Releases are driven by a `vX.Y.Z` tag through npm trusted publishing.

**A note on these two READMEs.** [README.md](README.md) is in French and is the authoritative one — this project implements French regulation, and its documentation, error messages and commit history are in French. This page is kept deliberately close in structure so a change on one side is easy to mirror on the other. If the two ever disagree, the French one is right.

## Licence

MIT
