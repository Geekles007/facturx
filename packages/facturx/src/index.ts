/**
 * @geekles/facturx — SDK TypeScript pur pour les factures Factur-X (profil EN 16931).
 *
 * Ce point d'entrée contient le modèle, la monnaie, la validation, le calcul des totaux et la génération XML CII.
 * L'embarquement PDF (pdf-lib) arrivera dans une entrée séparée.
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
export * from './xml/index.js';
