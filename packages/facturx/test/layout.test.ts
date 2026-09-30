import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import jsQR from 'jsqr';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  percent,
  sepaQrPayload,
} from '../src/index.js';
import type { FontMetrics } from '../src/pdf/fonts.js';
import {
  buildPalette,
  contrastRatio,
  DEFAULT_DISPLAY,
  type FacturXPdfError,
  FONT_FEATURES,
  type InvoiceLayout,
  type LayoutQrCode,
  type LayoutText,
  layoutInvoice,
  RENDER_LABELS,
  RENDER_TEMPLATES,
  type RenderLabels,
  type RenderTemplate,
  renderInvoicePdf,
} from '../src/pdf/index.js';
import { resolveLabels } from '../src/pdf/labels.js';
import { composeInvoice } from '../src/pdf/layout.js';
import { paintLayout } from '../src/pdf/paint.js';
import { resolveTheme } from '../src/pdf/theme.js';
import { testFonts } from './fixtures/fonts.js';
import { fullInvoice, multiRateInvoice, simpleDraft, simpleInvoice } from './fixtures/invoices.js';
import { testLogo } from './fixtures/logo.js';

interface FontkitFont {
  unitsPerEm: number;
  layout(text: string, features?: Record<string, boolean>): { glyphs: { advanceWidth: number }[] };
}

const fonts = testFonts;
const NBSP = '\u00a0';

const textOps = (layout: InvoiceLayout): LayoutText[] =>
  layout.pages.flatMap((p) => p.ops.filter((o): o is LayoutText => o.kind === 'text'));
const allText = (layout: InvoiceLayout): string =>
  textOps(layout)
    .map((t) => t.text)
    .join(' ');

/** Facture d'un micro-entrepreneur en franchise en base : catégorie E, motif VATEX-FR-FRANCHISE. */
function franchiseInvoice(): Invoice {
  const base = simpleDraft();
  const line = base.lines[0] as InvoiceDraft['lines'][number];
  const draft: InvoiceDraft = {
    ...base,
    lines: [{ ...line, tax: { category: 'E', rate: percent('0') } }],
  };
  return {
    ...draft,
    ...computeTotals(draft, { exemptions: { E: { code: 'VATEX-FR-FRANCHISE' } } }),
  };
}

describe('mentions obligatoires', () => {
  it('écrit la nature de l’opération, la période, le bon de commande et l’option sur les débits', async () => {
    const layout = await layoutInvoice(multiRateInvoice(), { fonts });
    const text = allText(layout);
    expect(text).toContain('Livraison de biens et prestation de services');
    expect(text).toContain('PO-4587');
    expect(text).toContain("Option pour le paiement de la taxe d'après les débits");
    expect(text).toContain(`01/09/2026 – 30/09/2026`);
    expect(layout.mentions).toEqual(
      expect.arrayContaining([
        'operationCategory',
        'purchaseOrder',
        'vatOnDebits',
        'deliveryDate',
        'vatBreakdown',
        'latePenalty',
        'recoveryIndemnity',
        'earlyPaymentDiscount',
        'sellerId',
        'sellerVatId',
        'buyerId',
      ]),
    );
  });

  it('écrit la mention de franchise en base à partir du seul code VATEX', async () => {
    const layout = await layoutInvoice(franchiseInvoice(), { fonts });
    expect(allText(layout)).toContain('TVA non applicable, art. 293 B du CGI');
    expect(layout.mentions).toContain('vatExemption');
  });

  it('préfère le texte d’exonération fourni (BT-120) au libellé du code', async () => {
    const layout = await layoutInvoice(fullInvoice(), { fonts });
    const text = allText(layout);
    expect(text).toContain('Autoliquidation');
    expect(layout.mentions).toEqual(
      expect.arrayContaining([
        'precedingInvoices',
        'taxPointDate',
        'deliveryAddress',
        'prepaid',
        'vatExemption',
      ]),
    );
    expect(text).toContain('n° F-2026-0000 du 01/08/2026');
  });

  it('écrit « Autofacturation » sur une facture auto-facturée', async () => {
    const layout = await layoutInvoice({ ...simpleInvoice(), typeCode: '389' }, { fonts });
    expect(allText(layout)).toContain('Autofacturation');
    expect(layout.mentions).toContain('selfBilling');
  });

  it('nomme le montant d’un avoir autrement qu’un net à payer', async () => {
    const layout = await layoutInvoice({ ...simpleInvoice(), typeCode: '381' }, { fonts });
    const text = allText(layout);
    expect(text).toContain('Avoir');
    expect(text).toContain("Montant de l'avoir");
    expect(text).not.toContain('Net à payer');
  });

  it('écrit les trois mentions de paiement une seule fois, depuis la même source que le XML', async () => {
    const layout = await layoutInvoice(simpleInvoice(), { fonts });
    const texts = textOps(layout).map((t) => t.text);
    expect(texts.filter((t) => t.startsWith('Pénalités de retard')).length).toBe(1);
    expect(texts.filter((t) => t.startsWith('Indemnité forfaitaire')).length).toBe(1);
    expect(texts.filter((t) => t.startsWith("Pas d'escompte")).length).toBe(1);
  });

  it('n’écrit pas la note BAR, consigne de traitement destinée à la plateforme', async () => {
    const layout = await layoutInvoice({ ...simpleInvoice(), processing: 'B2B' }, { fonts });
    expect(textOps(layout).some((t) => t.text === 'B2B')).toBe(false);
  });

  it('les options d’affichage ne masquent jamais une mention obligatoire', async () => {
    const layout = await layoutInvoice(fullInvoice(), {
      fonts,
      display: { references: false, paymentDetails: false, contacts: false, itemDetails: false },
    });
    const text = allText(layout);
    expect(text).toContain('PO-9001'); // bon de commande : obligatoire
    expect(text).toContain('F-2026-0000'); // facture de référence : obligatoire
    expect(text).not.toContain('CT-2025-118'); // contrat : facultatif
    expect(text).not.toContain('RUM-2026-000123'); // mandat : facultatif
    expect(text).not.toContain('jeanne@exemple.fr');
  });

  it('affiche l’adresse électronique de routage sur demande', async () => {
    const layout = await layoutInvoice(simpleInvoice(), {
      fonts,
      display: { electronicAddresses: true },
    });
    expect(allText(layout)).toContain('Adresse électronique 732829320 (0225)');
  });
});

describe('écriture des nombres et des dates', () => {
  it('écrit à la française : milliers séparés, virgule, symbole après le montant', async () => {
    const base = simpleDraft();
    const line = base.lines[0] as InvoiceDraft['lines'][number];
    const draft: InvoiceDraft = {
      ...base,
      lines: [{ ...line, quantity: 1_000_000 as never, netAmount: cents(1_000_000) }],
    };
    const layout = await layoutInvoice({ ...draft, ...computeTotals(draft) }, { fonts });
    const text = allText(layout);
    expect(text).toContain(`10${NBSP}000,00${NBSP}€`);
    expect(text).toContain(`20${NBSP}%`);
    expect(text).toContain('11/09/2026');
    expect(text).toContain('100 j');
    expect(text).toContain(`IBAN FR76${NBSP}3000${NBSP}6000`);
  });

  it('écrit à l’anglaise avec les libellés anglais', async () => {
    const layout = await layoutInvoice(simpleInvoice(), { fonts, labels: 'en' });
    const text = allText(layout);
    expect(text).toContain('€240.00');
    expect(text).toContain('11 Sep 2026');
    expect(text).toContain('Amount due');
  });

  it('retire les zéros inutiles des quantités, garde deux décimales aux prix', async () => {
    const layout = await layoutInvoice(multiRateInvoice(), { fonts });
    const text = allText(layout);
    expect(text).toContain('1,5 kg');
    expect(text).toContain(`50,00${NBSP}€`);
  });
});

describe('police', () => {
  it('relève un caractère absent de la police, avec le champ où il se trouve', async () => {
    const invoice = {
      ...simpleInvoice(),
      seller: { ...simpleInvoice().seller, name: 'Atelier 🙂' },
    };
    const layout = await layoutInvoice(invoice, { fonts });
    expect(layout.missingGlyphs).toEqual([
      expect.objectContaining({ char: '🙂', codePoint: 0x1f642, ref: 'seller.name' }),
    ]);
  });

  it('refuse de produire un PDF qui contiendrait un glyphe .notdef', async () => {
    const invoice = {
      ...simpleInvoice(),
      seller: { ...simpleInvoice().seller, name: 'Atelier 🙂' },
    };
    try {
      await renderInvoicePdf(invoice, { fonts });
      throw new Error('attendu en échec');
    } catch (error) {
      expect((error as FacturXPdfError).code).toBe('GLYPH_MISSING');
      expect((error as Error).message).toMatch(/U\+1F642.*seller\.name/);
    }
  });

  it('mesure sans ligature : un caractère, un glyphe', async () => {
    const { default: fontkit } = (await import('@pdf-lib/fontkit')) as unknown as {
      default: { create(bytes: Uint8Array): FontkitFont };
    };
    const font = fontkit.create(fonts.bold);
    const word = 'palette office';
    const advance = (text: string, features?: Record<string, boolean>) =>
      font.layout(text, features).glyphs.reduce((w, g) => w + g.advanceWidth, 0) / font.unitsPerEm;
    const letterByLetter = [...word].reduce((w, ch) => w + advance(ch, FONT_FEATURES), 0);
    // Geist a bien des ligatures (« tt », « ff ») : sans elles désactivées, le mot rétrécirait.
    expect(advance(word)).toBeLessThan(letterByLetter);

    const base = simpleDraft();
    const line = base.lines[0] as InvoiceDraft['lines'][number];
    const draft: InvoiceDraft = { ...base, lines: [{ ...line, name: word }] };
    const layout = await layoutInvoice({ ...draft, ...computeTotals(draft) }, { fonts });
    const op = textOps(layout).find((t) => t.text === word) as LayoutText;
    expect(op.font).toBe('bold');
    expect(op.width).toBeCloseTo(letterByLetter * op.size, 6);
  });

  it('remplace un signe de ponctuation absent par son équivalent simple, sans rien signaler', () => {
    // Police fictive sans typographie étendue : ni apostrophe courbe, ni tiret long, ni espace fine.
    const plain: FontMetrics = {
      ascent: 0.9,
      has: (char) => (char.codePointAt(0) ?? 0) < 0x2000 && char !== '\u00a0',
      width: (text, size) => [...text].length * size * 0.5,
    };
    const invoice = simpleInvoice();
    const layout = composeInvoice({
      invoice: { ...invoice, seller: { ...invoice.seller, name: 'L’Atelier — Paris' } },
      fonts: { regular: plain, bold: plain },
      labels: resolveLabels('fr'),
      locale: 'fr',
      theme: resolveTheme(),
      display: { ...DEFAULT_DISPLAY },
    });
    const text = allText(layout);
    expect(layout.missingGlyphs).toEqual([]);
    expect(text).toContain("L'Atelier - Paris");
    // Ni espace fine, ni insécable, ni symbole euro : une espace simple et le code de la devise.
    expect(text).toContain('240,00 EUR');
  });

  it('refuse une police WOFF : pdf-lib l’embarquerait comme un TTF illisible', async () => {
    const require = createRequire(import.meta.url);
    const geist = dirname(realpathSync(require.resolve('geist/font/sans')));
    const woff2 = new Uint8Array(readFileSync(join(geist, 'fonts/geist-sans/Geist-Regular.woff2')));
    await expect(
      layoutInvoice(simpleInvoice(), { fonts: { regular: woff2 } }),
    ).rejects.toMatchObject({
      code: 'FONT_INVALID',
    });
  });

  it('refuse des octets qui ne sont pas une police', async () => {
    await expect(
      layoutInvoice(simpleInvoice(), { fonts: { regular: new Uint8Array([1, 2, 3, 4, 5, 6]) } }),
    ).rejects.toMatchObject({ code: 'FONT_INVALID' });
  });
});

describe('thèmes', () => {
  const templates = Object.keys(RENDER_TEMPLATES) as RenderTemplate[];

  it.each(templates)('le modèle %s rend une facture complète, logo compris', async (template) => {
    const layout = await layoutInvoice(fullInvoice(), {
      fonts,
      theme: { template },
      logo: { bytes: testLogo(), type: 'png' },
    });
    expect(layout.missingGlyphs).toEqual([]);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    expect(layout.pages[0]?.ops.some((o) => o.kind === 'image')).toBe(true);
    expect(allText(layout)).toContain('F-2026-0003');
  });

  it('refuse une couleur illisible et un modèle inconnu', async () => {
    await expect(
      layoutInvoice(simpleInvoice(), { fonts, theme: { accent: 'bleu' } }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTION',
    });
    await expect(
      layoutInvoice(simpleInvoice(), { fonts, theme: { template: 'baroque' as RenderTemplate } }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });

  it('refuse un logo qui n’est pas l’image annoncée', async () => {
    await expect(
      layoutInvoice(simpleInvoice(), { fonts, logo: { bytes: testLogo(), type: 'jpeg' } }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('garde le texte lisible quelle que soit la couleur d’accent', () => {
    for (const accent of ['#ffff00', '#00ffff', '#2f4bd8', '#111111', '#f5f5f5', '#ff7a00']) {
      const palette = buildPalette(accent);
      expect(contrastRatio(palette.accentText, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accentOnTint, palette.tintStrong)).toBeGreaterThanOrEqual(4.5);
      // Blanc ou encre sur l'aplat : le meilleur des deux.
      const best = Math.max(
        contrastRatio('#ffffff', palette.accent),
        contrastRatio('#0a0a0a', palette.accent),
      );
      expect(contrastRatio(palette.onAccent, palette.accent)).toBeCloseTo(best, 5);
    }
  });

  it('un réglage fin surcharge le modèle sans l’effacer', async () => {
    const layout = await layoutInvoice(simpleInvoice(), {
      fonts,
      theme: { template: 'modern', style: { header: 'plain' } },
    });
    const rects = layout.pages[0]?.ops.filter((o) => o.kind === 'rect') ?? [];
    // Pas de bandeau pleine largeur, mais l'en-tête de tableau reste en aplat d'accent.
    expect(rects.some((r) => r.kind === 'rect' && r.width >= 595)).toBe(false);
    expect(rects.some((r) => r.kind === 'rect' && r.fill === '#2f4bd8')).toBe(true);
  });
});

describe('aperçu interactif', () => {
  it('relie chaque bloc au champ qu’il représente', async () => {
    const layout = await layoutInvoice(multiRateInvoice(), { fonts });
    const refs = new Set(layout.pages.flatMap((p) => p.ops.map((o) => o.ref)).filter(Boolean));
    for (const ref of [
      'seller',
      'buyer',
      'id',
      'issueDate',
      'paymentTerms.dueDate',
      'lines[0]',
      'lines[1].quantity',
      'allowances[0]',
      'charges[0]',
      'totals',
      'taxBreakdown',
      'paymentMeans[0]',
      'operationCategory',
    ]) {
      expect(refs, ref).toContain(ref);
    }
  });

  it('rappelle le document en tête des pages suivantes', async () => {
    const base = simpleInvoice();
    const first = base.lines[0] as Invoice['lines'][number];
    const lines = Array.from({ length: 45 }, (_, i) => ({ ...first, id: String(i + 1) }));
    const draft: InvoiceDraft = { ...simpleDraft(), lines };
    const layout = await layoutInvoice({ ...draft, ...computeTotals(draft) }, { fonts });
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(
      textOps({ ...layout, pages: [layout.pages[1] as InvoiceLayout['pages'][number]] }).map(
        (t) => t.text,
      ),
    ).toContain('Facture F-2026-0001 — suite');
  });
});

describe('libellés sur mesure', () => {
  it('une table écrite pour la 1.5 reste valable : les nouvelles clés viennent de la langue de base', async () => {
    const { fr } = RENDER_LABELS;
    const legacy: RenderLabels = {
      invoice: { '380': 'Rechnung' },
      seller: 'Verkäufer',
      buyer: 'Käufer',
      delivery: fr.delivery,
      issueDate: fr.issueDate,
      dueDate: fr.dueDate,
      reference: fr.reference,
      designation: 'Bezeichnung',
      quantity: fr.quantity,
      unitPrice: fr.unitPrice,
      vat: fr.vat,
      netAmount: fr.netAmount,
      lineTotal: fr.lineTotal,
      allowances: fr.allowances,
      charges: fr.charges,
      taxExclusive: fr.taxExclusive,
      taxBase: fr.taxBase,
      taxRate: fr.taxRate,
      taxAmount: fr.taxAmount,
      taxInclusive: fr.taxInclusive,
      prepaid: fr.prepaid,
      rounding: fr.rounding,
      amountDue: fr.amountDue,
      paymentTerms: fr.paymentTerms,
      page: fr.page,
    };
    const layout = await layoutInvoice(simpleInvoice(), { fonts, labels: legacy });
    const text = allText(layout);
    expect(text).toContain('Rechnung');
    expect(text).toContain('BEZEICHNUNG');
    expect(text).toContain('Prestation de services'); // repli sur la table française
  });
});

describe('QR code de paiement SEPA', () => {
  const qrOps = (layout: InvoiceLayout) =>
    layout.pages.flatMap((page, index) =>
      page.ops.filter((o): o is LayoutQrCode => o.kind === 'qr').map((op) => ({ op, index })),
    );

  /** Relit les modules avec jsQR, un décodeur indépendant, zone de silence comprise. */
  function decode(modules: boolean[][]): string | undefined {
    const n = modules.length;
    const scale = 4;
    const width = (n + 8) * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    modules.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (!dark) return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const o = (((y + 4) * scale + dy) * width + (x + 4) * scale + dx) * 4;
            data.fill(0, o, o + 3);
          }
        }
      });
    });
    return jsQR(data, width, width)?.data;
  }

  it('n’est pas imprimé sans le demander', async () => {
    const layout = await layoutInvoice(simpleInvoice(), { fonts });
    expect(qrOps(layout)).toEqual([]);
    expect(allText(layout)).not.toContain('Scannez pour payer');
  });

  it('se lit comme le virement de la facture, et désigne le moyen de paiement', async () => {
    const invoice = multiRateInvoice();
    const expected = sepaQrPayload(invoice);
    expect(expected.available).toBe(true);
    for (const template of Object.keys(RENDER_TEMPLATES) as RenderTemplate[]) {
      const layout = await layoutInvoice(invoice, {
        fonts,
        theme: { template },
        display: { paymentQrCode: true },
      });
      const found = qrOps(layout);
      expect(found, template).toHaveLength(1);
      const { op } = found[0] as { op: LayoutQrCode };
      expect(op.ref).toBe('paymentMeans[0]');
      expect(decode(op.modules), template).toBe(expected.available && expected.payload);
      // 0,4 mm par module au moins.
      expect(op.size / op.modules.length).toBeGreaterThanOrEqual((0.4 / 25.4) * 72);
      expect(allText(layout)).toContain('Scannez pour payer');
    }
    const en = await layoutInvoice(invoice, {
      fonts,
      labels: 'en',
      display: { paymentQrCode: true },
    });
    expect(allText(en)).toContain('Scan to pay');
  });

  it('garde vide la zone de silence : quatre modules tout autour', async () => {
    for (const invoice of [simpleInvoice(), multiRateInvoice()]) {
      for (const template of Object.keys(RENDER_TEMPLATES) as RenderTemplate[]) {
        const layout = await layoutInvoice(invoice, {
          fonts,
          theme: { template },
          display: { paymentQrCode: true },
          footer: 'SAS au capital de 10 000 €',
        });
        const [found] = qrOps(layout);
        if (!found) throw new Error(`pas de QR code (${template})`);
        const { op, index } = found;
        const quiet = (4 * op.size) / op.modules.length;
        const zone = {
          left: op.x - quiet,
          right: op.x + op.size + quiet,
          bottom: op.y - quiet,
          top: op.y + op.size + quiet,
        };
        const page = layout.pages[index] as InvoiceLayout['pages'][number];
        for (const o of page.ops) {
          if (o.kind === 'qr' || o.kind === 'area') continue;
          const box =
            o.kind === 'text'
              ? {
                  left: o.x,
                  right: o.x + o.width,
                  bottom: o.y - o.size * 0.28,
                  top: o.y + o.size * 0.8,
                }
              : o.kind === 'line'
                ? {
                    left: Math.min(o.x1, o.x2),
                    right: Math.max(o.x1, o.x2),
                    bottom: Math.min(o.y1, o.y2) - o.width / 2,
                    top: Math.max(o.y1, o.y2) + o.width / 2,
                  }
                : { left: o.x, right: o.x + o.width, bottom: o.y, top: o.y + o.height };
          const overlaps =
            box.left < zone.right - 0.01 &&
            box.right > zone.left + 0.01 &&
            box.bottom < zone.top - 0.01 &&
            box.top > zone.bottom + 0.01;
          expect(overlaps, `${template} : ${o.kind} ${'text' in o ? o.text : ''}`).toBe(false);
        }
      }
    }
  });

  it('n’est pas imprimé quand la facture ne s’y prête pas', async () => {
    // Prélèvement SEPA : rien à payer par virement.
    const layout = await layoutInvoice(fullInvoice(), { fonts, display: { paymentQrCode: true } });
    expect(sepaQrPayload(fullInvoice())).toEqual({ available: false, reason: 'no-transfer' });
    expect(qrOps(layout)).toEqual([]);
    expect(allText(layout)).not.toContain('Scannez pour payer');
  });

  it('se peint en un seul tracé, une suite de modules par rectangle', async () => {
    const layout = await layoutInvoice(simpleInvoice(), {
      fonts,
      display: { paymentQrCode: true },
    });
    const [found] = qrOps(layout);
    if (!found) throw new Error('pas de QR code');
    const { op } = found;
    const calls: { path: string; options: { x: number; y: number; scale: number } }[] = [];
    const page = {
      drawSvgPath: (path: string, options: { x: number; y: number; scale: number }) =>
        calls.push({ path, options }),
    };
    const doc = { addPage: () => page } as unknown as PDFDocument;
    const only: InvoiceLayout = {
      ...layout,
      pages: [{ width: 595.28, height: 841.89, ops: [op] }],
    };
    paintLayout(doc, only, { regular: {} as PDFFont, bold: {} as PDFFont }, undefined);
    expect(calls).toHaveLength(1);
    const { path, options } = calls[0] as (typeof calls)[number];
    // Repère SVG de drawSvgPath : origine au coin supérieur gauche du symbole, y vers le bas.
    expect(options).toMatchObject({
      x: op.x,
      y: op.y + op.size,
      scale: op.size / op.modules.length,
    });
    const n = op.modules.length;
    const painted = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    for (const [, x, y, w, back] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(back).toBe(w);
      for (let i = 0; i < Number(w); i++) {
        const row = painted[Number(y)] as boolean[];
        expect(row[Number(x) + i]).toBe(false);
        row[Number(x) + i] = true;
      }
    }
    expect(painted).toEqual(op.modules);
  });
});
