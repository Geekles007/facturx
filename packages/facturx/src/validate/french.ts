import {
  ELECTRONIC_ADDRESS_MAX_LENGTH,
  isValidEmailAddress,
  ROUTING_CHARS,
  ROUTING_CODE_MAX_LENGTH,
} from '../electronic-address.js';
import { resolveNotes } from '../payment-terms.js';
import {
  BUSINESS_PROCESS_CODES,
  FRENCH_TAX_CATEGORY_CODES,
  FRENCH_VAT_RATES_BPS,
  isBusinessProcessCode,
  isProcessingCode,
  isSelfBilledType,
  LEGAL_NOTE_CODES,
  OPERATION_CATEGORIES,
  operationCategoryFromBusinessProcess,
} from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import type { Party } from '../types/party.js';
import type { TaxInfo } from '../types/tax.js';
import {
  isNonEmptyString,
  isSafeInteger,
  isValidIsoDate,
  isValidSiren,
  isValidSiret,
} from './formats.js';
import type { IssueCollector } from './issues.js';

const INVOICE_ID_CHARS = /^[A-Za-z0-9+_/-]+$/;

function checkPartyIds(
  party: Party | undefined,
  path: string,
  sirenRule: 'BR-FR-10' | 'BR-FR-11',
  sirenRequired: boolean,
  c: IssueCollector,
): void {
  if (!party) return;
  if (party.siren === undefined) {
    if (sirenRequired) {
      c.add(
        sirenRule,
        `${path}.siren`,
        `Le SIREN (schéma 0002) est obligatoire pour ${path === 'seller' ? 'un vendeur' : 'un acheteur professionnel'} établi en France.`,
      );
    }
  } else if (!isValidSiren(party.siren)) {
    c.add(sirenRule, `${path}.siren`, 'SIREN invalide : 9 chiffres avec clé de Luhn attendus.', {
      actual: party.siren,
    });
  }
  if (party.siret !== undefined) {
    if (!isValidSiret(party.siret)) {
      c.add(
        'BR-FR-09',
        `${path}.siret`,
        'SIRET invalide : 14 chiffres avec clé de Luhn attendus.',
        {
          actual: party.siret,
        },
      );
    } else if (party.siren !== undefined && !party.siret.startsWith(party.siren)) {
      c.add(
        'BR-FR-09',
        `${path}.siret`,
        'Les 9 premiers chiffres du SIRET doivent être le SIREN de la partie.',
        {
          expected: `${party.siren}…`,
          actual: party.siret,
        },
      );
    }
  }
  if (
    party.vatId !== undefined &&
    party.siren !== undefined &&
    party.vatId.startsWith('FR') &&
    party.vatId.length === 13 &&
    party.vatId.slice(4) !== party.siren
  ) {
    c.add(
      'FR-VAT-ID',
      `${path}.vatId`,
      'Le numéro de TVA FR doit se terminer par le SIREN de la partie.',
      {
        expected: `FR…${party.siren}`,
        actual: party.vatId,
      },
    );
  }
}

/** Toutes les dates du document avec leur chemin (pour BR-FR-03). */
function collectDates(inv: Invoice): [string, unknown][] {
  const out: [string, unknown][] = [
    ['issueDate', inv.issueDate],
    ['taxPointDate', inv.taxPointDate],
    ['delivery.date', inv.delivery?.date],
    ['delivery.period.start', inv.delivery?.period?.start],
    ['delivery.period.end', inv.delivery?.period?.end],
    ['paymentTerms.dueDate', inv.paymentTerms?.dueDate],
  ];
  for (const [i, ref] of (inv.references?.precedingInvoices ?? []).entries()) {
    out.push([`references.precedingInvoices[${i}].issueDate`, ref.issueDate]);
  }
  for (const [i, line] of (Array.isArray(inv.lines) ? inv.lines : []).entries()) {
    out.push(
      [`lines[${i}].period.start`, line.period?.start],
      [`lines[${i}].period.end`, line.period?.end],
    );
  }
  return out;
}

function checkTax(tax: TaxInfo | undefined, path: string, c: IssueCollector): void {
  if (!tax) return;
  if (isNonEmptyString(tax.category) && !FRENCH_TAX_CATEGORY_CODES.includes(tax.category)) {
    c.add(
      'BR-FR-15',
      `${path}.category`,
      `Catégorie de TVA « ${tax.category} » non pertinente en France.`,
      {
        expected: FRENCH_TAX_CATEGORY_CODES,
        actual: tax.category,
      },
    );
  }
  if (
    tax.rate !== undefined &&
    isSafeInteger(tax.rate) &&
    !FRENCH_VAT_RATES_BPS.includes(tax.rate)
  ) {
    c.add(
      'BR-FR-16',
      `${path}.rate`,
      'Taux de TVA hors de la liste des taux autorisés en France.',
      {
        expected: FRENCH_VAT_RATES_BPS,
        actual: tax.rate,
      },
    );
  }
}

/**
 * Règles françaises : norme AFNOR XP Z12-012 (`BR-FR-*`) et Code de commerce / CGI (`FR-*`).
 * Appliquées uniquement si le vendeur est établi en France (BT-40 = FR).
 */
export function checkFrenchRules(inv: Invoice, c: IssueCollector): void {
  if (inv.seller?.address?.countryCode !== 'FR') return;

  // BR-FR-01 / BR-FR-02 : numéro de facture
  if (isNonEmptyString(inv.id)) {
    if (inv.id.length > 35) {
      c.add('BR-FR-01', 'id', 'Le numéro de facture (BT-1) est limité à 35 caractères.', {
        expected: '≤ 35',
        actual: inv.id.length,
      });
    }
    if (!INVOICE_ID_CHARS.test(inv.id)) {
      c.add(
        'BR-FR-02',
        'id',
        'Le numéro de facture (BT-1) n’admet que A-Z, a-z, 0-9 et les caractères - + _ /.',
        {
          actual: inv.id,
        },
      );
    }
  }

  // BR-FR-03 : années entre 2000 et 2099
  for (const [path, value] of collectDates(inv)) {
    if (typeof value !== 'string' || !isValidIsoDate(value)) continue;
    const year = Number(value.slice(0, 4));
    if (year < 2000 || year > 2099) {
      c.add('BR-FR-03', path, 'L’année d’une date doit être comprise entre 2000 et 2099.', {
        actual: value,
      });
    }
  }

  // BR-FR-10 / BR-FR-11 / BR-FR-09 : SIREN et SIRET
  checkPartyIds(inv.seller, 'seller', 'BR-FR-10', true, c);
  const buyerIsFrenchBusiness =
    inv.buyer?.address?.countryCode === 'FR' && inv.buyer.consumer !== true;
  checkPartyIds(inv.buyer, 'buyer', 'BR-FR-11', buyerIsFrenchBusiness, c);

  // BR-FR-08 : nature de l'opération et cadre de facturation (BT-23)
  if (inv.operationCategory === undefined) {
    c.add(
      'BR-FR-08',
      'operationCategory',
      'La nature de l’opération (biens, services ou mixte) est obligatoire : elle détermine le cadre de facturation BT-23.',
      { expected: OPERATION_CATEGORIES },
    );
  } else if (!OPERATION_CATEGORIES.includes(inv.operationCategory)) {
    c.add('BR-FR-08', 'operationCategory', 'Nature d’opération inconnue.', {
      expected: OPERATION_CATEGORIES,
      actual: inv.operationCategory,
    });
  }
  if (inv.businessProcess !== undefined) {
    if (!isBusinessProcessCode(inv.businessProcess)) {
      c.add(
        'BR-FR-08',
        'businessProcess',
        'Cadre de facturation (BT-23) hors des valeurs autorisées.',
        {
          expected: Object.keys(BUSINESS_PROCESS_CODES),
          actual: inv.businessProcess,
        },
      );
    } else if (
      inv.operationCategory !== undefined &&
      operationCategoryFromBusinessProcess(inv.businessProcess) !== inv.operationCategory
    ) {
      c.add(
        'BR-FR-08',
        'businessProcess',
        'La première lettre du cadre de facturation (B biens, S services, M mixte) doit correspondre à la nature de l’opération.',
        { expected: inv.operationCategory, actual: inv.businessProcess },
      );
    }
  }

  // BR-FR-23 à BR-FR-26 : formats des adresses électroniques et codes de routage
  for (const [path, party] of [
    ['seller', inv.seller],
    ['buyer', inv.buyer],
  ] as const) {
    const ea = party?.electronicAddress;
    if (ea) {
      if (ea.value.length > ELECTRONIC_ADDRESS_MAX_LENGTH) {
        c.add(
          'BR-FR-25',
          `${path}.electronicAddress.value`,
          `Une adresse électronique ne doit pas dépasser ${ELECTRONIC_ADDRESS_MAX_LENGTH} caractères.`,
          {
            actual: ea.value.length,
          },
        );
      }
      if (ea.scheme === '0225' && !ROUTING_CHARS.test(ea.value)) {
        c.add(
          'BR-FR-23',
          `${path}.electronicAddress.value`,
          'Une adresse électronique 0225 n’admet que A-Z, a-z, 0-9 et les caractères - _ .',
          {
            actual: ea.value,
          },
        );
      }
      if (ea.scheme === 'EM' && !isValidEmailAddress(ea.value)) {
        c.add(
          'FORMAT-EMAIL',
          `${path}.electronicAddress.value`,
          'Adresse e-mail attendue pour le schéma EM.',
          { actual: ea.value },
        );
      }
    }
    const rc = party?.routingCode;
    if (rc !== undefined) {
      if (!ROUTING_CHARS.test(rc)) {
        c.add(
          'BR-FR-24',
          `${path}.routingCode`,
          'Un code de routage (0224) n’admet que A-Z, a-z, 0-9 et les caractères - _ .',
          { actual: rc },
        );
      }
      if (rc.length > ROUTING_CODE_MAX_LENGTH) {
        c.add(
          'BR-FR-26',
          `${path}.routingCode`,
          `Un code de routage (0224) ne doit pas dépasser ${ROUTING_CODE_MAX_LENGTH} caractères.`,
          { actual: rc.length },
        );
      }
    }
  }

  // BR-FR-20 / 21 / 22 / 12 / 13 : traitement attendu et adresse électronique 0225 du destinataire
  if (inv.processing !== undefined) {
    if (!isProcessingCode(inv.processing)) {
      c.add(
        'BR-FR-20',
        'processing',
        'Traitement attendu inconnu (B2B, B2BINT, B2C, OUTOFSCOPE, ARCHIVEONLY).',
        { actual: inv.processing },
      );
    } else if (inv.processing === 'B2B') {
      const selfBilled = isSelfBilledType(inv.typeCode);
      const [path, party, rule, requiredRule] = selfBilled
        ? (['seller', inv.seller, 'BR-FR-22', 'BR-FR-13'] as const)
        : (['buyer', inv.buyer, 'BR-FR-21', 'BR-FR-12'] as const);
      const ea = party?.electronicAddress;
      if (!ea) {
        c.add(
          requiredRule,
          `${path}.electronicAddress`,
          `En e-invoicing, l’adresse électronique ${selfBilled ? 'du vendeur (BT-34)' : 'de l’acheteur (BT-49)'} est obligatoire (schéma 0225, forme SIREN ou SIREN_XXX).`,
        );
      } else {
        if (ea.scheme !== '0225') {
          c.add(
            rule,
            `${path}.electronicAddress.scheme`,
            'En e-invoicing, l’adresse électronique du destinataire doit utiliser le schéma 0225.',
            {
              expected: '0225',
              actual: ea.scheme,
            },
          );
        }
        if (isNonEmptyString(party?.siren) && !ea.value.startsWith(party.siren)) {
          c.add(
            rule,
            `${path}.electronicAddress.value`,
            'L’adresse électronique 0225 doit commencer par le SIREN de la partie.',
            {
              expected: `${party.siren}…`,
              actual: ea.value,
            },
          );
        }
      }
    }
  }

  // BR-FR-15 / BR-FR-16 : catégories et taux de TVA
  for (const [i, line] of (Array.isArray(inv.lines) ? inv.lines : []).entries())
    checkTax(line.tax, `lines[${i}].tax`, c);
  for (const [i, a] of (inv.allowances ?? []).entries()) checkTax(a.tax, `allowances[${i}].tax`, c);
  for (const [i, ch] of (inv.charges ?? []).entries()) checkTax(ch.tax, `charges[${i}].tax`, c);
  for (const [i, tb] of (Array.isArray(inv.taxBreakdown) ? inv.taxBreakdown : []).entries()) {
    checkTax(tb, `taxBreakdown[${i}]`, c);
  }

  // BR-FR-14 : adresse de livraison (BG-15) fournie ⇒ complète, et jamais pour une prestation de services
  const shipTo = inv.delivery?.address;
  if (shipTo) {
    if (inv.operationCategory === 'services') {
      c.add(
        'BR-FR-14',
        'delivery.address',
        'L’adresse de livraison (BG-15) ne doit pas être transmise pour une prestation de services.',
      );
    } else {
      const required: [keyof typeof shipTo, string][] = [
        ['line1', 'BT-75'],
        ['city', 'BT-77'],
        ['postCode', 'BT-78'],
        ['countryCode', 'BT-80'],
      ];
      for (const [key, bt] of required) {
        if (!isNonEmptyString(shipTo[key])) {
          c.add(
            'BR-FR-14',
            `delivery.address.${key}`,
            `L’adresse de livraison (BG-15) doit comporter ${bt} (${key}).`,
          );
        }
      }
    }
  }

  // Facture définitive après acompte (cadre *4) : la ou les factures d'acompte doivent être référencées (BT-25)
  if (inv.businessProcess?.endsWith('4') && !inv.references?.precedingInvoices?.length) {
    c.add(
      'FR-DEPOSIT-REFERENCE',
      'references.precedingInvoices',
      'Une facture définitive après acompte (cadre B4/S4/M4) doit référencer la ou les factures d’acompte (BT-25).',
    );
  }

  // Date de la vente / prestation : date de livraison OU période (L441-9)
  const d = inv.delivery;
  const hasDate = d?.date !== undefined;
  const hasPeriod = d?.period?.start !== undefined || d?.period?.end !== undefined;
  if (!hasDate && !hasPeriod) {
    c.add(
      'FR-DELIVERY',
      'delivery',
      'La date de livraison (BT-72) ou la période de facturation (BT-73/BT-74) est obligatoire (art. L441-9 C. com.).',
    );
  }

  // BR-FR-05 / BR-FR-06 : notes légales PMD, PMT, AAB — une fois chacune (générées depuis paymentTerms si absentes)
  const pt = inv.paymentTerms;
  if (!pt) return;
  const notes = resolveNotes(inv);
  const counts = new Map<string, number>();
  for (const n of notes)
    counts.set(n.subjectCode ?? '', (counts.get(n.subjectCode ?? '') ?? 0) + 1);
  const generator: Record<string, string> = {
    PMD: 'paymentTerms.latePenaltyRate',
    PMT: 'paymentTerms.recoveryIndemnity',
    AAB: 'paymentTerms.earlyPaymentDiscount',
  };
  for (const code of LEGAL_NOTE_CODES) {
    const n = counts.get(code) ?? 0;
    if (n === 0) {
      c.add(
        'BR-FR-05',
        'notes',
        `Note « ${code} » obligatoire (art. L441-9/L441-10 C. com.) : fournir les trois champs structurés (${generator[code]}, …) pour la générer, ou une note avec ce code.`,
        { expected: code },
      );
    } else if (n > 1) {
      c.add('BR-FR-06', 'notes', `La note « ${code} » ne doit être présente qu’une seule fois.`, {
        actual: n,
      });
    }
  }
  if ((counts.get('TXD') ?? 0) > 1) {
    c.add('BR-FR-06', 'notes', 'La note « TXD » ne doit être présente qu’une seule fois.', {
      actual: counts.get('TXD'),
    });
  }

  // Valeurs des champs structurés, lorsqu'ils sont fournis
  if (pt.text !== undefined && !isNonEmptyString(pt.text)) {
    c.add(
      'FR-PAYMENT-TERMS-TEXT',
      'paymentTerms.text',
      'Le texte des conditions de paiement (BT-20) ne peut pas être vide.',
    );
  }
  if (
    pt.latePenaltyRate !== undefined &&
    (!isSafeInteger(pt.latePenaltyRate) || pt.latePenaltyRate <= 0)
  ) {
    c.add(
      'FR-LATE-PENALTY',
      'paymentTerms.latePenaltyRate',
      'Le taux des pénalités de retard doit être > 0 (art. L441-10 C. com.).',
      {
        expected: '> 0',
        actual: pt.latePenaltyRate,
      },
    );
  }
  if (
    pt.recoveryIndemnity !== undefined &&
    (!isSafeInteger(pt.recoveryIndemnity) || pt.recoveryIndemnity <= 0)
  ) {
    c.add(
      'FR-RECOVERY-INDEMNITY',
      'paymentTerms.recoveryIndemnity',
      'L’indemnité forfaitaire doit être > 0 (40 €, art. D441-5 C. com.).',
      {
        expected: 4000,
        actual: pt.recoveryIndemnity,
      },
    );
  }
  const disc = pt.earlyPaymentDiscount;
  if (disc !== undefined && disc !== 'none') {
    if (!isSafeInteger(disc.rate) || disc.rate <= 0) {
      c.add(
        'FR-EARLY-PAYMENT-DISCOUNT',
        'paymentTerms.earlyPaymentDiscount.rate',
        'Taux d’escompte > 0 attendu.',
        {
          actual: disc.rate,
        },
      );
    }
    if (!isSafeInteger(disc.withinDays) || disc.withinDays <= 0) {
      c.add(
        'FR-EARLY-PAYMENT-DISCOUNT',
        'paymentTerms.earlyPaymentDiscount.withinDays',
        'Délai d’escompte (jours) > 0 attendu.',
        {
          actual: disc.withinDays,
        },
      );
    }
  }
}
