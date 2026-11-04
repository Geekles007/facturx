import { afterEach, describe, expect, it, vi } from 'vitest';
import { compteActif, retourDeLien, sessionProbable } from './session.js';

/** Un `localStorage` réduit à ce que `sessionProbable` lit : `length` et `key(i)`. */
function faireStockage(...cles: string[]): Storage {
  return {
    get length() {
      return cles.length;
    },
    key: (i: number) => cles[i] ?? null,
  } as Storage;
}

describe('sessionProbable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('est faux sans localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(sessionProbable()).toBe(false);
  });

  it('est faux avec une autre clé', () => {
    vi.stubGlobal('localStorage', faireStockage('draft', 'sb-abc-code-verifier', 'auth-token'));
    expect(sessionProbable()).toBe(false);
  });

  it('est vrai avec la clé de session de supabase-js', () => {
    vi.stubGlobal('localStorage', faireStockage('autre', 'sb-abc-auth-token'));
    expect(sessionProbable()).toBe(true);
  });

  it('est faux, sans lever, quand l’accès au stockage lève une exception', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('accès refusé', 'SecurityError');
      },
    });
    expect(() => sessionProbable()).not.toThrow();
    expect(sessionProbable()).toBe(false);
  });

  it('est faux, sans lever, quand la lecture des clés lève une exception', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('lecture impossible');
      },
      key: () => null,
    });
    expect(sessionProbable()).toBe(false);
  });
});

describe('retourDeLien', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconnaît le fragment qu’ajoute Supabase au retour d’un lien reçu par e-mail', () => {
    vi.stubGlobal('location', { hash: '#access_token=abc&refresh_token=def&type=signup' });
    expect(retourDeLien()).toBe(true);
  });

  it('est faux pour une adresse ordinaire', () => {
    vi.stubGlobal('location', { hash: '#contenu' });
    expect(retourDeLien()).toBe(false);
    vi.stubGlobal('location', { hash: '' });
    expect(retourDeLien()).toBe(false);
  });

  it('est faux, sans lever, hors d’un navigateur', () => {
    vi.stubGlobal('location', undefined);
    expect(retourDeLien()).toBe(false);
  });
});

describe('compteActif', () => {
  it('est faux quand le site est construit sans projet Supabase', () => {
    expect(compteActif()).toBe(false);
  });
});
