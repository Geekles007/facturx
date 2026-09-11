import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  FacturXParseError,
  fromCiiXml,
  parseXml,
  readCiiGuideline,
  toCiiXml,
  validateInvoice,
  XmlParseError,
} from '../src/index.js';
import { embedFacturX, extractFacturX, extractInvoice, FacturXPdfError } from '../src/pdf/index.js';
import { fullInvoice, simpleInvoice } from './fixtures/invoices.js';

describe('limites de taille', () => {
  it('valeurs par défaut alignées sur BR-FR-19', () => {
    expect(DEFAULT_LIMITS).toEqual({
      xmlBytes: 64 * 1024 * 1024,
      attachmentBytes: 20 * 1024 * 1024,
      attachmentsTotalBytes: 100_000_000,
      pdfBytes: 100 * 1024 * 1024,
    });
  });

  it('XML : refus typé avant lecture, en chaîne comme en octets', () => {
    const xml = toCiiXml(simpleInvoice());
    expect(() => parseXml(xml, { maxBytes: 100 })).toThrow(XmlParseError);
    expect(() => parseXml(new TextEncoder().encode(xml), { maxBytes: 100 })).toThrow(
      /trop volumineux/,
    );
    expect(() => fromCiiXml(xml, { limits: { xmlBytes: 100 } })).toThrow(FacturXParseError);
    expect(() => readCiiGuideline(xml, { limits: { xmlBytes: 100 } })).toThrow(/volumineux/);
    expect(fromCiiXml(xml, { limits: { xmlBytes: xml.length * 3 } }).id).toBe('F-2026-0001');
    expect(() => parseXml('<a>ééé</a>', { maxBytes: 12 })).toThrow(XmlParseError); // 13 octets UTF-8
    expect(parseXml('<a>ééé</a>', { maxBytes: 13 }).text).toBe('ééé');
  });

  it('pièces jointes : BR-FR-19 à la validation, TOO_LARGE à la lecture', () => {
    const invoice = fullInvoice(); // pièce CSV de 20 octets
    const codes = (limits: Parameters<typeof validateInvoice>[1]) =>
      validateInvoice(invoice, limits).issues.map((i) => `${i.code} @ ${i.path}`);
    expect(codes({ limits: { attachmentBytes: 10 } })).toContain(
      'BR-FR-19 @ attachments[0].file.bytes',
    );
    expect(codes({ limits: { attachmentsTotalBytes: 10 } })).toContain('BR-FR-19 @ attachments');
    expect(validateInvoice(invoice).ok).toBe(true);
    let caught: unknown;
    try {
      fromCiiXml(toCiiXml(invoice), { limits: { attachmentBytes: 10 } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FacturXParseError);
    expect((caught as FacturXParseError).code).toBe('TOO_LARGE');
    expect((caught as FacturXParseError).path).toMatch(/AttachmentBinaryObject$/);
  });

  it('PDF : refus typé avant pdf-lib, et XML embarqué borné', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    const pdf = await doc.save();
    await expect(
      embedFacturX(pdf, { invoice: simpleInvoice() }, { limits: { pdfBytes: 10 } }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(extractFacturX(pdf, { limits: { pdfBytes: 10 } })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    const facturx = await embedFacturX(pdf, { invoice: simpleInvoice() });
    await expect(extractFacturX(facturx, { limits: { xmlBytes: 100 } })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await expect(extractInvoice(facturx, { limits: { xmlBytes: 100 } })).rejects.toBeInstanceOf(
      FacturXPdfError,
    );
    expect((await extractInvoice(facturx))?.invoice.id).toBe('F-2026-0001');
  });
});
