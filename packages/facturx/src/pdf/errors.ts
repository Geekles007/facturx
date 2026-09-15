export type FacturXPdfErrorCode =
  /** Les octets fournis ne sont pas un PDF lisible. */
  | 'INVALID_PDF'
  /** Le PDF est chiffré : un PDF/A ne peut pas l'être, et son contenu n'est pas accessible. */
  | 'ENCRYPTED'
  /** La source XML est vide ou n'est pas un document XML. */
  | 'INVALID_XML'
  /** Structure PDF non prise en charge (ex. arbre de noms corrompu). */
  | 'UNSUPPORTED'
  /** PDF ou XML au-delà des limites (`Limits`). */
  | 'TOO_LARGE'
  /** `renderInvoicePdf` sans police : les polices standard du PDF ne s'embarquent pas. */
  | 'FONT_REQUIRED'
  /** `renderInvoicePdf` sans `@pdf-lib/fontkit`, requis pour embarquer une police. */
  | 'FONTKIT_REQUIRED'
  /** Police variable : le document produit n'est pas accepté comme PDF/A. */
  | 'FONT_VARIABLE';

/** Erreur typée levée par `embedFacturX` / `extractFacturX`. */
export class FacturXPdfError extends Error {
  override readonly name = 'FacturXPdfError';
  readonly code: FacturXPdfErrorCode;

  constructor(code: FacturXPdfErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}
