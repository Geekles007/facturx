import { ATTACHMENT_MIME_TYPES } from '../types/attachment.js';
import { INVOICE_TYPE_CODES, TAX_CATEGORY_CODES } from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import type { Party } from '../types/party.js';
import {
  isNonEmptyString,
  isSafeInteger,
  isValidBic,
  isValidCountryCode,
  isValidCurrencyCode,
  isValidIban,
  isValidIsoDate,
  isValidVatId,
} from './formats.js';
import type { IssueCode, IssueCollector } from './issues.js';

const PAYMENT_MEANS_CODES = new Set(['10', '20', '30', '42', '48', '49', '57', '58', '59', '97']);

function checkDate(value: unknown, path: string, c: IssueCollector): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    c.add('FORMAT-DATE', path, 'Date attendue au format ISO YYYY-MM-DD.', { actual: value });
  }
}

function checkInteger(value: unknown, path: string, code: IssueCode, c: IssueCollector): boolean {
  if (value === undefined) {
    c.add(code, path, 'Montant obligatoire (entier en centimes).');
    return false;
  }
  if (!isSafeInteger(value)) {
    c.add(
      'FORMAT-INTEGER',
      path,
      'Montant attendu sous forme d’entier (centimes ou 4 décimales).',
      {
        actual: value,
      },
    );
    return false;
  }
  return true;
}

function checkOptionalInteger(value: unknown, path: string, c: IssueCollector): void {
  if (value !== undefined && !isSafeInteger(value)) {
    c.add('FORMAT-INTEGER', path, 'Montant attendu sous forme d’entier.', { actual: value });
  }
}

function checkParty(
  party: Party | undefined,
  path: string,
  codes: { name: IssueCode; address: IssueCode; country: IssueCode },
  c: IssueCollector,
): void {
  if (!party) {
    c.add(codes.name, path, 'Partie obligatoire.');
    return;
  }
  if (!isNonEmptyString(party.name)) c.add(codes.name, `${path}.name`, 'Le nom est obligatoire.');
  if (!party.address) {
    c.add(codes.address, `${path}.address`, 'L’adresse postale est obligatoire.');
  } else if (!isNonEmptyString(party.address.countryCode)) {
    c.add(codes.country, `${path}.address.countryCode`, 'Le code pays est obligatoire.');
  } else if (!isValidCountryCode(party.address.countryCode)) {
    c.add('BR-CL-14', `${path}.address.countryCode`, 'Code pays ISO 3166-1 alpha-2 attendu.', {
      actual: party.address.countryCode,
    });
  }
  if (party.vatId !== undefined) {
    if (!isValidVatId(party.vatId)) {
      c.add(
        'FORMAT-VAT-ID',
        `${path}.vatId`,
        'Numéro de TVA invalide (préfixe pays ISO puis 2 à 12 caractères ; clé vérifiée pour FR).',
        { actual: party.vatId },
      );
    } else if (party.address && party.vatId.slice(0, 2) !== party.address.countryCode) {
      // BR-CO-09 impose un préfixe pays ; on tolère « EL » pour la Grèce (GR) et « XI » (Irlande du Nord).
      const prefix = party.vatId.slice(0, 2);
      const tolerated =
        (prefix === 'EL' && party.address.countryCode === 'GR') ||
        (prefix === 'XI' && party.address.countryCode === 'GB');
      if (!tolerated) {
        c.add(
          'BR-CO-09',
          `${path}.vatId`,
          'Le numéro de TVA doit commencer par le code pays ISO 3166-1 de la partie.',
          { expected: party.address.countryCode, actual: prefix },
        );
      }
    }
  }
}

/** Champs obligatoires, listes de codes et formats syntaxiques. */
export function checkRequired(inv: Invoice, c: IssueCollector): void {
  if (!isNonEmptyString(inv.id))
    c.add('BR-02', 'id', 'Le numéro de facture (BT-1) est obligatoire.');

  if (!isNonEmptyString(inv.issueDate)) {
    c.add('BR-03', 'issueDate', 'La date d’émission (BT-2) est obligatoire.');
  } else {
    checkDate(inv.issueDate, 'issueDate', c);
  }

  if (!isNonEmptyString(inv.typeCode)) {
    c.add('BR-04', 'typeCode', 'Le type de facture (BT-3) est obligatoire.');
  } else if (!INVOICE_TYPE_CODES.includes(inv.typeCode)) {
    c.add(
      'BR-CL-01',
      'typeCode',
      'Type de facture (BT-3) hors des codes pris en charge (BR-FR-04, codes intégrés à EN 16931).',
      {
        expected: INVOICE_TYPE_CODES,
        actual: inv.typeCode,
      },
    );
  }

  if (!isNonEmptyString(inv.currency)) {
    c.add('BR-05', 'currency', 'La devise (BT-5) est obligatoire.');
  } else if (!isValidCurrencyCode(inv.currency)) {
    c.add('FORMAT-CURRENCY', 'currency', 'Code devise ISO 4217 attendu (3 lettres).', {
      actual: inv.currency,
    });
  }

  checkDate(inv.taxPointDate, 'taxPointDate', c);
  if (inv.taxPointDate !== undefined && inv.vatOnDebits === true) {
    c.add(
      'BR-CO-03',
      'vatOnDebits',
      'La date d’exigibilité (BT-7) et l’option TVA sur les débits (BT-8) sont mutuellement exclusives.',
    );
  }

  checkParty(inv.seller, 'seller', { name: 'BR-06', address: 'BR-08', country: 'BR-09' }, c);
  checkParty(inv.buyer, 'buyer', { name: 'BR-07', address: 'BR-10', country: 'BR-11' }, c);

  if (inv.seller && !(inv.seller.siren || inv.seller.siret || inv.seller.vatId)) {
    c.add(
      'BR-CO-26',
      'seller',
      'Le vendeur doit porter au moins un identifiant : SIREN (BT-30), SIRET (BT-29) ou TVA (BT-31).',
    );
  }

  // Livraison
  if (inv.delivery) {
    checkDate(inv.delivery.date, 'delivery.date', c);
    checkDate(inv.delivery.period?.start, 'delivery.period.start', c);
    checkDate(inv.delivery.period?.end, 'delivery.period.end', c);
    const { start, end } = inv.delivery.period ?? {};
    if (start && end && isValidIsoDate(start) && isValidIsoDate(end) && end < start) {
      c.add('BR-29', 'delivery.period.end', 'La fin de période doit être ≥ au début.', {
        expected: `≥ ${start}`,
        actual: end,
      });
    }
  }

  // Références
  for (const [i, ref] of (inv.references?.precedingInvoices ?? []).entries()) {
    if (!isNonEmptyString(ref.id)) {
      c.add(
        'BR-02',
        `references.precedingInvoices[${i}].id`,
        'Le numéro de facture antérieure (BT-25) est obligatoire.',
      );
    }
    checkDate(ref.issueDate, `references.precedingInvoices[${i}].issueDate`, c);
  }

  // Lignes
  if (!Array.isArray(inv.lines) || inv.lines.length === 0) {
    c.add('BR-16', 'lines', 'La facture doit comporter au moins une ligne (BG-25).');
  } else {
    const seenIds = new Set<string>();
    for (const [i, line] of inv.lines.entries()) {
      const p = `lines[${i}]`;
      if (!isNonEmptyString(line.id)) {
        c.add('BR-21', `${p}.id`, 'L’identifiant de ligne (BT-126) est obligatoire.');
      } else if (seenIds.has(line.id)) {
        c.add('BR-21', `${p}.id`, 'L’identifiant de ligne (BT-126) doit être unique.', {
          actual: line.id,
        });
      } else {
        seenIds.add(line.id);
      }
      if (!isNonEmptyString(line.name)) {
        c.add('BR-25', `${p}.name`, 'La désignation de l’article (BT-153) est obligatoire.');
      }
      checkInteger(line.quantity, `${p}.quantity`, 'BR-22', c);
      if (!isNonEmptyString(line.unitCode)) {
        c.add('BR-23', `${p}.unitCode`, 'L’unité de quantité (BT-130) est obligatoire.');
      }
      if (checkInteger(line.unitPrice, `${p}.unitPrice`, 'BR-26', c) && line.unitPrice < 0) {
        c.add(
          'BR-27',
          `${p}.unitPrice`,
          'Le prix unitaire net (BT-146) ne peut pas être négatif.',
          {
            actual: line.unitPrice,
          },
        );
      }
      checkOptionalInteger(line.grossUnitPrice, `${p}.grossUnitPrice`, c);
      if (line.grossUnitPrice !== undefined && line.grossUnitPrice < 0) {
        c.add(
          'BR-28',
          `${p}.grossUnitPrice`,
          'Le prix unitaire brut (BT-148) ne peut pas être négatif.',
          {
            actual: line.grossUnitPrice,
          },
        );
      }
      checkOptionalInteger(line.priceDiscount, `${p}.priceDiscount`, c);
      checkOptionalInteger(line.baseQuantity, `${p}.baseQuantity`, c);
      checkInteger(line.netAmount, `${p}.netAmount`, 'BR-24', c);
      if (!line.tax || !isNonEmptyString(line.tax.category)) {
        c.add(
          'BR-CO-04',
          `${p}.tax.category`,
          'La catégorie TVA de ligne (BT-151) est obligatoire.',
        );
      } else if (!TAX_CATEGORY_CODES.includes(line.tax.category)) {
        c.add('BR-CL-10', `${p}.tax.category`, 'Catégorie TVA inconnue (UNTDID 5305).', {
          actual: line.tax.category,
        });
      }
      checkOptionalInteger(line.tax?.rate, `${p}.tax.rate`, c);
      checkDate(line.period?.start, `${p}.period.start`, c);
      checkDate(line.period?.end, `${p}.period.end`, c);
      const { start, end } = line.period ?? {};
      if (start && end && isValidIsoDate(start) && isValidIsoDate(end) && end < start) {
        c.add('BR-30', `${p}.period.end`, 'La fin de période de ligne doit être ≥ au début.', {
          expected: `≥ ${start}`,
          actual: end,
        });
      }
      for (const [j, a] of (line.allowances ?? []).entries()) {
        checkInteger(a.amount, `${p}.allowances[${j}].amount`, 'BR-41', c);
        if (!isNonEmptyString(a.reason) && !isNonEmptyString(a.reasonCode)) {
          c.add(
            'BR-42',
            `${p}.allowances[${j}]`,
            'Motif de remise (BT-139) ou code (BT-140) obligatoire.',
          );
        }
      }
      for (const [j, ch] of (line.charges ?? []).entries()) {
        checkInteger(ch.amount, `${p}.charges[${j}].amount`, 'BR-43', c);
        if (!isNonEmptyString(ch.reason) && !isNonEmptyString(ch.reasonCode)) {
          c.add(
            'BR-44',
            `${p}.charges[${j}]`,
            'Motif de frais (BT-144) ou code (BT-145) obligatoire.',
          );
        }
      }
    }
  }

  // Remises / frais document
  for (const [i, a] of (inv.allowances ?? []).entries()) {
    const p = `allowances[${i}]`;
    checkInteger(a.amount, `${p}.amount`, 'BR-31', c);
    if (!a.tax || !isNonEmptyString(a.tax.category)) {
      c.add('BR-32', `${p}.tax.category`, 'La catégorie TVA de la remise (BT-95) est obligatoire.');
    }
    if (!isNonEmptyString(a.reason) && !isNonEmptyString(a.reasonCode)) {
      c.add('BR-33', p, 'Motif de remise (BT-97) ou code (BT-98) obligatoire.');
    }
  }
  for (const [i, ch] of (inv.charges ?? []).entries()) {
    const p = `charges[${i}]`;
    checkInteger(ch.amount, `${p}.amount`, 'BR-36', c);
    if (!ch.tax || !isNonEmptyString(ch.tax.category)) {
      c.add('BR-37', `${p}.tax.category`, 'La catégorie TVA des frais (BT-102) est obligatoire.');
    }
    if (!isNonEmptyString(ch.reason) && !isNonEmptyString(ch.reasonCode)) {
      c.add('BR-38', p, 'Motif de frais (BT-104) ou code (BT-105) obligatoire.');
    }
  }

  // Documents justificatifs (BG-24)
  for (const [i, a] of (inv.attachments ?? []).entries()) {
    const p = `attachments[${i}]`;
    if (!isNonEmptyString(a.id))
      c.add('BR-52', `${p}.id`, 'L’identifiant du document justificatif (BT-122) est obligatoire.');
    if (a.file) {
      if (!isNonEmptyString(a.file.filename))
        c.add('BR-52', `${p}.file.filename`, 'Le nom du fichier joint (BT-125-2) est obligatoire.');
      if (!ATTACHMENT_MIME_TYPES.includes(a.file.mimeType)) {
        c.add(
          'BR-CL-24',
          `${p}.file.mimeType`,
          'Type MIME de pièce jointe non autorisé (PDF, PNG, JPEG, CSV, XLSX, ODS).',
          {
            expected: ATTACHMENT_MIME_TYPES,
            actual: a.file.mimeType,
          },
        );
      }
      if (!(a.file.bytes instanceof Uint8Array)) {
        c.add('FORMAT-BINARY', `${p}.file.bytes`, 'Contenu attendu en Uint8Array.');
      }
    }
  }

  // Ventilation TVA
  if (!Array.isArray(inv.taxBreakdown) || inv.taxBreakdown.length === 0) {
    c.add(
      'BR-CO-18',
      'taxBreakdown',
      'La facture doit comporter au moins une ventilation TVA (BG-23).',
    );
  } else {
    for (const [i, tb] of inv.taxBreakdown.entries()) {
      const p = `taxBreakdown[${i}]`;
      if (!TAX_CATEGORY_CODES.includes(tb.category)) {
        c.add('BR-CL-10', `${p}.category`, 'Catégorie TVA inconnue (UNTDID 5305).', {
          actual: tb.category,
        });
      }
      checkOptionalInteger(tb.rate, `${p}.rate`, c);
      checkInteger(tb.taxableAmount, `${p}.taxableAmount`, 'BR-CO-18', c);
      checkInteger(tb.taxAmount, `${p}.taxAmount`, 'BR-CO-18', c);
    }
  }

  // Totaux
  if (!inv.totals) {
    c.add('BR-12', 'totals', 'Les totaux (BG-22) sont obligatoires.');
  } else {
    const t = inv.totals;
    checkInteger(t.lineTotalAmount, 'totals.lineTotalAmount', 'BR-12', c);
    checkOptionalInteger(t.allowanceTotalAmount, 'totals.allowanceTotalAmount', c);
    checkOptionalInteger(t.chargeTotalAmount, 'totals.chargeTotalAmount', c);
    checkInteger(t.taxExclusiveAmount, 'totals.taxExclusiveAmount', 'BR-13', c);
    checkInteger(t.taxTotalAmount, 'totals.taxTotalAmount', 'BR-CO-14', c);
    checkInteger(t.taxInclusiveAmount, 'totals.taxInclusiveAmount', 'BR-14', c);
    checkOptionalInteger(t.prepaidAmount, 'totals.prepaidAmount', c);
    checkOptionalInteger(t.roundingAmount, 'totals.roundingAmount', c);
    checkInteger(t.amountDueForPayment, 'totals.amountDueForPayment', 'BR-15', c);
  }

  // Conditions de paiement
  if (!inv.paymentTerms) {
    c.add('BR-CO-25', 'paymentTerms', 'Les conditions de paiement sont obligatoires.');
  } else {
    checkDate(inv.paymentTerms.dueDate, 'paymentTerms.dueDate', c);
    const due = inv.totals?.amountDueForPayment;
    const hasTerms =
      inv.paymentTerms.dueDate !== undefined ||
      isNonEmptyString(inv.paymentTerms.text) ||
      isSafeInteger(inv.paymentTerms.latePenaltyRate);
    if (isSafeInteger(due) && due > 0 && !hasTerms) {
      c.add(
        'BR-CO-25',
        'paymentTerms',
        'Si le montant à payer est > 0, la date d’échéance (BT-9) ou les conditions de paiement (BT-20) sont obligatoires.',
      );
    }
  }

  // Moyens de paiement
  for (const [i, pm] of (inv.paymentMeans ?? []).entries()) {
    const p = `paymentMeans[${i}]`;
    if (!isNonEmptyString(pm.typeCode)) {
      c.add('BR-49', `${p}.typeCode`, 'Le code du moyen de paiement (BT-81) est obligatoire.');
    } else if (!PAYMENT_MEANS_CODES.has(pm.typeCode)) {
      c.add('BR-CL-16', `${p}.typeCode`, 'Code de moyen de paiement inconnu (UNTDID 4461).', {
        actual: pm.typeCode,
      });
    }
    if (
      (pm.typeCode === '30' || pm.typeCode === '58') &&
      !isNonEmptyString(pm.creditTransfer?.iban)
    ) {
      c.add(
        'BR-61',
        `${p}.creditTransfer.iban`,
        'Un compte (BT-84) est obligatoire pour un virement (30/58).',
      );
    }
    if (pm.creditTransfer?.iban !== undefined && !isValidIban(pm.creditTransfer.iban)) {
      c.add('FORMAT-IBAN', `${p}.creditTransfer.iban`, 'IBAN invalide (clé mod 97).', {
        actual: pm.creditTransfer.iban,
      });
    }
    if (pm.creditTransfer?.bic !== undefined && !isValidBic(pm.creditTransfer.bic)) {
      c.add('FORMAT-BIC', `${p}.creditTransfer.bic`, 'BIC invalide (8 ou 11 caractères).', {
        actual: pm.creditTransfer.bic,
      });
    }
    if (pm.directDebit?.debitedIban !== undefined && !isValidIban(pm.directDebit.debitedIban)) {
      c.add('FORMAT-IBAN', `${p}.directDebit.debitedIban`, 'IBAN invalide (clé mod 97).', {
        actual: pm.directDebit.debitedIban,
      });
    }
  }
}
