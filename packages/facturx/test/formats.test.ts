import { describe, expect, it } from 'vitest';
import {
  frenchVatKey,
  isValidBic,
  isValidFrenchVatId,
  isValidIban,
  isValidIsoDate,
  isValidSiren,
  isValidSiret,
  isValidVatId,
} from '../src/index.js';

describe('SIREN / SIRET', () => {
  it('valide la clé de Luhn', () => {
    expect(isValidSiren('443061841')).toBe(true);
    expect(isValidSiren('732829320')).toBe(true);
    expect(isValidSiren('123456789')).toBe(false);
    expect(isValidSiren('44306184')).toBe(false);
    expect(isValidSiren('44306184a')).toBe(false);
    expect(isValidSiret('44306184110004')).toBe(true);
    expect(isValidSiret('44306184110005')).toBe(false);
    expect(isValidSiret('443061841')).toBe(false);
  });

  it('applique l’exception La Poste', () => {
    expect(isValidSiret('35600000000042')).toBe(true); // somme des chiffres = 20, multiple de 5
    expect(isValidSiret('35600000000043')).toBe(false);
  });
});

describe('TVA intracommunautaire', () => {
  it('calcule et vérifie la clé FR', () => {
    expect(frenchVatKey('443061841')).toBe('64');
    expect(frenchVatKey('732829320')).toBe('44');
    expect(isValidFrenchVatId('FR64443061841')).toBe(true);
    expect(isValidFrenchVatId('FR65443061841')).toBe(false);
    expect(isValidFrenchVatId('FR64123456789')).toBe(false);
  });

  it('accepte la structure des autres pays', () => {
    expect(isValidVatId('DE123456789')).toBe(true);
    expect(isValidVatId('BE0123456789')).toBe(true);
    expect(isValidVatId('FR64443061841')).toBe(true);
    expect(isValidVatId('FR00443061841')).toBe(false);
    expect(isValidVatId('fr64443061841')).toBe(false);
    expect(isValidVatId('F')).toBe(false);
  });
});

describe('IBAN / BIC', () => {
  it('vérifie la clé mod 97', () => {
    expect(isValidIban('FR7630006000011234567890189')).toBe(true);
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('FR7630006000011234567890188')).toBe(false);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('FR76')).toBe(false);
  });

  it('valide la structure BIC', () => {
    expect(isValidBic('BNPAFRPP')).toBe(true);
    expect(isValidBic('BNPAFRPPXXX')).toBe(true);
    expect(isValidBic('BNPAFRP')).toBe(false);
    expect(isValidBic('bnpafrpp')).toBe(false);
  });
});

describe('dates ISO', () => {
  it('accepte les dates calendaires réelles', () => {
    expect(isValidIsoDate('2026-09-11')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('20260911')).toBe(false);
    expect(isValidIsoDate('2026-9-1')).toBe(false);
  });
});
