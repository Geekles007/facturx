import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeTotals, type Invoice, percent, toCiiXml, validateInvoice } from '../src/index.js';
import { simpleDraft } from './fixtures/invoices.js';
import {
  blockingFailures,
  describeFailures,
  RULESETS,
  runSchematron,
  schemasDir,
  schematronsAvailable,
} from './helpers/schematron.js';

/**
 * Validation par les schematrons officiels de la réforme (France_RFE v1.4.0.04), exécutés avec
 * Saxon-JS (pas de Java) — ceux du profil EN 16931, le seul que le SDK produit :
 *   - EN 16931 CII (CEN) — les règles BR-*, BR-CO-*, BR-CL-*, BR-S/E/AE/… que le SDK implémente lui-même ;
 *   - profil Factur-X EN 16931 1.09.2 (FNFE / ZUGFeRD) ;
 *   - BR-FR Flux 2 (AFNOR XP Z12-012 V1.4), les règles françaises appliquées par les plateformes agréées.
 * Les XSLT sont récupérées par `pnpm schemas:fetch` (git-ignorées) ; le test est ignoré si elles manquent.
 */
const goldenDir = new URL('./golden/', import.meta.url).pathname;

describe.skipIf(!schematronsAvailable())('schematrons officiels (Saxon-JS)', () => {
  const goldens = readdirSync(goldenDir).filter((f) => f.endsWith('.xml'));

  for (const ruleset of RULESETS) {
    it.each(goldens)(
      `${ruleset.name} — %s`,
      (file) => {
        const failures = blockingFailures(
          runSchematron(join(schemasDir, ruleset.sef), readFileSync(join(goldenDir, file), 'utf8')),
        );
        expect(
          failures,
          `${ruleset.name} : ${failures.length} règle(s) violée(s) dans ${file}\n${describeFailures(failures)}`,
        ).toEqual([]);
      },
      60_000,
    );
  }

  it('le harnais détecte une violation (contrôle négatif)', () => {
    const xml = readFileSync(join(goldenDir, 'simple.xml'), 'utf8').replace(
      '<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>240.01</ram:GrandTotalAmount>',
    );
    const failures = runSchematron(join(schemasDir, 'EN16931-CII-validation.sef.json'), xml);
    expect(failures.map((f) => f.id)).toContain('BR-CO-15');
  }, 60_000);

  /**
   * BR-FR-CO-16 (franchise en base) n'est dans aucun schematron, mais sa conséquence l'est : sans
   * numéro de TVA ni BT-32, le CEN refuse une facture en catégorie E (BR-E-02). Le SDK doit rendre le
   * même verdict, et accepter ce que la règle demande : le SIREN répété en BT-32.
   */
  describe('franchise en base d’un vendeur sans numéro de TVA', () => {
    const franchise = (taxRegistrationId?: string): Invoice => {
      const draft = simpleDraft();
      delete draft.seller.vatId;
      if (taxRegistrationId) draft.seller.taxRegistrationId = taxRegistrationId;
      draft.lines[0]!.tax = { category: 'E', rate: percent('0') };
      return {
        ...draft,
        ...computeTotals(draft, {
          exemptions: {
            E: { code: 'VATEX-FR-FRANCHISE', reason: 'TVA non applicable, art. 293 B du CGI' },
          },
        }),
      };
    };
    const failuresOf = (invoice: Invoice) =>
      RULESETS.flatMap((r) =>
        blockingFailures(
          runSchematron(join(schemasDir, r.sef), toCiiXml(invoice, { validate: false })),
        ),
      ).map((f) => f.id);

    it('SIREN répété en BT-32 : accepté par le SDK et les trois schematrons', () => {
      const invoice = franchise('443061841');
      expect(validateInvoice(invoice).ok).toBe(true);
      expect(failuresOf(invoice)).toEqual([]);
    }, 60_000);

    it('sans BT-32 : refusé par le SDK (BR-FR-CO-16) comme par le CEN (BR-E-02)', () => {
      const invoice = franchise();
      const sdk = validateInvoice(invoice);
      expect(sdk.ok ? [] : sdk.issues.map((i) => i.code)).toContain('BR-FR-CO-16');
      expect(failuresOf(invoice)).toContain('BR-E-02');
    }, 60_000);
  });
});
