import type { Cents } from '../money.js';
import type { Address } from './address.js';
import type { DocumentAllowance, DocumentCharge } from './allowance.js';
import type { Attachment } from './attachment.js';
import type {
  BusinessProcessCode,
  CurrencyCode,
  InvoiceTypeCode,
  IsoDate,
  NoteSubjectCode,
  OperationCategory,
  ProcessingCode,
} from './codes.js';
import type { Line } from './line.js';
import type { Party, Payee } from './party.js';
import type { PaymentMeans, PaymentTerms } from './payment.js';
import type { DocumentReferences } from './references.js';
import type { TaxBreakdown } from './tax.js';

/** Note de facture — BG-1. */
export interface InvoiceNote {
  /** BT-22 — Texte de la note. */
  text: string;
  /** BT-21 — Code de sujet (UNTDID 4451). */
  subjectCode?: NoteSubjectCode;
}

/**
 * Informations de livraison — BG-13.
 * Règle FR (art. L441-9 C. com.) : la facture mentionne la date de la vente ou de la prestation,
 * soit une date de livraison (BT-72), soit une période (BT-73/BT-74).
 */
export interface Delivery {
  /** BT-72 — Date de livraison effective. */
  date?: IsoDate;
  /** BG-14 — Période de facturation (BT-73 début, BT-74 fin ≥ début, BR-29). */
  period?: { start?: IsoDate; end?: IsoDate };
  /** BT-70 — Nom du destinataire de la livraison. */
  partyName?: string;
  /** BT-71 — Identifiant du lieu de livraison. */
  locationId?: string;
  /**
   * BG-15 — Adresse de livraison, à fournir si elle diffère de celle de l'acheteur (BG-8).
   * Règle FR BR-FR-14 : si fournie, `line1` (BT-75), `city` (BT-77), `postCode` (BT-78) et `countryCode` (BT-80)
   * sont obligatoires ; ne pas la transmettre pour une prestation de services.
   */
  address?: Address;
}

/**
 * Totaux du document — BG-22.
 * Tous les montants sont fournis par l'appelant et VÉRIFIÉS (jamais recalculés en silence).
 * Utiliser `computeTotals()` pour les produire explicitement.
 */
export interface Totals {
  /** BT-106 — Somme des montants nets de ligne (Σ BT-131). Obligatoire (BR-12, BR-CO-10). */
  lineTotalAmount: Cents;
  /** BT-107 — Somme des remises document (Σ BT-92) (BR-CO-11). */
  allowanceTotalAmount?: Cents;
  /** BT-108 — Somme des frais document (Σ BT-99) (BR-CO-12). */
  chargeTotalAmount?: Cents;
  /** BT-109 — Total HT = BT-106 − BT-107 + BT-108. Obligatoire (BR-13, BR-CO-13). */
  taxExclusiveAmount: Cents;
  /** BT-110 — Total TVA = Σ BT-117 (BR-CO-14). */
  taxTotalAmount: Cents;
  /** BT-112 — Total TTC = BT-109 + BT-110. Obligatoire (BR-14, BR-CO-15). */
  taxInclusiveAmount: Cents;
  /** BT-113 — Montant déjà payé (acomptes). */
  prepaidAmount?: Cents;
  /** BT-114 — Montant d'arrondi. */
  roundingAmount?: Cents;
  /** BT-115 — Montant à payer = BT-112 − BT-113 + BT-114. Obligatoire (BR-15, BR-CO-16). */
  amountDueForPayment: Cents;
}

/**
 * Facture au profil Factur-X EN 16931 (BT-24 = `urn:cen.eu:en16931:2017`).
 * Modèle sémantique EN 16931 ; seuls les éléments cités sont pris en charge en v1.
 */
export interface Invoice {
  /** BT-1 — Numéro de facture, unique et séquentiel. Obligatoire (BR-02). Règle FR : numérotation chronologique continue. */
  id: string;
  /** BT-2 — Date d'émission. Obligatoire (BR-03). */
  issueDate: IsoDate;
  /**
   * BT-3 — Type de facture (BR-FR-04) : `380` facture, `384` rectificative, `386` acompte, `389` auto-facturée,
   * `393` affacturée, `381` / `261` / `262` / `396` avoirs. Montants positifs ; document d'origine dans
   * `references.precedingInvoices`. Obligatoire (BR-04).
   */
  typeCode: InvoiceTypeCode;
  /** BT-5 — Devise de la facture (ISO 4217). Obligatoire (BR-05). */
  currency: CurrencyCode;
  /** BT-7 — Date d'exigibilité de la TVA, si différente de BT-2. Exclusif de `vatOnDebits` (BR-CO-03). */
  taxPointDate?: IsoDate;
  /**
   * BT-8 — Option pour le paiement de la TVA d'après les débits (code `5` = date de facture, UNTDID 2005).
   * Règle FR : mention obligatoire lorsque l'option est exercée (art. 242 nonies A CGI, réforme) ;
   * le PDF visuel doit l'imprimer. Exclusif de `taxPointDate` (BR-CO-03).
   */
  vatOnDebits?: true;
  /**
   * Règle FR (réforme) — Nature de l'opération : `goods` (livraison de biens), `services` (prestation),
   * `mixed`. Obligatoire pour un vendeur établi en France ; écrite dans le cadre de facturation BT-23
   * (`B1` / `S1` / `M1`) sauf `businessProcessId` explicite.
   */
  operationCategory?: OperationCategory;
  /**
   * BT-23 — Cadre de facturation (BR-FR-08) : `B1`/`S1`/`M1` dépôt d'une facture, `*2` déjà payée,
   * `*4` définitive après acompte, `S5`/`S6` sous-/cotraitance, `*7` déjà e-reportée.
   * Par défaut, déduit de `operationCategory` ; s'il est fourni, sa première lettre doit lui correspondre.
   */
  businessProcess?: BusinessProcessCode;
  /**
   * Règle FR BR-FR-20 — Traitement attendu (`B2B` e-invoicing, `B2BINT`, `B2C`, `OUTOFSCOPE`, `ARCHIVEONLY`),
   * écrit comme note `BAR`. En `B2B`, l'adresse électronique 0225 de l'acheteur (ou du vendeur en
   * autofacturation) devient obligatoire et doit commencer par son SIREN (BR-FR-12/13/21/22).
   */
  processing?: ProcessingCode;
  /** BT-10 — Référence acheteur (ex. code service Chorus Pro). Règle FR : obligatoire vers le secteur public. */
  buyerReference?: string;
  /**
   * BG-1 — Notes. Règle FR (BR-FR-05/06) : toute facture porte exactement une note `PMD` (pénalités de retard),
   * une `PMT` (indemnité forfaitaire de 40 €) et une `AAB` (escompte ou absence d'escompte) ; le SDK les génère
   * depuis `paymentTerms` si elles ne sont pas fournies ici. Autres mentions : `ABL` (forme juridique, RCS), `AAI`…
   */
  notes?: InvoiceNote[];
  /** BG-4 — Vendeur. */
  seller: Party;
  /** BG-7 — Acheteur. */
  buyer: Party;
  /** BG-10 — Bénéficiaire, si différent du vendeur. */
  payee?: Payee;
  /** BG-13 — Livraison. Règle FR : date OU période obligatoire. */
  delivery?: Delivery;
  /** Références documentaires (BT-11 à BT-19, BG-3). */
  references?: DocumentReferences;
  /** BG-24 — Documents justificatifs (bon de commande, RIB, représentation lisible…), embarqués en base64 ou référencés par URI. */
  attachments?: Attachment[];
  /** BG-25 — Lignes. Au moins une (BR-16). */
  lines: Line[];
  /** BG-20 — Remises au niveau document. */
  allowances?: DocumentAllowance[];
  /** BG-21 — Frais au niveau document. */
  charges?: DocumentCharge[];
  /** BG-23 — Ventilation de TVA. Au moins une entrée (BR-CO-18). */
  taxBreakdown: TaxBreakdown[];
  /** BG-22 — Totaux. */
  totals: Totals;
  /** BT-9 / BT-20 + mentions FR — Conditions de paiement. */
  paymentTerms: PaymentTerms;
  /** BT-83 — Référence de paiement (mention à rappeler par l'acheteur lors du règlement). */
  remittanceInformation?: string;
  /** BG-16 — Instructions de paiement (0..n). */
  paymentMeans?: PaymentMeans[];
}

/** Facture sans ses totaux ni sa ventilation TVA : entrée de `computeTotals()`. */
export type InvoiceDraft = Omit<Invoice, 'totals' | 'taxBreakdown'>;
