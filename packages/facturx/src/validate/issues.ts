import type { Invoice } from '../types/invoice.js';

/**
 * Codes d'anomalie.
 * - `BR-*`, `BR-CO-*`, `BR-CL-*`, `BR-S-*`… : règles EN 16931 (numérotation officielle).
 * - `BR-FR-*`  : règles françaises de la norme AFNOR XP Z12-012 (appliquées si le vendeur est établi en France).
 * - `FR-*`     : autres règles françaises (Code de commerce, CGI), sans identifiant AFNOR.
 * - `FORMAT-*` : formats syntaxiques (dates, IBAN, montants entiers…).
 * - `CALC-*`   : cohérences arithmétiques non couvertes par un BR officiel (montant net de ligne).
 */
export type IssueCode =
  // Obligations document
  | 'BR-02'
  | 'BR-03'
  | 'BR-04'
  | 'BR-05'
  | 'BR-06'
  | 'BR-07'
  | 'BR-08'
  | 'BR-09'
  | 'BR-10'
  | 'BR-11'
  | 'BR-12'
  | 'BR-13'
  | 'BR-14'
  | 'BR-15'
  | 'BR-16'
  // Obligations ligne
  | 'BR-21'
  | 'BR-22'
  | 'BR-23'
  | 'BR-24'
  | 'BR-25'
  | 'BR-26'
  | 'BR-27'
  | 'BR-28'
  | 'BR-29'
  | 'BR-30'
  // Remises / frais
  | 'BR-31'
  | 'BR-32'
  | 'BR-33'
  | 'BR-36'
  | 'BR-37'
  | 'BR-38'
  | 'BR-41'
  | 'BR-42'
  | 'BR-43'
  | 'BR-44'
  // Paiement
  | 'BR-49'
  | 'BR-61'
  // Conditions
  | 'BR-CO-03'
  | 'BR-CO-04'
  | 'BR-CO-09'
  | 'BR-CO-10'
  | 'BR-CO-11'
  | 'BR-CO-12'
  | 'BR-CO-13'
  | 'BR-CO-14'
  | 'BR-CO-15'
  | 'BR-CO-16'
  | 'BR-CO-17'
  | 'BR-CO-18'
  | 'BR-CO-25'
  | 'BR-CO-26'
  // Listes de codes
  | 'BR-CL-01'
  | 'BR-CL-04'
  | 'BR-CL-10'
  | 'BR-CL-14'
  | 'BR-CL-16'
  | 'BR-CL-23'
  // Catégories TVA : présence de la ventilation (-01), taux ligne (-05), remise (-06), frais (-07),
  // base imposable (-08), montant TVA (-09), motif d'exonération (-10)
  | `BR-${TaxRuleFamily}-${'01' | '05' | '06' | '07' | '08' | '09' | '10'}`
  // Règles françaises
  // Règles françaises officielles (AFNOR XP Z12-012)
  | 'BR-FR-01'
  | 'BR-FR-02'
  | 'BR-FR-03'
  | 'BR-FR-05'
  | 'BR-FR-06'
  | 'BR-FR-08'
  | 'BR-FR-09'
  | 'BR-FR-10'
  | 'BR-FR-11'
  | 'BR-FR-14'
  | 'BR-FR-15'
  | 'BR-FR-16'
  // Règles françaises sans identifiant AFNOR (Code de commerce, CGI)
  | 'FR-VAT-ID'
  | 'FR-DELIVERY'
  | 'FR-DEPOSIT-REFERENCE'
  | 'FR-LATE-PENALTY'
  | 'FR-RECOVERY-INDEMNITY'
  | 'FR-EARLY-PAYMENT-DISCOUNT'
  | 'FR-PAYMENT-TERMS-TEXT'
  // Formats
  | 'FORMAT-DATE'
  | 'FORMAT-IBAN'
  | 'FORMAT-BIC'
  | 'FORMAT-VAT-ID'
  | 'FORMAT-COUNTRY'
  | 'FORMAT-CURRENCY'
  | 'FORMAT-INTEGER'
  // Calculs
  | 'CALC-LINE-NET'
  | 'CALC-TAX-RATE';

export type TaxRuleFamily = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M';

/** Une anomalie de validation, localisée par un chemin dans l'objet `Invoice`. */
export interface Issue {
  /** Code de règle (EN 16931, FR, format ou calcul). */
  code: IssueCode;
  /** Chemin du champ fautif dans l'objet `Invoice`, ex. `lines[2].netAmount`, `seller.siren`. */
  path: string;
  /** Message lisible (français). */
  message: string;
  /** Valeur attendue, si pertinent (entiers monétaires bruts). */
  expected?: unknown;
  /** Valeur reçue, si pertinent. */
  actual?: unknown;
}

export type ValidationResult =
  | { readonly ok: true; readonly invoice: Invoice; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** Erreur agrégée levée par `assertValidInvoice()` : porte toutes les anomalies. */
export class FacturXValidationError extends Error {
  override readonly name = 'FacturXValidationError';
  readonly issues: readonly Issue[];

  constructor(issues: readonly Issue[]) {
    const head = issues
      .slice(0, 5)
      .map((i) => `  - [${i.code}] ${i.path}: ${i.message}`)
      .join('\n');
    const more = issues.length > 5 ? `\n  … et ${issues.length - 5} autre(s)` : '';
    super(`Facture invalide (${issues.length} anomalie(s)) :\n${head}${more}`);
    this.issues = issues;
  }
}

/** Collecteur interne d'anomalies. */
export class IssueCollector {
  readonly issues: Issue[] = [];

  add(code: IssueCode, path: string, message: string, detail?: Pick<Issue, 'expected' | 'actual'>) {
    const issue: Issue = { code, path, message };
    if (detail && 'expected' in detail) issue.expected = detail.expected;
    if (detail && 'actual' in detail) issue.actual = detail.actual;
    this.issues.push(issue);
  }

  get hasIssues(): boolean {
    return this.issues.length > 0;
  }
}
