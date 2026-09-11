/**
 * Contrôles de format purs (aucune dépendance), tous exportés et testés unitairement.
 */

/** Clé de Luhn (SIREN, SIRET). */
export function luhnCheck(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SIREN : 9 chiffres, clé de Luhn. */
export function isValidSiren(value: string): boolean {
  return /^\d{9}$/.test(value) && luhnCheck(value);
}

/**
 * SIRET : 14 chiffres, clé de Luhn.
 * Exception connue : les établissements de La Poste (SIREN 356 000 000) utilisent une somme simple multiple de 5.
 */
export function isValidSiret(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false;
  if (value.startsWith('356000000')) {
    let sum = 0;
    for (const ch of value) sum += Number(ch);
    return sum % 5 === 0;
  }
  return luhnCheck(value);
}

/** Clé de contrôle d'un numéro de TVA français : (12 + 3 × (SIREN mod 97)) mod 97. */
export function frenchVatKey(siren: string): string {
  return String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');
}

/** Numéro de TVA intracommunautaire FR : `FR` + clé (2) + SIREN (9), clé et Luhn vérifiés. */
export function isValidFrenchVatId(value: string): boolean {
  const m = /^FR(\d{2})(\d{9})$/.exec(value);
  if (!m) return false;
  const key = m[1] as string;
  const siren = m[2] as string;
  return isValidSiren(siren) && frenchVatKey(siren) === key;
}

/**
 * Numéro de TVA : préfixe pays ISO 3166-1 alpha-2 (BR-CO-09) puis 2 à 12 caractères alphanumériques.
 * Les identifiants `FR` sont vérifiés par clé ; les autres uniquement par structure.
 */
export function isValidVatId(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(value)) return false;
  return value.startsWith('FR') ? isValidFrenchVatId(value) : true;
}

/** IBAN : 15 à 34 caractères, pays + 2 chiffres de clé, contrôle mod 97 (ISO 7064). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const chunk = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of chunk) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** BIC / SWIFT : 8 ou 11 caractères (banque 4, pays 2, localisation 2, agence 3). */
export function isValidBic(value: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value);
}

/** Date ISO `YYYY-MM-DD`, calendaire réelle (29/02 uniquement les années bissextiles). */
export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Code pays ISO 3166-1 alpha-2 : deux lettres majuscules (structure seulement). */
export function isValidCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/** Code devise ISO 4217 : trois lettres majuscules (structure seulement). */
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
