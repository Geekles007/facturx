/**
 * Lecture d'un message de cycle de vie (CDAR D22B) vers un `LifecycleStatus`.
 *
 * Miroir de `toCdvXml`, comme `fromCiiXml` l'est de `toCiiXml`. Ce n'est pas qu'une commodité :
 * le XSD ne juge que la structure, pas que la bonne valeur est dans la bonne balise. Un
 * aller-retour écriture → lecture → comparaison est ce qui attrape un code de statut écrit dans
 * `ReasonCode` au lieu de `ProcessConditionCode` — le schéma, lui, laisserait passer.
 *
 * Mêmes principes que la lecture CII : pas de DTD, tailles bornées, chaque erreur localisée par
 * un chemin d'éléments aux préfixes canoniques, quels que soient ceux du document.
 */

import { type Limits, resolveLimits } from '../limits.js';
import { centsFromDecimal } from '../money.js';
import type { InvoiceTypeCode, IsoDate } from '../types/codes.js';
import { FacturXParseError } from '../xml/cii-read.js';
import { parseXml, type XmlNode, XmlParseError } from '../xml/parse.js';
import { CDAR_NAMESPACES, type CdvParty, type CdvSender } from './cdar.js';
import type {
  AmountCode,
  LifecycleStatus,
  LifecycleStatusCode,
  RefusalReasonCode,
} from './types.js';
import { assertValidLifecycleStatus } from './validate.js';

export interface ParsedCdvDocument {
  /** Le statut lui-même, tel que `validateLifecycleStatus` l'attend. */
  status: LifecycleStatus;
  /** `MDT-3` — urn du profil du message (G7.14). */
  profile: string;
  /** `MDT-4` / `MDT-5` / `MDT-8`. */
  messageId: string;
  messageName?: string;
  messageDateTime: string;
  /** `MDG-9` — plateforme émettrice. */
  sender: CdvSender;
  /** `MDG-16` / `MDG-23`. */
  issuer: CdvParty;
  recipient: CdvParty;
  /** `MDT-91` — type de la facture visée. */
  invoiceTypeCode: InvoiceTypeCode;
  /** `MDT-95` — réception de la facture par la plateforme. */
  invoiceReceivedAt: string;
  /** `MDT-124-2`. */
  sequence: number;
}

export interface FromCdvXmlOptions {
  /** Valider avec `assertValidLifecycleStatus` après lecture (défaut : `true`). */
  validate?: boolean;
  /** Limites de taille (défaut : `DEFAULT_LIMITS`). */
  limits?: Partial<Limits>;
}

// ---------- accès à l'arbre ----------

interface Ctx {
  readonly node: XmlNode;
  readonly path: string;
}

const { rsm: RSM, ram: RAM, udt: UDT, qdt: QDT } = CDAR_NAMESPACES;

function prefixFor(ns: string): string {
  return ns === RSM ? 'rsm' : ns === UDT ? 'udt' : ns === QDT ? 'qdt' : 'ram';
}

function children(ctx: Ctx, local: string, ns: string = RAM): Ctx[] {
  const matches = ctx.node.children.filter((c) => c.local === local && c.ns === ns);
  return matches.map((node, i) => ({
    node,
    path: `${ctx.path}/${prefixFor(node.ns)}:${node.local}${matches.length > 1 ? `[${i + 1}]` : ''}`,
  }));
}

function child(ctx: Ctx | undefined, local: string, ns: string = RAM): Ctx | undefined {
  return ctx === undefined ? undefined : children(ctx, local, ns)[0];
}

function requireChild(ctx: Ctx, local: string, ns: string = RAM): Ctx {
  const found = child(ctx, local, ns);
  if (!found) {
    throw new FacturXParseError(
      'MISSING',
      `${ctx.path}/${prefixFor(ns)}:${local}`,
      'Élément obligatoire absent',
    );
  }
  return found;
}

function text(ctx: Ctx | undefined): string | undefined {
  if (!ctx) return undefined;
  const value = ctx.node.text.trim();
  return value === '' ? undefined : value;
}

function requireText(ctx: Ctx, local: string, ns: string = RAM): string {
  const found = requireChild(ctx, local, ns);
  const value = text(found);
  if (value === undefined) throw new FacturXParseError('MISSING', found.path, 'Valeur absente');
  return value;
}

function attr(ctx: Ctx | undefined, name: string): string | undefined {
  const value = ctx?.node.attrs[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Inverse de `toFormat204` : `AAAAMMJJHHMMSS` → date-heure ISO 8601 en UTC
 * (`2026-09-15T08:30:00Z`). Le format 204 ne porte pas de fuseau ; le SDK écrit en UTC, il relit
 * donc en UTC.
 */
export function fromFormat204(value: string): string {
  if (!/^\d{14}$/.test(value)) {
    throw new TypeError(`Horodatage au format 204 (AAAAMMJJHHMMSS) attendu, reçu « ${value} ».`);
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== iso.slice(0, 19)) {
    throw new TypeError(`Horodatage invalide « ${value} ».`);
  }
  return iso;
}

/** `udt:DateTimeString` (ou `qdt:`) au format 204, sous l'élément conteneur nommé. */
function dateTime(ctx: Ctx): string {
  const inner = child(ctx, 'DateTimeString', UDT) ?? child(ctx, 'DateTimeString', QDT);
  if (!inner) {
    throw new FacturXParseError('MISSING', `${ctx.path}/udt:DateTimeString`, 'Horodatage absent');
  }
  const format = attr(inner, 'format');
  const raw = text(inner);
  if (format !== '204' || raw === undefined) {
    throw new FacturXParseError(
      'FORMAT',
      inner.path,
      `Horodatage au format 204 attendu, reçu « ${raw ?? ''} » (format ${format ?? '∅'})`,
    );
  }
  try {
    return fromFormat204(raw);
  } catch (error) {
    throw new FacturXParseError('FORMAT', inner.path, (error as Error).message, { cause: error });
  }
}

/** Partie commerciale : identifiant qualifié et code rôle. */
function party(ctx: Ctx): CdvParty {
  const schemeId = attr(requireChild(ctx, 'GlobalID'), 'schemeID');
  return {
    id: requireText(ctx, 'GlobalID'),
    ...(schemeId !== undefined && { schemeId }),
    roleCode: requireText(ctx, 'RoleCode'),
  };
}

/**
 * Lit un message CDV complet : le statut et l'enveloppe qui le porte.
 * Ne valide pas le statut — `fromCdvXml` s'en charge.
 */
export function parseCdvDocument(
  xml: string | Uint8Array,
  options: Pick<FromCdvXmlOptions, 'limits'> = {},
): ParsedCdvDocument {
  const limits = resolveLimits(options.limits);
  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xml, { maxBytes: limits.xmlBytes });
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new FacturXParseError('MALFORMED', '', error.message, { cause: error });
    throw error;
  }
  if (rootNode.ns !== RSM || rootNode.local !== 'CrossDomainAcknowledgementAndResponse') {
    throw new FacturXParseError(
      'NOT_CDAR',
      rootNode.name,
      'La racine doit être rsm:CrossDomainAcknowledgementAndResponse (CDAR D22B)',
    );
  }
  const root: Ctx = { node: rootNode, path: 'rsm:CrossDomainAcknowledgementAndResponse' };

  // MDB-1 — contexte : profil (G7.14), cadre de facturation éventuel.
  const context = requireChild(root, 'ExchangedDocumentContext', RSM);
  const profile = requireText(
    requireChild(context, 'GuidelineSpecifiedDocumentContextParameter'),
    'ID',
  );
  const businessProcess = text(
    child(child(context, 'BusinessProcessSpecifiedDocumentContextParameter'), 'ID'),
  );

  // MDB-2 — document d'échange.
  const document = requireChild(root, 'ExchangedDocument', RSM);
  const messageId = requireText(document, 'ID');
  const messageName = text(child(document, 'Name'));
  const messageDateTime = dateTime(requireChild(document, 'IssueDateTime'));
  const senderNode = requireChild(document, 'SenderTradeParty');
  const senderRole = requireText(senderNode, 'RoleCode');
  if (senderRole !== 'WK' && senderRole !== 'DFH') {
    throw new FacturXParseError(
      'FORMAT',
      `${senderNode.path}/ram:RoleCode`,
      `Rôle de plateforme WK ou DFH attendu, reçu « ${senderRole} »`,
    );
  }
  const sender: CdvSender = { id: requireText(senderNode, 'GlobalID'), roleCode: senderRole };
  const issuer = party(requireChild(document, 'IssuerTradeParty'));
  const recipient = party(requireChild(document, 'RecipientTradeParty'));

  // MDB-03 — le statut et la facture visée.
  const ack = requireChild(root, 'AcknowledgementDocument', RSM);
  const ref = requireChild(ack, 'ReferenceReferencedDocument');
  const invoiceId = requireText(ref, 'IssuerAssignedID');
  const invoiceTypeCode = requireText(ref, 'TypeCode') as InvoiceTypeCode;
  const invoiceReceivedAt = dateTime(requireChild(ref, 'ReceiptDateTime'));
  const issueDate = dateTime(requireChild(ref, 'FormattedIssueDateTime')).slice(0, 10) as IsoDate;
  const code = requireText(ref, 'ProcessConditionCode') as LifecycleStatusCode;
  // G7.17 — l'émetteur de la facture, un SIREN unique sous le qualifiant 0002.
  const invoiceIssuer = requireChild(ref, 'IssuerTradeParty');
  const sirenNode = children(invoiceIssuer, 'GlobalID').find((g) => attr(g, 'schemeID') === '0002');
  if (!sirenNode || text(sirenNode) === undefined) {
    throw new FacturXParseError(
      'MISSING',
      `${invoiceIssuer.path}/ram:GlobalID[@schemeID="0002"]`,
      'SIREN du fournisseur absent (G7.17)',
    );
  }
  const sellerSiren = text(sirenNode) as string;

  const detail = requireChild(ref, 'SpecifiedDocumentStatus');
  const dateTimeStatus = dateTime(requireChild(detail, 'ReferenceDateTime'));
  const reasonCode = text(child(detail, 'ReasonCode')) as RefusalReasonCode | undefined;
  const reasonLabel = text(child(detail, 'Reason'));
  const sequenceRaw = requireText(detail, 'SequenceNumeric');
  const sequence = Number(sequenceRaw);
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new FacturXParseError(
      'FORMAT',
      `${detail.path}/ram:SequenceNumeric`,
      `Entier attendu, reçu « ${sequenceRaw} »`,
    );
  }
  const comment = text(child(child(detail, 'IncludedNote'), 'Content'));
  const amountNode = child(child(detail, 'SpecifiedDocumentCharacteristic'), 'ValueAmount');
  let amount: LifecycleStatus['amount'];
  if (amountNode) {
    const raw = text(amountNode);
    const currency = attr(amountNode, 'currencyID');
    if (raw === undefined || currency === undefined) {
      throw new FacturXParseError('FORMAT', amountNode.path, 'Montant ou devise absent');
    }
    let value: ReturnType<typeof centsFromDecimal>;
    try {
      value = centsFromDecimal(raw);
    } catch (error) {
      throw new FacturXParseError('FORMAT', amountNode.path, `Montant illisible « ${raw} »`, {
        cause: error,
      });
    }
    // Le code montant (G7.12) n'a pas de balise propre dans le message : le SDK écrit toujours le
    // montant encaissé (MEN) — c'est celui que le préremplissage de TVA consomme.
    amount = { code: 'MEN' as AmountCode, value, currency };
  }

  const status: LifecycleStatus = {
    code,
    dateTime: dateTimeStatus,
    invoice: { id: invoiceId, issueDate, sellerSiren },
    ...(reasonCode !== undefined && { reasonCode }),
    ...(reasonLabel !== undefined && { reasonLabel }),
    ...(comment !== undefined && { comment }),
    ...(amount !== undefined && { amount }),
    ...(businessProcess !== undefined && { businessProcess }),
  };

  return {
    status,
    profile,
    messageId,
    ...(messageName !== undefined && { messageName }),
    messageDateTime,
    sender,
    issuer,
    recipient,
    invoiceTypeCode,
    invoiceReceivedAt,
    sequence,
  };
}

/** Lit un message CDV et rend le statut qu'il porte, validé sauf `validate: false`. */
export function fromCdvXml(
  xml: string | Uint8Array,
  options: FromCdvXmlOptions = {},
): LifecycleStatus {
  const { status } = parseCdvDocument(xml, options);
  return (options.validate ?? true) ? assertValidLifecycleStatus(status) : status;
}
