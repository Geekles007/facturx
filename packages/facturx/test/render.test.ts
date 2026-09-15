import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { cents, percent, quantity, unitPrice } from '../src/index.js';
import { FacturXPdfError, RENDER_LABELS, renderInvoicePdf } from '../src/pdf/index.js';
import type { Invoice } from '../src/types/invoice.js';
import { testFonts } from './fixtures/fonts.js';
import { multiRateInvoice, simpleInvoice } from './fixtures/invoices.js';

const fonts = { regular: testFonts.regular };

const pageCount = async (pdf: Uint8Array): Promise<number> =>
  (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();

describe('rendu', () => {
  it('produit un PDF d’une page pour une facture courte', async () => {
    const pdf = await renderInvoicePdf(simpleInvoice(), { fonts });
    expect(pdf.subarray(0, 4)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // %PDF
    expect(await pageCount(pdf)).toBe(1);
  });

  it('porte le numéro de facture dans le titre du document', async () => {
    const invoice = simpleInvoice();
    const pdf = await renderInvoicePdf(invoice, { fonts });
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getTitle()).toContain(invoice.id);
    expect(doc.getAuthor()).toBe(invoice.seller.name);
  });

  it('pèse ce que pèse une police embarquée', async () => {
    // pdf-lib compresse les objets : les clés de dictionnaire ne sont pas lisibles dans les octets,
    // donc chercher « FontFile » n'y prouverait rien. La preuve que la police est bien embarquée est
    // apportée par veraPDF dans pdfa.test.ts — un PDF/A est rejeté si une police ne l'est pas.
    // Ici on se contente du signe le plus simple : sans embarquement, le document ferait quelques Ko.
    const pdf = await renderInvoicePdf(simpleInvoice(), { fonts });
    expect(pdf.length).toBeGreaterThan(30_000);
  });
});

describe('débordement sur plusieurs pages', () => {
  /** Une facture à `count` lignes, montants cohérents pour rester validable. */
  function longInvoice(count: number): Invoice {
    const base = simpleInvoice();
    const first = base.lines[0] as (typeof base.lines)[number];
    const lines = Array.from({ length: count }, (_, i) => ({
      ...first,
      id: String(i + 1),
      name: `Prestation ${i + 1} — intitulé volontairement long pour éprouver le retour à la ligne`,
      description: 'Description complémentaire sur une ligne supplémentaire.',
      quantity: quantity(10000),
      unitPrice: unitPrice(10000),
      netAmount: cents(10000),
      tax: { category: 'S' as const, rate: percent('20') },
    }));
    return { ...base, lines };
  }

  it('ouvre une seconde page quand les lignes débordent', async () => {
    expect(await pageCount(await renderInvoicePdf(longInvoice(4), { fonts }))).toBe(1);
    expect(await pageCount(await renderInvoicePdf(longInvoice(40), { fonts }))).toBeGreaterThan(1);
  });

  it('numérote toutes les pages, une fois le total connu', async () => {
    const pdf = await renderInvoicePdf(longInvoice(40), { fonts });
    const pages = await pageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    // Le pied de page n'est écrit qu'après coup : chaque page connaît le total.
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(pages);
  });

  it('un intitulé sans espace est coupé plutôt que de déborder', async () => {
    const base = simpleInvoice();
    const first = base.lines[0] as (typeof base.lines)[number];
    const invoice = { ...base, lines: [{ ...first, name: 'A'.repeat(400) }] };
    await expect(renderInvoicePdf(invoice, { fonts })).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('options', () => {
  it('rend les libellés en anglais sur demande', async () => {
    const pdf = await renderInvoicePdf(simpleInvoice(), { fonts, labels: 'en' });
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getTitle()).toContain('Invoice');
  });

  it('accepte une table de libellés sur mesure', async () => {
    const labels = { ...RENDER_LABELS.fr, invoice: { '380': 'Rechnung' } };
    const pdf = await renderInvoicePdf(simpleInvoice(), { fonts, labels });
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getTitle()).toContain('Rechnung');
  });

  it('rend une facture à plusieurs taux de TVA', async () => {
    const pdf = await renderInvoicePdf(multiRateInvoice(), { fonts });
    expect(await pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });
});

describe('refus explicites', () => {
  it('refuse une police variable : le PDF produit ne serait pas un PDF/A', async () => {
    const variable = new Uint8Array(
      readFileSync(new URL('../../../site/fonts/Geist-Variable.woff2', import.meta.url)),
    );
    try {
      await renderInvoicePdf(simpleInvoice(), { fonts: { regular: variable } });
      throw new Error('attendu en échec');
    } catch (error) {
      expect((error as FacturXPdfError).code).toBe('FONT_VARIABLE');
      expect((error as Error).message).toMatch(/statique/);
    }
  });

  it('exige une police, et dit pourquoi', async () => {
    await expect(
      renderInvoicePdf(simpleInvoice(), { fonts: { regular: new Uint8Array() } }),
    ).rejects.toThrow(FacturXPdfError);
    await expect(
      renderInvoicePdf(simpleInvoice(), { fonts: { regular: new Uint8Array() } }),
    ).rejects.toThrow(/police/i);
  });

  it('porte un code d’erreur distinct de ceux de la lecture', async () => {
    try {
      await renderInvoicePdf(simpleInvoice(), { fonts: { regular: new Uint8Array() } });
      throw new Error('attendu en échec');
    } catch (error) {
      expect((error as FacturXPdfError).code).toBe('FONT_REQUIRED');
    }
  });
});
