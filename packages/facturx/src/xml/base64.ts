/** Base64 standard (RFC 4648) sans dépendance ni API Node, pour BT-125. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

const sextet = (n: number, shift: number): string => ALPHABET.charAt((n >> shift) & 63);

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += sextet(n, 18) + sextet(n, 12) + sextet(n, 6) + sextet(n, 0);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${sextet(n, 18)}${sextet(n, 12)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${sextet(n, 18)}${sextet(n, 12)}${sextet(n, 6)}=`;
  }
  return out;
}

export class Base64Error extends Error {
  override readonly name = 'Base64Error';
}

/** Décode du base64 (espaces et retours à la ligne ignorés, comme le permet xs:base64Binary). */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new Base64Error('Longueur base64 invalide.');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = clean.charCodeAt(i + k);
      const v = ch === 61 ? 0 : ch < 128 ? (LOOKUP[ch] ?? -1) : -1;
      if (v < 0) throw new Base64Error(`Caractère base64 invalide à la position ${i + k}.`);
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
