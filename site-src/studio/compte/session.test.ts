import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compteActif,
  effacerRetourDeLien,
  oublierSession,
  retourDeLien,
  sessionProbable,
} from './session.js';

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

/** Un `location` posé sur `adresse`, avec les trois propriétés que le code lit. */
function poserAdresse(adresse: string): void {
  const url = new URL(adresse);
  vi.stubGlobal('location', { href: url.href, search: url.search, hash: url.hash });
}

describe('retourDeLien', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconnaît le code que Supabase ajoute au retour d’un lien reçu par e-mail (flux PKCE)', () => {
    poserAdresse('https://exemple.test/studio/?code=abc123');
    expect(retourDeLien()).toBe('code');
    poserAdresse('https://exemple.test/en/studio/?utm=x&code=abc123#contenu');
    expect(retourDeLien()).toBe('code');
  });

  it('reconnaît une erreur de lien, dans la requête comme dans le fragment', () => {
    poserAdresse(
      'https://exemple.test/studio/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(retourDeLien()).toBe('erreur');
    poserAdresse(
      'https://exemple.test/studio/?error=access_denied&error_code=otp_expired&error_description=expired',
    );
    expect(retourDeLien()).toBe('erreur');
  });

  it('donne le pas à l’erreur quand le code l’accompagne', () => {
    poserAdresse('https://exemple.test/studio/?code=abc&error_code=otp_expired');
    expect(retourDeLien()).toBe('erreur');
  });

  it('reconnaît le premier des deux liens d’un changement d’adresse, tel que Supabase le rend', () => {
    poserAdresse(
      'https://exemple.test/studio/?message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email&sb=',
    );
    expect(retourDeLien()).toBe('message');
  });

  it('un autre `message` dans l’adresse n’en est pas un : supabase-js ne se charge pas pour lui', () => {
    poserAdresse('https://exemple.test/studio/?message=x');
    expect(retourDeLien()).toBeUndefined();
    poserAdresse('https://exemple.test/studio/#message=bonjour');
    expect(retourDeLien()).toBeUndefined();
    // Le texte de Supabase dans la requête seule, sans son fragment : pas un retour de lien non plus.
    poserAdresse('https://exemple.test/studio/?message=Confirmation+link+accepted');
    expect(retourDeLien()).toBeUndefined();
  });

  it('ignore le fragment du flux implicite : un lien fabriqué n’ouvre aucune session', () => {
    poserAdresse(
      'https://exemple.test/studio/#access_token=celui-de-l-attaquant&refresh_token=r&type=signup',
    );
    expect(retourDeLien()).toBeUndefined();
  });

  it('ne prend pas une adresse ordinaire pour un retour de lien', () => {
    poserAdresse('https://exemple.test/studio/');
    expect(retourDeLien()).toBeUndefined();
    poserAdresse('https://exemple.test/studio/?lang=en&barcode=1#contenu');
    expect(retourDeLien()).toBeUndefined();
  });

  it('est vide, sans lever, hors d’un navigateur', () => {
    vi.stubGlobal('location', undefined);
    expect(retourDeLien()).toBeUndefined();
  });
});

describe('effacerRetourDeLien', () => {
  const replaceState = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    replaceState.mockClear();
  });

  it('retire le code de l’adresse, sans toucher au reste ni recharger la page', () => {
    poserAdresse('https://exemple.test/studio/?code=abc123&lang=en#contenu');
    vi.stubGlobal('history', { state: { n: 1 }, replaceState });
    effacerRetourDeLien();
    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      { n: 1 },
      '',
      'https://exemple.test/studio/?lang=en#contenu',
    );
  });

  it('retire les paramètres d’erreur, y compris ceux du fragment', () => {
    poserAdresse(
      'https://exemple.test/studio/?error_code=otp_expired&error_description=x#error=access_denied&error_code=otp_expired',
    );
    vi.stubGlobal('history', { state: null, replaceState });
    effacerRetourDeLien();
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
  });

  it('retire le message d’un changement d’adresse, et son fragment', () => {
    poserAdresse(
      'https://exemple.test/studio/?message=Confirmation+link+accepted#message=Confirmation+link+accepted&sb=',
    );
    vi.stubGlobal('history', { state: null, replaceState });
    effacerRetourDeLien();
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
  });

  it('ne lève pas hors d’un navigateur', () => {
    vi.stubGlobal('location', undefined);
    expect(() => effacerRetourDeLien()).not.toThrow();
  });
});

describe('oublierSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retire la session de supabase-js et rien d’autre', () => {
    const contenu = new Map([
      ['draft', '{}'],
      ['sb-abc-auth-token', '{}'],
      ['sb-abc-code-verifier', 'v'],
      ['sb-def-auth-token', '{}'],
    ]);
    vi.stubGlobal('localStorage', {
      get length() {
        return contenu.size;
      },
      key: (i: number) => [...contenu.keys()][i] ?? null,
      removeItem: (cle: string) => contenu.delete(cle),
    });
    oublierSession();
    expect([...contenu.keys()]).toEqual(['draft', 'sb-abc-code-verifier']);
  });

  it('ne lève pas quand le stockage refuse l’accès', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('accès refusé');
      },
    });
    expect(() => oublierSession()).not.toThrow();
  });
});

describe('compteActif', () => {
  it('est faux quand le site est construit sans projet Supabase', () => {
    expect(compteActif()).toBe(false);
  });
});
