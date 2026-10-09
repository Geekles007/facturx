import {
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  percent,
  type TaxCategoryCode,
  type TaxInfo,
} from '../../src/index.js';
import { simpleDraft } from './invoices.js';

/**
 * Factures variées par catégorie de TVA et par identifiants des parties, pour les règles 02 à 04 de
 * chaque famille EN 16931 (identifiants fiscaux exigés ou interdits). Les mêmes cas servent au SDK
 * (test/tax-identifiers.test.ts) et au schematron CEN (test/schematron.test.ts) : les verdicts
 * attendus, écrits à la main, sont ainsi confrontés au validateur de référence.
 */

/** Codes des règles d'identifiants fiscaux, sous leur nom officiel. */
export const TAX_ID_RULE = /^BR-(S|Z|E|AE|IC|G|O|AF|AG)-0[234]$/;

const EXEMPTIONS: Partial<Record<TaxCategoryCode, { code: string; reason: string }>> = {
  E: { code: 'VATEX-EU-132', reason: 'Exonération, article 261 du CGI' },
  AE: { code: 'VATEX-EU-AE', reason: 'Autoliquidation' },
  K: { code: 'VATEX-EU-IC', reason: 'Livraison intracommunautaire exonérée' },
  G: { code: 'VATEX-EU-G', reason: 'Exportation hors de l’Union' },
  O: { code: 'VATEX-EU-O', reason: 'Hors du champ de la TVA' },
};

const taxOf = (category: TaxCategoryCode): TaxInfo => {
  if (category === 'O') return { category };
  if (category === 'S' || category === 'L' || category === 'M')
    return { category, rate: percent('20') };
  return { category, rate: percent('0') };
};

export interface TaxSetup {
  line?: TaxCategoryCode;
  allowance?: TaxCategoryCode;
  charge?: TaxCategoryCode;
  sellerWithoutVat?: true;
  /** BT-32 : identifiant fiscal du vendeur, ici son SIREN. */
  sellerBt32?: true;
  buyerWithoutVat?: true;
  buyerWithoutSiren?: true;
}

/** La facture de référence (vendeur et acheteur français, numéro de TVA et SIREN), variée par `s`. */
export function invoiceWithTaxes(s: TaxSetup): Invoice {
  const draft: InvoiceDraft = simpleDraft();
  if (s.sellerWithoutVat) delete draft.seller.vatId;
  if (s.sellerBt32) draft.seller.taxRegistrationId = '443061841';
  if (s.buyerWithoutVat) delete draft.buyer.vatId;
  if (s.buyerWithoutSiren) delete draft.buyer.siren;
  draft.lines[0]!.tax = taxOf(s.line ?? 'S');
  if (s.allowance)
    draft.allowances = [{ amount: cents(1000), reason: 'Remise', tax: taxOf(s.allowance) }];
  if (s.charge) draft.charges = [{ amount: cents(1000), reason: 'Port', tax: taxOf(s.charge) }];
  const exemptions = Object.fromEntries(
    [s.line, s.allowance, s.charge].flatMap((c) =>
      c && EXEMPTIONS[c] ? [[c, EXEMPTIONS[c]]] : [],
    ),
  );
  return { ...draft, ...computeTotals(draft, { exemptions }) };
}

/** Cas : libellé, variation, anomalies attendues du SDK (« code @ chemin », triées). */
export const TAX_ID_CASES: [string, TaxSetup, string[]][] = [
  [
    'S, vendeur sans numéro de TVA ni BT-32',
    { sellerWithoutVat: true },
    ['BR-S-02 @ seller.vatId'],
  ],
  ['S, BT-32 tient lieu de numéro de TVA', { sellerWithoutVat: true, sellerBt32: true }, []],
  [
    'Z, vendeur sans numéro de TVA ni BT-32',
    { line: 'Z', sellerWithoutVat: true },
    ['BR-Z-02 @ seller.vatId'],
  ],
  [
    'E, vendeur sans numéro de TVA ni BT-32',
    { line: 'E', sellerWithoutVat: true },
    ['BR-E-02 @ seller.vatId'],
  ],
  [
    'E, BT-32 tient lieu de numéro de TVA',
    { line: 'E', sellerWithoutVat: true, sellerBt32: true },
    [],
  ],
  [
    'AE, vendeur sans identifiant fiscal',
    { line: 'AE', sellerWithoutVat: true },
    ['BR-AE-02 @ seller.vatId'],
  ],
  [
    'AE, acheteur sans numéro de TVA ni SIREN',
    { line: 'AE', buyerWithoutVat: true, buyerWithoutSiren: true },
    ['BR-AE-02 @ buyer.vatId'],
  ],
  ['AE, le SIREN de l’acheteur (BT-47) suffit', { line: 'AE', buyerWithoutVat: true }, []],
  [
    'K, acheteur sans numéro de TVA',
    { line: 'K', buyerWithoutVat: true },
    ['BR-IC-02 @ buyer.vatId'],
  ],
  [
    'K, BT-32 ne remplace pas le numéro de TVA du vendeur',
    { line: 'K', sellerWithoutVat: true, sellerBt32: true },
    ['BR-IC-02 @ seller.vatId'],
  ],
  [
    'G, BT-32 ne remplace pas le numéro de TVA du vendeur',
    { line: 'G', sellerWithoutVat: true, sellerBt32: true },
    ['BR-G-02 @ seller.vatId'],
  ],
  [
    'O, numéros de TVA du vendeur et de l’acheteur interdits',
    { line: 'O' },
    ['BR-O-02 @ buyer.vatId', 'BR-O-02 @ seller.vatId'],
  ],
  ['O, sans numéro de TVA', { line: 'O', sellerWithoutVat: true, buyerWithoutVat: true }, []],
  [
    'L (IGIC), vendeur sans identifiant fiscal',
    { line: 'L', sellerWithoutVat: true },
    ['BR-AF-02 @ seller.vatId'],
  ],
  [
    'M (IPSI), vendeur sans identifiant fiscal',
    { line: 'M', sellerWithoutVat: true },
    ['BR-AG-02 @ seller.vatId'],
  ],
  [
    'remise de document en Z : règle 03',
    { allowance: 'Z', sellerWithoutVat: true },
    ['BR-S-02 @ seller.vatId', 'BR-Z-03 @ seller.vatId'],
  ],
  [
    'frais de document en Z : règle 04',
    { charge: 'Z', sellerWithoutVat: true },
    ['BR-S-02 @ seller.vatId', 'BR-Z-04 @ seller.vatId'],
  ],
  ['vendeur et acheteur complets : rien à redire', {}, []],
];
