import { describe, expect, it } from 'vitest';
import {
  applyRate,
  cents,
  centsFromDecimal,
  centsToString,
  divRoundHalfAwayFromZero,
  fromDecimal,
  lineNetAmount,
  MoneyError,
  percent,
  quantity,
  quantityFromDecimal,
  rateToString,
  sumCents,
  toDecimalString,
  unitPrice,
} from '../src/index.js';

describe('constructeurs', () => {
  it('acceptent les entiers sûrs et refusent le reste', () => {
    expect(cents(1234)).toBe(1234);
    expect(cents(-5)).toBe(-5);
    expect(() => cents(12.34)).toThrow(MoneyError);
    expect(() => cents(Number.NaN)).toThrow(MoneyError);
    expect(() => quantity(2 ** 53)).toThrow(MoneyError);
  });
});

describe('fromDecimal / toDecimalString', () => {
  it('parse sans float', () => {
    expect(fromDecimal('12.34', 2)).toBe(1234);
    expect(fromDecimal('12,3', 2)).toBe(1230);
    expect(fromDecimal('-0.01', 2)).toBe(-1);
    expect(fromDecimal('7', 4)).toBe(70000);
    expect(centsFromDecimal('0.10')).toBe(10);
    expect(quantityFromDecimal('1.5')).toBe(15000);
    expect(percent('5.5')).toBe(550);
  });

  it('refuse trop de décimales ou un format invalide', () => {
    expect(() => fromDecimal('1.234', 2)).toThrow(MoneyError);
    expect(() => fromDecimal('abc', 2)).toThrow(MoneyError);
    expect(() => fromDecimal('1e3', 2)).toThrow(MoneyError);
  });

  it('formate avec zéros de tête et signe', () => {
    expect(toDecimalString(1234, 2)).toBe('12.34');
    expect(toDecimalString(5, 2)).toBe('0.05');
    expect(toDecimalString(0, 2)).toBe('0.00');
    expect(toDecimalString(-1, 2)).toBe('-0.01');
    expect(toDecimalString(15000, 4)).toBe('1.5000');
    expect(toDecimalString(42, 0)).toBe('42');
    expect(centsToString(cents(19605))).toBe('196.05');
    expect(rateToString(percent('20'))).toBe('20.00');
  });
});

describe('arrondi commercial (half away from zero)', () => {
  it('arrondit la demi-unité vers l’extérieur', () => {
    expect(divRoundHalfAwayFromZero(5n, 10n)).toBe(1n); // 0,5 → 1
    expect(divRoundHalfAwayFromZero(-5n, 10n)).toBe(-1n); // −0,5 → −1
    expect(divRoundHalfAwayFromZero(4n, 10n)).toBe(0n);
    expect(divRoundHalfAwayFromZero(25n, 10n)).toBe(3n); // 2,5 → 3
    expect(divRoundHalfAwayFromZero(-25n, 10n)).toBe(-3n);
    expect(() => divRoundHalfAwayFromZero(1n, 0n)).toThrow(MoneyError);
  });
});

describe('lineNetAmount', () => {
  it('quantité × prix ÷ base, arrondi au centime', () => {
    expect(lineNetAmount(quantity(20000), unitPrice(105000))).toBe(2100); // 2 × 10,50
    expect(lineNetAmount(quantity(15000), unitPrice(200000))).toBe(3000); // 1,5 × 20
    expect(lineNetAmount(quantity(33333), unitPrice(10000))).toBe(333); // 3,3333 × 1 → 3,33
    expect(lineNetAmount(quantity(10000), unitPrice(1005))).toBe(10); // 0,1005 → 0,10 (0,1005 → 10,05 c → 10)
    expect(lineNetAmount(quantity(10000), unitPrice(1050))).toBe(11); // 0,105 → 10,5 c → 11
    // prix pour 100 unités : 250 × (12,00 / 100) = 30,00
    expect(lineNetAmount(quantity(2500000), unitPrice(120000), quantity(1000000))).toBe(3000);
  });

  it('reste exact au-delà de 2^53 en intermédiaire', () => {
    // 1 000 000 × 1 000 000,0000 → 1e12 € ; produit intermédiaire 1e20 > 2^53
    expect(lineNetAmount(quantity(10_000_000_000), unitPrice(10_000_000_000))).toBe(
      100_000_000_000_000,
    );
  });
});

describe('applyRate', () => {
  it('applique un taux en points de base avec arrondi', () => {
    expect(applyRate(cents(13700), percent('20'))).toBe(2740);
    expect(applyRate(cents(3000), percent('5.5'))).toBe(165);
    expect(applyRate(cents(1), percent('20'))).toBe(0); // 0,2 c → 0
    expect(applyRate(cents(3), percent('20'))).toBe(1); // 0,6 c → 1
    expect(applyRate(cents(12345), percent('5.5'))).toBe(679); // 678,975 → 679
  });
});

describe('sumCents', () => {
  it('somme exacte', () => {
    expect(sumCents([cents(1), cents(2), cents(-3)])).toBe(0);
    expect(sumCents([])).toBe(0);
  });
});
