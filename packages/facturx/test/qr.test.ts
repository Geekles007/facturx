import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeQr, type QrErrorCorrection, qrByteCapacity } from '../src/pdf/qr.js';

/** Image RGBA du symbole, zone de silence de quatre modules, `scale` pixels par module. */
function raster(modules: boolean[][], scale = 4): { data: Uint8ClampedArray; width: number } {
  const n = modules.length;
  const width = (n + 8) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = (((y + 4) * scale + dy) * width + (x + 4) * scale + dx) * 4;
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
        }
      }
    });
  });
  return { data, width };
}

/** Relit le symbole avec jsQR, un décodeur indépendant. */
function decode(modules: boolean[][]): Uint8Array | undefined {
  const { data, width } = raster(modules);
  const result = jsQR(data, width, width);
  return result ? Uint8Array.from(result.binaryData) : undefined;
}

/** Suite pseudo-aléatoire reproductible. */
function bytes(length: number, seed: number): Uint8Array {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state & 0xff;
  });
}

describe('QR code (ISO/IEC 18004)', () => {
  it('connaît la capacité de chaque version en mode octet', () => {
    // Table 7 de la norme : quelques versions, les quatre niveaux.
    const known: [number, number[]][] = [
      [1, [17, 14, 11, 7]],
      [5, [106, 84, 60, 44]],
      [7, [154, 122, 86, 64]],
      [10, [271, 213, 151, 119]],
      [13, [425, 331, 241, 177]],
      [27, [1465, 1125, 805, 625]],
      [40, [2953, 2331, 1663, 1273]],
    ];
    for (const [version, capacities] of known) {
      expect((['L', 'M', 'Q', 'H'] as const).map((l) => qrByteCapacity(version, l))).toEqual(
        capacities,
      );
    }
  });

  it('produit, à masque égal, le symbole de la bibliothèque qrcode', () => {
    // Vecteur de référence produit par `qrcode` (npm), indépendante du SDK : « facturx-sdk »,
    // niveau M, masque 3.
    const expected = [
      '#######.#...#.#######',
      '#.....#.#.##..#.....#',
      '#.###.#..#....#.###.#',
      '#.###.#.####..#.###.#',
      '#.###.#....#..#.###.#',
      '#.....#..####.#.....#',
      '#######.#.#.#.#######',
      '........##.##........',
      '#.##.###..###.#..#.##',
      '##.....#..#######.#.#',
      '....#.##..##.##....##',
      '#....#...#.#....##.##',
      '...####.#...#####..#.',
      '........#..#..####...',
      '#######.##.##.#####..',
      '#.....#.#.#..#.######',
      '#.###.#...#.#.....#..',
      '#.###.#.###....#.#.#.',
      '#.###.#.##..#.....#..',
      '#.....#.....####....#',
      '#######.#...#######..',
    ];
    const qr = encodeQr(new TextEncoder().encode('facturx-sdk'), { level: 'M', mask: 3 });
    expect(qr.version).toBe(1);
    expect(qr.modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''))).toEqual(
      expected,
    );
  });

  // Les versions 1 à 13 couvrent tout QR code de paiement (331 octets au plus) ; la 20, au-delà.
  it('se relit à l’identique, des versions 1 à 13 et 20, aux quatre niveaux', {
    timeout: 30_000,
  }, () => {
    const levels: QrErrorCorrection[] = ['L', 'M', 'Q', 'H'];
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20]) {
      levels.forEach((level, i) => {
        // Juste au-dessus de la capacité de la version précédente : impose la version.
        const length = version === 1 ? 1 : qrByteCapacity(version - 1, level) + 1;
        const data = bytes(length, version * 4 + i);
        const qr = encodeQr(data, { level });
        expect(qr.version, `version ${version}, niveau ${level}`).toBe(version);
        expect(qr.modules).toHaveLength(version * 4 + 17);
        expect(decode(qr.modules), `version ${version}, niveau ${level}`).toEqual(data);
      });
    }
  });

  it('se relit quel que soit le masque, et retient celui demandé', () => {
    const data = new TextEncoder().encode('Scannez pour payer — 2 880,00 €');
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr(data, { mask });
      expect(qr.mask).toBe(mask);
      expect(decode(qr.modules)).toEqual(data);
    }
  });

  it('résiste à un symbole abîmé, dans la limite du niveau de correction', () => {
    const data = new TextEncoder().encode(
      'BCD\n002\n1\nSCT\n\nAtelier\nFR7630006000011234567890189',
    );
    const qr = encodeQr(data, { level: 'M' });
    // Une tache au centre, sur les données : le niveau M corrige environ 15 % des mots.
    const n = qr.modules.length;
    const damaged = qr.modules.map((row, y) =>
      row.map((dark, x) => (Math.abs(x - n / 2) < 3 && Math.abs(y - n / 2) < 3 ? !dark : dark)),
    );
    expect(damaged).not.toEqual(qr.modules);
    expect(decode(damaged)).toEqual(data);
  });

  it('refuse des données plus longues que la version maximale', () => {
    expect(() => encodeQr(bytes(332, 1), { level: 'M', maxVersion: 13 })).toThrow(RangeError);
    expect(encodeQr(bytes(331, 1), { level: 'M', maxVersion: 13 }).version).toBe(13);
  });
});
