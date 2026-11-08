import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n.js';
import { indexedDbPersistence, storage, utiliser } from '../storage.js';
import { store } from '../store.js';
import {
  CGU_VERSION,
  changerAdresse,
  changerMotDePasse,
  connecter,
  deconnecter,
  demarrer,
  inscrire,
  reinitialiser,
} from './index.js';
import { estPersistenceCompte } from './persistence.js';

// Un client Supabase factice : seuls les appels que `compte/index.ts` fait existent.
const { auth, from, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const requete = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle };
  requete.select.mockReturnValue(requete);
  requete.eq.mockReturnValue(requete);
  requete.limit.mockReturnValue(requete);
  return {
    maybeSingle,
    from: vi.fn(() => requete),
    auth: {
      getSession: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  };
});
vi.mock('./client.js', () => ({ client: () => ({ auth, from }) }));

const reload = vi.fn();
const replaceState = vi.fn();
const utilisateur = {
  id: 'user-1',
  email: 'a@exemple.test',
  email_confirmed_at: '2026-11-04T10:00:00Z',
};

/** Pose `location` sur `chemin` (relatif à https://exemple.test), avec ce que le code lit. */
function poserAdresse(chemin = '/studio/'): void {
  const url = new URL(chemin, 'https://exemple.test');
  vi.stubGlobal('location', {
    origin: url.origin,
    href: url.href,
    search: url.search,
    hash: url.hash,
    reload,
  });
}

beforeEach(() => {
  poserAdresse();
  vi.stubGlobal('history', { state: null, replaceState });
  store.set((s) => ({ ui: { ...s.ui, compte: undefined, toast: undefined } }));
});

afterEach(() => {
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('demarrer', () => {
  it('ne renvoie rien sans session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await demarrer()).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(store.get().ui.compte).toBeUndefined();
    expect(storage).toBe(indexedDbPersistence);
  });

  it('relève l’entreprise du compte et renseigne ui.compte', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue({
      data: {
        entreprise_id: 'e-1',
        entreprises: { suppression_demandee_le: '2026-11-03T08:00:00Z' },
      },
      error: null,
    });
    const attendu = {
      email: 'a@exemple.test',
      confirme: true,
      entrepriseId: 'e-1',
      suppressionDemandeeLe: '2026-11-03T08:00:00Z',
      session: 'active',
    };
    expect(await demarrer()).toEqual(attendu);
    expect(store.get().ui.compte).toEqual(attendu);
    expect(from).toHaveBeenCalledWith('membres');
  });

  it('met la conservation du serveur derrière storage, à l’entreprise du compte', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue({
      data: { entreprise_id: 'e-1', entreprises: { suppression_demandee_le: null } },
      error: null,
    });
    await demarrer();
    expect(estPersistenceCompte(storage) && storage.entrepriseId).toBe('e-1');
  });

  it('sans suppression demandée, la date est absente', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { ...utilisateur, email_confirmed_at: null } } },
    });
    maybeSingle.mockResolvedValue({
      data: { entreprise_id: 'e-1', entreprises: { suppression_demandee_le: null } },
      error: null,
    });
    const compte = await demarrer();
    expect(compte?.suppressionDemandeeLe).toBeUndefined();
    expect(compte?.confirme).toBe(false);
  });

  it('ne renvoie rien quand les lignes du compte sont illisibles', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'JWT expired' } });
    expect(await demarrer()).toBeUndefined();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await demarrer()).toBeUndefined();
    expect(store.get().ui.compte).toBeUndefined();
  });

  it('ne lève jamais : un échec du client vaut « pas de compte »', async () => {
    auth.getSession.mockRejectedValue(new Error('réseau coupé'));
    await expect(demarrer()).resolves.toBeUndefined();
  });

  it('renonce au compte plutôt que de retenir le démarrage', async () => {
    vi.useFakeTimers();
    auth.getSession.mockReturnValue(new Promise(() => {}));
    const demarrage = demarrer();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(demarrage).resolves.toBeUndefined();
  });
});

describe('demarrer, au retour d’un lien reçu par e-mail', () => {
  const membre = {
    data: { entreprise_id: 'e-1', entreprises: { suppression_demandee_le: null } },
    error: null,
  };

  it('ouvre la session quand le code a pu être échangé, et retire le code de l’adresse', async () => {
    poserAdresse('/studio/?code=abc123');
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue(membre);
    expect((await demarrer())?.email).toBe('a@exemple.test');
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
    expect(store.get().ui.toast).toBeUndefined();
  });

  it('dit que l’adresse est confirmée quand le lien a été ouvert dans un autre navigateur', async () => {
    // Sans le vérificateur du navigateur d'origine, `supabase-js` n'échange rien : pas de session.
    poserAdresse('/studio/?code=abc123');
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await demarrer()).toBeUndefined();
    expect(store.get().ui.toast).toMatchObject({ kind: 'info', text: t.compte.link.noSession });
    expect(t.compte.link.noSession).toMatch(/confirmée.*connectez-vous/);
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
  });

  it('signale un lien expiré ou invalide, et en retire les paramètres', async () => {
    poserAdresse(
      '/studio/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid#error_code=otp_expired',
    );
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await demarrer()).toBeUndefined();
    expect(store.get().ui.toast).toMatchObject({ kind: 'error', text: t.compte.link.expired });
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
  });

  it('laisse le message assez longtemps pour être lu', async () => {
    vi.useFakeTimers();
    poserAdresse('/studio/?code=abc123');
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await demarrer();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(store.get().ui.toast?.text).toBe(t.compte.link.noSession);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get().ui.toast).toBeUndefined();
  });

  it('le premier des deux liens d’un changement d’adresse : ouvrir l’autre, et l’adresse nettoyée', async () => {
    // Supabase confirme une adresse sur deux, et le dit en anglais dans l'adresse de retour.
    poserAdresse(
      '/studio/?message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email#message=Confirmation+link+accepted&sb=',
    );
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue(membre);
    expect((await demarrer())?.email).toBe('a@exemple.test');
    expect(store.get().ui.toast).toMatchObject({ kind: 'info', text: t.compte.link.autreAdresse });
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://exemple.test/studio/');
  });

  it('ne dit rien d’une session déjà ouverte, ni d’une adresse ordinaire', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await demarrer();
    expect(store.get().ui.toast).toBeUndefined();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('ne conclut pas à l’absence de session quand le serveur tarde', async () => {
    vi.useFakeTimers();
    poserAdresse('/studio/?code=abc123');
    auth.getSession.mockReturnValue(new Promise(() => {}));
    const demarrage = demarrer();
    await vi.advanceTimersByTimeAsync(10_000);
    await demarrage;
    expect(store.get().ui.toast).toBeUndefined();
  });
});

describe('inscrire', () => {
  it('transmet l’acceptation des CGU, sans quoi la base refuse le compte', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await inscrire('a@exemple.test', 'secret', CGU_VERSION)).toBe('confirmation');
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@exemple.test',
      password: 'secret',
      options: { data: { cgu: '2026-11' }, emailRedirectTo: 'https://exemple.test/studio/' },
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('recharge la page quand la session s’ouvre sans confirmation', async () => {
    auth.signUp.mockResolvedValue({ data: { session: { user: utilisateur } }, error: null });
    expect(await inscrire('a@exemple.test', 'secret', CGU_VERSION)).toBe('connecte');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('traduit un mot de passe trop faible', async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Password should be at least 6 characters', 422, 'weak_password'),
    });
    await expect(inscrire('a@exemple.test', '1', CGU_VERSION)).rejects.toThrow(
      t.compte.errors.weak,
    );
  });
});

describe('connecter', () => {
  it('recharge la page une fois connecté', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await connecter('a@exemple.test', 'secret');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@exemple.test',
      password: 'secret',
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  /** Le Studio connecté dont la session a expiré, dialogue de connexion ouvert. */
  const sessionExpiree = () =>
    store.set((s) => ({
      ui: {
        ...s.ui,
        connexion: 'connexion',
        compte: {
          email: 'a@exemple.test',
          confirme: true,
          entrepriseId: 'e-1',
          suppressionDemandeeLe: undefined,
          session: 'expiree',
        },
      },
    }));

  it('après une session expirée, au même compte : la session reprend, sans recharger', async () => {
    sessionExpiree();
    auth.signInWithPassword.mockResolvedValue({ data: { user: utilisateur }, error: null });
    maybeSingle.mockResolvedValue({ data: { entreprise_id: 'e-1' }, error: null });
    await connecter('a@exemple.test', 'secret');
    expect(reload).not.toHaveBeenCalled();
    expect(store.get().ui.compte?.session).toBe('active');
    expect(store.get().ui.connexion).toBeUndefined();
    expect(from).toHaveBeenCalledWith('membres');
  });

  it('après une session expirée, avec un autre compte : recharge', async () => {
    sessionExpiree();
    auth.signInWithPassword.mockResolvedValue({
      data: { user: { ...utilisateur, id: 'user-2' } },
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await connecter('b@exemple.test', 'secret');
    expect(reload).toHaveBeenCalledOnce();
    expect(store.get().ui.compte?.session).toBe('expiree');
  });

  it('dit « identifiants incorrects » sans citer le texte du serveur', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    await expect(connecter('a@exemple.test', 'faux')).rejects.toThrow(t.compte.errors.credentials);
    expect(reload).not.toHaveBeenCalled();
  });

  it('distingue un serveur injoignable d’un refus', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(connecter('a@exemple.test', 'secret')).rejects.toThrow(t.compte.errors.network);
  });

  it('ramène tout code inconnu à une phrase générale', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthApiError('boom', 500, 'unexpected_failure'),
    });
    await expect(connecter('a@exemple.test', 'secret')).rejects.toThrow(t.compte.errors.other);
  });
});

describe('reinitialiser', () => {
  it('ramène sur le Studio de la langue de la page', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await reinitialiser('a@exemple.test');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@exemple.test', {
      redirectTo: 'https://exemple.test/studio/',
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('après un lien de réinitialisation', () => {
  it('l’évènement PASSWORD_RECOVERY ouvre le formulaire du nouveau mot de passe', async () => {
    store.set((s) => ({ ui: { ...s.ui, recuperation: false } }));
    auth.getSession.mockResolvedValue({ data: { session: { user: utilisateur } } });
    maybeSingle.mockResolvedValue({
      data: { entreprise_id: 'e-1', entreprises: { suppression_demandee_le: null } },
      error: null,
    });
    await demarrer();
    // L'écoute est posée avant que `supabase-js` n'échange le code du lien.
    expect(auth.onAuthStateChange).toHaveBeenCalledBefore(auth.getSession);
    const ecoute = auth.onAuthStateChange.mock.calls[0]?.[0] as (evenement: string) => void;
    ecoute('SIGNED_IN');
    expect(store.get().ui.recuperation).toBe(false);
    ecoute('PASSWORD_RECOVERY');
    expect(store.get().ui.recuperation).toBe(true);
  });
});

describe('changer d’adresse et de mot de passe', () => {
  beforeEach(() => {
    store.set((s) => ({
      ui: {
        ...s.ui,
        compte: {
          email: 'a@exemple.test',
          confirme: true,
          entrepriseId: 'e-1',
          suppressionDemandeeLe: undefined,
          session: 'active',
        },
      },
    }));
  });

  it('la nouvelle adresse attend sa confirmation : le lien ramène au Studio, rien ne change avant', async () => {
    auth.updateUser.mockResolvedValue({ data: { user: utilisateur }, error: null });
    await changerAdresse('  b@exemple.test ');
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'b@exemple.test' },
      { emailRedirectTo: 'https://exemple.test/studio/' },
    );
    expect(store.get().ui.compte?.email).toBe('a@exemple.test');
  });

  it('la même adresse, ou une adresse déjà prise, est refusée et dite', async () => {
    await expect(changerAdresse('A@exemple.test')).rejects.toThrow(t.compte.motDePasse.memeAdresse);
    expect(auth.updateUser).not.toHaveBeenCalled();
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        'A user with this email address has already been registered',
        422,
        'email_exists',
      ),
    });
    await expect(changerAdresse('b@exemple.test')).rejects.toThrow(t.compte.errors.exists);
  });

  it('le mot de passe change ; un mot de passe identique ou trop faible est dit', async () => {
    auth.updateUser.mockResolvedValue({ data: { user: utilisateur }, error: null });
    await changerMotDePasse('un-nouveau-secret');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'un-nouveau-secret' });
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('New password should be different', 422, 'same_password'),
    });
    await expect(changerMotDePasse('le-meme')).rejects.toThrow(t.compte.errors.samePassword);
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Password should be at least 6 characters', 422, 'weak_password'),
    });
    await expect(changerMotDePasse('1')).rejects.toThrow(t.compte.errors.weak);
    // `secure_password_change` (si la production l'active) : une connexion récente est demandée.
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        'Password update requires reauthentication',
        400,
        'reauthentication_needed',
      ),
    });
    await expect(changerMotDePasse('un-autre-secret')).rejects.toThrow(t.compte.errors.reauth);
  });
});

describe('deconnecter', () => {
  /** Un `localStorage` en mémoire, avec la session que `supabase-js` y aurait laissée. */
  function poserStockage(): Map<string, string> {
    const contenu = new Map([
      ['draft', '{}'],
      ['sb-127-auth-token', '{"access_token":"x"}'],
    ]);
    vi.stubGlobal('localStorage', {
      get length() {
        return contenu.size;
      },
      key: (i: number) => [...contenu.keys()][i] ?? null,
      removeItem: (cle: string) => contenu.delete(cle),
    });
    return contenu;
  }

  it('ne ferme que la session de ce navigateur, puis recharge', async () => {
    poserStockage();
    auth.signOut.mockResolvedValue({ error: null });
    await deconnecter();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('recharge aussi quand le serveur refuse ou ne répond pas : on sort de l’état connecté', async () => {
    const contenu = poserStockage();
    auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    await expect(deconnecter()).resolves.toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
    // Même si le client n'avait pas retiré la session, elle ne survit pas au rechargement.
    expect([...contenu.keys()]).toEqual(['draft']);
  });

  it('recharge encore quand le client lève une exception', async () => {
    const contenu = poserStockage();
    auth.signOut.mockRejectedValue(new Error('verrou indisponible'));
    await expect(deconnecter()).resolves.toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
    expect([...contenu.keys()]).toEqual(['draft']);
  });
});
