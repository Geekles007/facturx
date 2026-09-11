import { describe, expect, it } from 'vitest';
import {
  assertValidInvoice,
  buildPaymentTermsText,
  cents,
  computeTotals,
  FacturXValidationError,
  type Invoice,
  type Issue,
  percent,
  resolveNotes,
  validateInvoice,
} from '../src/index.js';
import {
  multiRateDraft,
  multiRateInvoice,
  simpleDraft,
  simpleInvoice,
} from './fixtures/invoices.js';

function issuesOf(invoice: Invoice): Issue[] {
  const r = validateInvoice(invoice);
  return r.ok ? [] : [...r.issues];
}

function codesAndPaths(invoice: Invoice): string[] {
  return issuesOf(invoice).map((i) => `${i.code} @ ${i.path}`);
}

describe('facture simple', () => {
  it('est valide et ses totaux sont ceux attendus', () => {
    const invoice = simpleInvoice();
    expect(invoice.totals).toEqual({
      lineTotalAmount: 20000,
      taxExclusiveAmount: 20000,
      taxTotalAmount: 4000,
      taxInclusiveAmount: 24000,
      amountDueForPayment: 24000,
    });
    expect(invoice.taxBreakdown).toEqual([
      { category: 'S', rate: 2000, taxableAmount: 20000, taxAmount: 4000 },
    ]);
    const r = validateInvoice(invoice);
    expect(r.ok).toBe(true);
    expect(assertValidInvoice(invoice)).toBe(invoice);
  });

  it('ne modifie pas la facture', () => {
    const invoice = simpleInvoice();
    const snapshot = JSON.stringify(invoice);
    validateInvoice(invoice);
    expect(JSON.stringify(invoice)).toBe(snapshot);
  });
});

describe('facture multi-taux avec remises', () => {
  it('calcule une ventilation par (catégorie, taux) et des totaux exacts', () => {
    const invoice = multiRateInvoice();
    expect(invoice.taxBreakdown).toEqual([
      { category: 'S', rate: 2000, taxableAmount: 13700, taxAmount: 2740 },
      { category: 'S', rate: 550, taxableAmount: 3000, taxAmount: 165 },
    ]);
    expect(invoice.totals).toEqual({
      lineTotalAmount: 17000,
      allowanceTotalAmount: 500,
      chargeTotalAmount: 200,
      taxExclusiveAmount: 16700,
      taxTotalAmount: 2905,
      taxInclusiveAmount: 19605,
      amountDueForPayment: 19605,
    });
    expect(validateInvoice(invoice).ok).toBe(true);
  });

  it('prend en compte acompte et arrondi', () => {
    const draft = multiRateDraft();
    const { totals } = computeTotals(draft, {
      prepaidAmount: cents(5000),
      roundingAmount: cents(-5),
    });
    expect(totals.prepaidAmount).toBe(5000);
    expect(totals.roundingAmount).toBe(-5);
    expect(totals.amountDueForPayment).toBe(19605 - 5000 - 5);
    expect(
      validateInvoice({
        ...draft,
        ...computeTotals(draft, { prepaidAmount: cents(5000), roundingAmount: cents(-5) }),
      }).ok,
    ).toBe(true);
  });
});

describe('totaux incohérents — jamais corrigés en silence', () => {
  it('signale un TTC faux avec le chemin, l’attendu et le reçu', () => {
    const invoice = simpleInvoice();
    invoice.totals.taxInclusiveAmount = cents(24001);
    const issues = issuesOf(invoice);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'BR-CO-15',
        path: 'totals.taxInclusiveAmount',
        expected: 24000,
        actual: 24001,
      }),
    );
    // l’erreur se propage au montant à payer, qui ne suit plus BT-112 − BT-113 + BT-114
    expect(issues.map((i) => i.code)).toContain('BR-CO-16');
    expect(invoice.totals.taxInclusiveAmount).toBe(24001);
  });

  it('signale un montant net de ligne faux', () => {
    const invoice = simpleInvoice();
    invoice.lines[0]!.netAmount = cents(19999);
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining([
        'CALC-LINE-NET @ lines[0].netAmount',
        'BR-CO-10 @ totals.lineTotalAmount',
      ]),
    );
  });

  it('signale une base imposable et une TVA fausses dans la ventilation', () => {
    const invoice = multiRateInvoice();
    invoice.taxBreakdown[1]!.taxAmount = cents(166);
    const issues = issuesOf(invoice);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'BR-CO-17',
        path: 'taxBreakdown[1].taxAmount',
        expected: 165,
        actual: 166,
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'BR-CO-14', path: 'totals.taxTotalAmount' }),
    );
  });

  it('signale une ventilation manquante pour un taux présent dans les lignes', () => {
    const invoice = multiRateInvoice();
    invoice.taxBreakdown.splice(1, 1);
    const codes = codesAndPaths(invoice);
    expect(codes).toContain('BR-S-01 @ taxBreakdown');
    expect(codes).toContain('BR-CO-14 @ totals.taxTotalAmount');
  });

  it('assertValidInvoice lève une erreur typée portant toutes les anomalies', () => {
    const invoice = simpleInvoice();
    invoice.totals.taxInclusiveAmount = cents(1);
    invoice.seller.siren = '123456789';
    let caught: unknown;
    try {
      assertValidInvoice(invoice);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FacturXValidationError);
    const err = caught as FacturXValidationError;
    expect(err.issues.length).toBeGreaterThanOrEqual(2);
    expect(err.message).toContain('[BR-CO-15] totals.taxInclusiveAmount');
    expect(err.message).toContain('[BR-FR-10] seller.siren');
  });
});

describe('identifiants français', () => {
  it('refuse un SIREN vendeur invalide', () => {
    const invoice = simpleInvoice();
    const { siret: _siret, vatId: _vatId, ...rest } = invoice.seller;
    invoice.seller = { ...rest, siren: '123456789' };
    expect(issuesOf(invoice)).toContainEqual(
      expect.objectContaining({
        code: 'BR-FR-10',
        path: 'seller.siren',
        actual: '123456789',
      }),
    );
  });

  it('exige un SIREN pour un vendeur établi en France', () => {
    const invoice = simpleInvoice();
    const { siren: _siren, siret: _siret, ...sellerWithoutSiren } = invoice.seller;
    invoice.seller = sellerWithoutSiren;
    expect(codesAndPaths(invoice)).toContain('BR-FR-10 @ seller.siren');
  });

  it('n’applique pas les règles FR à un vendeur étranger', () => {
    const invoice = simpleInvoice();
    const { siren: _siren, siret: _siret, ...rest } = invoice.seller;
    invoice.seller = {
      ...rest,
      vatId: 'DE123456789',
      address: { ...rest.address, countryCode: 'DE' },
    };
    expect(codesAndPaths(invoice).filter((c) => c.startsWith('FR-'))).toEqual([]);
  });

  it('vérifie la cohérence SIRET ↔ SIREN et TVA ↔ SIREN', () => {
    const invoice = simpleInvoice();
    invoice.seller = { ...invoice.seller, siret: '73282932010008', vatId: 'FR44732829320' };
    const codes = codesAndPaths(invoice);
    expect(codes).toContain('BR-FR-09 @ seller.siret');
    expect(codes).toContain('FR-VAT-ID @ seller.vatId');
  });

  it('refuse une clé de TVA FR fausse', () => {
    const invoice = simpleInvoice();
    invoice.buyer = { ...invoice.buyer, vatId: 'FR41732829320' };
    expect(codesAndPaths(invoice)).toContain('FORMAT-VAT-ID @ buyer.vatId');
  });
});

describe('TVA : taux et exonérations', () => {
  it('refuse une catégorie E sans motif d’exonération', () => {
    const draft = simpleDraft();
    draft.lines[0]!.tax = { category: 'E', rate: percent('0') };
    const invoice: Invoice = { ...draft, ...computeTotals(draft) };
    expect(invoice.taxBreakdown[0]).toEqual({
      category: 'E',
      rate: 0,
      taxableAmount: 20000,
      taxAmount: 0,
    });
    expect(codesAndPaths(invoice)).toContain('BR-E-10 @ taxBreakdown[0].exemptionReason');
  });

  it('accepte une catégorie E avec code VATEX (franchise en base)', () => {
    const draft = simpleDraft();
    draft.lines[0]!.tax = { category: 'E', rate: percent('0') };
    const invoice: Invoice = {
      ...draft,
      ...computeTotals(draft, {
        exemptions: {
          E: { code: 'VATEX-FR-FRANCHISE', reason: 'TVA non applicable, art. 293 B du CGI' },
        },
      }),
    };
    expect(invoice.totals.taxTotalAmount).toBe(0);
    expect(validateInvoice(invoice).ok).toBe(true);
  });

  it('refuse un taux 0 en catégorie S (taux sans exonération justifiée)', () => {
    const draft = simpleDraft();
    draft.lines[0]!.tax = { category: 'S', rate: percent('0') };
    const invoice: Invoice = { ...draft, ...computeTotals(draft) };
    const codes = codesAndPaths(invoice);
    expect(codes).toContain('BR-S-05 @ lines[0].tax.rate');
    expect(codes).toContain('CALC-TAX-RATE @ taxBreakdown[0].rate');
  });

  it('refuse un taux non nul en autoliquidation et un motif sur une catégorie S', () => {
    const draft = simpleDraft();
    draft.lines[0]!.tax = { category: 'AE', rate: percent('20') };
    const invoice: Invoice = {
      ...draft,
      ...computeTotals(draft, { exemptions: { AE: { code: 'VATEX-EU-AE' } } }),
    };
    expect(codesAndPaths(invoice)).toContain('BR-AE-05 @ lines[0].tax.rate');

    const s = simpleInvoice();
    s.taxBreakdown[0]!.exemptionReason = 'sans objet';
    expect(codesAndPaths(s)).toContain('BR-S-10 @ taxBreakdown[0].exemptionReason');
  });
});

describe('champs obligatoires et formats', () => {
  it('accumule les anomalies de champs manquants', () => {
    const invoice = simpleInvoice();
    invoice.id = '';
    invoice.issueDate = '2026-02-30';
    invoice.lines[0]!.unitCode = '';
    invoice.paymentMeans![0]!.creditTransfer!.iban = 'FR7630006000011234567890188';
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining([
        'BR-02 @ id',
        'FORMAT-DATE @ issueDate',
        'BR-23 @ lines[0].unitCode',
        'FORMAT-IBAN @ paymentMeans[0].creditTransfer.iban',
      ]),
    );
  });

  it('refuse un montant non entier', () => {
    const invoice = simpleInvoice();
    invoice.lines[0]!.netAmount = 200.5 as never;
    expect(codesAndPaths(invoice)).toContain('FORMAT-INTEGER @ lines[0].netAmount');
  });

  it('exige les mentions de paiement françaises', () => {
    const invoice = simpleInvoice();
    invoice.paymentTerms = {
      ...invoice.paymentTerms,
      latePenaltyRate: percent('0'),
      recoveryIndemnity: cents(0),
    };
    delete (invoice as { delivery?: unknown }).delivery;
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining([
        'FR-LATE-PENALTY @ paymentTerms.latePenaltyRate',
        'FR-RECOVERY-INDEMNITY @ paymentTerms.recoveryIndemnity',
        'FR-DELIVERY @ delivery',
      ]),
    );
  });

  it('exige au moins une ligne et une ventilation', () => {
    const invoice = simpleInvoice();
    invoice.lines = [];
    invoice.taxBreakdown = [];
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining(['BR-16 @ lines', 'BR-CO-18 @ taxBreakdown']),
    );
  });
});

describe('texte des conditions de paiement (BT-20)', () => {
  it('compose les trois mentions légales', () => {
    const text = buildPaymentTermsText(simpleInvoice().paymentTerms);
    expect(text).toContain("Pénalités de retard : 10,00 % l'an");
    expect(text).toContain('frais de recouvrement en cas de retard de paiement : 40,00 €');
    expect(text).toContain("Pas d'escompte pour paiement anticipé.");
    expect(text).toContain('2026-10-11');
  });

  it('formule l’escompte quand il existe', () => {
    const text = buildPaymentTermsText(multiRateInvoice().paymentTerms);
    expect(text).toContain('Escompte pour paiement anticipé : 2,00 % si règlement sous 10 jours.');
  });
});

describe('conditions de paiement : notes légales BR-FR-05/06', () => {
  it('génère PMD, PMT et AAB depuis les champs structurés', () => {
    const notes = resolveNotes(simpleInvoice());
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMD', 'PMT', 'AAB']);
    expect(notes[0]?.text).toContain("Pénalités de retard : 10,00 % l'an");
    expect(notes[1]?.text).toContain('40,00 €');
    expect(notes[2]?.text).toBe("Pas d'escompte pour paiement anticipé.");
    expect(validateInvoice(simpleInvoice()).ok).toBe(true);
  });

  it('un texte BT-20 seul ne suffit plus : les trois notes sont exigées (facture importée sans notes)', () => {
    const invoice = simpleInvoice();
    invoice.paymentTerms = {
      dueDate: '2026-10-11',
      text: 'Pénalités : 10 %. Indemnité : 40 €. Pas d’escompte.',
    };
    const codes = codesAndPaths(invoice);
    expect(codes.filter((c) => c === 'BR-FR-05 @ notes')).toHaveLength(3);
    invoice.notes = [
      { text: 'Pénalités de retard : 10 % l’an.', subjectCode: 'PMD' },
      { text: 'Indemnité forfaitaire de 40 €.', subjectCode: 'PMT' },
      { text: 'Pas d’escompte.', subjectCode: 'AAB' },
    ];
    expect(validateInvoice(invoice).ok).toBe(true);
  });

  it('refuse une note légale en double (BR-FR-06) et ne régénère pas une note fournie', () => {
    const invoice = simpleInvoice();
    invoice.notes = [
      { text: 'Mes pénalités.', subjectCode: 'PMD' },
      { text: 'Encore.', subjectCode: 'PMD' },
    ];
    expect(codesAndPaths(invoice)).toContain('BR-FR-06 @ notes');
    invoice.notes = [{ text: 'Mes pénalités.', subjectCode: 'PMD' }];
    const notes = resolveNotes(invoice);
    expect(notes.filter((n) => n.subjectCode === 'PMD')).toEqual([
      { text: 'Mes pénalités.', subjectCode: 'PMD' },
    ]);
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMD', 'PMT', 'AAB']);
  });

  it('refuse un texte vide et vérifie les champs structurés même incomplets', () => {
    const invoice = simpleInvoice();
    invoice.paymentTerms = { text: '  ', latePenaltyRate: percent('0') };
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining([
        'FR-PAYMENT-TERMS-TEXT @ paymentTerms.text',
        'FR-LATE-PENALTY @ paymentTerms.latePenaltyRate',
        'BR-FR-05 @ notes',
      ]),
    );
    expect(() => buildPaymentTermsText({ text: 'x' })).toThrow(TypeError);
  });
});

describe('règles AFNOR XP Z12-012 : numéro, dates, cadre, TVA', () => {
  it('BR-FR-01 / BR-FR-02 : numéro de facture', () => {
    const long = simpleInvoice();
    long.id = 'F'.repeat(36);
    expect(codesAndPaths(long)).toContain('BR-FR-01 @ id');
    const chars = simpleInvoice();
    chars.id = 'F 2026#1';
    expect(codesAndPaths(chars)).toContain('BR-FR-02 @ id');
    const ok = simpleInvoice();
    ok.id = 'F/2026-0001_A+B';
    expect(codesAndPaths(ok).filter((c) => c.startsWith('BR-FR-0'))).toEqual([]);
  });

  it('BR-FR-03 : années entre 2000 et 2099, sur toutes les dates', () => {
    const invoice = simpleInvoice();
    invoice.issueDate = '1999-12-31';
    invoice.paymentTerms = { ...invoice.paymentTerms, dueDate: '2100-01-01' };
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining(['BR-FR-03 @ issueDate', 'BR-FR-03 @ paymentTerms.dueDate']),
    );
  });

  it('BR-FR-08 : cadre de facturation valide et cohérent avec la nature de l’opération', () => {
    const paid = { ...simpleInvoice(), businessProcess: 'S2' as const };
    expect(validateInvoice(paid).ok).toBe(true);
    const mismatch = { ...simpleInvoice(), businessProcess: 'B1' as const };
    expect(issuesOf(mismatch)).toContainEqual(
      expect.objectContaining({ code: 'BR-FR-08', path: 'businessProcess', actual: 'B1' }),
    );
    const unknown = { ...simpleInvoice(), businessProcess: 'S9' as never };
    expect(codesAndPaths(unknown)).toContain('BR-FR-08 @ businessProcess');
  });

  it('BR-FR-15 / BR-FR-16 : catégories et taux de TVA autorisés en France', () => {
    const draft = simpleDraft();
    draft.lines[0]!.tax = { category: 'L', rate: percent('7') };
    const invoice: Invoice = { ...draft, ...computeTotals(draft) };
    expect(codesAndPaths(invoice)).toEqual(
      expect.arrayContaining([
        'BR-FR-15 @ lines[0].tax.category',
        'BR-FR-15 @ taxBreakdown[0].category',
      ]),
    );
    const rate = simpleDraft();
    rate.lines[0]!.tax = { category: 'S', rate: percent('19') };
    const inv2: Invoice = { ...rate, ...computeTotals(rate) };
    expect(codesAndPaths(inv2)).toEqual(
      expect.arrayContaining(['BR-FR-16 @ lines[0].tax.rate', 'BR-FR-16 @ taxBreakdown[0].rate']),
    );
  });
});

describe('réforme : SIREN acheteur, nature de l’opération, TVA sur les débits, avoirs', () => {
  it('exige le SIREN d’un acheteur professionnel établi en France', () => {
    const invoice = simpleInvoice();
    const { siren: _siren, vatId: _vat, ...buyerWithoutSiren } = invoice.buyer;
    invoice.buyer = buyerWithoutSiren;
    expect(codesAndPaths(invoice)).toContain('BR-FR-11 @ buyer.siren');
  });

  it('n’exige pas le SIREN d’un particulier ni d’un acheteur étranger', () => {
    const consumer = simpleInvoice();
    const { siren: _s1, vatId: _v1, ...b1 } = consumer.buyer;
    consumer.buyer = { ...b1, consumer: true };
    expect(codesAndPaths(consumer).filter((c) => c.startsWith('BR-FR-11'))).toEqual([]);

    const foreign = simpleInvoice();
    const { siren: _s2, vatId: _v2, ...b2 } = foreign.buyer;
    foreign.buyer = { ...b2, address: { ...b2.address, countryCode: 'DE' } };
    expect(codesAndPaths(foreign).filter((c) => c.startsWith('BR-FR-11'))).toEqual([]);
  });

  it('exige la nature de l’opération et refuse une valeur inconnue', () => {
    const invoice = simpleInvoice();
    delete (invoice as { operationCategory?: unknown }).operationCategory;
    expect(codesAndPaths(invoice)).toContain('BR-FR-08 @ operationCategory');
    invoice.operationCategory = 'other' as never;
    expect(issuesOf(invoice)).toContainEqual(
      expect.objectContaining({
        code: 'BR-FR-08',
        path: 'operationCategory',
        actual: 'other',
      }),
    );
  });

  it('refuse BT-7 et BT-8 ensemble (BR-CO-03)', () => {
    const invoice = simpleInvoice();
    invoice.taxPointDate = '2026-09-10';
    invoice.vatOnDebits = true;
    expect(codesAndPaths(invoice)).toContain('BR-CO-03 @ vatOnDebits');
    delete invoice.taxPointDate;
    expect(validateInvoice(invoice).ok).toBe(true);
  });

  it('accepte un avoir (381) et refuse les autres types', () => {
    const creditNote = simpleInvoice();
    creditNote.typeCode = '381';
    creditNote.references = { precedingInvoices: [{ id: 'F-2026-0000', issueDate: '2026-08-01' }] };
    expect(validateInvoice(creditNote).ok).toBe(true);
    creditNote.typeCode = '384' as never;
    expect(issuesOf(creditNote)).toContainEqual(
      expect.objectContaining({ code: 'BR-CL-01', path: 'typeCode', actual: '384' }),
    );
  });
});
