import {
  type Cents,
  centsToString,
  type Quantity,
  type Rate,
  rateToString,
  toDecimalString,
  type UnitPrice,
} from '../money.js';
import { resolveNotes, resolvePaymentTermsText } from '../payment-terms.js';
import type { Address } from '../types/address.js';
import type { DocumentAllowance, DocumentCharge } from '../types/allowance.js';
import { BUSINESS_PROCESS_BY_CATEGORY, type IsoDate } from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import type { Line, LineAllowance, LineCharge } from '../types/line.js';
import type { Contact, Party } from '../types/party.js';
import type { PaymentMeans } from '../types/payment.js';
import type { TaxBreakdown, TaxInfo } from '../types/tax.js';
import { assertValidInvoice } from '../validate/index.js';
import { el, elA, serializeXml, type XmlChild, type XmlElement } from './node.js';

/** Espaces de noms CII D16B utilisés par Factur-X. */
export const CII_NAMESPACES = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const;

/** BT-24 — Identifiant de spécification du profil EN 16931. */
export const EN16931_GUIDELINE_ID = 'urn:cen.eu:en16931:2017';

export interface ToCiiXmlOptions {
  /** Valider avec `assertValidInvoice` avant de générer (défaut : `true`). `false` uniquement pour le debug. */
  validate?: boolean;
  /** Indenter la sortie (défaut : compact). */
  pretty?: boolean;
  /** BT-23 — Valeur brute forcée (prioritaire sur `invoice.businessProcess` et sur la déduction depuis `operationCategory`). Réservé aux cas hors liste BR-FR-08. */
  businessProcessId?: string;
}

// ---------- formatage ----------

const amount = (c: Cents): string => centsToString(c);
const pct = (r: Rate): string => rateToString(r);

/** Quantité / prix à 4 décimales, en supprimant les zéros finaux au-delà de 2 décimales (2.0000 → 2.00, 1.5000 → 1.50, 0.1234 → 0.1234). */
function e4(value: Quantity | UnitPrice): string {
  const s = toDecimalString(value, 4);
  return s.replace(/(\.\d\d)0+$/, '$1');
}

/** Date au format CII `102` : YYYYMMDD. */
function date102(date: IsoDate): string {
  return date.replaceAll('-', '');
}

const text = (name: string, value: string | undefined): XmlElement | undefined =>
  value === undefined ? undefined : el(name, value);

const dateTime = (name: string, date: IsoDate | undefined): XmlElement | undefined =>
  date === undefined
    ? undefined
    : el(name, elA('udt:DateTimeString', { format: '102' }, date102(date)));

const indicator = (value: boolean): XmlElement =>
  el('ram:ChargeIndicator', el('udt:Indicator', String(value)));

// ---------- parties ----------

function postalAddress(name: string, a: Address): XmlElement {
  return el(
    name,
    text('ram:PostcodeCode', a.postCode),
    text('ram:LineOne', a.line1),
    text('ram:LineTwo', a.line2),
    text('ram:LineThree', a.line3),
    text('ram:CityName', a.city),
    el('ram:CountryID', a.countryCode),
    text('ram:CountrySubDivisionName', a.countrySubdivision),
  );
}

function tradeContact(c: Contact): XmlElement {
  return el(
    'ram:DefinedTradeContact',
    text('ram:PersonName', c.name),
    c.phone === undefined
      ? undefined
      : el('ram:TelephoneUniversalCommunication', el('ram:CompleteNumber', c.phone)),
    c.email === undefined
      ? undefined
      : el('ram:EmailURIUniversalCommunication', el('ram:URIID', c.email)),
  );
}

/** BG-4 / BG-7 — ordre XSD : GlobalID, Name, Description, SpecifiedLegalOrganization, DefinedTradeContact, PostalTradeAddress, URIUniversalCommunication, SpecifiedTaxRegistration. */
function tradeParty(name: string, p: Party, role: 'seller' | 'buyer'): XmlElement {
  return el(
    name,
    p.routingCode === undefined ? undefined : elA('ram:ID', { schemeID: '0224' }, p.routingCode),
    p.siret === undefined ? undefined : elA('ram:GlobalID', { schemeID: '0009' }, p.siret),
    el('ram:Name', p.name),
    role === 'seller' ? text('ram:Description', p.legalInfo) : undefined,
    p.siren === undefined && p.tradingName === undefined
      ? undefined
      : el(
          'ram:SpecifiedLegalOrganization',
          p.siren === undefined ? undefined : elA('ram:ID', { schemeID: '0002' }, p.siren),
          text('ram:TradingBusinessName', p.tradingName),
        ),
    p.contact === undefined ? undefined : tradeContact(p.contact),
    postalAddress('ram:PostalTradeAddress', p.address),
    p.electronicAddress === undefined
      ? undefined
      : el(
          'ram:URIUniversalCommunication',
          elA('ram:URIID', { schemeID: p.electronicAddress.scheme }, p.electronicAddress.value),
        ),
    p.vatId === undefined
      ? undefined
      : el('ram:SpecifiedTaxRegistration', elA('ram:ID', { schemeID: 'VA' }, p.vatId)),
    role === 'seller' && p.taxRegistrationId !== undefined
      ? el('ram:SpecifiedTaxRegistration', elA('ram:ID', { schemeID: 'FC' }, p.taxRegistrationId))
      : undefined,
  );
}

// ---------- TVA, remises, frais ----------

function lineTradeTax(tax: TaxInfo): XmlElement {
  return el(
    'ram:ApplicableTradeTax',
    el('ram:TypeCode', 'VAT'),
    el('ram:CategoryCode', tax.category),
    tax.rate === undefined ? undefined : el('ram:RateApplicablePercent', pct(tax.rate)),
  );
}

/** BG-27/28 et BG-20/21 — ordre XSD : ChargeIndicator, CalculationPercent, BasisAmount, ActualAmount, ReasonCode, Reason, CategoryTradeTax. */
function allowanceCharge(
  isCharge: boolean,
  ac: LineAllowance | LineCharge | DocumentAllowance | DocumentCharge,
  tax?: TaxInfo,
): XmlElement {
  return el(
    'ram:SpecifiedTradeAllowanceCharge',
    indicator(isCharge),
    ac.percentage === undefined ? undefined : el('ram:CalculationPercent', pct(ac.percentage)),
    ac.baseAmount === undefined ? undefined : el('ram:BasisAmount', amount(ac.baseAmount)),
    el('ram:ActualAmount', amount(ac.amount)),
    text('ram:ReasonCode', ac.reasonCode),
    text('ram:Reason', ac.reason),
    tax === undefined
      ? undefined
      : el(
          'ram:CategoryTradeTax',
          el('ram:TypeCode', 'VAT'),
          el('ram:CategoryCode', tax.category),
          tax.rate === undefined ? undefined : el('ram:RateApplicablePercent', pct(tax.rate)),
        ),
  );
}

/** BG-23 — ordre XSD : CalculatedAmount, TypeCode, ExemptionReason, BasisAmount, CategoryCode, ExemptionReasonCode, TaxPointDate, RateApplicablePercent. */
function headerTradeTax(
  tb: TaxBreakdown,
  taxPointDate: IsoDate | undefined,
  vatOnDebits: boolean,
): XmlElement {
  return el(
    'ram:ApplicableTradeTax',
    el('ram:CalculatedAmount', amount(tb.taxAmount)),
    el('ram:TypeCode', 'VAT'),
    text('ram:ExemptionReason', tb.exemptionReason),
    el('ram:BasisAmount', amount(tb.taxableAmount)),
    el('ram:CategoryCode', tb.category),
    text('ram:ExemptionReasonCode', tb.exemptionReasonCode),
    taxPointDate === undefined
      ? undefined
      : el('ram:TaxPointDate', elA('udt:DateString', { format: '102' }, date102(taxPointDate))),
    vatOnDebits ? el('ram:DueDateTypeCode', '5') : undefined,
    tb.rate === undefined ? undefined : el('ram:RateApplicablePercent', pct(tb.rate)),
  );
}

// ---------- lignes ----------

function tradePrice(name: string, price: UnitPrice, line: Line, discount?: UnitPrice): XmlElement {
  return el(
    name,
    el('ram:ChargeAmount', e4(price)),
    line.baseQuantity === undefined
      ? undefined
      : elA(
          'ram:BasisQuantity',
          { unitCode: line.baseQuantityUnitCode ?? line.unitCode },
          e4(line.baseQuantity),
        ),
    discount === undefined
      ? undefined
      : el(
          'ram:AppliedTradeAllowanceCharge',
          indicator(false),
          el('ram:ActualAmount', e4(discount)),
        ),
  );
}

/** BG-25 — ordre XSD : AssociatedDocumentLineDocument, SpecifiedTradeProduct, SpecifiedLineTradeAgreement, SpecifiedLineTradeDelivery, SpecifiedLineTradeSettlement. */
function lineItem(line: Line): XmlElement {
  return el(
    'ram:IncludedSupplyChainTradeLineItem',
    el(
      'ram:AssociatedDocumentLineDocument',
      el('ram:LineID', line.id),
      line.note === undefined ? undefined : el('ram:IncludedNote', el('ram:Content', line.note)),
    ),
    el(
      'ram:SpecifiedTradeProduct',
      line.standardItemId === undefined
        ? undefined
        : elA('ram:GlobalID', { schemeID: line.standardItemId.scheme }, line.standardItemId.value),
      text('ram:SellerAssignedID', line.sellerItemId),
      text('ram:BuyerAssignedID', line.buyerItemId),
      el('ram:Name', line.name),
      text('ram:Description', line.description),
      line.originCountry === undefined
        ? undefined
        : el('ram:OriginTradeCountry', el('ram:ID', line.originCountry)),
    ),
    el(
      'ram:SpecifiedLineTradeAgreement',
      line.orderLineReference === undefined
        ? undefined
        : el('ram:BuyerOrderReferencedDocument', el('ram:LineID', line.orderLineReference)),
      line.grossUnitPrice === undefined
        ? undefined
        : tradePrice(
            'ram:GrossPriceProductTradePrice',
            line.grossUnitPrice,
            line,
            line.priceDiscount,
          ),
      tradePrice('ram:NetPriceProductTradePrice', line.unitPrice, line),
    ),
    el(
      'ram:SpecifiedLineTradeDelivery',
      elA('ram:BilledQuantity', { unitCode: line.unitCode }, e4(line.quantity)),
    ),
    el(
      'ram:SpecifiedLineTradeSettlement',
      lineTradeTax(line.tax),
      line.period === undefined
        ? undefined
        : el(
            'ram:BillingSpecifiedPeriod',
            dateTime('ram:StartDateTime', line.period.start),
            dateTime('ram:EndDateTime', line.period.end),
          ),
      (line.allowances ?? []).map((a) => allowanceCharge(false, a)),
      (line.charges ?? []).map((c) => allowanceCharge(true, c)),
      el(
        'ram:SpecifiedTradeSettlementLineMonetarySummation',
        el('ram:LineTotalAmount', amount(line.netAmount)),
      ),
      line.buyerAccountingReference === undefined
        ? undefined
        : el(
            'ram:ReceivableSpecifiedTradeAccountingAccount',
            el('ram:ID', line.buyerAccountingReference),
          ),
    ),
  );
}

// ---------- paiement ----------

/** BG-16 — ordre XSD : TypeCode, Information, PayerPartyDebtorFinancialAccount, PayeePartyCreditorFinancialAccount, PayeeSpecifiedCreditorFinancialInstitution. */
function paymentMeans(pm: PaymentMeans): XmlElement {
  return el(
    'ram:SpecifiedTradeSettlementPaymentMeans',
    el('ram:TypeCode', pm.typeCode),
    text('ram:Information', pm.text),
    pm.directDebit?.debitedIban === undefined
      ? undefined
      : el('ram:PayerPartyDebtorFinancialAccount', el('ram:IBANID', pm.directDebit.debitedIban)),
    pm.creditTransfer === undefined
      ? undefined
      : el(
          'ram:PayeePartyCreditorFinancialAccount',
          el('ram:IBANID', pm.creditTransfer.iban),
          text('ram:AccountName', pm.creditTransfer.accountName),
        ),
    pm.creditTransfer?.bic === undefined
      ? undefined
      : el(
          'ram:PayeeSpecifiedCreditorFinancialInstitution',
          el('ram:BICID', pm.creditTransfer.bic),
        ),
  );
}

// ---------- document ----------

/** BT-20 / BT-9 / BT-89 — omis entièrement si aucune information. */
function paymentTermsElement(
  invoice: Invoice,
  mandateReference: string | undefined,
): XmlElement | undefined {
  const description = resolvePaymentTermsText(invoice.paymentTerms);
  if (
    description === undefined &&
    invoice.paymentTerms.dueDate === undefined &&
    mandateReference === undefined
  )
    return undefined;
  return el(
    'ram:SpecifiedTradePaymentTerms',
    text('ram:Description', description),
    dateTime('ram:DueDateDateTime', invoice.paymentTerms.dueDate),
    text('ram:DirectDebitMandateID', mandateReference),
  );
}

function referencedDocument(name: string, id: string | undefined): XmlElement | undefined {
  return id === undefined ? undefined : el(name, el('ram:IssuerAssignedID', id));
}

/**
 * Construit l'arbre CII (D16B, profil EN 16931) d'une facture, dans l'ordre imposé par le XSD.
 * Ne valide pas : voir `toCiiXml`.
 */
export function toCiiTree(
  invoice: Invoice,
  options: Pick<ToCiiXmlOptions, 'businessProcessId'> = {},
): XmlElement {
  const refs = invoice.references ?? {};
  const directDebit = invoice.paymentMeans?.find((pm) => pm.directDebit !== undefined)?.directDebit;
  const remittance = invoice.paymentMeans?.find(
    (pm) => pm.remittanceInformation !== undefined,
  )?.remittanceInformation;
  const totals = invoice.totals;
  // BT-23 : option explicite, sinon cadre de facturation du modèle, sinon déduit de la nature de l'opération (B1 / S1 / M1)
  const businessProcessId =
    options.businessProcessId ??
    invoice.businessProcess ??
    (invoice.operationCategory === undefined
      ? undefined
      : BUSINESS_PROCESS_BY_CATEGORY[invoice.operationCategory]);

  const context = el(
    'rsm:ExchangedDocumentContext',
    businessProcessId === undefined
      ? undefined
      : el('ram:BusinessProcessSpecifiedDocumentContextParameter', el('ram:ID', businessProcessId)),
    el('ram:GuidelineSpecifiedDocumentContextParameter', el('ram:ID', EN16931_GUIDELINE_ID)),
  );

  const document = el(
    'rsm:ExchangedDocument',
    el('ram:ID', invoice.id),
    el('ram:TypeCode', invoice.typeCode),
    dateTime('ram:IssueDateTime', invoice.issueDate),
    // BG-1 : notes fournies + notes légales PMD/PMT/AAB générées depuis paymentTerms (BR-FR-05)
    resolveNotes(invoice).map((n) =>
      el('ram:IncludedNote', el('ram:Content', n.text), text('ram:SubjectCode', n.subjectCode)),
    ),
  );

  const agreement = el(
    'ram:ApplicableHeaderTradeAgreement',
    text('ram:BuyerReference', invoice.buyerReference),
    tradeParty('ram:SellerTradeParty', invoice.seller, 'seller'),
    tradeParty('ram:BuyerTradeParty', invoice.buyer, 'buyer'),
    referencedDocument('ram:SellerOrderReferencedDocument', refs.salesOrder),
    referencedDocument('ram:BuyerOrderReferencedDocument', refs.purchaseOrder),
    referencedDocument('ram:ContractReferencedDocument', refs.contract),
    refs.tenderOrLot === undefined
      ? undefined
      : el(
          'ram:AdditionalReferencedDocument',
          el('ram:IssuerAssignedID', refs.tenderOrLot),
          el('ram:TypeCode', '50'),
        ),
    refs.invoicedObject === undefined
      ? undefined
      : el(
          'ram:AdditionalReferencedDocument',
          el('ram:IssuerAssignedID', refs.invoicedObject),
          el('ram:TypeCode', '130'),
        ),
    refs.project === undefined
      ? undefined
      : el(
          'ram:SpecifiedProcuringProject',
          el('ram:ID', refs.project),
          el('ram:Name', refs.project),
        ),
  );

  const d = invoice.delivery;
  const delivery = el(
    'ram:ApplicableHeaderTradeDelivery',
    d?.partyName === undefined && d?.locationId === undefined && d?.address === undefined
      ? undefined
      : el(
          'ram:ShipToTradeParty',
          text('ram:ID', d.locationId),
          text('ram:Name', d.partyName),
          d.address === undefined ? undefined : postalAddress('ram:PostalTradeAddress', d.address),
        ),
    d?.date === undefined
      ? undefined
      : el('ram:ActualDeliverySupplyChainEvent', dateTime('ram:OccurrenceDateTime', d.date)),
    referencedDocument('ram:DespatchAdviceReferencedDocument', refs.despatchAdvice),
    referencedDocument('ram:ReceivingAdviceReferencedDocument', refs.receivingAdvice),
  );

  const settlement = el(
    'ram:ApplicableHeaderTradeSettlement',
    text('ram:CreditorReferenceID', directDebit?.creditorId),
    text('ram:PaymentReference', remittance),
    el('ram:InvoiceCurrencyCode', invoice.currency),
    invoice.payee === undefined
      ? undefined
      : el(
          'ram:PayeeTradeParty',
          text('ram:ID', invoice.payee.id),
          el('ram:Name', invoice.payee.name),
          invoice.payee.legalId === undefined
            ? undefined
            : el(
                'ram:SpecifiedLegalOrganization',
                elA('ram:ID', { schemeID: '0002' }, invoice.payee.legalId),
              ),
        ),
    (invoice.paymentMeans ?? []).map(paymentMeans),
    invoice.taxBreakdown.map((tb) =>
      headerTradeTax(tb, invoice.taxPointDate, invoice.vatOnDebits === true),
    ),
    d?.period === undefined
      ? undefined
      : el(
          'ram:BillingSpecifiedPeriod',
          dateTime('ram:StartDateTime', d.period.start),
          dateTime('ram:EndDateTime', d.period.end),
        ),
    (invoice.allowances ?? []).map((a) => allowanceCharge(false, a, a.tax)),
    (invoice.charges ?? []).map((c) => allowanceCharge(true, c, c.tax)),
    paymentTermsElement(invoice, directDebit?.mandateReference),
    el(
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation',
      el('ram:LineTotalAmount', amount(totals.lineTotalAmount)),
      totals.chargeTotalAmount === undefined
        ? undefined
        : el('ram:ChargeTotalAmount', amount(totals.chargeTotalAmount)),
      totals.allowanceTotalAmount === undefined
        ? undefined
        : el('ram:AllowanceTotalAmount', amount(totals.allowanceTotalAmount)),
      el('ram:TaxBasisTotalAmount', amount(totals.taxExclusiveAmount)),
      elA('ram:TaxTotalAmount', { currencyID: invoice.currency }, amount(totals.taxTotalAmount)),
      totals.roundingAmount === undefined
        ? undefined
        : el('ram:RoundingAmount', amount(totals.roundingAmount)),
      el('ram:GrandTotalAmount', amount(totals.taxInclusiveAmount)),
      totals.prepaidAmount === undefined
        ? undefined
        : el('ram:TotalPrepaidAmount', amount(totals.prepaidAmount)),
      el('ram:DuePayableAmount', amount(totals.amountDueForPayment)),
    ),
    (refs.precedingInvoices ?? []).map((ref) =>
      el(
        'ram:InvoiceReferencedDocument',
        el('ram:IssuerAssignedID', ref.id),
        ref.issueDate === undefined
          ? undefined
          : el(
              'ram:FormattedIssueDateTime',
              elA('qdt:DateTimeString', { format: '102' }, date102(ref.issueDate)),
            ),
      ),
    ),
    refs.buyerAccountingReference === undefined
      ? undefined
      : el(
          'ram:ReceivableSpecifiedTradeAccountingAccount',
          el('ram:ID', refs.buyerAccountingReference),
        ),
  );

  const transaction: XmlChild[] = [invoice.lines.map(lineItem), agreement, delivery, settlement];

  return elA(
    'rsm:CrossIndustryInvoice',
    {
      'xmlns:rsm': CII_NAMESPACES.rsm,
      'xmlns:qdt': CII_NAMESPACES.qdt,
      'xmlns:ram': CII_NAMESPACES.ram,
      'xmlns:udt': CII_NAMESPACES.udt,
    },
    context,
    document,
    el('rsm:SupplyChainTradeTransaction', transaction),
  );
}

/**
 * Génère le XML CII (Factur-X, profil EN 16931) d'une facture.
 * Par défaut, la facture est validée avant génération (`FacturXValidationError` sinon) :
 * un XML n'est jamais produit à partir de montants incohérents sans opt-out explicite.
 */
export function toCiiXml(invoice: Invoice, options: ToCiiXmlOptions = {}): string {
  if (options.validate ?? true) assertValidInvoice(invoice);
  const tree = toCiiTree(invoice, options);
  return serializeXml(tree, { pretty: options.pretty ?? false });
}
