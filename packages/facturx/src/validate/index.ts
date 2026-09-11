import type { Invoice } from '../types/invoice.js';
import { checkArithmetic } from './arithmetic.js';
import { checkFrenchRules } from './french.js';
import { FacturXValidationError, IssueCollector, type ValidationResult } from './issues.js';
import { checkRequired } from './required.js';

export { taxKey } from './arithmetic.js';
export * from './formats.js';
export type { Issue, IssueCode, ValidationResult } from './issues.js';
export { FacturXValidationError } from './issues.js';

/**
 * Valide une facture : champs obligatoires, formats, cohérence arithmétique et règles françaises.
 * Accumule TOUTES les anomalies ; ne modifie jamais la facture.
 */
export function validateInvoice(invoice: Invoice): ValidationResult {
  const c = new IssueCollector();
  checkRequired(invoice, c);
  checkArithmetic(invoice, c);
  checkFrenchRules(invoice, c);
  return c.hasIssues ? { ok: false, issues: c.issues } : { ok: true, invoice, issues: [] };
}

/** Comme `validateInvoice`, mais lève une `FacturXValidationError` portant toutes les anomalies. */
export function assertValidInvoice(invoice: Invoice): Invoice {
  const result = validateInvoice(invoice);
  if (!result.ok) throw new FacturXValidationError(result.issues);
  return result.invoice;
}
