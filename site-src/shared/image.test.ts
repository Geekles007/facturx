import { describe, expect, test } from 'vitest';
import { dimensionsImage, logoTropGrand, PLAFOND_LOGO } from './image.js';

/**
 * Les dimensions d'un logo lues dans ses octets, sans décoder l'image (Ruling 62) : l'en-tête IHDR
 * d'un PNG, le premier segment SOFn d'un JPEG (de base ou progressif). Un en-tête tronqué, ou qui
 * n'est pas celui qu'on attend, ne donne rien : l'image est refusée.
 */

/** Un PNG réduit à sa signature et à son en-tête IHDR (le reste n'est pas lu). */
function png(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(33);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(o.buffer);
  v.setUint32(8, 13);
  o.set([0x49, 0x48, 0x44, 0x52], 12);
  v.setUint32(16, largeur);
  v.setUint32(20, hauteur);
  o.set([8, 6, 0, 0, 0], 24);
  return o;
}

/** Un segment JPEG : son marqueur, sa longueur (deux octets, comptés), sa charge. */
const segment = (marqueur: number, charge: number[]): number[] => [
  0xff,
  marqueur,
  (charge.length + 2) >> 8,
  (charge.length + 2) & 0xff,
  ...charge,
];

/** Un JPEG : SOI, APP0, une table de Huffman, puis le SOFn donné ; ni image ni EOI. */
function jpeg(sof: number, largeur: number, hauteur: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    // DHT (0xC4) n'est pas un SOF, même s'il en a l'allure.
    ...segment(0xc4, [0, 1, 2, 3]),
    // Des octets de remplissage 0xFF avant un marqueur sont permis.
    0xff,
    ...segment(sof, [8, hauteur >> 8, hauteur & 0xff, largeur >> 8, largeur & 0xff, 1, 1, 0x11, 0]),
  ]);
}

describe('dimensionsImage', () => {
  test('PNG : l’en-tête IHDR', () => {
    expect(dimensionsImage(png(4000, 4000))).toEqual({ largeur: 4000, hauteur: 4000 });
    expect(dimensionsImage(png(300, 120))).toEqual({ largeur: 300, hauteur: 120 });
  });

  test('JPEG de base (SOF0) et progressif (SOF2), après d’autres segments', () => {
    expect(dimensionsImage(jpeg(0xc0, 1200, 300))).toEqual({ largeur: 1200, hauteur: 300 });
    expect(dimensionsImage(jpeg(0xc2, 2500, 10))).toEqual({ largeur: 2500, hauteur: 10 });
  });

  test('en-tête tronqué, absent ou faux : rien, l’image est refusée', () => {
    const p = png(300, 120);
    expect(dimensionsImage(p.subarray(0, 20))).toBeUndefined();
    const autreBloc = p.slice();
    autreBloc.set([0x49, 0x44, 0x41, 0x54], 12); // IDAT au lieu de IHDR
    expect(dimensionsImage(autreBloc)).toBeUndefined();
    expect(dimensionsImage(png(0, 120))).toBeUndefined();
    const j = jpeg(0xc0, 1200, 300);
    expect(dimensionsImage(j.subarray(0, j.length - 6))).toBeUndefined();
    expect(dimensionsImage(Uint8Array.of(0xff, 0xd8))).toBeUndefined();
    // Les données de l'image (SOS) avant tout SOF : rien à lire.
    expect(
      dimensionsImage(Uint8Array.from([0xff, 0xd8, ...segment(0xda, [1, 2, 3])])),
    ).toBeUndefined();
    expect(dimensionsImage(new TextEncoder().encode('GIF89a……'))).toBeUndefined();
    expect(dimensionsImage(new Uint8Array())).toBeUndefined();
  });
});

describe('le plafond du logo', () => {
  test('2000 × 2000 pixels au plus, en largeur comme en hauteur', () => {
    expect(PLAFOND_LOGO).toEqual({ largeur: 2000, hauteur: 2000 });
    expect(logoTropGrand({ largeur: 2000, hauteur: 2000 })).toBe(false);
    expect(logoTropGrand({ largeur: 2001, hauteur: 300 })).toBe(true);
    expect(logoTropGrand({ largeur: 300, hauteur: 2001 })).toBe(true);
  });
});
