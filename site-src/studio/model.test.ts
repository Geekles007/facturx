import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { centsToString, toCiiXml, validateInvoice } from 'facturx-sdk';
import { describe, expect, it } from 'vitest';
import { generateCode } from './codegen.js';
import { importBytes } from './importer.js';
import {
  advance,
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  formatNumber,
  fromPortableJson,
  newInvoiceForm,
  nextRank,
  numberProblems,
  rankOf,
  toPortableJson,
} from './library.js';
import {
  blankDocAdjustment,
  blankLine,
  buildInvoice,
  type InputError,
  invoiceToForm,
  normalizeDecimal,
  parseScaled,
  parseVat,
  vatKey,
} from './model.js';
import { sampleForm } from './sample.js';

const TODAY = '2026-09-30';

describe('saisie des nombres', () => {
  it('lit les nombres à la française, sans flottant', () => {
    const errors: InputError[] = [];
    expect(parseScaled('1 234,56', 2, 'x', errors)).toBe(123456);
    expect(parseScaled('1\u00a0234,5', 2, 'x', errors)).toBe(123450);
    expect(parseScaled('0,1234', 4, 'x', errors)).toBe(1234);
    expect(parseScaled(',5', 2, 'x', errors)).toBe(50);
    expect(parseScaled('12,', 2, 'x', errors)).toBe(1200);
    expect(parseScaled('', 2, 'x', errors)).toBeUndefined();
    expect(errors).toEqual([]);
    expect(normalizeDecimal("1'234.5")).toBe('1234.5');
  });

  it('relève une saisie illisible, trop précise ou négative, avec le chemin du champ', () => {
    const errors: InputError[] = [];
    parseScaled('12,345', 2, 'lines[0].unitPrice', errors);
    parseScaled('douze', 2, 'prepaid', errors);
    parseScaled('-5', 2, 'lines[1].unitPrice', errors);
    expect(parseScaled('-5', 2, 'rounding', errors, { negative: true })).toBe(-500);
    expect(errors).toEqual([
      { path: 'lines[0].unitPrice', kind: 'decimals', scale: 2 },
      { path: 'prepaid', kind: 'number' },
      { path: 'lines[1].unitPrice', kind: 'negative' },
    ]);
  });

  it('écrit et relit un taux de TVA', () => {
    expect(parseVat('S:5.5')).toEqual({ category: 'S', rate: 550 });
    expect(parseVat('O:')).toEqual({ category: 'O' });
    expect(vatKey({ category: 'S', rate: 2000 })).toBe('S:20');
    expect(vatKey({ category: 'S', rate: 550 })).toBe('S:5.5');
    expect(vatKey({ category: 'O' })).toBe('O:');
  });
});

describe('formulaire → facture', () => {
  it('l’exemple de la première visite est conforme de bout en bout', () => {
    const { invoice, errors } = buildInvoice(sampleForm(TODAY));
    expect(errors).toEqual([]);
    const result = validateInvoice(invoice);
    expect(result.issues).toEqual([]);
    expect(() => toCiiXml(invoice)).not.toThrow();
    // 2 × 720 + 1450 + 12 × 29,90 = 3248,80 ; remise 5 % = 162,44 ; HT 3086,36 ; TVA 617,27
    expect(centsToString(invoice.totals.taxExclusiveAmount)).toBe('3086.36');
    expect(centsToString(invoice.totals.amountDueForPayment)).toBe('3703.63');
  });

  it('un champ vide reste absent : la validation dit ce qui manque', () => {
    const form = sampleForm(TODAY);
    form.buyer.siren = '';
    form.buyer.electronicAddress.value = '';
    const { invoice } = buildInvoice(form);
    expect(invoice.buyer.siren).toBeUndefined();
    expect(invoice.buyer.electronicAddress).toBeUndefined();
    const codes = validateInvoice(invoice).issues.map((i) => i.code);
    expect(codes).toContain('BR-FR-11');
    expect(codes).toContain('BR-FR-12');
  });

  it('répartit une remise globale entre les taux de TVA, au prorata', () => {
    const form = sampleForm(TODAY);
    form.lines = [
      { ...blankLine('S:20'), name: 'A', quantity: '1', unitPrice: '300' },
      { ...blankLine('S:5.5'), name: 'B', quantity: '1', unitPrice: '100' },
    ];
    form.allowances = [{ ...blankDocAdjustment('Remise'), mode: 'amount', value: '10' }];
    const { invoice, errors, toFormPath } = buildInvoice(form);
    expect(errors).toEqual([]);
    expect(invoice.allowances?.map((a) => [a.tax.rate, a.amount])).toEqual([
      [2000, 750],
      [550, 250],
    ]);
    expect(validateInvoice(invoice).ok).toBe(true);
    expect(toFormPath('allowances[1].reason')).toBe('allowances[0].reason');
  });

  it('une remise en pourcentage porte sur chaque assiette', () => {
    const form = sampleForm(TODAY);
    form.lines = [
      { ...blankLine('S:20'), name: 'A', quantity: '1', unitPrice: '300' },
      { ...blankLine('S:5.5'), name: 'B', quantity: '1', unitPrice: '100' },
    ];
    form.allowances = [{ ...blankDocAdjustment('Remise'), mode: 'percent', value: '10' }];
    const { invoice } = buildInvoice(form);
    expect(invoice.allowances?.map((a) => [a.baseAmount, a.percentage, a.amount])).toEqual([
      [30000, 1000, 3000],
      [10000, 1000, 1000],
    ]);
  });

  it('une remise de ligne en pourcentage s’applique au montant brut de la ligne', () => {
    const form = sampleForm(TODAY);
    form.lines = [
      {
        ...blankLine('S:20'),
        name: 'A',
        quantity: '3',
        unitPrice: '50',
        allowances: [
          { uid: 'a', reason: 'Fidélité', reasonCode: '', mode: 'percent', value: '10' },
        ],
      },
    ];
    form.allowances = [];
    const { invoice } = buildInvoice(form);
    expect(invoice.lines[0]?.netAmount).toBe(13500);
    expect(validateInvoice(invoice).ok).toBe(true);
  });

  it('la franchise en base porte son motif et sa mention', () => {
    const form = sampleForm(TODAY);
    form.seller.vatId = '';
    form.seller.taxRegistrationId = '443061841'; // BR-FR-CO-16 : sans numéro de TVA, le SIREN en BT-32
    for (const line of form.lines) line.vat = 'E:0';
    const { invoice } = buildInvoice(form);
    expect(invoice.taxBreakdown).toEqual([
      expect.objectContaining({
        category: 'E',
        exemptionReasonCode: 'VATEX-FR-FRANCHISE',
        exemptionReason: 'TVA non applicable, art. 293 B du CGI',
        taxAmount: 0,
      }),
    ]);
    expect(validateInvoice(invoice).issues).toEqual([]);
  });

  it('en franchise sans numéro de TVA, l’identifiant fiscal manquant est signalé sur son champ', () => {
    const form = sampleForm(TODAY);
    form.seller.vatId = '';
    for (const line of form.lines) line.vat = 'E:0';
    const { invoice } = buildInvoice(form);
    expect(validateInvoice(invoice).issues).toContainEqual(
      expect.objectContaining({ code: 'BR-FR-CO-16', path: 'seller.taxRegistrationId' }),
    );
  });

  it('un prix brut inférieur au prix net est refusé à la saisie', () => {
    const form = sampleForm(TODAY);
    const line = form.lines[0];
    if (line) line.grossUnitPrice = '100';
    expect(buildInvoice(form).errors).toEqual([{ path: 'lines[0].grossUnitPrice', kind: 'gross' }]);
  });
});

describe('facture → formulaire', () => {
  it('l’aller-retour garde les montants', () => {
    const first = buildInvoice(sampleForm(TODAY)).invoice;
    const again = buildInvoice(invoiceToForm(first)).invoice;
    expect(again.totals).toEqual(first.totals);
    expect(again.taxBreakdown).toEqual(first.taxBreakdown);
    expect(again.lines.map((l) => l.netAmount)).toEqual(first.lines.map((l) => l.netAmount));
  });

  it('relit une facture CII complète produite par le SDK', async () => {
    const xml = readFileSync(
      new URL('../../packages/facturx/test/golden/full.xml', import.meta.url),
    );
    const imported = await importBytes(new Uint8Array(xml), 'facture.xml');
    expect(imported.source).toBe('cii');
    const { invoice } = buildInvoice(imported.form);
    expect(invoice.id).toBe('F-2026-0003');
    expect(centsToString(invoice.totals.taxInclusiveAmount)).toBe('545.00');
  });

  it('relit un document du Studio, pièces jointes comprises', async () => {
    const form = sampleForm(TODAY);
    form.attachments = [
      {
        uid: 'x',
        id: 'BC-1',
        description: 'BON_COMMANDE',
        uri: '',
        file: { name: 'bc.csv', mimeType: 'text/csv', bytes: new Uint8Array([1, 2, 3]) },
      },
    ];
    const json = toPortableJson({
      format: 'facturx-studio',
      version: 1,
      form,
      appearance: defaultAppearance(),
    });
    const imported = await importBytes(new TextEncoder().encode(json), 'facture.json');
    expect(imported.source).toBe('studio');
    expect(imported.form.attachments[0]?.file?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(
      fromPortableJson<{ a: Uint8Array }>(toPortableJson({ a: new Uint8Array([9]) })).a,
    ).toEqual(new Uint8Array([9]));
  });
});

describe('numérotation', () => {
  it('compose le numéro depuis le gabarit', () => {
    expect(formatNumber('F-{AAAA}-{NNNN}', 42, TODAY)).toBe('F-2026-0042');
    expect(formatNumber('{AA}{MM}-{NNN}', 7, TODAY)).toBe('2609-007');
  });

  it('repart de 1 chaque année si demandé, jamais en arrière sinon', () => {
    const numbering = { ...defaultNumbering(), next: 58, year: 2026 };
    expect(nextRank(numbering, '2026-12-31')).toBe(58);
    expect(nextRank(numbering, '2027-01-02')).toBe(1);
    expect(advance(numbering, '2027-01-02')).toMatchObject({ next: 2, year: 2027 });
    expect(nextRank({ ...numbering, yearly: false }, '2027-01-02')).toBe(58);
  });

  it('reprend la séquence au rang d’un numéro émis hors séquence, sans revenir en arrière', () => {
    const numbering = { ...defaultNumbering(), next: 1, year: 2026 };
    expect(rankOf('F-{AAAA}-{NNNN}', 'F-2026-0042')).toBe(42);
    expect(rankOf('F-{AAAA}-{NNNN}', 'AUTRE-1')).toBeUndefined();
    expect(rankOf('FA{AA}.{MM}/{NNN}', 'FA26.09/007')).toBe(7);
    expect(advance(numbering, TODAY, 'F-2026-0042').next).toBe(43);
    expect(advance({ ...numbering, next: 50 }, TODAY, 'F-2026-0042').next).toBe(51);
    expect(advance(numbering, TODAY, 'saisi-a-la-main').next).toBe(2);
  });

  it('signale un numéro trop long ou aux caractères refusés (BR-FR-01/02)', () => {
    expect(numberProblems('F-2026-0001')).toEqual([]);
    expect(numberProblems('F 2026 #1')).toEqual(['chars']);
    expect(numberProblems('F'.repeat(36))).toEqual(['length']);
  });

  it('une nouvelle facture reprend l’entreprise et le numéro suivant', () => {
    const company = defaultCompany();
    company.seller.name = 'Mon entreprise';
    const form = newInvoiceForm(company, { ...defaultNumbering(), next: 12, year: 2026 }, TODAY);
    expect(form.id).toBe('F-2026-0012');
    expect(form.seller.name).toBe('Mon entreprise');
    expect(form.paymentTerms.dueDate).toBe('2026-10-30');
  });
});

describe('code généré', () => {
  it('est du TypeScript valide qui refait la facture avec le SDK', async () => {
    const built = buildInvoice(sampleForm(TODAY));
    const code = generateCode({
      invoice: built.invoice,
      totalsOptions: built.totalsOptions,
      render: {
        fonts: { regular: new Uint8Array(), bold: new Uint8Array() },
        theme: { template: 'modern', accent: '#2f4bd8' },
        locale: 'fr',
      },
      fontFiles: { regular: 'Geist-Regular.ttf', bold: 'Geist-SemiBold.ttf' },
      labels: { language: 'fr', renamed: { designation: 'Prestation' } },
    });
    await expect(transform(code, { loader: 'ts', format: 'esm' })).resolves.toBeDefined();
    expect(code).toContain('unitPrice: unitPrice(7200000)');
    expect(code).toContain("rate: percent('20')");
    expect(code).toContain('computeTotals(draft');
    expect(code).toContain("labels: { ...RENDER_LABELS.fr, designation: 'Prestation' }");
    expect(code).toContain("template: 'modern'");
    expect(code).not.toContain('netAmount: cents(0)');
  });
});
