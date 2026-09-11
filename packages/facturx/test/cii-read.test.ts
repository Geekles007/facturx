import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PROCESS_BY_CATEGORY,
  FacturXParseError,
  FacturXValidationError,
  fromCiiXml,
  type Invoice,
  parseCiiDocument,
  resolvePaymentTermsText,
  toCiiXml,
} from '../src/index.js';
import { fullInvoice, multiRateInvoice, simpleInvoice } from './fixtures/invoices.js';

/** Forme attendue après un aller-retour : identique, plus le cadre de facturation BT-23 relu. */
function roundTripExpectation(invoice: Invoice): Invoice {
  const businessProcess =
    invoice.businessProcess ??
    (invoice.operationCategory === undefined
      ? undefined
      : BUSINESS_PROCESS_BY_CATEGORY[invoice.operationCategory]);
  return businessProcess === undefined ? invoice : { ...invoice, businessProcess };
}

describe('aller-retour toCiiXml → fromCiiXml', () => {
  it.each([
    ['simple', simpleInvoice],
    ['multi-rate', multiRateInvoice],
    ['full', fullInvoice],
  ])('%s : fromCiiXml(toCiiXml(x)) ≡ x', (_name, factory) => {
    const invoice = factory();
    const parsed = fromCiiXml(toCiiXml(invoice));
    expect(parsed).toEqual(roundTripExpectation(invoice));
  });

  it('lit les golden files et renvoie la guideline', () => {
    for (const name of ['simple', 'multi-rate', 'full']) {
      const xml = readFileSync(new URL(`./golden/${name}.xml`, import.meta.url), 'utf8');
      const { invoice, guidelineId, businessProcessId } = parseCiiDocument(xml);
      expect(guidelineId).toBe('urn:cen.eu:en16931:2017');
      expect(businessProcessId).toMatch(/^[SM]1$/);
      expect(invoice.lines.length).toBeGreaterThan(0);
    }
    expect(
      parseCiiDocument(toCiiXml(simpleInvoice(), { businessProcessId: 'A1' })).businessProcessId,
    ).toBe('A1');
  });

  it('est stable : re-générer depuis le résultat donne le même XML', () => {
    const xml = toCiiXml(fullInvoice());
    expect(toCiiXml(fromCiiXml(xml))).toBe(xml);
  });
});

describe('fromCiiXml — XML étrangers', () => {
  const foreign = `<?xml version="1.0" encoding="UTF-8"?>
<n1:CrossIndustryInvoice xmlns:n1="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:u="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <n1:ExchangedDocumentContext>
    <GuidelineSpecifiedDocumentContextParameter><ID>urn:factur-x.eu:1p0:minimum</ID></GuidelineSpecifiedDocumentContextParameter>
  </n1:ExchangedDocumentContext>
  <n1:ExchangedDocument>
    <ID>MIN-1</ID><TypeCode>380</TypeCode>
    <IssueDateTime><u:DateTimeString format="102">20260911</u:DateTimeString></IssueDateTime>
    <UnknownElement>ignored</UnknownElement>
  </n1:ExchangedDocument>
  <n1:SupplyChainTradeTransaction>
    <ApplicableHeaderTradeAgreement>
      <SellerTradeParty><Name>Vendeur</Name><SpecifiedLegalOrganization><ID schemeID="0002">443061841</ID></SpecifiedLegalOrganization>
        <PostalTradeAddress><CountryID>FR</CountryID></PostalTradeAddress>
        <SpecifiedTaxRegistration><ID schemeID="VA">FR64443061841</ID></SpecifiedTaxRegistration></SellerTradeParty>
      <BuyerTradeParty><Name>Acheteur</Name></BuyerTradeParty>
    </ApplicableHeaderTradeAgreement>
    <ApplicableHeaderTradeDelivery/>
    <ApplicableHeaderTradeSettlement>
      <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
      <SpecifiedTradeSettlementHeaderMonetarySummation>
        <TaxBasisTotalAmount>100.00</TaxBasisTotalAmount><TaxTotalAmount currencyID="EUR">20.00</TaxTotalAmount>
        <GrandTotalAmount>120.00</GrandTotalAmount><DuePayableAmount>120.00</DuePayableAmount>
        <LineTotalAmount>100.00</LineTotalAmount>
      </SpecifiedTradeSettlementHeaderMonetarySummation>
    </ApplicableHeaderTradeSettlement>
  </n1:SupplyChainTradeTransaction>
</n1:CrossIndustryInvoice>`;

  it('lit un profil MINIMUM à préfixes différents sans validation, et le refuse avec validation', () => {
    const { invoice, guidelineId } = parseCiiDocument(foreign);
    expect(guidelineId).toBe('urn:factur-x.eu:1p0:minimum');
    expect(invoice.id).toBe('MIN-1');
    expect(invoice.seller.siren).toBe('443061841');
    expect(invoice.seller.vatId).toBe('FR64443061841');
    expect(invoice.buyer.address.countryCode).toBe('');
    expect(invoice.lines).toEqual([]);
    expect(invoice.totals.taxInclusiveAmount).toBe(12000);
    expect(invoice.paymentTerms).toEqual({});
    expect(fromCiiXml(foreign, { validate: false }).id).toBe('MIN-1');
    let caught: unknown;
    try {
      fromCiiXml(foreign);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FacturXValidationError);
    expect((caught as FacturXValidationError).issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['BR-16', 'BR-11', 'BR-CO-18']),
    );
  });

  it('signale les erreurs de structure et de format avec le chemin CII', () => {
    const expectError = (xml: string, code: string, path: string | RegExp) => {
      let caught: unknown;
      try {
        parseCiiDocument(xml);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(FacturXParseError);
      expect((caught as FacturXParseError).code).toBe(code);
      if (typeof path === 'string') expect((caught as FacturXParseError).path).toBe(path);
      else expect((caught as FacturXParseError).path).toMatch(path);
    };
    expectError('<a/>', 'NOT_CII', 'a');
    expectError('<a', 'MALFORMED', '');
    expectError(
      foreign.replace('<LineTotalAmount>100.00</LineTotalAmount>', ''),
      'MISSING',
      /SpecifiedTradeSettlementHeaderMonetarySummation\/ram:LineTotalAmount$/,
    );
    expectError(
      foreign.replace(
        '<GrandTotalAmount>120.00</GrandTotalAmount>',
        '<GrandTotalAmount>120.005</GrandTotalAmount>',
      ),
      'FORMAT',
      /ram:GrandTotalAmount$/,
    );
    expectError(
      foreign.replace('format="102">20260911', 'format="102">20261311'),
      'FORMAT',
      /ram:IssueDateTime\/udt:DateTimeString$/,
    );
    expectError(foreign.replace('format="102"', 'format="610"'), 'FORMAT', /udt:DateTimeString$/);
    expectError(
      foreign.replace(
        '<GuidelineSpecifiedDocumentContextParameter><ID>urn:factur-x.eu:1p0:minimum</ID></GuidelineSpecifiedDocumentContextParameter>',
        '',
      ),
      'MISSING',
      /GuidelineSpecifiedDocumentContextParameter/,
    );
  });

  it('refuse une décimale de trop sur une ligne, avec l’index de la ligne', () => {
    const xml = toCiiXml(multiRateInvoice(), { pretty: true }).replace(
      '<ram:LineTotalAmount>30.00</ram:LineTotalAmount>',
      '<ram:LineTotalAmount>30.001</ram:LineTotalAmount>',
    );
    let caught: unknown;
    try {
      fromCiiXml(xml);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FacturXParseError);
    expect((caught as FacturXParseError).path).toBe(
      'rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[2]/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount',
    );
  });

  it('valide après lecture : un total incohérent dans le XML est signalé, jamais corrigé', () => {
    const xml = toCiiXml(simpleInvoice()).replace(
      '<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>240.01</ram:GrandTotalAmount>',
    );
    expect(() => fromCiiXml(xml)).toThrow(FacturXValidationError);
    expect(fromCiiXml(xml, { validate: false }).totals.taxInclusiveAmount).toBe(24001);
  });
});

describe('réforme : lecture de BT-23, BT-8 et des avoirs', () => {
  it('déduit la nature de l’opération de tout cadre B*/S*/M*, et l’option débits de BT-8', () => {
    const xml = toCiiXml(simpleInvoice(), { businessProcessId: 'B2' });
    const parsed = parseCiiDocument(xml);
    expect(parsed.businessProcessId).toBe('B2');
    expect(parsed.invoice.operationCategory).toBe('goods');
    expect(parsed.invoice.vatOnDebits).toBeUndefined();

    const debits = fromCiiXml(toCiiXml(multiRateInvoice()));
    expect(debits.vatOnDebits).toBe(true);
    expect(debits.operationCategory).toBe('mixed');

    const unknown = parseCiiDocument(toCiiXml(simpleInvoice(), { businessProcessId: 'A1' }));
    expect(unknown.invoice.operationCategory).toBeUndefined();
  });

  it('lit un avoir 381 et le valide', () => {
    const creditNote: Invoice = { ...simpleInvoice(), typeCode: '381' };
    const parsed = fromCiiXml(toCiiXml(creditNote));
    expect(parsed.typeCode).toBe('381');
  });
});

describe('notes légales à la lecture', () => {
  it('reconstitue les champs structurés depuis les notes au format du SDK et retire le BT-20 régénérable', () => {
    const parsed = fromCiiXml(toCiiXml(simpleInvoice()));
    expect(parsed.notes).toBeUndefined();
    expect(parsed.paymentTerms).toEqual(simpleInvoice().paymentTerms);
  });

  it('conserve des notes légales étrangères telles quelles, sans champs structurés', () => {
    const invoice = simpleInvoice();
    invoice.paymentTerms = { dueDate: '2026-10-11', text: 'Conditions maison.' };
    invoice.notes = [
      { text: 'Pénalités de retard : taux BCE + 10 points.', subjectCode: 'PMD' },
      { text: 'Indemnité forfaitaire de recouvrement : 40 euros.', subjectCode: 'PMT' },
      { text: 'Aucun escompte.', subjectCode: 'AAB' },
    ];
    const parsed = fromCiiXml(toCiiXml(invoice));
    expect(parsed.notes).toEqual(invoice.notes);
    expect(parsed.paymentTerms).toEqual({ dueDate: '2026-10-11', text: 'Conditions maison.' });
  });

  it('lit le cadre de facturation en businessProcess', () => {
    expect(
      fromCiiXml(toCiiXml({ ...simpleInvoice(), businessProcess: 'S2' })).businessProcess,
    ).toBe('S2');
  });
});
