import {
  ELECTRONIC_ADDRESS_MAX_LENGTH,
  isValidEmailAddress,
  ROUTING_CHARS,
  ROUTING_CODE_MAX_LENGTH,
} from '../electronic-address.js';
import { DEFAULT_LIMITS, type Limits } from '../limits.js';
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
const NINE_DIGITS = /^\d{9}$/;
/** BR-FR-31 : les traitements attendus que compte le schematron (B2CINT y figure depuis la V1.4). */
const BAR_TREATMENTS: ReadonlySet<string> = new Set([
  'B2B',
  'B2BINT',
  'B2C',
  'B2CINT',
  'OUTOFSCOPE',
  'ARCHIVEONLY',
]);
/** BR-FR-CO-05 : les avoirs qui citent leur facture antérieure (502 et 503 sont refusés par BR-CL-01). */
const CREDIT_NOTES_CITING: ReadonlySet<string> = new Set(['261', '381', '396']);

function globalIdsOf(party: Party | undefined) {
  return Array.isArray(party?.globalIds) ? party.globalIds : [];
}

/**
 * BR-FR-32 et BR-FR-CO-10 : identifiants globaux (BT-29-1, BT-46-1, BT-60-1) et SIREN du bénéficiaire.
 * Le SIREN du vendeur et de l'acheteur relève déjà de BR-FR-10/11, plus strictes (clé de Luhn).
 */
function checkGlobalIds(inv: Invoice, c: IssueCollector): void {
  const nineDigits = (path: string, value: unknown) => {
    if (typeof value === 'string' && !NINE_DIGITS.test(value.trim())) {
      c.add(
        'BR-FR-32',
        path,
        'Un identifiant de schéma 0002 (SIREN) ou 0231 compte exactement 9 chiffres.',
        { actual: value },
      );
    }
  };
  const missingScheme = (path: string) =>
    c.add('BR-FR-CO-10', path, 'Un identifiant global porte son schéma (ISO 6523).');

  for (const [path, party] of [
    ['seller', inv.seller],
    ['buyer', inv.buyer],
  ] as const) {
    // Le SIRET s'écrit en identifiant global 0009 : il compte parmi les schémas de la partie.
    const seen = new Set(party?.siret === undefined ? [] : ['0009']);
    for (const [i, id] of globalIdsOf(party).entries()) {
      const scheme = id?.scheme;
      if (!isNonEmptyString(scheme)) {
        missingScheme(`${path}.globalIds[${i}].scheme`);
        continue;
      }
      if (scheme === '0002' || scheme === '0231')
        nineDigits(`${path}.globalIds[${i}].value`, id.value);
      if (seen.has(scheme)) {
        c.add(
          'BR-FR-CO-10',
          `${path}.globalIds[${i}].scheme`,
          scheme === '0009' && party?.siret !== undefined
            ? 'Le SIRET s’écrit déjà en identifiant global 0009 : il ne se répète pas dans `globalIds`.'
            : `Le schéma « ${scheme} » n’apparaît qu’une fois parmi les identifiants globaux d’une partie.`,
          { actual: scheme },
        );
      }
      seen.add(scheme);
    }
  }

  const payee = inv.payee;
  if (payee?.legalId !== undefined) nineDigits('payee.legalId', payee.legalId);
  const payeeId = payee?.globalId;
  if (payeeId !== undefined) {
    if (!isNonEmptyString(payeeId.scheme)) missingScheme('payee.globalId.scheme');
    else if (payeeId.scheme === '0002' || payeeId.scheme === '0231')
      nineDigits('payee.globalId.value', payeeId.value);
  }
}

/**
 * BR-FR-CO-03, 05, 07, 08 et 09 : ce que le type de document (BT-3) et le cadre de facturation (BT-23)
 * exigent des références, de l'échéance et des montants.
 */
function checkDocumentFramework(inv: Invoice, c: IssueCollector): void {
  // BR-FR-CO-03 : un avoir de remise globale porte son contrat et sa période de facturation complète.
  if (inv.typeCode === '262') {
    if (!isNonEmptyString(inv.references?.contract)) {
      c.add(
        'BR-FR-CO-03',
        'references.contract',
        'Un avoir de remise globale (262) porte la référence du contrat (BT-12).',
      );
    }
    const period = inv.delivery?.period;
    if (!isNonEmptyString(period?.start) || !isNonEmptyString(period?.end)) {
      c.add(
        'BR-FR-CO-03',
        'delivery.period',
        'Un avoir de remise globale (262) porte sa période de facturation (BG-14), début et fin (BT-73, BT-74).',
      );
    }
  }

  // BR-FR-CO-05 : un avoir cite au moins une facture antérieure, avec sa date. Le schematron admet aussi
  // une référence sur chaque ligne, que le modèle EN 16931 ne porte pas.
  if (CREDIT_NOTES_CITING.has(inv.typeCode)) {
    const dated = (inv.references?.precedingInvoices ?? []).some(
      (ref) => isNonEmptyString(ref?.id) && isNonEmptyString(ref.issueDate),
    );
    if (!dated) {
      c.add(
        'BR-FR-CO-05',
        'references.precedingInvoices',
        `Un avoir (${inv.typeCode}) cite au moins une facture antérieure (BT-25) avec sa date (BT-26).`,
      );
    }
  }

  const framework = isBusinessProcessCode(inv.businessProcess) ? inv.businessProcess : undefined;
  const alreadyPaid = framework?.endsWith('2') === true;

  // BR-FR-CO-07 : l'échéance ne précède pas la date de facture, sauf pour une facture d'acompte ou une
  // facture déjà payée, dont l'échéance est la date du paiement.
  const due = inv.paymentTerms?.dueDate;
  if (
    typeof due === 'string' &&
    isValidIsoDate(due) &&
    typeof inv.issueDate === 'string' &&
    isValidIsoDate(inv.issueDate) &&
    due < inv.issueDate &&
    inv.typeCode !== '386' &&
    !alreadyPaid
  ) {
    c.add(
      'BR-FR-CO-07',
      'paymentTerms.dueDate',
      'L’échéance (BT-9) ne précède pas la date de facture (BT-2), sauf pour une facture d’acompte ou déjà payée.',
      { expected: `≥ ${inv.issueDate}`, actual: due },
    );
  }

  // BR-FR-CO-08 : une facture définitive après acompte n'est pas elle-même une facture d'acompte.
  if (framework?.endsWith('4') && inv.typeCode === '386') {
    c.add(
      'BR-FR-CO-08',
      'typeCode',
      'Une facture définitive après acompte (cadre B4, S4 ou M4) ne peut pas être une facture d’acompte (386).',
      { actual: inv.typeCode },
    );
  }

  // BR-FR-CO-09 : une facture déjà payée porte son TTC en montant déjà payé, un net à payer nul et son
  // échéance, qui est la date du paiement.
  if (alreadyPaid) {
    const t = inv.totals;
    if (t && t.prepaidAmount !== t.taxInclusiveAmount) {
      c.add(
        'BR-FR-CO-09',
        'totals.prepaidAmount',
        'Une facture déjà payée (cadre B2, S2 ou M2) porte son TTC (BT-112) en montant déjà payé (BT-113).',
        { expected: t.taxInclusiveAmount, actual: t.prepaidAmount },
      );
    }
    if (t && t.amountDueForPayment !== 0) {
      c.add(
        'BR-FR-CO-09',
        'totals.amountDueForPayment',
        'Une facture déjà payée (cadre B2, S2 ou M2) a un net à payer (BT-115) nul.',
        { expected: 0, actual: t.amountDueForPayment },
      );
    }
    if (!isNonEmptyString(due)) {
      c.add(
        'BR-FR-CO-09',
        'paymentTerms.dueDate',
        'Une facture déjà payée (cadre B2, S2 ou M2) porte son échéance (BT-9) : la date du paiement.',
      );
    }
  }
}

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
export function checkFrenchRules(
  inv: Invoice,
  c: IssueCollector,
  limits: Limits = DEFAULT_LIMITS,
): void {
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
  checkGlobalIds(inv, c);

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

  // BR-FR-12 : l'adresse électronique de l'acheteur (BT-49) est obligatoire (schematron officiel : inconditionnelle),
  // sauf pour un particulier (hors e-invoicing)
  const buyerEa = inv.buyer?.electronicAddress;
  if (!buyerEa && inv.buyer?.consumer !== true) {
    c.add(
      'BR-FR-12',
      'buyer.electronicAddress',
      'L’adresse électronique de l’acheteur (BT-49) est obligatoire ; en e-invoicing, schéma 0225 (SIREN ou SIREN_XXX).',
    );
  }

  // BR-FR-20 / 21 / 22 / 13 : traitement attendu et adresse électronique 0225 du destinataire
  if (inv.processing !== undefined) {
    if (!isProcessingCode(inv.processing)) {
      c.add(
        'BR-FR-20',
        'processing',
        'Traitement attendu inconnu (B2B, B2BINT, B2C, OUTOFSCOPE, ARCHIVEONLY).',
        {
          actual: inv.processing,
        },
      );
    } else if (inv.processing === 'B2B') {
      const selfBilled = isSelfBilledType(inv.typeCode);
      const [path, party, rule] = selfBilled
        ? (['seller', inv.seller, 'BR-FR-22'] as const)
        : (['buyer', inv.buyer, 'BR-FR-21'] as const);
      const ea = party?.electronicAddress;
      if (!ea) {
        if (selfBilled) {
          c.add(
            'BR-FR-13',
            'seller.electronicAddress',
            'En autofacturation e-invoicing, l’adresse électronique du vendeur (BT-34) est obligatoire (schéma 0225, SIREN ou SIREN_XXX).',
          );
        }
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

  // BR-FR-31 : une seule note BAR porte le traitement attendu. Le schematron ne compte que les notes au
  // contenu de sa liste ; celle que génère `processing` s'efface devant une note BAR fournie.
  const treatments = (Array.isArray(inv.notes) ? inv.notes : []).filter(
    (n) =>
      n?.subjectCode === 'BAR' && typeof n.text === 'string' && BAR_TREATMENTS.has(n.text.trim()),
  ).length;
  if (treatments > 1) {
    c.add('BR-FR-31', 'notes', 'Une seule note « BAR » (BT-21) porte le traitement attendu.', {
      expected: '≤ 1',
      actual: treatments,
    });
  }

  // BR-FR-19 : taille des pièces jointes (par pièce, et 100 Mo cumulés par facture)
  let attachedTotal = 0;
  for (const [i, a] of (inv.attachments ?? []).entries()) {
    const size = a.file?.bytes instanceof Uint8Array ? a.file.bytes.byteLength : 0;
    attachedTotal += size;
    if (size > limits.attachmentBytes) {
      c.add(
        'BR-FR-19',
        `attachments[${i}].file.bytes`,
        `Pièce jointe de ${size} octets au-delà de la limite (${limits.attachmentBytes}).`,
        {
          expected: `≤ ${limits.attachmentBytes}`,
          actual: size,
        },
      );
    }
  }
  if (attachedTotal > limits.attachmentsTotalBytes) {
    c.add(
      'BR-FR-19',
      'attachments',
      `Pièces jointes cumulées : ${attachedTotal} octets, au-delà de ${limits.attachmentsTotalBytes} (100 Mo par facture).`,
      {
        expected: `≤ ${limits.attachmentsTotalBytes}`,
        actual: attachedTotal,
      },
    );
  }

  // BR-FR-18 : une seule pièce jointe « LISIBLE »
  const readable = (inv.attachments ?? []).filter((a) => a.description === 'LISIBLE').length;
  if (readable > 1) {
    c.add(
      'BR-FR-18',
      'attachments',
      'Il ne peut y avoir qu’une seule pièce jointe décrite « LISIBLE » (BT-123).',
      {
        actual: readable,
      },
    );
  }

  // BR-FR-15 / BR-FR-16 : catégories et taux de TVA
  for (const [i, line] of (Array.isArray(inv.lines) ? inv.lines : []).entries())
    checkTax(line.tax, `lines[${i}].tax`, c);
  for (const [i, a] of (inv.allowances ?? []).entries()) checkTax(a.tax, `allowances[${i}].tax`, c);
  for (const [i, ch] of (inv.charges ?? []).entries()) checkTax(ch.tax, `charges[${i}].tax`, c);
  for (const [i, tb] of (Array.isArray(inv.taxBreakdown) ? inv.taxBreakdown : []).entries()) {
    checkTax(tb, `taxBreakdown[${i}]`, c);
  }

  // BR-FR-CO-16 (annexe A V1.4) : la franchise en base s'exprime en catégorie E avec le code
  // VATEX-FR-FRANCHISE ; un vendeur sans numéro de TVA répète son SIREN en BT-32. La règle est « non
  // vérifiable » et aucun schematron ne la porte : on ne bloque que ce que le CEN refuse aussi (BR-E-02),
  // un vendeur sans numéro de TVA ni BT-32, avec le SIREN attendu pour remède (D69).
  const seller = inv.seller;
  if (
    declaresFranchise(inv) &&
    seller &&
    !isNonEmptyString(seller.vatId) &&
    !isNonEmptyString(seller.taxRegistrationId)
  ) {
    c.add(
      'BR-FR-CO-16',
      'seller.taxRegistrationId',
      'Un vendeur en franchise en base sans numéro de TVA répète son SIREN comme identifiant fiscal (BT-32).',
      { expected: seller.siren },
    );
  }

  // BR-FR-14 : adresse de livraison (BG-15) fournie ⇒ complète. La norme la dit « pas à transmettre »
  // pour une prestation de services, mais non contrôlable : ni le schematron officiel ni les exemples
  // du FNFE-MPE ne l'interdisent, le SDK non plus (D66).
  const shipTo = inv.delivery?.address;
  if (shipTo) {
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

  // Facture définitive après acompte (cadre *4) : la ou les factures d'acompte doivent être référencées (BT-25)
  if (inv.businessProcess?.endsWith('4') && !inv.references?.precedingInvoices?.length) {
    c.add(
      'FR-DEPOSIT-REFERENCE',
      'references.precedingInvoices',
      'Une facture définitive après acompte (cadre B4/S4/M4) doit référencer la ou les factures d’acompte (BT-25).',
    );
  }

  // BR-FR-CO-04 : une facture rectificative cite une et une seule facture antérieure (BT-25). Comme le
  // schematron BR-FR v1.4.0.04, on compte toutes les références, complètes ou non (D69). Les autres
  // rectificatives (471–473) sont refusées par BR-CL-01 tant qu'elles ne sont pas adoptées.
  if (inv.typeCode === '384') {
    const count = inv.references?.precedingInvoices?.length ?? 0;
    if (count !== 1) {
      c.add(
        'BR-FR-CO-04',
        'references.precedingInvoices',
        'Une facture rectificative (384) cite une et une seule facture antérieure (BT-25).',
        { expected: 1, actual: count },
      );
    }
  }
  checkDocumentFramework(inv, c);

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

/** La facture se déclare en franchise en base : une ventilation E avec le code VATEX-FR-FRANCHISE. */
export function declaresFranchise(inv: Invoice): boolean {
  return (Array.isArray(inv.taxBreakdown) ? inv.taxBreakdown : []).some(
    (tb) => tb?.category === 'E' && tb.exemptionReasonCode === 'VATEX-FR-FRANCHISE',
  );
}
