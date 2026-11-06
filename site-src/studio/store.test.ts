import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from './i18n.js';
import { defaultCompany } from './library.js';
import { blankForm } from './model.js';
import { type CodeConservation, ErreurConservation, type Persistence } from './persistence.js';
import { indexedDbPersistence, utiliser } from './storage.js';
import {
  type CompteUi,
  enregistrerMaintenant,
  type Loaded,
  setForm,
  startPersistence,
  store,
  ui,
} from './store.js';

const COMPTE: CompteUi = {
  email: 'a@exemple.test',
  confirme: true,
  entrepriseId: 'e-1',
  suppressionDemandeeLe: undefined,
  session: 'active',
};

/**
 * Une conservation qui note chaque écriture et répond ce que `refus` dit à ce moment : rien
 * (l'écriture passe), ou le code d'une `ErreurConservation`.
 */
function fausseConservation() {
  const ecrites: { cle: string; valeur: unknown }[] = [];
  const etat: { refus: CodeConservation | Error | undefined; detail?: string } = {
    refus: undefined,
  };
  const p: Persistence = {
    available: async () => true,
    get: async () => undefined,
    async set(cle, valeur) {
      ecrites.push({ cle, valeur });
      if (etat.refus instanceof Error) throw etat.refus;
      if (etat.refus) throw new ErreurConservation(etat.refus, etat.detail);
      return cle;
    },
    list: async () => [],
    put: async (_, valeur) => valeur.uid,
    remove: async () => undefined,
    getFile: async () => undefined,
    setFile: async (cle) => cle,
    dump: async () => ({}),
  };
  return { p, ecrites, etat };
}

/** La fenêtre : ses évènements (`online`, `pagehide`) sont ceux d'un `EventTarget` à nous. */
let fenetre: EventTarget;
let arreter: (() => void) | undefined;

/**
 * Le Studio démarré sur `p` : connecté (`COMPTE`), sauf `sansCompte`, et enregistrant sans délai,
 * sauf `options` donné (`{}` : le délai par défaut).
 */
function demarrer(
  p: Persistence,
  reglages: { options?: { delai?: number }; sansCompte?: boolean } = {},
) {
  const compte = reglages.sansCompte ? undefined : COMPTE;
  utiliser(p);
  store.set((s) => ({
    form: blankForm('2026-11-04'),
    company: defaultCompany(),
    ui: {
      ...s.ui,
      storage: 'ok',
      compte,
      conflit: false,
      reseau: 'ok',
      connexion: undefined,
      toast: undefined,
      issued: undefined,
      sample: false,
    },
  }));
  arreter = startPersistence(reglages.options ?? { delai: 0 });
}

const brouillonsEcrits = (ecrites: { cle: string; valeur: unknown }[]) =>
  ecrites
    .filter((e) => e.cle === 'draft')
    .map((e) => (e.valeur as NonNullable<Loaded['draft']>).form.buyer.name);

beforeEach(() => {
  vi.useFakeTimers();
  fenetre = new EventTarget();
  vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
  vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
});

afterEach(() => {
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startPersistence', () => {
  it('enregistre une seconde après la dernière frappe, avec le délai du mode compte', async () => {
    const { p, ecrites } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'A');
    await vi.advanceTimersByTimeAsync(600);
    setForm('buyer.name', 'AB');
    // Ce qui ne touche pas au document (survol de l'aperçu) ne repousse pas l'enregistrement.
    await vi.advanceTimersByTimeAsync(500);
    ui({ hover: 'buyer.name' });
    await vi.advanceTimersByTimeAsync(499);
    expect(ecrites).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(brouillonsEcrits(ecrites)).toEqual(['AB']);
  });

  it('sans délai donné, enregistre au bout de 400 ms, comme avant', async () => {
    const { p, ecrites } = fausseConservation();
    demarrer(p, { options: {}, sansCompte: true });
    setForm('buyer.name', 'A');
    await vi.advanceTimersByTimeAsync(399);
    expect(ecrites).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(brouillonsEcrits(ecrites)).toEqual(['A']);
  });

  it('enregistrerMaintenant écrit ce qui attend le délai, sans l’attendre', async () => {
    const { p, ecrites } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'A');
    await enregistrerMaintenant();
    expect(brouillonsEcrits(ecrites)).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ecrites).toHaveLength(1);
  });

  it('ouvrir une facture émise : la saisie en attente part d’abord', async () => {
    const { p, ecrites } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'Saisie en cours');
    store.set((s) => ({
      form: { ...blankForm('2026-11-04'), id: 'F-2026-0007' },
      ui: { ...s.ui, issued: 'facture-7' },
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(brouillonsEcrits(ecrites)).toEqual(['Saisie en cours']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ecrites.at(-1)?.valeur).toMatchObject({ issued: 'facture-7' });
  });

  it('sans compte, une écriture refusée fait passer en mémoire, comme avant', async () => {
    const { p, etat } = fausseConservation();
    etat.refus = new Error('quota');
    demarrer(p, { sansCompte: true });
    setForm('buyer.name', 'A');
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('memory'));
  });
});

describe('startPersistence en mode compte', () => {
  it('conflit : ui.conflit, rien n’est rechargé ni rejoué', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'BROUILLON_MODIFIE';
    demarrer(p);
    setForm('buyer.name', 'Ma saisie');
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true));
    expect(store.get().form.buyer.name).toBe('Ma saisie');
    fenetre.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ecrites).toHaveLength(1);
    expect(store.get().ui.storage).toBe('ok');
  });

  it('hors ligne : au retour du réseau, seule la dernière écriture de chaque clé part', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'RESEAU';
    demarrer(p);
    setForm('buyer.name', 'A');
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('hors-ligne'));
    setForm('buyer.name', 'AB');
    store.set((s) => ({
      company: { ...s.company, defaults: { ...s.company.defaults, vat: 'S:10' } },
    }));
    await vi.advanceTimersByTimeAsync(0);
    setForm('buyer.name', 'ABC');
    await vi.advanceTimersByTimeAsync(0);
    expect(brouillonsEcrits(ecrites)).toEqual(['A', 'AB', 'ABC']);

    etat.refus = undefined;
    ecrites.length = 0;
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('ok'));
    expect(ecrites.map((e) => e.cle).sort()).toEqual(['company', 'draft']);
    expect(brouillonsEcrits(ecrites)).toEqual(['ABC']);

    // Tout est parti : un second retour du réseau n'envoie rien.
    fenetre.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ecrites).toHaveLength(2);
  });

  it('un refus du serveur : un message, et aucun nouvel essai', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'REFUS';
    etat.detail = 'NUMEROTATION_RECUL';
    demarrer(p);
    store.set((s) => ({ numbering: { ...s.numbering, next: 1 } }));
    await vi.waitFor(() => expect(store.get().ui.toast?.kind).toBe('error'));
    expect(store.get().ui.toast?.text).toBe(t.compte.conservation.recul);
    expect(store.get().ui.reseau).toBe('ok');
    fenetre.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ecrites).toHaveLength(1);
  });

  it('401 : la connexion ne s’ouvre qu’une fois, puis le brouillon part après la reconnexion', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'SESSION';
    demarrer(p);
    setForm('buyer.name', 'A');
    await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));
    expect(store.get().ui.connexion).toBe('connexion');

    // L'utilisateur ferme le dialogue et continue : aucune nouvelle ouverture.
    ui({ connexion: undefined });
    setForm('buyer.name', 'AB');
    await vi.advanceTimersByTimeAsync(0);
    setForm('buyer.name', 'ABC');
    await vi.advanceTimersByTimeAsync(0);
    expect(brouillonsEcrits(ecrites)).toEqual(['A', 'AB', 'ABC']);
    expect(store.get().ui.connexion).toBeUndefined();

    etat.refus = undefined;
    ecrites.length = 0;
    ui({ compte: COMPTE });
    await vi.waitFor(() => expect(brouillonsEcrits(ecrites)).toEqual(['ABC']));
    expect(ecrites).toHaveLength(1);
  });
});
