import { describe, expect, test } from 'vitest';
import { ajouterJours, periode } from './periode.js';

/** La période du tableau de bord et le décompte des jours : des calculs de dates, sans fuseau. */

describe('la période du tableau de bord', () => {
  test('le mois du jour, du premier au dernier jour, années bissextiles comprises', () => {
    expect(periode('mois', '2026-02-14')).toEqual({ debut: '2026-02-01', fin: '2026-02-28' });
    expect(periode('mois', '2028-02-10').fin).toBe('2028-02-29');
    expect(periode('mois', '2026-12-31')).toEqual({ debut: '2026-12-01', fin: '2026-12-31' });
    expect(periode('mois', '2026-04-01')).toEqual({ debut: '2026-04-01', fin: '2026-04-30' });
    // Divisible par 100 sans l'être par 400 : pas bissextile ; par 400 : bissextile.
    expect(periode('mois', '2100-02-01').fin).toBe('2100-02-28');
    expect(periode('mois', '2000-02-29').fin).toBe('2000-02-29');
  });

  test('l’année du jour, du 1er janvier au 31 décembre', () => {
    expect(periode('annee', '2026-11-04')).toEqual({ debut: '2026-01-01', fin: '2026-12-31' });
    expect(periode('annee', '2027-01-01')).toEqual({ debut: '2027-01-01', fin: '2027-12-31' });
  });

  test('une date illisible ou impossible est refusée', () => {
    for (const date of ['', '14/02/2026', '2026-2-14', '2026-13-01', '2026-02-30', '2026-00-10']) {
      expect(() => periode('mois', date), date).toThrow(RangeError);
    }
  });
});

describe('ajouter des jours à une date', () => {
  test('d’un mois et d’une année à l’autre, et au changement d’heure', () => {
    expect(ajouterJours('2026-11-25', 15)).toBe('2026-12-10');
    expect(ajouterJours('2026-12-20', 15)).toBe('2027-01-04');
    expect(ajouterJours('2028-02-20', 15)).toBe('2028-03-06');
    // Le passage à l'heure d'été à Paris (29 mars 2026) n'y change rien : des jours, pas des heures.
    expect(ajouterJours('2026-03-28', 1)).toBe('2026-03-29');
    expect(ajouterJours('2026-03-29', 1)).toBe('2026-03-30');
    expect(ajouterJours('2026-11-07', 0)).toBe('2026-11-07');
    expect(ajouterJours('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('une date illisible est refusée', () => {
    expect(() => ajouterJours('2026-02-30', 1)).toThrow(RangeError);
  });
});
