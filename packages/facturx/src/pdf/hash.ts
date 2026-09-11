/**
 * Empreinte 128 bits déterministe (deux FNV-1a 64 bits à bases différentes) pour l'identifiant
 * de fichier du trailer (`/ID`, requis par PDF/A). Pas cryptographique : sert à l'unicité et à la reproductibilité.
 */
export function fingerprint128(chunks: readonly Uint8Array[]): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let a = 0xcbf29ce484222325n;
  let b = 0x84222325cbf29ce4n;
  for (const chunk of chunks) {
    for (const byte of chunk) {
      a = ((a ^ BigInt(byte)) * PRIME) & MASK;
      b = ((b ^ BigInt(byte ^ 0x5a)) * PRIME) & MASK;
    }
  }
  return a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0');
}
