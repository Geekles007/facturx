/**
 * Validation d'un statut du cycle de vie.
 *
 * Mêmes principes que `validateInvoice` : toutes les anomalies sont accumulées, rien n'est corrigé
 * en silence, et chaque anomalie porte le code de la règle officielle, le chemin du champ fautif,
 * l'attendu et le reçu. Les codes `G*` sont ceux de l'annexe 7 « Règles de gestion » v1.9 du dossier
 * de spécifications externes DGFiP v3.2.
 */

import { isValidCurrencyCode, isValidIsoDate, isValidSiren } from '../validate/formats.js';
import {
  LIFECYCLE_STATUS_CODES,
  type LifecycleStatus,
  REFUSAL_REASON_LABELS,
  S6_REFUSAL_REASONS,
} from './types.js';

/**
 * Codes d'anomalie d'un statut.
 * - `G*` : règles de gestion officielles (annexe 7).
 * - `FORMAT-*` : formats syntaxiques, sans règle officielle dédiée.
 */
export type LifecycleIssueCode =
  /** Seuls les quatre statuts obligatoires sont transmissibles ; sinon rejet `REJ_RG`. */
  | 'G7.44'
  /** Code motif exigé sur un refus (210) ou un rejet (213). */
  | 'G7.08'
  /** Commentaire exigé sur un refus (210). */
  | 'G7.25'
  /** Refus d'une facture au cadre S6 : motifs restreints. */
  | 'G7.39'
  /** Montant encaissé exprimé en euros. */
  | 'G6.27'
  /** Identification de l'émetteur de la facture obligatoire dans un CDV de facture. */
  | 'G7.17'
  /** Montant qualifié par un code de la liste G7.12. */
  | 'G7.12'
  | 'FORMAT-DATETIME'
  | 'FORMAT-INVOICE-ID'
  | 'FORMAT-REASON-CODE'
  | 'FORMAT-REASON-LABEL';

export interface LifecycleIssue {
  code: LifecycleIssueCode;
  /** Chemin du champ fautif dans l'objet `LifecycleStatus`, ex. `reasonCode`, `invoice.sellerSiren`. */
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export type LifecycleValidationResult =
  | { readonly ok: true; readonly status: LifecycleStatus; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly LifecycleIssue[] };

export class FacturXLifecycleError extends Error {
  override readonly name = 'FacturXLifecycleError';
  readonly issues: readonly LifecycleIssue[];

  constructor(issues: readonly LifecycleIssue[]) {
    const head = issues.map((i) => `  - [${i.code}] ${i.path}: ${i.message}`).join('\n');
    super(`Statut invalide (${issues.length} anomalie(s)) :\n${head}`);
    this.issues = issues;
  }
}

/** MDT-114 — libellé de motif, 250 caractères au plus. */
const REASON_LABEL_MAX = 250;
/** BT-1 — numéro de facture, 35 caractères au plus (BR-FR-01). */
const INVOICE_ID_MAX = 35;

const AMOUNT_CODES = new Set(['RAP', 'ESC', 'RAB', 'REM', 'MPA', 'MEN']);

/** Date-heure ISO 8601 : `2026-09-15T08:30:00Z` ou avec décalage explicite. */
function isValidDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/**
 * Valide le contenu d'un statut du cycle de vie. N'effectue aucun appel réseau : les contrôles qui
 * relèvent de la plateforme (existence de la facture, présence dans l'annuaire) sont hors périmètre.
 */
export function validateLifecycleStatus(status: LifecycleStatus): LifecycleValidationResult {
  const issues: LifecycleIssue[] = [];
  const add = (
    code: LifecycleIssueCode,
    path: string,
    message: string,
    detail?: Pick<LifecycleIssue, 'expected' | 'actual'>,
  ) => {
    issues.push({ code, path, message, ...detail });
  };

  // G7.44 — un cycle de vie référençant un statut non obligatoire est rejeté (motif REJ_RG).
  if (!LIFECYCLE_STATUS_CODES.includes(status.code)) {
    add('G7.44', 'code', 'Statut non transmissible au portail public de facturation', {
      expected: LIFECYCLE_STATUS_CODES,
      actual: status.code,
    });
  }

  if (!isValidDateTime(status.dateTime)) {
    add('FORMAT-DATETIME', 'dateTime', 'Horodatage attendu en ISO 8601 avec fuseau', {
      expected: '2026-09-15T08:30:00Z',
      actual: status.dateTime,
    });
  }

  // G7.17 — dans un CDV de facture, l'identification de l'émetteur est obligatoire.
  if (!status.invoice.sellerSiren) {
    add('G7.17', 'invoice.sellerSiren', 'SIREN du fournisseur obligatoire dans un CDV de facture');
  } else if (!isValidSiren(status.invoice.sellerSiren)) {
    add('G7.17', 'invoice.sellerSiren', 'SIREN invalide (9 chiffres, clé de Luhn)', {
      actual: status.invoice.sellerSiren,
    });
  }

  if (!status.invoice.id) {
    add('FORMAT-INVOICE-ID', 'invoice.id', 'Numéro de la facture visée obligatoire');
  } else if (status.invoice.id.length > INVOICE_ID_MAX) {
    add('FORMAT-INVOICE-ID', 'invoice.id', `Numéro de facture trop long`, {
      expected: `≤ ${INVOICE_ID_MAX} caractères`,
      actual: status.invoice.id.length,
    });
  }

  // G1.45/G7.31 — l'année d'émission entre dans l'identifiant de la facture.
  if (!isValidIsoDate(status.invoice.issueDate)) {
    add('FORMAT-DATETIME', 'invoice.issueDate', "Date d'émission attendue au format AAAA-MM-JJ", {
      actual: status.invoice.issueDate,
    });
  }

  // G7.08 — code motif exigé sur un refus (210) et sur un rejet (213).
  const exigeMotif = status.code === '210' || status.code === '213';
  if (exigeMotif && !status.reasonCode) {
    add('G7.08', 'reasonCode', 'Code motif obligatoire pour un refus (210) ou un rejet (213)');
  }
  if (status.reasonCode && !(status.reasonCode in REFUSAL_REASON_LABELS)) {
    add('FORMAT-REASON-CODE', 'reasonCode', 'Code motif hors de la liste officielle', {
      actual: status.reasonCode,
    });
  }
  if (status.reasonLabel && status.reasonLabel.length > REASON_LABEL_MAX) {
    add('FORMAT-REASON-LABEL', 'reasonLabel', 'Libellé de motif trop long', {
      expected: `≤ ${REASON_LABEL_MAX} caractères`,
      actual: status.reasonLabel.length,
    });
  }

  // G7.25 — un refus doit être motivé par un commentaire.
  if (status.code === '210' && !status.comment?.trim()) {
    add('G7.25', 'comment', 'Commentaire motivant le refus obligatoire (statut 210)');
  }

  // G7.39 — refus d'une facture déposée par un cotraitant (cadre S6) : motifs restreints.
  if (
    status.code === '210' &&
    status.businessProcess === 'S6' &&
    status.reasonCode &&
    !S6_REFUSAL_REASONS.includes(status.reasonCode)
  ) {
    add('G7.39', 'reasonCode', 'Motif de refus interdit pour une facture au cadre S6', {
      expected: S6_REFUSAL_REASONS,
      actual: status.reasonCode,
    });
  }

  if (status.amount) {
    if (!AMOUNT_CODES.has(status.amount.code)) {
      add('G7.12', 'amount.code', 'Code montant hors de la liste officielle', {
        expected: [...AMOUNT_CODES],
        actual: status.amount.code,
      });
    }
    if (!isValidCurrencyCode(status.amount.currency)) {
      add('G6.27', 'amount.currency', 'Code devise ISO 4217 attendu', {
        actual: status.amount.currency,
      });
    } else if (status.amount.code === 'MEN' && status.amount.currency !== 'EUR') {
      // G6.27 — la valeur du montant encaissé doit être exprimée en euros.
      add('G6.27', 'amount.currency', 'Le montant encaissé doit être exprimé en euros', {
        expected: 'EUR',
        actual: status.amount.currency,
      });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, status, issues: [] };
}

/** Comme `validateLifecycleStatus`, mais lève une erreur portant toutes les anomalies. */
export function assertValidLifecycleStatus(status: LifecycleStatus): LifecycleStatus {
  const result = validateLifecycleStatus(status);
  if (!result.ok) throw new FacturXLifecycleError(result.issues);
  return result.status;
}
