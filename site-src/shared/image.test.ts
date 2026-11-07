import { describe, expect, test } from 'vitest';
import { dimensionsImage, logoTropGrand, PLAFOND_LOGO } from './image.js';

/**
 * Les dimensions d'un logo lues dans ses octets, sans décoder l'image (Ruling 62) : l'en-tête IHDR
 * d'un PNG, le premier segment SOFn d'un JPEG (de base ou progressif). Un en-tête tronqué, ou qui
 * n'est pas celui qu'on attend, ne donne rien : l'image est refusée. Un PNG se lit bloc par bloc,
 * jusqu'à IEND, comme le décodeur de pdf-lib : un second IHDR (le décodeur garde le dernier), une
 * animation (`acTL`, `fcTL`, `fdAT`, décodée image par image), une profondeur de 16 bits ou un bloc
 * dont la longueur dépasse le fichier le font refuser.
 */

/** Un bloc PNG : sa longueur, son type, ses données, et un CRC (que personne ne vérifie ici). */
function bloc(type: string, donnees: number[] = []): number[] {
  const longueur = donnees.length;
  return [
    longueur >>> 24,
    (longueur >>> 16) & 0xff,
    (longueur >>> 8) & 0xff,
    longueur & 0xff,
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...donnees,
    0,
    0,
    0,
    0,
  ];
}

const u32 = (n: number): number[] => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** Le bloc IHDR : largeur, hauteur, profondeur, RVBA, sans entrelacement. */
const ihdr = (largeur: number, hauteur: number, profondeur = 8): number[] =>
  bloc('IHDR', [...u32(largeur), ...u32(hauteur), profondeur, 6, 0, 0, 0]);

/** Un PNG : la signature, puis les blocs donnés. */
const pngDe = (...blocs: number[][]): Uint8Array =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...blocs.flat()]);

/** Un PNG bien formé : IHDR, un IDAT (jamais décodé ici), IEND. */
const png = (largeur: number, hauteur: number): Uint8Array =>
  pngDe(ihdr(largeur, hauteur), bloc('IDAT', [0x78, 0x9c, 1, 2, 3]), bloc('IEND'));

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

describe('dimensionsImage : un PNG se lit bloc par bloc, comme le décodeur de pdf-lib', () => {
  test('des blocs connus ou non, puis IEND ; ce qui suit IEND n’est pas lu', () => {
    const texte = bloc(
      'tEXt',
      Array.from('Software\0Studio', (c) => c.charCodeAt(0)),
    );
    const p = pngDe(ihdr(640, 200), texte, bloc('zzZz', [1, 2]), bloc('IDAT', [1]), bloc('IEND'));
    expect(dimensionsImage(p)).toEqual({ largeur: 640, hauteur: 200 });
    expect(dimensionsImage(Uint8Array.from([...png(300, 120), 0xde, 0xad]))).toEqual({
      largeur: 300,
      hauteur: 120,
    });
  });

  test('un second IHDR : refusé (le décodeur garderait le dernier, au-delà du plafond)', () => {
    const deux = pngDe(ihdr(100, 100), bloc('IDAT', [1]), ihdr(40_000, 40_000), bloc('IEND'));
    expect(dimensionsImage(deux)).toBeUndefined();
    expect(dimensionsImage(pngDe(ihdr(100, 100), ihdr(100, 100), bloc('IEND')))).toBeUndefined();
  });

  test('un PNG animé (acTL, fcTL ou fdAT) : refusé, ses images seraient décodées une à une', () => {
    const actl = bloc('acTL', [...u32(2), ...u32(0)]);
    const fctl = bloc('fcTL', [
      ...u32(0),
      ...u32(40_000),
      ...u32(40_000),
      ...new Array(14).fill(0),
    ]);
    expect(dimensionsImage(pngDe(ihdr(100, 100), actl, bloc('IDAT', [1]), bloc('IEND')))).toBe(
      undefined,
    );
    expect(dimensionsImage(pngDe(ihdr(100, 100), fctl, bloc('IDAT', [1]), bloc('IEND')))).toBe(
      undefined,
    );
    expect(
      dimensionsImage(pngDe(ihdr(100, 100), bloc('IDAT', [1]), bloc('fdAT', [0, 0, 0, 1, 2]))),
    ).toBeUndefined();
  });

  test('une profondeur de 16 bits : refusée (jamais produite par le Studio, jamais mesurée)', () => {
    expect(dimensionsImage(pngDe(ihdr(100, 100, 16), bloc('IDAT', [1]), bloc('IEND')))).toBe(
      undefined,
    );
    expect(dimensionsImage(pngDe(ihdr(100, 100, 8), bloc('IDAT', [1]), bloc('IEND')))).toEqual({
      largeur: 100,
      hauteur: 100,
    });
  });

  test('une longueur de bloc fausse, ou un fichier qui s’arrête avant IEND : refusé', () => {
    // Un IDAT qui annonce plus d'octets que le fichier n'en a.
    const long = Uint8Array.from(pngDe(ihdr(100, 100), bloc('IDAT', [1, 2, 3]), bloc('IEND')));
    new DataView(long.buffer).setUint32(33, 0xffff_fff0);
    expect(dimensionsImage(long)).toBeUndefined();
    // Un IHDR qui n'a pas ses 13 octets.
    const court = pngDe(bloc('IHDR', [...u32(100), ...u32(100)]), bloc('IEND'));
    expect(dimensionsImage(court)).toBeUndefined();
    // Tronqué dans un bloc, entre deux blocs, ou sans IEND.
    const entier = png(300, 120);
    expect(dimensionsImage(entier.subarray(0, entier.length - 3))).toBeUndefined();
    expect(dimensionsImage(entier.subarray(0, 33 + 2))).toBeUndefined();
    expect(dimensionsImage(pngDe(ihdr(300, 120), bloc('IDAT', [1])))).toBeUndefined();
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
