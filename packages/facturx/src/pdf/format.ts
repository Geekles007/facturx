/**
 * Mise en forme des nombres, montants et dates pour la page lisible.
 *
 * Pas d'`Intl` : le rendu doit être identique d'un moteur JavaScript à l'autre, et les séparateurs
 * dépendent de la police — l'espace fine insécable (U+202F) de la typographie française n'existe
 * pas dans toutes, et un caractère absent devient un glyphe `.notdef` que PDF/A refuse. Le
 * formateur reçoit donc les séparateurs que la police sait dessiner.
 */

import { type Cents, E4_SCALE, type Rate, toDecimalString } from '../money.js';

export type RenderLocale = 'fr' | 'en';

/** Caractères de séparation, choisis selon ce que la police sait dessiner. */
export interface Separators {
  /** Séparateur de milliers en français, et espace avant `%` ou `€`. */
  group: string;
}

/** Symboles des devises les plus courantes ; les autres s'écrivent en code ISO 4217. */
const SYMBOLS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  JPY: '¥',
  CHF: 'CHF',
};

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Regroupe les chiffres d'une partie entière par milliers. */
function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export class Formatter {
  constructor(
    readonly locale: RenderLocale,
    readonly separators: Separators,
    /** Vrai si la police dessine le symbole de la devise ; sinon le code ISO est écrit. */
    private readonly hasGlyph: (char: string) => boolean,
  ) {}

  /** Nombre décimal (chaîne `-1234.5`) avec séparateurs de la langue. */
  private decimal(text: string): string {
    const negative = text.startsWith('-');
    const [whole = '0', fraction] = (negative ? text.slice(1) : text).split('.');
    const sign = negative ? '−' : '';
    const minus = this.hasGlyph('−') ? sign : negative ? '-' : '';
    if (this.locale === 'fr') {
      const body = group(whole, this.separators.group);
      return `${minus}${fraction ? `${body},${fraction}` : body}`;
    }
    const body = group(whole, ',');
    return `${minus}${fraction ? `${body}.${fraction}` : body}`;
  }

  /** Symbole de la devise, ou son code si la police n'a pas le glyphe. */
  currency(code: string): string {
    const symbol = SYMBOLS[code];
    return symbol && [...symbol].every((c) => this.hasGlyph(c)) ? symbol : code;
  }

  /** Montant : `2 880,00 €` en français, `€2,880.00` en anglais (code ISO à défaut de symbole). */
  money(value: Cents, currency: string): string {
    const amount = this.decimal(toDecimalString(value, 2));
    const unit = this.currency(currency);
    if (this.locale === 'fr') return `${amount}${this.separators.group}${unit}`;
    return unit.length === 1 ? amount.replace(/^(−|-)?/, `$1${unit}`) : `${amount} ${unit}`;
  }

  /** Quantité (4 décimales) : les zéros inutiles disparaissent, `2` plutôt que `2,0000`. */
  quantity(value: number): string {
    const text = toDecimalString(value, E4_SCALE).replace(/\.?0+$/, '');
    return this.decimal(text);
  }

  /** Prix unitaire (4 décimales) : au moins deux décimales, comme un montant. */
  price(value: number): string {
    return this.decimal(toDecimalString(value, E4_SCALE).replace(/(\.\d\d\d*?)0+$/, '$1'));
  }

  /** Prix unitaire suivi de la devise. */
  unitPrice(value: number, currency: string): string {
    const amount = this.price(value);
    const unit = this.currency(currency);
    if (this.locale === 'fr') return `${amount}${this.separators.group}${unit}`;
    return unit.length === 1 ? amount.replace(/^(−|-)?/, `$1${unit}`) : `${amount} ${unit}`;
  }

  /** Taux : `20 %`, `5,5 %` en français ; `20%`, `5.5%` en anglais. */
  percent(value: Rate): string {
    const text = toDecimalString(value, 2).replace(/\.?0+$/, '');
    const body = this.decimal(text);
    return this.locale === 'fr' ? `${body}${this.separators.group}%` : `${body}%`;
  }

  /** Date ISO `AAAA-MM-JJ` : `11/09/2026` en français, `11 Sep 2026` en anglais. */
  date(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const [, y, m, d] = match as unknown as [string, string, string, string];
    if (this.locale === 'fr') return `${d}/${m}/${y}`;
    return `${Number(d)} ${MONTHS_EN[Number(m) - 1] ?? m} ${y}`;
  }

  /** IBAN par groupes de quatre, comme sur un RIB. */
  iban(value: string): string {
    return value
      .replace(/\s+/g, '')
      .replace(/(.{4})(?=.)/g, `$1${this.separators.group}`)
      .trim();
  }

  /** SIREN `443 061 841`, SIRET `443 061 841 00004` ; autre chose inchangé. */
  registration(value: string): string {
    const s = this.separators.group;
    if (/^\d{9}$/.test(value))
      return `${value.slice(0, 3)}${s}${value.slice(3, 6)}${s}${value.slice(6)}`;
    if (/^\d{14}$/.test(value)) {
      return `${value.slice(0, 3)}${s}${value.slice(3, 6)}${s}${value.slice(6, 9)}${s}${value.slice(9)}`;
    }
    return value;
  }

  /** « Libellé : valeur », avec l'espace insécable française avant les deux-points. */
  pair(label: string, value: string): string {
    return this.locale === 'fr'
      ? `${label}${this.separators.group}: ${value}`
      : `${label}: ${value}`;
  }
}
