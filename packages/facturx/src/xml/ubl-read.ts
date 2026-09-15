/**
 * Lecture d'une facture **UBL 2.1** (profil EN 16931) vers le modèle `Invoice`.
 *
 * Pourquoi cette syntaxe : le socle de la réforme française en accepte trois — Factur-X (PDF/A-3 +
 * CII), CII nu, et UBL. Depuis le 1er septembre 2026 toute entreprise doit pouvoir **recevoir** une
 * facture électronique ; sans UBL, un tiers du socle restait illisible.
 *
 * Le modèle sémantique est le même qu'en CII : ce sont les mêmes Business Terms EN 16931 (`BT-xx`),
 * seule la syntaxe change. Une facture lue ici et la même lue en CII produisent le même `Invoice` —
 * c'est ce que vérifient les tests.
 *
 * Lecture seule, et volontairement : le SDK écrit du Factur-X, qui est la cible d'un émetteur
 * français. UBL sert à comprendre ce qu'on reçoit.
 */

import { type Limits, resolveLimits } from '../limits.js';
import {
  type Cents,
  centsFromDecimal,
  fromDecimal,
  type Quantity,
  type Rate,
  type UnitPrice,
} from '../money.js';
import { buildPaymentTermsText, parseLegalNotes, parseProcessingNote } from '../payment-terms.js';
import type { Address } from '../types/address.js';
import type { DocumentAllowance, DocumentCharge } from '../types/allowance.js';
import type {
  BusinessProcessCode,
  CurrencyCode,
  InvoiceTypeCode,
  IsoDate,
  NoteSubjectCode,
  TaxCategoryCode,
} from '../types/codes.js';
import { isBusinessProcessCode, operationCategoryFromBusinessProcess } from '../types/codes.js';
import type { Delivery, Invoice, InvoiceNote, Totals } from '../types/invoice.js';
import type { Line } from '../types/line.js';
import type { Party } from '../types/party.js';
import type { PaymentMeans, PaymentTerms } from '../types/payment.js';
import type { TaxBreakdown } from '../types/tax.js';
import { isValidIsoDate } from '../validate/formats.js';
import { assertValidInvoice } from '../validate/index.js';
import { FacturXParseError } from './cii-read.js';
import { parseXml, type XmlNode, XmlParseError } from './parse.js';

/** Espaces de noms UBL 2.1. `cbc` porte les valeurs, `cac` les regroupements. */
export const UBL_NAMESPACES = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

const { cac: CAC, cbc: CBC } = UBL_NAMESPACES;

export interface ParsedUblDocument {
  invoice: Invoice;
  /** BT-24 — `cbc:CustomizationID`, `urn:cen.eu:en16931:2017` pour le profil EN 16931. */
  guidelineId: string;
  /** BT-23 — `cbc:ProfileID`, s'il est présent. */
  businessProcessId?: string;
}

export interface FromUblXmlOptions {
  /** Valider avec `assertValidInvoice` après lecture (défaut : `true`). */
  validate?: boolean;
  /** Limites de taille (défaut : `DEFAULT_LIMITS`). */
  limits?: Partial<Limits>;
}

// ---------- accès à l'arbre ----------

interface Ctx {
  readonly node: XmlNode;
  readonly path: string;
}

function prefixFor(ns: string): string {
  return ns === CBC ? 'cbc' : ns === CAC ? 'cac' : '';
}

function children(ctx: Ctx, local: string, ns: string): Ctx[] {
  const matches = ctx.node.children.filter((c) => c.local === local && c.ns === ns);
  return matches.map((node, i) => ({
    node,
    path: `${ctx.path}/${prefixFor(node.ns)}:${node.local}${matches.length > 1 ? `[${i + 1}]` : ''}`,
  }));
}

const cac = (ctx: Ctx | undefined, local: string): Ctx | undefined =>
  ctx && children(ctx, local, CAC)[0];
const cacAll = (ctx: Ctx | undefined, local: string): Ctx[] =>
  ctx ? children(ctx, local, CAC) : [];
const cbc = (ctx: Ctx | undefined, local: string): Ctx | undefined =>
  ctx && children(ctx, local, CBC)[0];
const cbcAll = (ctx: Ctx | undefined, local: string): Ctx[] =>
  ctx ? children(ctx, local, CBC) : [];

function text(ctx: Ctx | undefined): string | undefined {
  if (!ctx) return undefined;
  const value = ctx.node.text.trim();
  return value === '' ? undefined : value;
}

const textOf = (ctx: Ctx | undefined, local: string): string | undefined => text(cbc(ctx, local));

function attr(ctx: Ctx | undefined, name: string): string | undefined {
  const value = ctx?.node.attrs[name];
  return value === undefined || value === '' ? undefined : value;
}

function require<T>(value: T | undefined, path: string, what: string): T {
  if (value === undefined) throw new FacturXParseError('MISSING', path, what);
  return value;
}

/** Décimal signé vers un entier à l'échelle donnée, en refusant ce qui n'est pas un nombre. */
function scaled(ctx: Ctx, scale: number): number {
  const raw = require(text(ctx), ctx.path, 'Valeur numérique absente');
  try {
    return fromDecimal(raw, scale);
  } catch (error) {
    throw new FacturXParseError('FORMAT', ctx.path, `Nombre illisible « ${raw} »`, {
      cause: error,
    });
  }
}

/** Montant en centimes, avec l'erreur localisée plutôt qu'une MoneyError brute qui ne dit pas où. */
function amount(ctx: Ctx): Cents {
  const raw = require(text(ctx), ctx.path, 'Montant absent');
  try {
    return centsFromDecimal(raw);
  } catch (error) {
    throw new FacturXParseError('FORMAT', ctx.path, `Montant illisible « ${raw} »`, {
      cause: error,
    });
  }
}
const amountOf = (ctx: Ctx | undefined, local: string): Cents | undefined => {
  const found = cbc(ctx, local);
  return found ? amount(found) : undefined;
};

/** Taux en points de base : `20` → 2000, `5.5` → 550. */
const rateOf = (ctx: Ctx | undefined, local: string): Rate | undefined => {
  const found = cbc(ctx, local);
  return found ? (scaled(found, 2) as Rate) : undefined;
};

function date(ctx: Ctx | undefined): IsoDate | undefined {
  const raw = text(ctx);
  if (raw === undefined) return undefined;
  if (!isValidIsoDate(raw)) {
    throw new FacturXParseError(
      'FORMAT',
      (ctx as Ctx).path,
      `Date ISO (AAAA-MM-JJ) attendue, reçu « ${raw} »`,
    );
  }
  return raw as IsoDate;
}

const dateOf = (ctx: Ctx | undefined, local: string): IsoDate | undefined => date(cbc(ctx, local));

/** Retire les clés `undefined` : le modèle distingue « absent » de « présent et vide ». */
function defined<T extends object>(obj: { [K in keyof T]?: T[K] | undefined }): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

const nonEmpty = <T>(items: T[]): T[] | undefined => (items.length > 0 ? items : undefined);

// ---------- fragments ----------

function address(ctx: Ctx | undefined, path: string): Address {
  const node = require(ctx, path, 'Adresse postale absente');
  const country = cac(node, 'Country');
  return defined<Address>({
    line1: textOf(node, 'StreetName'),
    line2: textOf(node, 'AdditionalStreetName'),
    line3: text(cbc(cac(node, 'AddressLine'), 'Line')),
    city: textOf(node, 'CityName'),
    postCode: textOf(node, 'PostalZone'),
    countrySubdivision: textOf(node, 'CountrySubentity'),
    countryCode: require(textOf(
      country,
      'IdentificationCode',
    ), `${node.path}/cac:Country/cbc:IdentificationCode`, 'Code pays absent (BT-40 / BT-55)'),
  });
}

/**
 * En UBL le SIREN et le SIRET partagent la balise `cac:PartyLegalEntity/cbc:CompanyID`, distingués
 * par leur `schemeID` (`0002` SIREN, `0009` SIRET). Le SIREN est déduit du SIRET quand seul ce
 * dernier est présent : ses neuf premiers chiffres, par construction.
 */
function party(ctx: Ctx | undefined, path: string): Party {
  const node = require(ctx, path, 'Partie absente');
  const legal = cac(node, 'PartyLegalEntity');
  const companyId = cbc(legal, 'CompanyID');
  const scheme = attr(companyId, 'schemeID');
  const company = text(companyId);
  const siret = scheme === '0009' ? company : undefined;
  const siren = scheme === '0002' ? company : siret?.slice(0, 9);

  const endpoint = cbc(node, 'EndpointID');
  const contact = cac(node, 'Contact');
  const vatScheme = cacAll(node, 'PartyTaxScheme').find(
    (s) => text(cbc(cac(s, 'TaxScheme'), 'ID'))?.toUpperCase() === 'VAT',
  );

  return defined<Party>({
    name: require(text(cbc(cac(node, 'PartyName'), 'Name')) ??
      textOf(
        legal,
        'RegistrationName',
      ), `${node.path}/cac:PartyName/cbc:Name`, 'Nom de la partie absent (BT-27 / BT-44)'),
    tradingName: (() => {
      // BT-28 n'existe que si le nom commercial diffère de la raison sociale ; sinon UBL répète
      // simplement la même valeur dans les deux balises et il n'y a rien à conserver.
      const commercial = text(cbc(cac(node, 'PartyName'), 'Name'));
      const legalName = textOf(legal, 'RegistrationName');
      return commercial && legalName && commercial !== legalName ? legalName : undefined;
    })(),
    siren,
    siret,
    vatId: textOf(vatScheme, 'CompanyID'),
    legalInfo: textOf(legal, 'CompanyLegalForm'),
    address: address(cac(node, 'PostalAddress'), `${node.path}/cac:PostalAddress`),
    contact: (() => {
      const c = defined<NonNullable<Party['contact']>>({
        name: textOf(contact, 'Name'),
        phone: textOf(contact, 'Telephone'),
        email: textOf(contact, 'ElectronicMail'),
      });
      return Object.keys(c).length > 0 ? c : undefined;
    })(),
    electronicAddress:
      endpoint && text(endpoint) !== undefined
        ? defined<NonNullable<Party['electronicAddress']>>({
            value: text(endpoint) as string,
            scheme: attr(endpoint, 'schemeID'),
          })
        : undefined,
  });
}

/** `cac:TaxCategory` ou `cac:ClassifiedTaxCategory` : catégorie et taux. */
function taxCategory(
  ctx: Ctx | undefined,
  path: string,
): { category: TaxCategoryCode; rate?: Rate } {
  const node = require(ctx, path, 'Catégorie de TVA absente');
  return defined({
    category: require(textOf(
      node,
      'ID',
    ), `${node.path}/cbc:ID`, 'Code de catégorie de TVA absent (BT-151 / BT-118)') as TaxCategoryCode,
    rate: rateOf(node, 'Percent'),
  });
}

/** Remises et frais, au document comme à la ligne : le drapeau `ChargeIndicator` les sépare. */
function allowanceCharge(ctx: Ctx): { charge: boolean; value: DocumentAllowance & DocumentCharge } {
  const charge = text(cbc(ctx, 'ChargeIndicator')) === 'true';
  const value = defined<DocumentAllowance & DocumentCharge>({
    amount: amount(require(cbc(ctx, 'Amount'), `${ctx.path}/cbc:Amount`, 'Montant absent')),
    baseAmount: amountOf(ctx, 'BaseAmount'),
    percentage: rateOf(ctx, 'MultiplierFactorNumeric'),
    reason: textOf(ctx, 'AllowanceChargeReason'),
    reasonCode: textOf(ctx, 'AllowanceChargeReasonCode') as never,
    tax: (() => {
      const cat = cac(ctx, 'TaxCategory');
      return cat ? taxCategory(cat, `${ctx.path}/cac:TaxCategory`) : undefined;
    })() as never,
  });
  return { charge, value };
}

function line(ctx: Ctx, creditNote: boolean): Line {
  const item = cac(ctx, 'Item');
  const price = cac(ctx, 'Price');
  // La quantité change de nom selon le document : InvoicedQuantity / CreditedQuantity.
  const qtyNode = cbc(ctx, creditNote ? 'CreditedQuantity' : 'InvoicedQuantity');
  const allowances: Line['allowances'] = [];
  const charges: Line['charges'] = [];
  for (const ac of cacAll(ctx, 'AllowanceCharge')) {
    const { charge, value } = allowanceCharge(ac);
    (charge ? charges : allowances).push(value);
  }
  const period = cac(ctx, 'InvoicePeriod');

  return defined<Line>({
    id: require(textOf(ctx, 'ID'), `${ctx.path}/cbc:ID`, 'Identifiant de ligne absent (BT-126)'),
    note: textOf(ctx, 'Note'),
    orderLineReference: text(cbc(cac(ctx, 'OrderLineReference'), 'LineID')),
    buyerAccountingReference: textOf(ctx, 'AccountingCost'),
    period: period
      ? defined<NonNullable<Line['period']>>({
          start: dateOf(period, 'StartDate'),
          end: dateOf(period, 'EndDate'),
        })
      : undefined,
    name: require(textOf(
      item,
      'Name',
    ), `${ctx.path}/cac:Item/cbc:Name`, "Nom de l'article absent (BT-153)"),
    description: textOf(item, 'Description'),
    sellerItemId: text(cbc(cac(item, 'SellersItemIdentification'), 'ID')),
    buyerItemId: text(cbc(cac(item, 'BuyersItemIdentification'), 'ID')),
    quantity: require(qtyNode &&
      (scaled(
        qtyNode,
        4,
      ) as Quantity), `${ctx.path}/cbc:InvoicedQuantity`, 'Quantité absente (BT-129)'),
    unitCode: attr(qtyNode, 'unitCode') as never,
    unitPrice: require(cbc(price, 'PriceAmount') &&
      (scaled(
        cbc(price, 'PriceAmount') as Ctx,
        4,
      ) as UnitPrice), `${ctx.path}/cac:Price/cbc:PriceAmount`, 'Prix unitaire absent (BT-146)'),
    baseQuantity: (() => {
      const base = cbc(price, 'BaseQuantity');
      return base ? (scaled(base, 4) as Quantity) : undefined;
    })(),
    allowances: nonEmpty(allowances),
    charges: nonEmpty(charges),
    netAmount: amount(
      require(cbc(
        ctx,
        'LineExtensionAmount',
      ), `${ctx.path}/cbc:LineExtensionAmount`, 'Montant net de ligne absent (BT-131)'),
    ),
    tax: taxCategory(
      cac(item, 'ClassifiedTaxCategory'),
      `${ctx.path}/cac:Item/cac:ClassifiedTaxCategory`,
    ),
  });
}

/**
 * BT-21 — le code de sujet d'une note. UBL n'a pas de balise dédiée : la norme le préfixe au texte,
 * `#AAB#texte`. Une note sans préfixe n'a pas de code, ce qui est licite.
 */
function note(ctx: Ctx): InvoiceNote {
  const raw = text(ctx) ?? '';
  const match = /^#([A-Z]{2,3})#([\s\S]*)$/.exec(raw);
  const [, code, body] = match ?? [];
  return defined<InvoiceNote>({
    text: body?.trim() ?? raw,
    subjectCode: code as NoteSubjectCode | undefined,
  });
}

// ---------- document ----------

/** Lit une facture UBL sans la valider. `fromUblXml` valide. */
export function parseUblDocument(
  xml: string | Uint8Array,
  options: Pick<FromUblXmlOptions, 'limits'> = {},
): ParsedUblDocument {
  const limits = resolveLimits(options.limits);
  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xml, { maxBytes: limits.xmlBytes });
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new FacturXParseError('MALFORMED', '', error.message, { cause: error });
    throw error;
  }
  const creditNote = rootNode.ns === UBL_NAMESPACES.creditNote && rootNode.local === 'CreditNote';
  if (!creditNote && !(rootNode.ns === UBL_NAMESPACES.invoice && rootNode.local === 'Invoice')) {
    throw new FacturXParseError(
      'NOT_UBL',
      rootNode.name,
      'La racine doit être Invoice ou CreditNote (UBL 2.1)',
    );
  }
  const root: Ctx = { node: rootNode, path: creditNote ? 'CreditNote' : 'Invoice' };

  const guidelineId = require(textOf(
    root,
    'CustomizationID',
  ), `${root.path}/cbc:CustomizationID`, 'Identifiant de spécification absent (BT-24)');
  const businessProcessId = textOf(root, 'ProfileID');

  const typeCode = require(textOf(
    root,
    creditNote ? 'CreditNoteTypeCode' : 'InvoiceTypeCode',
  ), `${root.path}/cbc:InvoiceTypeCode`, 'Code de type de document absent (BT-3)') as InvoiceTypeCode;

  // Remises et frais au niveau document.
  const allowances: DocumentAllowance[] = [];
  const charges: DocumentCharge[] = [];
  for (const ac of cacAll(root, 'AllowanceCharge')) {
    const { charge, value } = allowanceCharge(ac);
    (charge ? charges : allowances).push(value);
  }

  // Ventilation de TVA : on ne retient que le TaxTotal en devise du document.
  const taxTotal = cacAll(root, 'TaxTotal')[0];
  const taxBreakdown: TaxBreakdown[] = cacAll(taxTotal, 'TaxSubtotal').map((sub) => {
    const cat = cac(sub, 'TaxCategory');
    return defined<TaxBreakdown>({
      ...taxCategory(cat, `${sub.path}/cac:TaxCategory`),
      taxableAmount: amount(
        require(cbc(
          sub,
          'TaxableAmount',
        ), `${sub.path}/cbc:TaxableAmount`, 'Base absente (BT-116)'),
      ),
      taxAmount: amount(
        require(cbc(sub, 'TaxAmount'), `${sub.path}/cbc:TaxAmount`, 'TVA absente (BT-117)'),
      ),
      exemptionReason: textOf(cat, 'TaxExemptionReason'),
      exemptionReasonCode: textOf(cat, 'TaxExemptionReasonCode') as never,
    });
  });

  const monetary = require(cac(
    root,
    'LegalMonetaryTotal',
  ), `${root.path}/cac:LegalMonetaryTotal`, 'Totaux absents (BG-22)');
  const totals = defined<Totals>({
    lineTotalAmount: amount(
      require(cbc(
        monetary,
        'LineExtensionAmount',
      ), `${monetary.path}/cbc:LineExtensionAmount`, 'Total des lignes absent (BT-106)'),
    ),
    allowanceTotalAmount: amountOf(monetary, 'AllowanceTotalAmount'),
    chargeTotalAmount: amountOf(monetary, 'ChargeTotalAmount'),
    taxExclusiveAmount: amount(
      require(cbc(
        monetary,
        'TaxExclusiveAmount',
      ), `${monetary.path}/cbc:TaxExclusiveAmount`, 'Total HT absent (BT-109)'),
    ),
    taxTotalAmount: require(amountOf(
      taxTotal,
      'TaxAmount',
    ), `${root.path}/cac:TaxTotal/cbc:TaxAmount`, 'Total de TVA absent (BT-110)'),
    taxInclusiveAmount: amount(
      require(cbc(
        monetary,
        'TaxInclusiveAmount',
      ), `${monetary.path}/cbc:TaxInclusiveAmount`, 'Total TTC absent (BT-112)'),
    ),
    prepaidAmount: amountOf(monetary, 'PrepaidAmount'),
    roundingAmount: amountOf(monetary, 'PayableRoundingAmount'),
    amountDueForPayment: amount(
      require(cbc(
        monetary,
        'PayableAmount',
      ), `${monetary.path}/cbc:PayableAmount`, 'Net à payer absent (BT-115)'),
    ),
  });

  const paymentMeans: PaymentMeans[] = cacAll(root, 'PaymentMeans').map((pm) => {
    const account = cac(pm, 'PayeeFinancialAccount');
    const mandate = cac(pm, 'PaymentMandate');
    const iban = textOf(account, 'ID');
    return defined<PaymentMeans>({
      typeCode: require(textOf(
        pm,
        'PaymentMeansCode',
      ), `${pm.path}/cbc:PaymentMeansCode`, 'Code de moyen de paiement absent (BT-81)') as never,
      text: attr(cbc(pm, 'PaymentMeansCode'), 'name'),
      creditTransfer: iban
        ? defined<NonNullable<PaymentMeans['creditTransfer']>>({
            iban,
            accountName: textOf(account, 'Name'),
            bic: text(cbc(cac(account, 'FinancialInstitutionBranch'), 'ID')),
          })
        : undefined,
      directDebit: mandate
        ? defined<NonNullable<PaymentMeans['directDebit']>>({
            mandateReference: textOf(mandate, 'ID'),
            debitedIban: text(cbc(cac(mandate, 'PayerFinancialAccount'), 'ID')),
          })
        : undefined,
    });
  });

  const allNotes = cbcAll(root, 'Note').map(note);
  const legal = parseLegalNotes(allNotes);
  const bar = parseProcessingNote(legal.remaining);
  const terms = cac(root, 'PaymentTerms');
  const termsText = textOf(terms, 'Note');
  const paymentTerms = defined<PaymentTerms>({ dueDate: dateOf(root, 'DueDate'), ...legal.terms });
  // Le BT-20 que le SDK génère est régénéré à l'identique : ne le garder que s'il diffère.
  if (
    termsText !== undefined &&
    (legal.terms === undefined || termsText !== buildPaymentTermsText(paymentTerms))
  ) {
    paymentTerms.text = termsText;
  }
  const delivery = cac(root, 'Delivery');
  const deliveryLocation = cac(delivery, 'DeliveryLocation');
  const period = cac(root, 'InvoicePeriod');

  const invoice = defined<Invoice>({
    id: require(textOf(root, 'ID'), `${root.path}/cbc:ID`, 'Numéro de facture absent (BT-1)'),
    issueDate: require(dateOf(
      root,
      'IssueDate',
    ), `${root.path}/cbc:IssueDate`, "Date d'émission absente (BT-2)"),
    typeCode,
    currency: require(textOf(
      root,
      'DocumentCurrencyCode',
    ), `${root.path}/cbc:DocumentCurrencyCode`, 'Devise absente (BT-5)') as CurrencyCode,
    taxPointDate: dateOf(root, 'TaxPointDate'),
    operationCategory: operationCategoryFromBusinessProcess(businessProcessId),
    businessProcess: isBusinessProcessCode(businessProcessId)
      ? (businessProcessId as BusinessProcessCode)
      : undefined,
    processing: bar.processing,
    buyerReference: textOf(root, 'BuyerReference'),
    notes: nonEmpty(bar.remaining),
    seller: party(
      cac(cac(root, 'AccountingSupplierParty'), 'Party'),
      `${root.path}/cac:AccountingSupplierParty/cac:Party`,
    ),
    buyer: party(
      cac(cac(root, 'AccountingCustomerParty'), 'Party'),
      `${root.path}/cac:AccountingCustomerParty/cac:Party`,
    ),
    delivery:
      delivery || period
        ? defined<Delivery>({
            date: dateOf(delivery, 'ActualDeliveryDate'),
            period: period
              ? defined<NonNullable<Delivery['period']>>({
                  start: dateOf(period, 'StartDate'),
                  end: dateOf(period, 'EndDate'),
                })
              : undefined,
            partyName: text(cbc(cac(cac(delivery, 'DeliveryParty'), 'PartyName'), 'Name')),
            locationId: textOf(deliveryLocation, 'ID'),
            address:
              deliveryLocation && cac(deliveryLocation, 'Address')
                ? address(cac(deliveryLocation, 'Address'), `${deliveryLocation.path}/cac:Address`)
                : undefined,
          })
        : undefined,
    lines: cacAll(root, creditNote ? 'CreditNoteLine' : 'InvoiceLine').map((l) =>
      line(l, creditNote),
    ),
    allowances: nonEmpty(allowances),
    charges: nonEmpty(charges),
    taxBreakdown,
    totals,
    paymentTerms,
    remittanceInformation: text(cbc(cacAll(root, 'PaymentMeans')[0], 'PaymentID')),
    paymentMeans: nonEmpty(paymentMeans),
  });

  return defined<ParsedUblDocument>({ invoice, guidelineId, businessProcessId });
}

/** Lit une facture UBL et la valide (EN 16931 + règles françaises), sauf `validate: false`. */
export function fromUblXml(xml: string | Uint8Array, options: FromUblXmlOptions = {}): Invoice {
  const { invoice } = parseUblDocument(xml, options);
  return (options.validate ?? true) ? assertValidInvoice(invoice, options) : invoice;
}
