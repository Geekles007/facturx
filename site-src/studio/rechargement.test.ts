/**
 * Un fragment du Studio qui ne se charge pas : un nouvel `import()` de la même adresse échouerait
 * aussitôt (le navigateur garde l'échec), seul un rechargement de la page le refait. Ici, le fragment
 * de l'émission en mode compte.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Assets } from './pipeline.js';

// Le module de l'émission ne se charge pas (réseau coupé au moment de l'`import()`).
vi.mock('./compte/emission.js', () => {
  throw new Error('chargement impossible');
});

// L'enregistrement qui précède un rechargement de la page : on en tient l'issue.
const enregistrer = vi.fn(async () => true);
vi.mock('./store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.js')>()),
  enregistrerMaintenant: () => enregistrer(),
}));

const { issueInvoice } = await import('./workflows.js');
const { store, ui } = await import('./store.js');
const { t } = await import('./i18n.js');

const uiAvant = store.get().ui;

afterEach(() => {
  store.set({ ui: uiAvant });
  enregistrer.mockClear();
  vi.unstubAllGlobals();
});

describe('le module de l’émission ne se charge pas', () => {
  test('rien n’est émis, et le message propose de recharger la page, saisie enregistrée d’abord', async () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    });
    const avant = store.get();
    expect(await issueInvoice({} as Assets, { record: true })).toBe(false);
    // Rien d'émis : ni historique, ni numérotation, ni facture affichée.
    expect(store.get().history).toBe(avant.history);
    expect(store.get().numbering).toBe(avant.numbering);
    expect(store.get().ui.issued).toBeUndefined();

    const message = store.get().ui.toast;
    expect(message?.kind).toBe('error');
    expect(message?.text).toBe(t.compte.emission.chargement);
    // Le message nomme l'émission et propose le rechargement, seul remède.
    expect(t.compte.emission.chargement).toMatch(/émission/);
    expect(t.compte.emission.chargement).toMatch(/rechargez la page/);
    expect(message?.action?.label).toBe(t.compte.conservation.rechargerPage);

    // Un second essai échoue de même, sans rien émettre : le même message, la même issue.
    ui({ toast: undefined });
    expect(await issueInvoice({} as Assets, { record: true })).toBe(false);
    expect(store.get().ui.toast?.action?.label).toBe(t.compte.conservation.rechargerPage);

    // Recharger : la saisie part d'abord, puis la page se recharge.
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    let enregistree: (fait: boolean) => void = () => undefined;
    enregistrer.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          enregistree = r;
        }),
    );
    const rechargement = store.get().ui.toast?.action?.run();
    await vi.waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();
    enregistree(true);
    await rechargement;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('chaque fragment a son message, qui le nomme', () => {
    // Le module des brouillons ne se fait plus passer pour celui de la connexion.
    expect(t.compte.brouillons.moduleNonCharge).not.toBe(t.compte.errors.loadFailed);
    expect(t.compte.brouillons.moduleNonCharge).toMatch(/brouillons/);
    expect(t.compte.emission.chargement).not.toBe(t.compte.errors.loadFailed);
  });
});
