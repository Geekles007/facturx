import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cents,
  EN16931_GUIDELINE_ID,
  FacturXValidationError,
  type Invoice,
  toCiiTree,
  toCiiXml,
  XmlError,
} from '../src/index.js';
import { fullInvoice, multiRateInvoice, simpleInvoice } from './fixtures/invoices.js';

const golden = (name: string) =>
  readFileSync(new URL(`./golden/${name}.xml`, import.meta.url), 'utf8');

describe('golden files (pretty)', () => {
  it.each([
    ['simple', simpleInvoice],
    ['multi-rate', multiRateInvoice],
    ['full', fullInvoice],
  ])('%s.xml', (name, factory) => {
    expect(toCiiXml(factory(), { pretty: true })).toBe(golden(name));
  });
});

describe('toCiiXml', () => {
  it('produit une sortie compacte par défaut, avec déclaration et guideline EN 16931', () => {
    const xml = toCiiXml(simpleInvoice());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice ')).toBe(
      true,
    );
    expect(xml).not.toContain('\n');
    expect(xml).toContain(
      `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${EN16931_GUIDELINE_ID}</ram:ID>`,
    );
    expect(xml).not.toContain('BusinessProcessSpecifiedDocumentContextParameter');
  });

  it('émet BT-23 si demandé', () => {
    expect(toCiiXml(simpleInvoice(), { businessProcessId: 'A1' })).toContain(
      '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>A1</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>',
    );
  });

  it('respecte l’ordre XSD : lignes → agreement → delivery → settlement', () => {
    const xml = toCiiXml(multiRateInvoice());
    const idx = (s: string, from = 0) => xml.indexOf(s, from);
    const agreement = idx('<ram:ApplicableHeaderTradeAgreement>');
    const delivery = idx('<ram:ApplicableHeaderTradeDelivery');
    const settlement = idx('<ram:ApplicableHeaderTradeSettlement>');
    expect(idx('<ram:IncludedSupplyChainTradeLineItem>')).toBeLessThan(agreement);
    expect(agreement).toBeLessThan(delivery);
    expect(delivery).toBeLessThan(settlement);
    // à l'intérieur du règlement : moyens de paiement → ventilation TVA → remises/frais → conditions → totaux
    const means = idx('<ram:SpecifiedTradeSettlementPaymentMeans>', settlement);
    const tax = idx('<ram:ApplicableTradeTax>', settlement);
    const allowance = idx('<ram:SpecifiedTradeAllowanceCharge>', settlement);
    const terms = idx('<ram:SpecifiedTradePaymentTerms>', settlement);
    const summation = idx('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>', settlement);
    expect(means).toBeLessThan(tax);
    expect(tax).toBeLessThan(allowance);
    expect(allowance).toBeLessThan(terms);
    expect(terms).toBeLessThan(summation);
  });

  it('échappe les libellés et refuse les caractères interdits', () => {
    const invoice = fullInvoice();
    expect(toCiiXml(invoice)).toContain(
      '<ram:Name>Câbles &lt;2 mm&gt; &amp; "fixations"</ram:Name>',
    );
    invoice.lines[0]!.name = 'Injection </ram:Name><evil/>';
    expect(toCiiXml(invoice)).toContain(
      '<ram:Name>Injection &lt;/ram:Name&gt;&lt;evil/&gt;</ram:Name>',
    );
    invoice.lines[0]!.name = 'Nul \u0000 ';
    expect(() => toCiiXml(invoice)).toThrow(XmlError);
  });

  it('formate montants, taux, quantités et dates', () => {
    const xml = toCiiXml(fullInvoice());
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">250.00</ram:BilledQuantity>');
    expect(xml).toContain('<ram:BasisQuantity unitCode="C62">100.00</ram:BasisQuantity>');
    expect(xml).toContain('<ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>');
    expect(xml).toContain('<ram:CalculationPercent>6.67</ram:CalculationPercent>');
    expect(xml).toContain('<udt:DateTimeString format="102">20260911</udt:DateTimeString>');
    expect(xml).toContain(
      '<ram:TaxPointDate><udt:DateString format="102">20260910</udt:DateString></ram:TaxPointDate>',
    );
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">7.50</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:RoundingAmount>0.01</ram:RoundingAmount>');
    expect(xml).toContain('<ram:DuePayableAmount>445.01</ram:DuePayableAmount>');
  });

  it('émet la ventilation exonérée avec motif et code', () => {
    const xml = toCiiXml(fullInvoice());
    expect(xml).toContain(
      '<ram:ApplicableTradeTax><ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:ExemptionReason>Autoliquidation</ram:ExemptionReason><ram:BasisAmount>500.00</ram:BasisAmount><ram:CategoryCode>AE</ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>',
    );
  });

  it('utilise le texte BT-20 fourni, sinon le texte généré', () => {
    expect(toCiiXml(fullInvoice())).toContain('<ram:Description>Prélèvement SEPA à 30 jours.');
    expect(toCiiXml(simpleInvoice())).toContain(
      "<ram:Description>Paiement à réception, au plus tard le 2026-10-11. Pénalités de retard : 10,00 % l'an",
    );
  });

  it('valide avant de générer, sauf opt-out explicite', () => {
    const invoice: Invoice = simpleInvoice();
    invoice.totals.taxInclusiveAmount = cents(1);
    expect(() => toCiiXml(invoice)).toThrow(FacturXValidationError);
    expect(toCiiXml(invoice, { validate: false })).toContain(
      '<ram:GrandTotalAmount>0.01</ram:GrandTotalAmount>',
    );
  });

  it('est déterministe et ne modifie pas la facture', () => {
    const invoice = multiRateInvoice();
    const snapshot = JSON.stringify(invoice);
    expect(toCiiXml(invoice)).toBe(toCiiXml(invoice));
    expect(JSON.stringify(invoice)).toBe(snapshot);
  });

  it('expose l’arbre pour inspection', () => {
    const tree = toCiiTree(simpleInvoice());
    expect(tree.name).toBe('rsm:CrossIndustryInvoice');
    expect(tree.children.map((c) => (typeof c === 'string' ? c : c.name))).toEqual([
      'rsm:ExchangedDocumentContext',
      'rsm:ExchangedDocument',
      'rsm:SupplyChainTradeTransaction',
    ]);
  });
});
