/**
 * @geekles/facturx — SDK TypeScript pur pour les factures Factur-X (profil EN 16931).
 *
 * Ce point d'entrée ne contient que le modèle, la monnaie, la validation et le calcul des totaux.
 * La génération XML CII et l'embarquement PDF (pdf-lib) arriveront dans des entrées séparées.
 */
export {
  type ComputedTotals,
  type ComputeTotalsOptions,
  computeLineNetAmount,
  computeTotals,
} from './compute.js';
export * from './money.js';
export { buildPaymentTermsText, resolvePaymentTermsText } from './payment-terms.js';
export * from './types/index.js';
export * from './validate/index.js';
