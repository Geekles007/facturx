/**
 * Polices : chargement, mesure du texte et couverture des caractères.
 *
 * La mise en page mesure le texte avec fontkit, exactement comme pdf-lib le fera en l'écrivant :
 * somme des avances des glyphes, sans crénage, avec les mêmes fonctionnalités OpenType. Une
 * mesure faite ailleurs qu'au dessin décalerait les colonnes alignées à droite.
 */

import { FacturXPdfError } from './errors.js';

/**
 * Fonctionnalités OpenType désactivées. pdf-lib écrit les glyphes substitués par une ligature ou
 * une alternative contextuelle sans reprendre leurs avances, ce qui ouvre des trous dans les mots
 * (« palette » s'affichait « palett e » avec Geist) ; sans substitution, un caractère = un glyphe,
 * et le texte copié depuis le PDF reste celui de la facture.
 */
export const FONT_FEATURES: Readonly<Record<string, boolean>> = {
  liga: false,
  clig: false,
  calt: false,
  rlig: false,
  dlig: false,
};

/** La partie de fontkit dont le rendu a besoin. */
export interface FontkitFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  variationAxes?: Record<string, unknown>;
  layout(text: string, features?: Record<string, boolean>): { glyphs: { advanceWidth: number }[] };
  hasGlyphForCodePoint(codePoint: number): boolean;
}

export interface Fontkit {
  create(bytes: Uint8Array): FontkitFont;
}

/** `@pdf-lib/fontkit` n'est requis que par qui rend une page : dépendance pair optionnelle. */
export async function loadFontkit(): Promise<Fontkit> {
  const module = (await import('@pdf-lib/fontkit').catch(() => {
    throw new FacturXPdfError(
      'FONTKIT_REQUIRED',
      'Le rendu embarque une police, ce qui requiert « @pdf-lib/fontkit ». Installez-le : npm add @pdf-lib/fontkit',
    );
  })) as { default?: Fontkit } & Partial<Fontkit>;
  return (module.default ?? module) as Fontkit;
}

/** Mesures d'une police à une taille donnée, et couverture des caractères. */
export interface FontMetrics {
  /** Largeur du texte, en points. */
  width(text: string, size: number): number;
  /** Vrai si la police dessine ce caractère (un point de code). */
  has(char: string): boolean;
  /** Hauteur au-dessus de la ligne de base, en proportion du corps. */
  readonly ascent: number;
}

const parsed = new WeakMap<Uint8Array, FontkitFont>();

/**
 * Ouvre une police (une fois par tableau d'octets : l'aperçu d'un éditeur la mesure à chaque
 * frappe) et refuse les **polices variables**.
 *
 * Elles se chargent sans broncher, mais le document obtenu est rejeté par veraPDF —
 * « the font programs for all fonts used for rendering shall be embedded ». L'erreur n'apparaîtrait
 * donc qu'au contrôle de conformité, voire au dépôt sur une plateforme : autant la lever ici.
 * La plupart des familles publient une version statique à côté de la variable
 * (`Geist-Regular.ttf` plutôt que `Geist-Variable.woff2`) ; c'est celle-là qu'il faut.
 */
export function openFont(fontkit: Fontkit, bytes: Uint8Array, field: string): FontkitFont {
  let font = parsed.get(bytes);
  if (!font) {
    try {
      font = fontkit.create(bytes);
    } catch (error) {
      throw new FacturXPdfError(
        'FONT_INVALID',
        `La police fournie en ${field} est illisible : TTF ou OTF attendu.`,
        { cause: error },
      );
    }
    if (typeof font?.layout !== 'function') {
      throw new FacturXPdfError(
        'FONT_INVALID',
        `La police fournie en ${field} est une collection ou un format non pris en charge : TTF ou OTF attendu.`,
      );
    }
    parsed.set(bytes, font);
  }
  const axes = font.variationAxes;
  if (axes && Object.keys(axes).length > 0) {
    throw new FacturXPdfError(
      'FONT_VARIABLE',
      `La police fournie en ${field} est une police variable (axes : ${Object.keys(axes).join(', ')}). Le PDF produit serait refusé comme PDF/A, faute de programme de police embarquable : fournissez la version statique de cette famille.`,
    );
  }
  // fontkit lit le WOFF, mais pdf-lib embarque les octets tels quels comme programme TrueType :
  // un WOFF compressé à la place d'un TTF donne un PDF dont la police est illisible.
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'wOFF' || magic === 'wOF2') {
    throw new FacturXPdfError(
      'FONT_INVALID',
      `La police fournie en ${field} est au format ${magic === 'wOF2' ? 'WOFF2' : 'WOFF'}, une compression pour le web qui ne s'embarque pas dans un PDF : fournissez le fichier TTF ou OTF de la même police.`,
    );
  }
  return font;
}

/** Mesures d'une police ouverte ; les largeurs déjà calculées sont gardées. */
export function metricsOf(font: FontkitFont): FontMetrics {
  const widths = new Map<string, number>();
  const scale = 1 / font.unitsPerEm;
  return {
    ascent: font.ascent * scale,
    width(text, size) {
      let units = widths.get(text);
      if (units === undefined) {
        units = 0;
        for (const glyph of font.layout(text, FONT_FEATURES).glyphs) units += glyph.advanceWidth;
        if (widths.size > 20_000) widths.clear();
        widths.set(text, units);
      }
      return units * scale * size;
    },
    has(char) {
      const codePoint = char.codePointAt(0);
      return codePoint !== undefined && font.hasGlyphForCodePoint(codePoint);
    },
  };
}

// ---------- images ----------

/** Dimensions d'un PNG ou d'un JPEG, lues dans l'en-tête ; `undefined` si illisible. */
export function imageSize(
  bytes: Uint8Array,
  type: 'png' | 'jpeg',
): { width: number; height: number } | undefined {
  const u32 = (i: number) =>
    (((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0)) >>>
    0;
  const u16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  if (type === 'png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((b, i) => bytes[i] === b)) return undefined;
    const width = u32(16);
    const height = u32(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1] ?? 0;
    // Marqueurs sans longueur (remplissage, RSTn) : on avance d'un octet.
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = u16(i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const height = u16(i + 5);
      const width = u16(i + 7);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (length < 2) return undefined;
    i += 2 + length;
  }
  return undefined;
}
