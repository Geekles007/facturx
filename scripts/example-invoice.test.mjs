import { toCiiXml, validateInvoice } from 'facturx-sdk';
import { extractFacturX, extractInvoice } from 'facturx-sdk/pdf';
import { describe, expect, it } from 'vitest';
import {
  BROKEN_DEFECTS,
  brokenInvoice,
  buildBrokenFacturX,
  buildExampleFacturX,
  exampleInvoice,
} from './example-invoice.mjs';

/**
 * La facture d'exemple est publiée sur le site et téléchargée par des inconnus : elle doit rester
 * irréprochable. La conformité PDF/A-3b est couverte par packages/facturx/test/pdfa.test.ts.
 */
describe('facture d’exemple', () => {
  it('ne présente aucune anomalie de validation', () => {
    const result = validateInvoice(exampleInvoice());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('porte les mentions françaises et le cadre de facturation attendus', () => {
    const invoice = exampleInvoice();
    expect(invoice.buyer.electronicAddress).toEqual({ value: '732829320', scheme: '0225' });
    expect(invoice.totals.taxInclusiveAmount).toBe(518400);
    const xml = toCiiXml(invoice);
    expect(xml).toContain('<ram:ID>S1</ram:ID>'); // prestation de services
    expect(xml).toContain('<ram:SubjectCode>PMD</ram:SubjectCode>'); // pénalités de retard
    expect(xml).toContain('<ram:SubjectCode>AAB</ram:SubjectCode>'); // escompte
  });

  it('produit un PDF relisible, dont le XML redonne la même facture', async () => {
    const pdf = await buildExampleFacturX();
    expect(pdf.length).toBeGreaterThan(10_000);
    const read = await extractInvoice(pdf);
    expect(read?.filename).toBe('factur-x.xml');
    expect(read?.conformanceLevel).toBe('EN 16931');
    expect(read?.invoice.id).toBe('FA-2026-0042');
    expect(read?.invoice.totals).toEqual(exampleInvoice().totals);
  }, 60_000);

  it('est déterministe : deux constructions donnent le même fichier', async () => {
    const [a, b] = await Promise.all([buildExampleFacturX(), buildExampleFacturX()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  }, 60_000);
});

describe('facture d’exemple non conforme', () => {
  it('porte exactement les défauts annoncés sur le document', () => {
    const issues = validateInvoice(brokenInvoice()).issues;
    const codes = [...new Set(issues.map((i) => i.code))].sort();
    expect(codes).toEqual(['BR-CO-15', 'BR-FR-05', 'BR-FR-11', 'BR-FR-12']);
    // Chaque code annoncé au lecteur du PDF doit être réellement relevé.
    for (const code of codes) {
      expect(BROKEN_DEFECTS.join(' ')).toContain(code);
    }
    expect(BROKEN_DEFECTS).toHaveLength(4);
  });

  it('reste un PDF lisible : le défaut est dans la facture, pas dans le fichier', async () => {
    const pdf = await buildBrokenFacturX();
    const read = await extractFacturX(pdf);
    expect(read?.filename).toBe('factur-x.xml');
    expect(read?.xml).toContain('<ram:ID>FA-2026-0043</ram:ID>');
    expect(read?.xml).toContain('<ram:GrandTotalAmount>5100.00</ram:GrandTotalAmount>');
  }, 60_000);
});
