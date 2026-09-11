import { describe, expect, it } from 'vitest';
import { Base64Error, decodeBase64, encodeBase64 } from '../src/index.js';

const vectors: [string, string][] = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
];

describe('base64', () => {
  it('encode et décode (RFC 4648), toutes longueurs de reste', () => {
    for (const [text, expected] of vectors) {
      const bytes = new TextEncoder().encode(text);
      expect(encodeBase64(bytes)).toBe(expected);
      expect(decodeBase64(expected)).toEqual(bytes);
    }
  });

  it('aller-retour binaire et espaces tolérés', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
    const b64 = encodeBase64(bytes);
    expect(decodeBase64(b64)).toEqual(bytes);
    expect(decodeBase64(b64.replace(/(.{76})/g, '$1\n'))).toEqual(bytes);
  });

  it('refuse un base64 malformé', () => {
    expect(() => decodeBase64('Zm9')).toThrow(Base64Error);
    expect(() => decodeBase64('Zm9$')).toThrow(Base64Error);
  });
});
