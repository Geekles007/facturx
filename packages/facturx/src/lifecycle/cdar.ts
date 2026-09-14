/**
 * Sérialisation d'un statut du cycle de vie en message CDV (flux 6).
 *
 * Le message ne repose pas sur un schéma français mais sur le **CDAR** d'UN/CEFACT — *Cross Domain
 * Acknowledgement and Response*, version **D22B** —, comme le prévoit la norme AFNOR XP Z12-012.
 * C'est pourquoi le paquet de spécifications de la DGFiP n'en contient aucun XSD : la structure est
 * internationale, seules les valeurs sont françaises.
 *
 * Structure et cardinalités : annexe 2 « Format sémantique FE CDV — Flux 6 » v2.3 du dossier de
 * spécifications externes **v3.2** ; valeurs : annexe 7 « Règles de gestion » v1.9. Les `MDT-*`
 * renvoient aux balises de l'annexe, les `G*` aux règles.
 *
 * **Qui émet un tel message ?** Une plateforme. L'émetteur (`MDT-19`) est identifié par un matricule
 * PDP/PPF sous le qualifiant `0238`, avec un code rôle `WK` (plateforme ou opérateur de
 * dématérialisation) ou `DFH` (le PPF). Une application de facturation ordinaire n'en possède pas :
 * cette fonction s'adresse à qui construit ou teste une plateforme, non à qui émet des factures.
 */

import { centsToString } from '../money.js';
import type { InvoiceTypeCode } from '../types/codes.js';
import { el, elA, serializeXml, type XmlChild, type XmlElement } from '../xml/node.js';
import type { LifecycleStatus } from './types.js';
import { assertValidLifecycleStatus } from './validate.js';

/** Espaces de noms du CDAR D22B. `ram`, `udt` et `qdt` sont ceux du CII, `rsm` est propre au CDAR. */
export const CDAR_NAMESPACES = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const;

/**
 * `MDT-3` et `MDT-97` — urn du profil, selon l'objet du cycle de vie (**G7.14**).
 * Un CDV portant sur une facture e-invoicing (flux 2) utilise `einvoicingF2`.
 */
export const CDV_PROFILES = {
  flux: 'urn.cpro.gouv.fr:1p0:CDV:flux',
  factureEinvoicing: 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2',
  donneesReglementaires: 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF1',
  transmissionEreporting: 'urn.cpro.gouv.fr:1p0:CDV:ereportingF10',
  annuaire: 'urn.cpro.gouv.fr:1p0:CDV:annuaire',
  messageCdv: 'urn.cpro.gouv.fr:1p0:CDV:messageCDV',
} as const;

/** UNTDID 2379 — format des dates du message : `AAAAMMJJHHMMSS`. */
const DATE_FORMAT_204 = '204';

/** `MDT-18` — qualifiant du matricule d'une plateforme (ICD 6523). */
const SCHEME_MATRICULE_PLATEFORME = '0238';
/** `MDT-130` — qualifiant SIREN, imposé par **G7.17** pour l'émetteur de la facture. */
const SCHEME_SIREN = '0002';

/** Plateforme émettrice du message (`MDG-9`). */
export interface CdvSender {
  /** `MDT-19` — matricule PDP/PPF, écrit sous le qualifiant `0238`. */
  id: string;
  /** `MDT-21` — UNCL 3035 : `WK` pour une plateforme, `DFH` pour le PPF. Défaut : `WK`. */
  roleCode?: 'WK' | 'DFH';
}

/** Partie identifiée par un identifiant qualifié et un rôle (`MDG-16`, `MDG-23`). */
export interface CdvParty {
  id: string;
  /** Qualifiant ICD 6523 : `0002` SIREN, `0009` SIRET, `0224` code de routage… Défaut : `0002`. */
  schemeId?: string;
  /** UNCL 3035 : `BY` acheteur, `SE` vendeur, `AB` représentant… */
  roleCode: string;
}

export interface ToCdvXmlOptions {
  /** Plateforme qui émet le message. */
  sender: CdvSender;
  /** `MDG-16` — émetteur du document d'échange. */
  issuer: CdvParty;
  /** `MDG-23` — destinataire du message. */
  recipient: CdvParty;
  /** `MDT-4` — identifiant du message CDV. */
  messageId: string;
  /** `MDT-5` — nom du message. Défaut : `Cycle de vie`. */
  messageName?: string;
  /** `MDT-8` — horodatage du message. Défaut : l'horodatage du statut. */
  messageDateTime?: string;
  /** `MDT-91` — type de la facture visée ; **G7.15** renvoie au code type du document (G1.01). */
  invoiceTypeCode: InvoiceTypeCode;
  /** `MDT-95` — date de réception de la facture par la plateforme. */
  invoiceReceivedAt: string;
  /** `MDT-124-2` — numéro incrémental du statut. Défaut : `1`. */
  sequence?: number;
  /** Valider le statut avant de sérialiser (défaut : `true`). `false` réservé au debug. */
  validate?: boolean;
  /** Indenter la sortie (défaut : compact). */
  pretty?: boolean;
}

/**
 * Convertit une date-heure ISO 8601 au format UNTDID 204 (`AAAAMMJJHHMMSS`), en UTC.
 * Une date seule (`AAAA-MM-JJ`) est interprétée à minuit UTC.
 */
export function toFormat204(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Date-heure illisible : "${value}".`);
  }
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** `udt:DateTimeString` avec son attribut de format, sous l'élément conteneur nommé. */
function horodatage(nom: string, valeur: string, prefixe: 'udt' | 'qdt' = 'udt'): XmlElement {
  return el(
    nom,
    elA(`${prefixe}:DateTimeString`, { format: DATE_FORMAT_204 }, toFormat204(valeur)),
  );
}

/** Partie commerciale : identifiant global qualifié puis code rôle, dans cet ordre. */
function partie(nom: string, party: CdvParty): XmlElement {
  return el(
    nom,
    elA('ram:GlobalID', { schemeID: party.schemeId ?? SCHEME_SIREN }, party.id),
    el('ram:RoleCode', party.roleCode),
  );
}

/**
 * Sérialise un statut en message CDV complet, prêt à être déposé.
 *
 * L'ordre des éléments suit la séquence du XSD CDAR : il n'est pas négociable, un élément déplacé
 * rend le document invalide. Le statut est validé avant sérialisation, sauf `validate: false`.
 */
export function toCdvXml(status: LifecycleStatus, options: ToCdvXmlOptions): string {
  if (options.validate ?? true) assertValidLifecycleStatus(status);

  const profil = CDV_PROFILES.factureEinvoicing;
  const horodatageMessage = options.messageDateTime ?? status.dateTime;

  // MDT-113/114 et le montant ne sont écrits que s'ils sont renseignés : G7.08 et G6.27 ont déjà
  // été vérifiées par la validation, inutile de les rejouer ici.
  // L'ordre suit la séquence de DocumentStatusType dans le XSD : horodatage, motif, puis numéro
  // incrémental, note et montant. Un élément déplacé et le document ne valide plus.
  const detailStatut: XmlChild[] = [
    horodatage('ram:ReferenceDateTime', status.dateTime),
    status.reasonCode && el('ram:ReasonCode', status.reasonCode),
    status.reasonLabel && el('ram:Reason', status.reasonLabel),
    el('ram:SequenceNumeric', String(options.sequence ?? 1)),
    status.comment && el('ram:IncludedNote', el('ram:Content', status.comment)),
    status.amount &&
      el(
        'ram:SpecifiedDocumentCharacteristic',
        elA(
          'ram:ValueAmount',
          { currencyID: status.amount.currency },
          centsToString(status.amount.value),
        ),
      ),
  ];

  const racine = elA(
    'rsm:CrossDomainAcknowledgementAndResponse',
    {
      'xmlns:rsm': CDAR_NAMESPACES.rsm,
      'xmlns:qdt': CDAR_NAMESPACES.qdt,
      'xmlns:ram': CDAR_NAMESPACES.ram,
      'xmlns:udt': CDAR_NAMESPACES.udt,
    },
    // MDB-1 — contrôle du processus : le profil du message (G7.14).
    el(
      'rsm:ExchangedDocumentContext',
      el('ram:GuidelineSpecifiedDocumentContextParameter', el('ram:ID', profil)),
    ),
    // MDB-2 — document d'échange : qui envoie, à qui, quand.
    el(
      'rsm:ExchangedDocument',
      el('ram:ID', options.messageId),
      el('ram:Name', options.messageName ?? 'Cycle de vie'),
      horodatage('ram:IssueDateTime', horodatageMessage),
      el(
        'ram:SenderTradeParty',
        elA('ram:GlobalID', { schemeID: SCHEME_MATRICULE_PLATEFORME }, options.sender.id),
        el('ram:RoleCode', options.sender.roleCode ?? 'WK'),
      ),
      partie('ram:IssuerTradeParty', options.issuer),
      partie('ram:RecipientTradeParty', options.recipient),
    ),
    // MDB-03 — document réponse : le statut lui-même et la facture qu'il vise.
    el(
      'rsm:AcknowledgementDocument',
      el('ram:MultipleReferencesIndicator', el('udt:Indicator', 'false')),
      horodatage('ram:IssueDateTime', status.dateTime),
      el(
        'ram:ReferenceReferencedDocument',
        el('ram:IssuerAssignedID', status.invoice.id),
        el('ram:TypeCode', options.invoiceTypeCode),
        horodatage('ram:ReceiptDateTime', options.invoiceReceivedAt),
        el('ram:ReferenceTypeCode', profil),
        // MDG-35 — date d'émission de la facture (G7.31), en qdt et non udt à cet emplacement.
        horodatage('ram:FormattedIssueDateTime', status.invoice.issueDate, 'qdt'),
        el('ram:ProcessConditionCode', status.code),
        // G7.17 — un seul SIREN, qualifiant 0002, sous peine de rejet du cycle de vie.
        el(
          'ram:IssuerTradeParty',
          elA('ram:GlobalID', { schemeID: SCHEME_SIREN }, status.invoice.sellerSiren),
        ),
        el('ram:SpecifiedDocumentStatus', ...detailStatut),
      ),
    ),
  );

  return serializeXml(racine, { pretty: options.pretty ?? false });
}
