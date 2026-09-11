import { describe, expect, it } from 'vitest';
import { assertXmlSafe, escapeXmlAttr, escapeXmlText, XmlError } from '../src/index.js';

describe('escapeXmlText', () => {
  it('échappe &, < et > uniquement', () => {
    expect(escapeXmlText('a<b&c>d"e\'f')).toBe('a&lt;b&amp;c&gt;d"e\'f');
    expect(escapeXmlText('&amp;')).toBe('&amp;amp;'); // pas de double-échappement implicite
    expect(escapeXmlText('')).toBe('');
  });

  it('laisse passer Unicode, tab, LF, CR', () => {
    expect(escapeXmlText('Câbles — 😀\t\n\r')).toBe('Câbles — 😀\t\n\r');
  });
});

describe('escapeXmlAttr', () => {
  it('échappe aussi les guillemets doubles', () => {
    expect(escapeXmlAttr('x="1" & y<2')).toBe('x=&quot;1&quot; &amp; y&lt;2');
  });
});

describe('caractères interdits XML 1.0', () => {
  it.each([
    ['NUL', 'a\u0000b', '0000'],
    ['contrôle C0', 'a\u001Fb', '001F'],
    ['surrogate isolé haut', 'a\uD800b', 'D800'],
    ['surrogate isolé bas', 'a\uDC00b', 'DC00'],
    ['U+FFFE', 'a\uFFFEb', 'FFFE'],
  ])('rejette %s', (_label, input, code) => {
    expect(() => escapeXmlText(input)).toThrow(XmlError);
    expect(() => escapeXmlText(input)).toThrow(`U+${code}`);
    expect(() => escapeXmlAttr(input)).toThrow(XmlError);
    expect(() => assertXmlSafe(input)).toThrow('position 1');
  });

  it('accepte les caractères hors BMP (paire de surrogates valide)', () => {
    expect(() => assertXmlSafe('\u{1F600}')).not.toThrow();
  });
});
