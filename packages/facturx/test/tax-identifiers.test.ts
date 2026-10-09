import { describe, expect, it } from 'vitest';
import { computeTotals, type Invoice, percent, validateInvoice } from '../src/index.js';
import { simpleDraft } from './fixtures/invoices.js';
import { invoiceWithTaxes, TAX_ID_CASES, TAX_ID_RULE } from './fixtures/tax-categories.js';

/**
 * Identifiants fiscaux exigés ou interdits selon la catégorie de TVA : règles 02 (lignes), 03 (remises)
 * et 04 (frais de document) de chaque famille EN 16931. Les familles portent leur nom officiel :
 * K → BR-IC (livraison intracommunautaire), L → BR-AF (IGIC), M → BR-AG (IPSI).
 */

/** Les anomalies des seules règles d'identifiants fiscaux, « code @ chemin », triées. */
function taxIdIssues(inv: Invoice): string[] {
  const result = validateInvoice(inv);
  return (result.ok ? [] : result.issues)
    .filter((i) => TAX_ID_RULE.test(i.code))
    .map((i) => `${i.code} @ ${i.path}`)
    .sort();
}

describe('identifiants fiscaux selon la catégorie de TVA (règles 02 à 04)', () => {
  it.each(TAX_ID_CASES)('%s', (_, setup, expected) => {
    expect(taxIdIssues(invoiceWithTaxes(setup))).toEqual(expected);
  });

  it('une ligne par catégorie ne multiplie pas l’anomalie', () => {
    const inv = invoiceWithTaxes({ sellerWithoutVat: true });
    const twoLines: Invoice = {
      ...inv,
      lines: [...inv.lines, { ...inv.lines[0]!, id: '2' }],
    };
    expect(taxIdIssues(twoLines)).toEqual(['BR-S-02 @ seller.vatId']);
  });

  it('en franchise en base, BR-FR-CO-16 parle seule : pas de BR-E-02 en double', () => {
    const draft = simpleDraft();
    delete draft.seller.vatId;
    draft.lines[0]!.tax = { category: 'E', rate: percent('0') };
    const inv: Invoice = {
      ...draft,
      ...computeTotals(draft, {
        exemptions: {
          E: { code: 'VATEX-FR-FRANCHISE', reason: 'TVA non applicable, art. 293 B du CGI' },
        },
      }),
    };
    expect(taxIdIssues(inv)).toEqual([]);
    const result = validateInvoice(inv);
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toContain('BR-FR-CO-16');
  });
});
