/**
 * Les dimensions d'un logo, lues dans ses octets sans décoder l'image, et le plafond que le Studio et
 * l'Edge Function `emettre` imposent (Ruling 62). La mémoire d'un rendu PDF suit le nombre de pixels
 * du logo, pas le poids de son fichier : un PNG de 4000 × 4000 pixels pèse 77 Ko, et son décodage a
 * pris 518 Mio de mémoire résidente en natif, au-delà des 256 Mo d'une Edge Function.
 *
 * Le plafond vient d'une mesure native (Deno 2.9.8, tas plafonné à 256 Mo, facture de 50 lignes,
 * tâche 21, tour 1) : pic de mémoire résidente d'un rendu seul, sans logo 121 Mio ; PNG de 2000 ×
 * 2000 pixels 161 à 167 Mio, deux rendus de suite 185 Mio ; 2500 × 2500, 179 Mio seul mais 247 Mio
 * pour deux rendus ; 3000 × 3000, 205 à 219 Mio. Un JPEG n'est pas décodé (il passe tel quel dans le
 * PDF) : 117 à 120 Mio quelle que soit sa taille. 2000 × 2000 est la plus grande valeur ronde qui
 * reste sous 200 Mio, rendus répétés compris ; la même borne vaut pour les deux formats.
 *
 * Le module n'importe rien : `pnpm compte:preparer` le copie tel quel pour Deno, qui ne résout pas
 * un `./x.js` vers `./x.ts` comme esbuild ou vitest.
 */

/** Le plus grand logo admis, en pixels. */
export const PLAFOND_LOGO = { largeur: 2000, hauteur: 2000 } as const;

export interface Dimensions {
  largeur: number;
  hauteur: number;
}

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** `IHDR`, le premier bloc d'un PNG, qui porte la largeur et la hauteur. */
const IHDR = [0x49, 0x48, 0x44, 0x52];

/** Les SOFn d'un JPEG (C0 à CF), sauf C4 (DHT), C8 (JPG) et CC (DAC), qui n'en sont pas. */
const estSof = (marqueur: number): boolean =>
  marqueur >= 0xc0 &&
  marqueur <= 0xcf &&
  marqueur !== 0xc4 &&
  marqueur !== 0xc8 &&
  marqueur !== 0xcc;

/** Les dimensions d'un PNG, d'après son en-tête IHDR. */
function dimensionsPng(o: Uint8Array): Dimensions | undefined {
  if (o.length < 24 || !IHDR.every((octet, i) => o[12 + i] === octet)) return undefined;
  const vue = new DataView(o.buffer, o.byteOffset, o.byteLength);
  return { largeur: vue.getUint32(16), hauteur: vue.getUint32(20) };
}

/**
 * Les dimensions d'un JPEG, d'après le premier segment SOFn (de base, progressif…), en sautant les
 * segments qui le précèdent. Rien si les données de l'image (SOS) ou la fin du fichier viennent avant.
 */
function dimensionsJpeg(o: Uint8Array): Dimensions | undefined {
  let i = 2;
  while (i < o.length) {
    if (o[i] !== 0xff) return undefined;
    // Des octets de remplissage 0xFF peuvent précéder un marqueur.
    while (o[i] === 0xff) i++;
    const marqueur = o[i];
    i++;
    if (marqueur === undefined || marqueur === 0xd9 || marqueur === 0xda) return undefined;
    // Les marqueurs sans segment : TEM, RST0 à RST7.
    if (marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) continue;
    if (i + 2 > o.length) return undefined;
    const longueur = ((o[i] as number) << 8) | (o[i + 1] as number);
    if (longueur < 2) return undefined;
    if (estSof(marqueur)) {
      if (i + 7 > o.length) return undefined;
      const hauteur = ((o[i + 3] as number) << 8) | (o[i + 4] as number);
      const largeur = ((o[i + 5] as number) << 8) | (o[i + 6] as number);
      return { largeur, hauteur };
    }
    i += longueur;
  }
  return undefined;
}

/**
 * Les dimensions d'une image PNG ou JPEG, lues dans ses en-têtes, sans la décoder. Rien si ce n'est
 * ni l'un ni l'autre, si l'en-tête est tronqué ou faux, ou si une dimension est nulle : une telle
 * image est refusée comme logo.
 */
export function dimensionsImage(octets: Uint8Array): Dimensions | undefined {
  const png = SIGNATURE_PNG.every((octet, i) => octets[i] === octet);
  const jpeg = octets[0] === 0xff && octets[1] === 0xd8;
  const d = png ? dimensionsPng(octets) : jpeg ? dimensionsJpeg(octets) : undefined;
  return d && d.largeur > 0 && d.hauteur > 0 ? d : undefined;
}

/** Vrai si l'image dépasse le plafond du logo, en largeur ou en hauteur. */
export function logoTropGrand(d: Dimensions): boolean {
  return d.largeur > PLAFOND_LOGO.largeur || d.hauteur > PLAFOND_LOGO.hauteur;
}
