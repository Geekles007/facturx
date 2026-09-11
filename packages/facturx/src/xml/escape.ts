/**
 * Échappement XML manuel (aucune lib) et rejet des caractères interdits par XML 1.0 §2.2 :
 * autorisés = #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF].
 * Un surrogate isolé (chaîne JS mal formée) n'appartient à aucun intervalle avec le flag `u` : il est rejeté.
 */
const ILLEGAL_XML_CHAR = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;

export class XmlError extends Error {
  override readonly name = 'XmlError';
}

/** Lève une `XmlError` si `text` contient un caractère interdit en XML 1.0. */
export function assertXmlSafe(text: string, context = 'texte'): void {
  const match = ILLEGAL_XML_CHAR.exec(text);
  if (match) {
    const code = (text.codePointAt(match.index) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    throw new XmlError(
      `Caractère U+${code} interdit en XML 1.0 (${context}, position ${match.index}).`,
    );
  }
}

/** Échappe un contenu textuel : `&`, `<`, `>`. Lève si un caractère interdit est présent. */
export function escapeXmlText(text: string): string {
  assertXmlSafe(text);
  return text.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

/** Échappe une valeur d'attribut (délimitée par des guillemets doubles) : `&`, `<`, `>`, `"`. */
export function escapeXmlAttr(text: string): string {
  assertXmlSafe(text, 'attribut');
  return text.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );
}
