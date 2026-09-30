/**
 * Encodeur de QR code (ISO/IEC 18004), en mode octet, sans dépendance.
 *
 * Juste ce que demande le QR code de paiement SEPA : des octets (UTF-8), un niveau de correction,
 * la plus petite version qui les contient et le masque de moindre pénalité. Le résultat est la
 * matrice des modules, que la mise en page dessine en vectoriel : net à toute échelle, sans image
 * à embarquer, et sans rien que PDF/A refuse.
 */

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** Modules du symbole, ligne par ligne depuis le haut : `true` pour un module sombre. Sans zone de silence. */
export type QrModules = boolean[][];

const LEVELS: readonly QrErrorCorrection[] = ['L', 'M', 'Q', 'H'];

/** Indicateur du niveau dans les bits de format : L = 01, M = 00, Q = 11, H = 10. */
const FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Par niveau (L, M, Q, H) puis par version (1 à 40) : mots de correction par bloc, nombre de blocs.
// Table 9 de la norme ; l’index 0 ne sert pas.
const ECC_PER_BLOCK: readonly (readonly number[])[] = [
  [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
const BLOCKS: readonly (readonly number[])[] = [
  [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
    40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

function at(table: readonly number[], index: number): number {
  return table[index] ?? 0;
}

/** Modules disponibles pour les données et la correction, une fois les motifs fixes posés. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function levelIndex(level: QrErrorCorrection): number {
  return LEVELS.indexOf(level);
}

/** Mots de données d'une version à un niveau donné. */
function dataCodewords(version: number, level: QrErrorCorrection): number {
  const l = levelIndex(level);
  return (
    Math.floor(rawDataModules(version) / 8) -
    at(ECC_PER_BLOCK[l] ?? [], version) * at(BLOCKS[l] ?? [], version)
  );
}

/** Octets que contient une version en mode octet (indicateur de mode et compteur déduits). */
export function qrByteCapacity(version: number, level: QrErrorCorrection): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8);
}

// ---------- Reed-Solomon sur GF(256), polynôme 0x11D ----------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Générateur de degré `degree`, racines α⁰ à α^(degree-1), sans le coefficient dominant. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(at(result, j), root) ^ (j + 1 < degree ? at(result, j + 1) : 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = at(result, i) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---------- flux de bits ----------

function dataStream(bytes: Uint8Array, version: number, level: QrErrorCorrection): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // mode octet
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version, level) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminateur
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | at(bits, i + j);
    codewords.push(byte);
  }
  return codewords;
}

/** Découpe en blocs, ajoute la correction de chacun, entrelace. */
function interleave(data: readonly number[], version: number, level: QrErrorCorrection): number[] {
  const l = levelIndex(level);
  const blocks = at(BLOCKS[l] ?? [], version);
  const eccLength = at(ECC_PER_BLOCK[l] ?? [], version);
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const own = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += own.length;
    const ecc = rsRemainder(own, divisor);
    // Un bloc court reçoit une case vide, sautée à l'entrelacement : les colonnes restent alignées.
    if (i < shortBlocks) own.push(0);
    all.push([...own, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < shortLength + 1; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(at(block, i));
    });
  }
  return result;
}

// ---------- matrice ----------

class Matrix {
  readonly size: number;
  readonly dark: Uint8Array;
  readonly fixed: Uint8Array;

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fixed = new Uint8Array(this.size * this.size);
  }

  get(x: number, y: number): boolean {
    return this.dark[y * this.size + x] === 1;
  }

  setFixed(x: number, y: number, dark: boolean): void {
    this.dark[y * this.size + x] = dark ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }

  isFixed(x: number, y: number): boolean {
    return this.fixed[y * this.size + x] === 1;
  }

  /** Motifs fixes : repères, séparateurs, synchronisation, alignement, emplacements de format et de version. */
  drawPatterns(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFixed(6, i, i % 2 === 0);
      this.setFixed(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= n || y < 0 || y >= n) continue;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFixed(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((cx, i) => {
      positions.forEach((cy, j) => {
        // Pas sur les trois repères.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.setFixed(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });
    this.drawFormat(0, 'M'); // réserve les emplacements ; réécrit avec le masque retenu
    this.drawVersion();
  }

  alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  /** Niveau et masque, protégés par un code BCH(15,5), en deux exemplaires. */
  drawFormat(mask: number, level: QrErrorCorrection): void {
    const data = (FORMAT_BITS[level] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFixed(8, i, bit(i));
    this.setFixed(8, 7, bit(6));
    this.setFixed(8, 8, bit(7));
    this.setFixed(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFixed(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFixed(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFixed(8, n - 15 + i, bit(i));
    this.setFixed(8, n - 8, true); // module toujours sombre
  }

  /** Numéro de version, protégé par un code BCH(18,6), à partir de la version 7. */
  drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFixed(a, b, dark);
      this.setFixed(b, a, dark);
    }
  }

  /** Pose les mots en zigzag, par colonnes de deux modules, de droite à gauche. */
  drawCodewords(codewords: readonly number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // la colonne de synchronisation est sautée
      const upward = ((right + 1) & 2) === 0;
      for (let v = 0; v < n; v++) {
        const y = upward ? n - 1 - v : v;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (this.isFixed(x, y) || i >= codewords.length * 8) continue;
          const dark = ((at(codewords, i >>> 3) >>> (7 - (i & 7))) & 1) === 1;
          this.dark[y * n + x] = dark ? 1 : 0;
          i++;
        }
      }
    }
  }

  /** Inverse les modules de données où le masque vaut vrai ; appliqué deux fois, s'annule. */
  applyMask(mask: number): void {
    const n = this.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (this.isFixed(x, y) || !MASKS[mask]?.(x, y)) continue;
        this.dark[y * n + x] = this.get(x, y) ? 0 : 1;
      }
    }
  }

  /** Pénalité de la norme (§ 7.8.3) : suites, carrés, motifs de repère, équilibre. */
  penalty(): number {
    const n = this.size;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const add = (length: number) => {
        history.pop();
        history.unshift(history[0] === 0 ? length + n : length); // bordure claire au début
      };
      const finders = () => {
        const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0] = history;
        const core = h1 > 0 && h2 === h1 && h3 === h1 * 3 && h4 === h1 && h5 === h1;
        return (
          (core && h0 >= h1 * 4 && h6 >= h1 ? 1 : 0) + (core && h6 >= h1 * 4 && h0 >= h1 ? 1 : 0)
        );
      };
      for (let i = 0; i < n; i++) {
        if (get(i) === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          add(run);
          if (!color) score += finders() * 40;
          color = get(i);
          run = 1;
        }
      }
      // Fin de ligne : la suite en cours, puis la bordure claire.
      if (color) {
        add(run);
        run = 0;
      }
      add(run + n);
      score += finders() * 40;
    };
    for (let y = 0; y < n; y++) line((x) => this.get(x, y));
    for (let x = 0; x < n; x++) line((y) => this.get(x, y));
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = this.get(x, y);
        if (c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) {
          score += 3;
        }
      }
    }
    let darkCount = 0;
    for (const m of this.dark) darkCount += m;
    const total = n * n;
    score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  modules(): QrModules {
    const n = this.size;
    return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => this.get(x, y)));
  }
}

/** Les huit masques de la norme ; `x` est la colonne, `y` la ligne. */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export interface QrOptions {
  /** Niveau de correction. Défaut : `M` (15 % du symbole peut être abîmé). */
  level?: QrErrorCorrection;
  /** Version minimale (1 à 40). Défaut : 1. */
  minVersion?: number;
  /** Version maximale ; au-delà, l'encodage échoue. Défaut : 40. */
  maxVersion?: number;
  /** Masque imposé (0 à 7) ; par défaut, celui de moindre pénalité. */
  mask?: number;
}

export interface QrCode {
  version: number;
  level: QrErrorCorrection;
  mask: number;
  modules: QrModules;
}

/**
 * Encode des octets en QR code, dans la plus petite version qui les contient.
 * Lève une `RangeError` si les données dépassent la version maximale.
 */
export function encodeQr(bytes: Uint8Array, options: QrOptions = {}): QrCode {
  const level = options.level ?? 'M';
  const min = options.minVersion ?? 1;
  const max = options.maxVersion ?? 40;
  let version = min;
  while (version <= max && qrByteCapacity(version, level) < bytes.length) version++;
  if (version > max) {
    throw new RangeError(
      `${bytes.length} octets dépassent la capacité d'un QR code de version ${max} (niveau ${level}).`,
    );
  }
  const symbol = new Matrix(version);
  symbol.drawPatterns();
  symbol.drawCodewords(interleave(dataStream(bytes, version, level), version, level));
  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < 8; candidate++) {
      symbol.applyMask(candidate);
      symbol.drawFormat(candidate, level);
      const score = symbol.penalty();
      if (score < best) {
        best = score;
        mask = candidate;
      }
      symbol.applyMask(candidate);
    }
  }
  symbol.applyMask(mask);
  symbol.drawFormat(mask, level);
  return { version, level, mask, modules: symbol.modules() };
}
