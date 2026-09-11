/**
 * Représentation monétaire : entiers uniquement, zéro flottant (voir docs/decisions.md).
 *
 * - `Cents`     : montant à 2 décimales           → 1234   = 12,34
 * - `Quantity`  : quantité à 4 décimales           → 15000  = 1,5
 * - `UnitPrice` : prix unitaire net à 4 décimales  → 105000 = 10,50
 * - `Rate`      : pourcentage en points de base    → 2000   = 20,00 %
 *
 * Les produits intermédiaires (quantité × prix) sont calculés en `bigint`
 * pour rester exacts au-delà de 2^53, puis arrondis UNE seule fois vers le centime
 * (arrondi commercial : demi-unité vers l'extérieur, « half away from zero »).
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Montant en centimes (2 décimales), entier signé. */
export type Cents = Brand<number, 'Cents'>;
/** Quantité à 4 décimales (BT-129, BT-149), entier signé. */
export type Quantity = Brand<number, 'Quantity'>;
/** Prix unitaire à 4 décimales (BT-146), entier signé. */
export type UnitPrice = Brand<number, 'UnitPrice'>;
/** Pourcentage en points de base : 2000 = 20,00 % (BT-119, BT-152…). */
export type Rate = Brand<number, 'Rate'>;

export const CENTS_SCALE = 2;
export const E4_SCALE = 4;
export const RATE_SCALE = 2;

export class MoneyError extends TypeError {
  override readonly name = 'MoneyError';
}

function assertSafeInteger(value: number, kind: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${kind} doit être un entier sûr (reçu : ${String(value)}).`);
  }
}

/** Construit un montant en centimes à partir d'un entier (1234 → 12,34). */
export function cents(value: number): Cents {
  assertSafeInteger(value, 'Cents');
  return value as Cents;
}

/** Construit une quantité à 4 décimales à partir d'un entier (15000 → 1,5). */
export function quantity(value: number): Quantity {
  assertSafeInteger(value, 'Quantity');
  return value as Quantity;
}

/** Construit un prix unitaire à 4 décimales à partir d'un entier (105000 → 10,50). */
export function unitPrice(value: number): UnitPrice {
  assertSafeInteger(value, 'UnitPrice');
  return value as UnitPrice;
}

/** Construit un taux en points de base (2000 → 20,00 %). */
export function rate(basisPoints: number): Rate {
  assertSafeInteger(basisPoints, 'Rate');
  return basisPoints as Rate;
}

/** Construit un taux depuis une chaîne décimale exacte ("20" ou "5.5" → 2000 / 550). */
export function percent(text: string): Rate {
  return rate(fromDecimal(text, RATE_SCALE));
}

/**
 * Parse une chaîne décimale exacte vers un entier à `scale` décimales, sans passer par un float.
 * Accepte un signe, un point ou une virgule, et refuse plus de `scale` décimales.
 */
export function fromDecimal(text: string, scale: number): number {
  const match = /^([+-])?(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!match) throw new MoneyError(`Nombre décimal invalide : "${text}".`);
  const sign = match[1] === '-' ? -1 : 1;
  const intPart = match[2] ?? '0';
  const fracPart = match[3] ?? '';
  if (fracPart.length > scale) {
    throw new MoneyError(`"${text}" dépasse ${scale} décimale(s).`);
  }
  const digits = intPart + fracPart.padEnd(scale, '0');
  const value = sign * Number(digits);
  assertSafeInteger(value, 'Decimal');
  return value;
}

export const centsFromDecimal = (text: string): Cents => cents(fromDecimal(text, CENTS_SCALE));
export const quantityFromDecimal = (text: string): Quantity =>
  quantity(fromDecimal(text, E4_SCALE));
export const unitPriceFromDecimal = (text: string): UnitPrice =>
  unitPrice(fromDecimal(text, E4_SCALE));

/** Formate un entier à `scale` décimales en chaîne décimale ("." comme séparateur) : 1234, 2 → "12.34". */
export function toDecimalString(value: number, scale: number): string {
  assertSafeInteger(value, 'Decimal');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value)
    .toString()
    .padStart(scale + 1, '0');
  if (scale === 0) return sign + abs;
  return `${sign}${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
}

export const centsToString = (value: Cents): string => toDecimalString(value, CENTS_SCALE);
export const e4ToString = (value: Quantity | UnitPrice): string => toDecimalString(value, E4_SCALE);
export const rateToString = (value: Rate): string => toDecimalString(value, RATE_SCALE);

/** Division entière avec arrondi commercial (demi-unité vers l'extérieur, « half away from zero »). */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division par zéro.');
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function toCents(value: bigint): Cents {
  const n = Number(value);
  assertSafeInteger(n, 'Cents');
  return n as Cents;
}

/** Quantité à 4 décimales représentant 1 (base par défaut de BT-149). */
export const ONE_QUANTITY: Quantity = 10_000 as Quantity;

/**
 * Montant net d'une ligne avant remises/frais de ligne :
 * quantité × prix unitaire ÷ quantité de base, arrondi au centime (BT-129 × BT-146 ÷ BT-149).
 */
export function lineNetAmount(
  qty: Quantity,
  price: UnitPrice,
  baseQuantity: Quantity = ONE_QUANTITY,
): Cents {
  // (qty ×1e4) × (price ×1e4) ÷ ((base ×1e4) × 1e2)  →  ×1e2
  return toCents(
    divRoundHalfAwayFromZero(BigInt(qty) * BigInt(price), BigInt(baseQuantity) * 100n),
  );
}

/** Applique un taux (points de base) à un montant : montant × taux ÷ 10 000, arrondi au centime (BR-CO-17). */
export function applyRate(amount: Cents, percentage: Rate): Cents {
  return toCents(divRoundHalfAwayFromZero(BigInt(amount) * BigInt(percentage), 10_000n));
}

/** Somme exacte de montants en centimes. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return cents(total);
}

export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export const ZERO_CENTS: Cents = 0 as Cents;
