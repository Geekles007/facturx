import { describe, expect, it } from 'vitest';
import { PACKAGE, readDownloadsPoint } from './fetch-npm-downloads.mjs';

/**
 * Le chiffre relevé ici est affiché sur la page d'accueil comme une preuve : il doit venir de
 * l'API ou ne pas venir du tout. Toute réponse douteuse est donc refusée plutôt qu'interprétée.
 */
describe('relevé des téléchargements npm', () => {
  const point = { downloads: 1234, start: '2026-08-18', end: '2026-09-16', package: PACKAGE };

  it('ne garde du relevé que le nombre et sa période', () => {
    expect(readDownloadsPoint({ ...point, inattendu: 'ignoré' })).toEqual({
      package: PACKAGE,
      downloads: 1234,
      start: '2026-08-18',
      end: '2026-09-16',
    });
  });

  it('accepte un paquet encore jamais téléchargé', () => {
    expect(readDownloadsPoint({ ...point, downloads: 0 }).downloads).toBe(0);
  });

  it('refuse la réponse d’un autre paquet', () => {
    expect(() => readDownloadsPoint({ ...point, package: 'facturx' })).toThrow(/facturx-sdk/);
  });

  it('refuse un nombre absent, négatif, décimal ou textuel', () => {
    for (const downloads of [undefined, null, -1, 12.5, '1234', Number.NaN]) {
      expect(() => readDownloadsPoint({ ...point, downloads })).toThrow(/downloads/);
    }
  });

  it('refuse une période absente, mal formée ou à l’envers', () => {
    expect(() => readDownloadsPoint({ ...point, end: undefined })).toThrow(/end/);
    expect(() => readDownloadsPoint({ ...point, end: '16/09/2026' })).toThrow(/end/);
    expect(() => readDownloadsPoint({ ...point, start: '2026-9-1' })).toThrow(/start/);
    expect(() => readDownloadsPoint({ ...point, start: '2026-09-17' })).toThrow(/envers/);
  });

  it('refuse ce qui n’est pas un relevé', () => {
    // L'API répond « {"error":"package facturx-sdk not found"} » ; une page HTML d'erreur, elle,
    // ne survit même pas au JSON.parse qui précède.
    for (const payload of [null, 'texte', 42, [point], { error: 'not found' }]) {
      expect(() => readDownloadsPoint(payload)).toThrow();
    }
  });
});
