import type { IsoDate } from './codes.js';

/** Référence à une facture antérieure — BG-3 (ex. facture acomptée). */
export interface PrecedingInvoiceReference {
  /** BT-25 — Numéro de la facture antérieure. */
  id: string;
  /** BT-26 — Date d'émission de la facture antérieure. */
  issueDate?: IsoDate;
}

/** Références documentaires du niveau document. */
export interface DocumentReferences {
  /** BT-11 — Référence de projet. */
  project?: string;
  /** BT-12 — Référence de contrat. */
  contract?: string;
  /** BT-13 — Référence de bon de commande (acheteur). */
  purchaseOrder?: string;
  /** BT-14 — Référence de commande vendeur. */
  salesOrder?: string;
  /** BT-15 — Référence d'avis de réception. */
  receivingAdvice?: string;
  /** BT-16 — Référence d'avis d'expédition. */
  despatchAdvice?: string;
  /** BT-17 — Référence d'appel d'offres ou de lot. */
  tenderOrLot?: string;
  /** BT-18 — Identifiant de l'objet facturé (ex. numéro d'abonnement). */
  invoicedObject?: string;
  /** BT-19 — Référence comptable acheteur. */
  buyerAccountingReference?: string;
  /** BG-3 — Factures antérieures. */
  precedingInvoices?: PrecedingInvoiceReference[];
}
