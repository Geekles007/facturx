import { type Limits, resolveLimits } from '../limits.js';
import {
  type Cents,
  fromDecimal,
  MoneyError,
  type Quantity,
  type Rate,
  type UnitPrice,
} from '../money.js';
import { buildPaymentTermsText, parseLegalNotes, parseProcessingNote } from '../payment-terms.js';
import type { Address } from '../types/address.js';
import type { DocumentAllowance, DocumentCharge } from '../types/allowance.js';
import type { Attachment, AttachmentMimeType } from '../types/attachment.js';
import {
  type InvoiceTypeCode,
  type IsoDate,
  isBusinessProcessCode,
  operationCategoryFromBusinessProcess,
  type TaxCategoryCode,
} from '../types/codes.js';
import type { Delivery, Invoice, InvoiceNote, Totals } from '../types/invoice.js';
import type { Line, LineAllowance, LineCharge } from '../types/line.js';
import type { Contact, Party, PartyIdentifier, Payee } from '../types/party.js';
import type { PaymentMeans, PaymentTerms } from '../types/payment.js';
import type { DocumentReferences, PrecedingInvoiceReference } from '../types/references.js';
import type { TaxBreakdown, TaxInfo } from '../types/tax.js';
import { isValidIsoDate } from '../validate/formats.js';
import { assertValidInvoice } from '../validate/index.js';
import { decodeBase64 } from './base64.js';
import { CII_NAMESPACES } from './cii.js';
import { parseXml, type XmlNode, XmlParseError } from './parse.js';

export type FacturXParseErrorCode =
  /** XML mal formé (voir `cause` : `XmlParseError` avec ligne/colonne). */
  | 'MALFORMED'
  /** La racine n'est pas `rsm:CrossIndustryInvoice`. */
  | 'NOT_CII'
  /** La racine n'est pas `rsm:CrossDomainAcknowledgementAndResponse` (lecture d'un message CDV). */
  | 'NOT_CDAR'
  /** Élément obligatoire absent. */
  | 'MISSING'
  /** Valeur mal formée (nombre, date, indicateur). */
  | 'FORMAT'
  /** Structure non prise en charge. */
  | 'UNSUPPORTED'
  /** Entrée ou pièce jointe au-delà des limites (`Limits`). */
  | 'TOO_LARGE';

/** Erreur typée de lecture CII, localisée par un chemin d'éléments. */
export class FacturXParseError extends Error {
  override readonly name = 'FacturXParseError';
  readonly code: FacturXParseErrorCode;
  /** Chemin CII aux préfixes canoniques (rsm/ram/udt/qdt, quels que soient ceux du document), ex. `…/ram:IncludedSupplyChainTradeLineItem[2]/…`. */
  readonly path: string;

  constructor(
    code: FacturXParseErrorCode,
    path: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(path ? `${message} (${path})` : message, options);
    this.code = code;
    this.path = path;
  }
}

export interface ParsedCiiDocument {
  invoice: Invoice;
  /** BT-24 — identifiant de la guideline (`urn:cen.eu:en16931:2017` pour EN 16931, `…:minimum`, `…:basic`, `…:extended`…). */
  guidelineId: string;
  /** BT-23 — identifiant de processus métier, s'il est présent. */
  businessProcessId?: string;
}

export interface FromCiiXmlOptions {
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

const { rsm: RSM, ram: RAM, udt: UDT, qdt: QDT } = CII_NAMESPACES;

function children(ctx: Ctx, local: string, ns: string = RAM): Ctx[] {
  const matches = ctx.node.children.filter((c) => c.local === local && c.ns === ns);
  return matches.map((node, i) => ({
    node,
    path: `${ctx.path}/${prefixFor(node.ns)}:${node.local}${matches.length > 1 ? `[${i + 1}]` : ''}`,
  }));
}

function child(ctx: Ctx | undefined, local: string, ns: string = RAM): Ctx | undefined {
  return ctx === undefined ? undefined : children(ctx, local, ns)[0];
}

function requireChild(ctx: Ctx, local: string, ns: string = RAM): Ctx {
  const found = child(ctx, local, ns);
  if (!found)
    throw new FacturXParseError(
      'MISSING',
      `${ctx.path}/${prefixFor(ns)}:${local}`,
      'Élément obligatoire absent',
    );
  return found;
}

function prefixFor(ns: string): string {
  return ns === RSM ? 'rsm' : ns === UDT ? 'udt' : ns === QDT ? 'qdt' : 'ram';
}

function text(ctx: Ctx | undefined): string | undefined {
  if (!ctx) return undefined;
  const value = ctx.node.text.trim();
  return value === '' ? undefined : value;
}

/** Texte d'un enfant direct. */
function textOf(ctx: Ctx | undefined, local: string, ns: string = RAM): string | undefined {
  return text(child(ctx, local, ns));
}

function attr(ctx: Ctx | undefined, name: string): string | undefined {
  const value = ctx?.node.attrs[name];
  return value === undefined || value === '' ? undefined : value;
}

function decimal(ctx: Ctx, scale: number): number {
  const raw = text(ctx);
  if (raw === undefined)
    throw new FacturXParseError('MISSING', ctx.path, 'Valeur numérique absente');
  try {
    return fromDecimal(raw, scale);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new FacturXParseError(
        'FORMAT',
        ctx.path,
        `Nombre invalide « ${raw} » (${scale} décimale(s) max)`,
        { cause: error },
      );
    }
    throw error;
  }
}

const amount = (ctx: Ctx): Cents => decimal(ctx, 2) as Cents;
const amountOf = (ctx: Ctx | undefined, local: string): Cents | undefined => {
  const c = child(ctx, local);
  return c === undefined ? undefined : amount(c);
};
const requireAmount = (ctx: Ctx, local: string): Cents => amount(requireChild(ctx, local));
const e4 = (ctx: Ctx): number => decimal(ctx, 4);
const rateOf = (ctx: Ctx | undefined, local: string): Rate | undefined => {
  const c = child(ctx, local);
  return c === undefined ? undefined : (decimal(c, 2) as Rate);
};

/** Date `udt:DateTimeString`/`udt:DateString`/`qdt:DateTimeString` au format 102 (YYYYMMDD) → ISO. */
function date(ctx: Ctx | undefined): IsoDate | undefined {
  if (!ctx) return undefined;
  const inner =
    child(ctx, 'DateTimeString', UDT) ??
    child(ctx, 'DateString', UDT) ??
    child(ctx, 'DateTimeString', QDT);
  if (!inner)
    throw new FacturXParseError('MISSING', `${ctx.path}/udt:DateTimeString`, 'Date absente');
  const format = attr(inner, 'format');
  const raw = text(inner);
  if (format !== '102' || raw === undefined || !/^\d{8}$/.test(raw)) {
    throw new FacturXParseError(
      'FORMAT',
      inner.path,
      `Date au format 102 (YYYYMMDD) attendue, reçu « ${raw ?? ''} » (format ${format ?? '∅'})`,
    );
  }
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (!isValidIsoDate(iso))
    throw new FacturXParseError('FORMAT', inner.path, `Date calendaire invalide « ${raw} »`);
  return iso as IsoDate;
}

const dateOf = (ctx: Ctx | undefined, local: string): IsoDate | undefined =>
  date(child(ctx, local));

function indicator(ctx: Ctx): boolean {
  const raw = textOf(child(ctx, 'ChargeIndicator'), 'Indicator', UDT);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new FacturXParseError(
    'FORMAT',
    `${ctx.path}/ram:ChargeIndicator/udt:Indicator`,
    `Indicateur true/false attendu, reçu « ${raw ?? ''} »`,
  );
}

/** Retire les clés `undefined` (compatibilité `exactOptionalPropertyTypes`). */
function defined<T extends object>(obj: { [K in keyof T]?: T[K] | undefined }): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) if (value !== undefined) out[key] = value;
  return out as T;
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

function some(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

// ---------- parties ----------

function address(ctx: Ctx | undefined): Address | undefined {
  if (!ctx) return undefined;
  return defined<Address>({
    line1: textOf(ctx, 'LineOne'),
    line2: textOf(ctx, 'LineTwo'),
    line3: textOf(ctx, 'LineThree'),
    city: textOf(ctx, 'CityName'),
    postCode: textOf(ctx, 'PostcodeCode'),
    countrySubdivision: textOf(ctx, 'CountrySubDivisionName'),
    countryCode: textOf(ctx, 'CountryID') ?? '',
  });
}

function contact(ctx: Ctx | undefined): Contact | undefined {
  if (!ctx) return undefined;
  const c = defined<Contact>({
    name: textOf(ctx, 'PersonName'),
    phone: textOf(child(ctx, 'TelephoneUniversalCommunication'), 'CompleteNumber'),
    email: textOf(child(ctx, 'EmailURIUniversalCommunication'), 'URIID'),
  });
  return some(c) ? c : undefined;
}

function party(ctx: Ctx, role: 'seller' | 'buyer'): Party {
  const globalIds = children(ctx, 'GlobalID');
  const legal = child(ctx, 'SpecifiedLegalOrganization');
  const legalId = child(legal, 'ID');
  const legalScheme = attr(legalId, 'schemeID');
  let siren = legalScheme === '0002' ? text(legalId) : undefined;
  let siret = text(globalIds.find((g) => attr(g, 'schemeID') === '0009'));
  if (legalScheme === '0009' && siret === undefined) siret = text(legalId);
  siren ??= text(globalIds.find((g) => attr(g, 'schemeID') === '0002'));
  let vatId: string | undefined;
  let taxRegistrationId: string | undefined;
  for (const reg of children(ctx, 'SpecifiedTaxRegistration')) {
    const id = child(reg, 'ID');
    const scheme = attr(id, 'schemeID');
    if (scheme === 'VA') vatId ??= text(id);
    else if (scheme === 'FC') taxRegistrationId ??= text(id);
  }
  const routing = children(ctx, 'ID').find((id) => attr(id, 'schemeID') === '0224');
  const identifiers: PartyIdentifier[] = children(ctx, 'ID')
    .filter((id) => attr(id, 'schemeID') !== '0224' && text(id) !== undefined)
    .map((id) =>
      defined<PartyIdentifier>({ value: text(id) as string, scheme: attr(id, 'schemeID') }),
    );
  const globalIdsOther: PartyIdentifier[] = globalIds
    .filter((g) => attr(g, 'schemeID') !== '0009' && text(g) !== undefined)
    .map((g) =>
      defined<PartyIdentifier>({ value: text(g) as string, scheme: attr(g, 'schemeID') }),
    );
  const uri = child(child(ctx, 'URIUniversalCommunication'), 'URIID');
  const uriValue = text(uri);
  return defined<Party>({
    name: textOf(ctx, 'Name') ?? '',
    tradingName: textOf(legal, 'TradingBusinessName'),
    siren,
    siret,
    vatId,
    taxRegistrationId: role === 'seller' ? taxRegistrationId : undefined,
    legalInfo: role === 'seller' ? textOf(ctx, 'Description') : undefined,
    address: address(child(ctx, 'PostalTradeAddress')) ?? { countryCode: '' },
    contact: contact(child(ctx, 'DefinedTradeContact')),
    routingCode: text(routing),
    identifiers: nonEmpty(identifiers),
    globalIds: nonEmpty(globalIdsOther),
    electronicAddress:
      uriValue === undefined ? undefined : { value: uriValue, scheme: attr(uri, 'schemeID') ?? '' },
  });
}

// ---------- TVA, remises, frais ----------

function taxInfo(ctx: Ctx | undefined, path: string): TaxInfo {
  if (!ctx) throw new FacturXParseError('MISSING', path, 'Information TVA absente');
  const category = textOf(ctx, 'CategoryCode');
  if (category === undefined)
    throw new FacturXParseError('MISSING', `${ctx.path}/ram:CategoryCode`, 'Catégorie TVA absente');
  return defined<TaxInfo>({
    category: category as TaxCategoryCode,
    rate: rateOf(ctx, 'RateApplicablePercent'),
  });
}

function allowanceChargeFields(ctx: Ctx) {
  return {
    amount: requireAmount(ctx, 'ActualAmount'),
    baseAmount: amountOf(ctx, 'BasisAmount'),
    percentage: rateOf(ctx, 'CalculationPercent'),
    reason: textOf(ctx, 'Reason'),
    reasonCode: textOf(ctx, 'ReasonCode'),
  };
}

function lineAllowancesCharges(ctx: Ctx): { allowances?: LineAllowance[]; charges?: LineCharge[] } {
  const allowances: LineAllowance[] = [];
  const charges: LineCharge[] = [];
  for (const ac of children(ctx, 'SpecifiedTradeAllowanceCharge')) {
    const fields = defined<LineAllowance>(allowanceChargeFields(ac));
    if (indicator(ac)) charges.push(fields as LineCharge);
    else allowances.push(fields);
  }
  return defined({ allowances: nonEmpty(allowances), charges: nonEmpty(charges) });
}

function documentAllowancesCharges(ctx: Ctx): {
  allowances?: DocumentAllowance[];
  charges?: DocumentCharge[];
} {
  const allowances: DocumentAllowance[] = [];
  const charges: DocumentCharge[] = [];
  for (const ac of children(ctx, 'SpecifiedTradeAllowanceCharge')) {
    const fields = defined<DocumentAllowance>({
      ...allowanceChargeFields(ac),
      tax: taxInfo(child(ac, 'CategoryTradeTax'), `${ac.path}/ram:CategoryTradeTax`),
    });
    if (indicator(ac)) charges.push(fields as DocumentCharge);
    else allowances.push(fields);
  }
  return defined({ allowances: nonEmpty(allowances), charges: nonEmpty(charges) });
}

function taxBreakdown(ctx: Ctx): TaxBreakdown {
  const category = textOf(ctx, 'CategoryCode');
  if (category === undefined)
    throw new FacturXParseError('MISSING', `${ctx.path}/ram:CategoryCode`, 'Catégorie TVA absente');
  return defined<TaxBreakdown>({
    category: category as TaxCategoryCode,
    rate: rateOf(ctx, 'RateApplicablePercent'),
    taxableAmount: requireAmount(ctx, 'BasisAmount'),
    taxAmount: requireAmount(ctx, 'CalculatedAmount'),
    exemptionReason: textOf(ctx, 'ExemptionReason'),
    exemptionReasonCode: textOf(ctx, 'ExemptionReasonCode'),
  });
}

// ---------- lignes ----------

function line(ctx: Ctx): Line {
  const doc = child(ctx, 'AssociatedDocumentLineDocument');
  const product = child(ctx, 'SpecifiedTradeProduct');
  const agreement = child(ctx, 'SpecifiedLineTradeAgreement');
  const delivery = requireChild(ctx, 'SpecifiedLineTradeDelivery');
  const settlement = requireChild(ctx, 'SpecifiedLineTradeSettlement');
  const netPrice = child(agreement, 'NetPriceProductTradePrice');
  if (!netPrice)
    throw new FacturXParseError(
      'MISSING',
      `${ctx.path}/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice`,
      'Prix net absent',
    );
  const grossPrice = child(agreement, 'GrossPriceProductTradePrice');
  const billed = requireChild(delivery, 'BilledQuantity');
  const basis = child(netPrice, 'BasisQuantity');
  const globalId = child(product, 'GlobalID');
  const globalIdValue = text(globalId);
  const period = child(settlement, 'BillingSpecifiedPeriod');
  const discount = child(child(grossPrice, 'AppliedTradeAllowanceCharge'), 'ActualAmount');

  return defined<Line>({
    id: textOf(doc, 'LineID') ?? '',
    note: textOf(child(doc, 'IncludedNote'), 'Content'),
    orderLineReference: textOf(child(agreement, 'BuyerOrderReferencedDocument'), 'LineID'),
    buyerAccountingReference: textOf(
      child(settlement, 'ReceivableSpecifiedTradeAccountingAccount'),
      'ID',
    ),
    period:
      period === undefined
        ? undefined
        : defined({ start: dateOf(period, 'StartDateTime'), end: dateOf(period, 'EndDateTime') }),
    name: textOf(product, 'Name') ?? '',
    description: textOf(product, 'Description'),
    sellerItemId: textOf(product, 'SellerAssignedID'),
    buyerItemId: textOf(product, 'BuyerAssignedID'),
    standardItemId:
      globalIdValue === undefined
        ? undefined
        : { value: globalIdValue, scheme: attr(globalId, 'schemeID') ?? '' },
    originCountry: textOf(child(product, 'OriginTradeCountry'), 'ID'),
    quantity: e4(billed) as Quantity,
    unitCode: attr(billed, 'unitCode') ?? '',
    unitPrice: e4(requireChild(netPrice, 'ChargeAmount')) as UnitPrice,
    grossUnitPrice:
      grossPrice === undefined
        ? undefined
        : (e4(requireChild(grossPrice, 'ChargeAmount')) as UnitPrice),
    priceDiscount: discount === undefined ? undefined : (e4(discount) as UnitPrice),
    baseQuantity: basis === undefined ? undefined : (e4(basis) as Quantity),
    baseQuantityUnitCode: attr(basis, 'unitCode'),
    ...lineAllowancesCharges(settlement),
    netAmount: requireAmount(
      requireChild(settlement, 'SpecifiedTradeSettlementLineMonetarySummation'),
      'LineTotalAmount',
    ),
    tax: taxInfo(
      child(settlement, 'ApplicableTradeTax'),
      `${settlement.path}/ram:ApplicableTradeTax`,
    ),
  });
}

// ---------- document ----------

function paymentMeans(ctx: Ctx): PaymentMeans {
  const creditor = child(ctx, 'PayeePartyCreditorFinancialAccount');
  const iban = textOf(creditor, 'IBANID') ?? textOf(creditor, 'ProprietaryID');
  const debitedIban = textOf(child(ctx, 'PayerPartyDebtorFinancialAccount'), 'IBANID');
  return defined<PaymentMeans>({
    typeCode: textOf(ctx, 'TypeCode') ?? '',
    text: textOf(ctx, 'Information'),
    creditTransfer:
      iban === undefined
        ? undefined
        : defined({
            iban,
            accountName: textOf(creditor, 'AccountName'),
            bic: textOf(child(ctx, 'PayeeSpecifiedCreditorFinancialInstitution'), 'BICID'),
          }),
    directDebit: debitedIban === undefined ? undefined : { debitedIban },
  });
}

/** Guideline (BT-24) et cadre (BT-23) d'un document CII, sans lire le reste — pour router une facture reçue. */
export function readCiiGuideline(
  xml: string | Uint8Array,
  options: Pick<FromCiiXmlOptions, 'limits'> = {},
): { guidelineId: string; businessProcessId?: string } {
  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xml, { maxBytes: resolveLimits(options.limits).xmlBytes });
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new FacturXParseError('MALFORMED', '', error.message, { cause: error });
    throw error;
  }
  if (rootNode.ns !== RSM || rootNode.local !== 'CrossIndustryInvoice') {
    throw new FacturXParseError(
      'NOT_CII',
      rootNode.name,
      'La racine doit être rsm:CrossIndustryInvoice (CII D16B)',
    );
  }
  const root: Ctx = { node: rootNode, path: 'rsm:CrossIndustryInvoice' };
  const context = requireChild(root, 'ExchangedDocumentContext', RSM);
  const guidelineId = textOf(
    requireChild(context, 'GuidelineSpecifiedDocumentContextParameter'),
    'ID',
  );
  if (guidelineId === undefined) {
    throw new FacturXParseError(
      'MISSING',
      `${context.path}/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`,
      'Identifiant de guideline (BT-24) absent',
    );
  }
  return defined({
    guidelineId,
    businessProcessId: textOf(
      child(context, 'BusinessProcessSpecifiedDocumentContextParameter'),
      'ID',
    ),
  });
}

/**
 * Lit un document CII (Factur-X, tout profil) en `Invoice`, sans validation.
 * Les éléments inconnus sont ignorés ; les éléments structurellement indispensables manquants lèvent `FacturXParseError`.
 */
export function parseCiiDocument(
  xml: string | Uint8Array,
  options: Pick<FromCiiXmlOptions, 'limits'> = {},
): ParsedCiiDocument {
  const limits = resolveLimits(options.limits);
  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xml, { maxBytes: limits.xmlBytes });
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new FacturXParseError('MALFORMED', '', error.message, { cause: error });
    throw error;
  }
  if (rootNode.ns !== RSM || rootNode.local !== 'CrossIndustryInvoice') {
    throw new FacturXParseError(
      'NOT_CII',
      rootNode.name,
      'La racine doit être rsm:CrossIndustryInvoice (CII D16B)',
    );
  }
  const root: Ctx = { node: rootNode, path: 'rsm:CrossIndustryInvoice' };

  const context = requireChild(root, 'ExchangedDocumentContext', RSM);
  const guidelineId = textOf(
    requireChild(context, 'GuidelineSpecifiedDocumentContextParameter'),
    'ID',
  );
  if (guidelineId === undefined) {
    throw new FacturXParseError(
      'MISSING',
      `${context.path}/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`,
      'Identifiant de guideline (BT-24) absent',
    );
  }
  const businessProcessId = textOf(
    child(context, 'BusinessProcessSpecifiedDocumentContextParameter'),
    'ID',
  );

  const document = requireChild(root, 'ExchangedDocument', RSM);
  const transaction = requireChild(root, 'SupplyChainTradeTransaction', RSM);
  const agreement = requireChild(transaction, 'ApplicableHeaderTradeAgreement');
  const delivery = child(transaction, 'ApplicableHeaderTradeDelivery');
  const settlement = requireChild(transaction, 'ApplicableHeaderTradeSettlement');

  // Références
  const additional = children(agreement, 'AdditionalReferencedDocument');
  // BG-24 : documents justificatifs (TypeCode 916)
  const attachments: Attachment[] = additional
    .filter((d) => textOf(d, 'TypeCode') === '916')
    .map((d) => {
      const binary = child(d, 'AttachmentBinaryObject');
      const raw = text(binary);
      let bytes: Uint8Array | undefined = binary === undefined ? undefined : new Uint8Array(0);
      if (binary && raw !== undefined) {
        const approx = Math.floor((raw.replace(/\s+/g, '').length * 3) / 4);
        if (approx > limits.attachmentBytes) {
          throw new FacturXParseError(
            'TOO_LARGE',
            binary.path,
            `Pièce jointe de ~${approx} octets au-delà de la limite \`attachmentBytes\` (${limits.attachmentBytes}).`,
          );
        }
        try {
          bytes = decodeBase64(raw);
        } catch (error) {
          throw new FacturXParseError('FORMAT', binary.path, 'Contenu base64 invalide (BT-125).', {
            cause: error,
          });
        }
      }
      return defined<Attachment>({
        id: textOf(d, 'IssuerAssignedID') ?? '',
        description: textOf(d, 'Name'),
        uri: textOf(d, 'URIID'),
        file:
          binary === undefined || bytes === undefined
            ? undefined
            : {
                filename: attr(binary, 'filename') ?? '',
                mimeType: (attr(binary, 'mimeCode') ?? '') as AttachmentMimeType,
                bytes,
              },
      });
    });
  const byType = (code: string) =>
    textOf(
      additional.find((d) => textOf(d, 'TypeCode') === code),
      'IssuerAssignedID',
    );
  const references = defined<DocumentReferences>({
    project: textOf(child(agreement, 'SpecifiedProcuringProject'), 'ID'),
    contract: textOf(child(agreement, 'ContractReferencedDocument'), 'IssuerAssignedID'),
    purchaseOrder: textOf(child(agreement, 'BuyerOrderReferencedDocument'), 'IssuerAssignedID'),
    salesOrder: textOf(child(agreement, 'SellerOrderReferencedDocument'), 'IssuerAssignedID'),
    receivingAdvice: textOf(
      child(delivery, 'ReceivingAdviceReferencedDocument'),
      'IssuerAssignedID',
    ),
    despatchAdvice: textOf(child(delivery, 'DespatchAdviceReferencedDocument'), 'IssuerAssignedID'),
    tenderOrLot: byType('50'),
    invoicedObject: byType('130'),
    buyerAccountingReference: textOf(
      child(settlement, 'ReceivableSpecifiedTradeAccountingAccount'),
      'ID',
    ),
    precedingInvoices: nonEmpty(
      children(settlement, 'InvoiceReferencedDocument').map((ref) =>
        defined<PrecedingInvoiceReference>({
          id: textOf(ref, 'IssuerAssignedID') ?? '',
          issueDate: dateOf(ref, 'FormattedIssueDateTime'),
        }),
      ),
    ),
  });

  // Livraison
  const shipTo = child(delivery, 'ShipToTradeParty');
  const period = child(settlement, 'BillingSpecifiedPeriod');
  const deliveryInfo = defined<Delivery>({
    date: dateOf(child(delivery, 'ActualDeliverySupplyChainEvent'), 'OccurrenceDateTime'),
    period:
      period === undefined
        ? undefined
        : defined({ start: dateOf(period, 'StartDateTime'), end: dateOf(period, 'EndDateTime') }),
    partyName: textOf(shipTo, 'Name'),
    locationId: textOf(shipTo, 'ID'),
    address: address(child(shipTo, 'PostalTradeAddress')),
  });

  // Ventilation TVA (+ BT-7 lue sur la première entrée qui la porte)
  const taxes = children(settlement, 'ApplicableTradeTax');
  const taxPointDate = taxes.map((t) => dateOf(t, 'TaxPointDate')).find((d) => d !== undefined);
  const vatOnDebits = taxes.some((t) => textOf(t, 'DueDateTypeCode') === '5');

  // Moyens de paiement + informations document-level (BT-83, BT-89, BT-90)
  const means = children(settlement, 'SpecifiedTradeSettlementPaymentMeans').map(paymentMeans);
  const terms = child(settlement, 'SpecifiedTradePaymentTerms');
  const remittance = textOf(settlement, 'PaymentReference');
  const mandate = textOf(terms, 'DirectDebitMandateID');
  const creditorId = textOf(settlement, 'CreditorReferenceID');
  if (means.length > 0) {
    const first = means[0] as PaymentMeans;
    if (mandate !== undefined || creditorId !== undefined) {
      const target =
        means.find(
          (m) => m.directDebit !== undefined || m.typeCode === '59' || m.typeCode === '49',
        ) ?? first;
      target.directDebit = defined({
        ...target.directDebit,
        mandateReference: mandate,
        creditorId,
      });
    }
  }

  // Totaux
  const summation = requireChild(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const totals = defined<Totals>({
    lineTotalAmount: requireAmount(summation, 'LineTotalAmount'),
    allowanceTotalAmount: amountOf(summation, 'AllowanceTotalAmount'),
    chargeTotalAmount: amountOf(summation, 'ChargeTotalAmount'),
    taxExclusiveAmount: requireAmount(summation, 'TaxBasisTotalAmount'),
    taxTotalAmount: requireAmount(summation, 'TaxTotalAmount'),
    taxInclusiveAmount: requireAmount(summation, 'GrandTotalAmount'),
    prepaidAmount: amountOf(summation, 'TotalPrepaidAmount'),
    roundingAmount: amountOf(summation, 'RoundingAmount'),
    amountDueForPayment: requireAmount(summation, 'DuePayableAmount'),
  });

  const payeeCtx = child(settlement, 'PayeeTradeParty');
  const payee =
    payeeCtx === undefined
      ? undefined
      : defined<Payee>({
          name: textOf(payeeCtx, 'Name') ?? '',
          id: textOf(payeeCtx, 'ID'),
          legalId: textOf(child(payeeCtx, 'SpecifiedLegalOrganization'), 'ID'),
          globalId: (() => {
            const g = child(payeeCtx, 'GlobalID');
            const v = text(g);
            return v === undefined
              ? undefined
              : defined<PartyIdentifier>({ value: v, scheme: attr(g, 'schemeID') });
          })(),
        });

  // Notes BG-1 : les notes légales PMD/PMT/AAB au format du SDK redeviennent des champs structurés
  const allNotes = children(document, 'IncludedNote').map((n) =>
    defined<InvoiceNote>({
      text: textOf(n, 'Content') ?? '',
      subjectCode: textOf(n, 'SubjectCode'),
    }),
  );
  const legal = parseLegalNotes(allNotes);
  const bar = parseProcessingNote(legal.remaining);
  const dueDate = dateOf(terms, 'DueDateDateTime');
  const termsText = textOf(terms, 'Description');
  const paymentTerms = defined<PaymentTerms>({ dueDate, ...legal.terms });
  // Le BT-20 généré par le SDK est régénéré à l'identique : on ne le conserve que s'il diffère
  if (
    termsText !== undefined &&
    (legal.terms === undefined || termsText !== buildPaymentTermsText(paymentTerms))
  ) {
    paymentTerms.text = termsText;
  }

  const invoice = defined<Invoice>({
    id: textOf(document, 'ID') ?? '',
    issueDate: dateOf(document, 'IssueDateTime') ?? ('' as IsoDate),
    typeCode: (textOf(document, 'TypeCode') ?? '') as InvoiceTypeCode,
    currency: textOf(settlement, 'InvoiceCurrencyCode') ?? '',
    taxPointDate,
    vatOnDebits: vatOnDebits ? true : undefined,
    operationCategory: operationCategoryFromBusinessProcess(businessProcessId),
    businessProcess: isBusinessProcessCode(businessProcessId) ? businessProcessId : undefined,
    buyerReference: textOf(agreement, 'BuyerReference'),
    remittanceInformation: remittance,
    processing: bar.processing,
    notes: nonEmpty(bar.remaining),
    attachments: nonEmpty(attachments),
    seller: party(requireChild(agreement, 'SellerTradeParty'), 'seller'),
    buyer: party(requireChild(agreement, 'BuyerTradeParty'), 'buyer'),
    payee,
    delivery: some(deliveryInfo) ? deliveryInfo : undefined,
    references: some(references) ? references : undefined,
    lines: children(transaction, 'IncludedSupplyChainTradeLineItem').map(line),
    ...documentAllowancesCharges(settlement),
    taxBreakdown: taxes.map(taxBreakdown),
    totals,
    paymentTerms,
    paymentMeans: nonEmpty(means),
  });

  return defined<ParsedCiiDocument>({ invoice, guidelineId, businessProcessId });
}

/**
 * Lit un XML CII Factur-X en `Invoice`. Par défaut, la facture est validée (EN 16931 + règles FR)
 * après lecture : `FacturXValidationError` sinon. `validate: false` pour lire un profil MINIMUM/BASIC tel quel.
 */
export function fromCiiXml(xml: string | Uint8Array, options: FromCiiXmlOptions = {}): Invoice {
  const { invoice } = parseCiiDocument(xml, options);
  return (options.validate ?? true) ? assertValidInvoice(invoice, options) : invoice;
}
