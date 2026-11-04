/**
 * JSON qui transporte des octets, partagé entre le Studio (sauvegardes, import) et les Edge
 * Functions. Le module n'importe rien : Deno ne résout pas un `./x.js` vers `./x.ts`.
 */

/** Octets → base64, par blocs (un `String.fromCharCode(...grand tableau)` déborde la pile). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** JSON qui transporte des `Uint8Array` (pièces jointes, logo, polices) en base64 balisé. */
export function toPortableJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => (v instanceof Uint8Array ? { $bytes: toBase64(v) } : v),
    2,
  );
}

export function fromPortableJson<T>(text: string): T {
  return JSON.parse(text, (_, v) =>
    v && typeof v === 'object' && typeof (v as { $bytes?: unknown }).$bytes === 'string'
      ? fromBase64((v as { $bytes: string }).$bytes)
      : v,
  ) as T;
}
