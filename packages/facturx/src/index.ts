/**
 * facturx-sdk — SDK TypeScript pur pour les factures Factur-X (profil EN 16931).
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
export {
  DepositError,
  type DepositErrorCode,
  FINAL_AFTER_DEPOSIT_BY_CATEGORY,
  type WithDepositsResult,
  withDeposits,
} from './deposit.js';
export * from './electronic-address.js';
export * from './lifecycle/index.js';
export * from './limits.js';
export * from './money.js';
export {
  buildLegalNotes,
  buildPaymentTermsText,
  canBuildLegalNotes,
  hasStructuredTerms,
  type ParsedLegalNotes,
  parseLegalNotes,
  parseProcessingNote,
  resolveNotes,
  resolvePaymentTermsText,
} from './payment-terms.js';
export * from './types/index.js';
export * from './validate/index.js';
export * from './xml/index.js';
