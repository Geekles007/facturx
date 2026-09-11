/**
 * Limites de taille appliquées aux entrées non fiables (XML, pièces jointes, PDF).
 * Alignées sur BR-FR-19 (« toute facture de moins de 100 Mo, pièces jointes incluses, doit pouvoir être traitée »)
 * avec une marge pour le XML seul. Toutes surchargeables par option ; jamais silencieuses.
 */
export interface Limits {
  /** Taille maximale d'un document XML lu (octets UTF-8). */
  xmlBytes: number;
  /** Taille maximale d'une pièce jointe embarquée (BT-125), en octets décodés. */
  attachmentBytes: number;
  /** Taille maximale cumulée des pièces jointes d'une facture (BR-FR-19 : 100 Mo). */
  attachmentsTotalBytes: number;
  /** Taille maximale d'un PDF lu ou modifié. */
  pdfBytes: number;
}

const MIB = 1024 * 1024;

export const DEFAULT_LIMITS: Readonly<Limits> = {
  xmlBytes: 64 * MIB,
  attachmentBytes: 20 * MIB,
  attachmentsTotalBytes: 100_000_000,
  pdfBytes: 100 * MIB,
};

export function resolveLimits(override?: Partial<Limits>): Limits {
  return { ...DEFAULT_LIMITS, ...override };
}

/** Taille en octets UTF-8 d'une entrée texte ou binaire (calcul exact seulement si nécessaire). */
export function byteLength(input: string | Uint8Array): number {
  if (typeof input !== 'string') return input.byteLength;
  return new TextEncoder().encode(input).byteLength;
}

/** Vrai si l'entrée dépasse `limit` octets ; pour une chaîne, évite l'encodage quand la réponse est certaine. */
export function exceeds(input: string | Uint8Array, limit: number): boolean {
  if (typeof input !== 'string') return input.byteLength > limit;
  if (input.length > limit) return true; // chaque caractère pèse au moins un octet
  if (input.length * 3 <= limit) return false; // au plus trois octets par unité de code
  return byteLength(input) > limit;
}
