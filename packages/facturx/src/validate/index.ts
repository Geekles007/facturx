import { type Limits, resolveLimits } from '../limits.js';
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
export interface ValidateOptions {
  /** Limites de taille (BR-FR-19, pièces jointes) ; défaut : `DEFAULT_LIMITS`. */
  limits?: Partial<Limits>;
}

export function validateInvoice(invoice: Invoice, options: ValidateOptions = {}): ValidationResult {
  const c = new IssueCollector();
  checkRequired(invoice, c);
  checkArithmetic(invoice, c);
  checkFrenchRules(invoice, c, resolveLimits(options.limits));
  return c.hasIssues ? { ok: false, issues: c.issues } : { ok: true, invoice, issues: [] };
}

/** Comme `validateInvoice`, mais lève une `FacturXValidationError` portant toutes les anomalies. */
export function assertValidInvoice(invoice: Invoice, options: ValidateOptions = {}): Invoice {
  const result = validateInvoice(invoice, options);
  if (!result.ok) throw new FacturXValidationError(result.issues);
  return result.invoice;
}
