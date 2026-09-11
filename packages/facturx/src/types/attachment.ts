/**
 * BR-FR-17 — Qualificatifs de pièce jointe (BT-123) reconnus par les plateformes françaises.
 * Liste indicative (« peuvent être utilisés ») : une description libre reste possible.
 */
export type AttachmentQualifier =
  | 'RIB'
  | 'LISIBLE'
  | 'FEUILLE_DE_STYLE'
  | 'PJA'
  | 'BORDEREAU_SUIVI'
  | 'DOCUMENT_ANNEXE'
  | 'BON_LIVRAISON'
  | 'BON_COMMANDE'
  | 'BORDEREAU_SUIVI_VALIDATION'
  | 'ETAT_ACOMPTE'
  | 'FACTURE_PAIEMENT_DIRECT'
  | 'RECAPITULATIF_COTRAITANCE';
export const ATTACHMENT_QUALIFIERS: readonly AttachmentQualifier[] = [
  'RIB',
  'LISIBLE',
  'FEUILLE_DE_STYLE',
  'PJA',
  'BORDEREAU_SUIVI',
  'DOCUMENT_ANNEXE',
  'BON_LIVRAISON',
  'BON_COMMANDE',
  'BORDEREAU_SUIVI_VALIDATION',
  'ETAT_ACOMPTE',
  'FACTURE_PAIEMENT_DIRECT',
  'RECAPITULATIF_COTRAITANCE',
];

/** BR-CL-24 — Types MIME autorisés pour un document joint (BT-125). */
export type AttachmentMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.oasis.opendocument.spreadsheet';
export const ATTACHMENT_MIME_TYPES: readonly AttachmentMimeType[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
];

/** BT-125 — Document joint embarqué (base64 dans le XML). */
export interface AttachmentFile {
  /** BT-125-2 — Nom du fichier. */
  filename: string;
  /** BT-125-1 — Type MIME (BR-CL-24). */
  mimeType: AttachmentMimeType;
  /** Contenu ; encodé en base64 par le SDK. */
  bytes: Uint8Array;
}

/** Document justificatif — BG-24 (`ram:AdditionalReferencedDocument`, TypeCode 916). */
export interface Attachment {
  /** BT-122 — Identifiant du document justificatif. Obligatoire (BR-52). */
  id: string;
  /**
   * BT-123 — Description. Règle FR BR-FR-17 : de préférence un qualificatif (`BON_COMMANDE`, `RIB`, `LISIBLE`…) ;
   * BR-FR-18 : une seule pièce `LISIBLE` par facture.
   */
  description?: AttachmentQualifier | (string & {});
  /** BT-124 — Emplacement externe (URI) du document. */
  uri?: string;
  /** BT-125 — Document embarqué. */
  file?: AttachmentFile;
}
