import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from './i18n.js';
import { defaultCompany } from './library.js';
import { blankForm } from './model.js';
import {
  type CodeConservation,
  type ConservationDuCompte,
  ErreurConservation,
  type Persistence,
} from './persistence.js';
import { indexedDbPersistence, utiliser } from './storage.js';
import {
  type CompteUi,
  conserver,
  enregistrerMaintenant,
  type Loaded,
  setForm,
  startPersistence,
  store,
  ui,
} from './store.js';
import { startDraft } from './workflows.js';

const COMPTE: CompteUi = {
  email: 'a@exemple.test',
  confirme: true,
  entrepriseId: 'e-1',
  suppressionDemandeeLe: undefined,
  session: 'active',
};

/**
 * Une conservation qui note chaque écriture et répond ce que `refus` dit à ce moment : rien
 * (l'écriture passe), ou le code d'une `ErreurConservation`. Elle tient aussi, comme celle du
 * compte, un miroir (`gardes`), des brouillons (`nouveaux`) et une saisie en attente au
 * démarrage (`enAttente`). Une vue (facture émise, exemple) ne va pas au serveur : elle passe
 * toujours.
 */
function fausseConservation() {
  const ecrites: { cle: string; valeur: unknown }[] = [];
  const gardes: unknown[] = [];
  const etat: {
    refus: CodeConservation | Error | undefined;
    detail?: string;
    nouveaux: number;
    enAttente?: unknown;
  } = { refus: undefined, nouveaux: 0 };
  const echoue = (): void => {
    if (etat.refus instanceof Error) throw etat.refus;
    if (etat.refus) throw new ErreurConservation(etat.refus, etat.detail);
  };
  const p: Persistence & ConservationDuCompte = {
    available: async () => true,
    get: async () => undefined,
    async set(cle, valeur) {
      ecrites.push({ cle, valeur });
      const vue = (valeur as { issued?: string; sample?: boolean }).issued !== undefined;
      if (!vue) echoue();
      return cle;
    },
    list: async () => [],
    async put(store, valeur) {
      ecrites.push({ cle: `${store}:${valeur.uid}`, valeur });
      echoue();
      return valeur.uid;
    },
    remove: async () => undefined,
    getFile: async () => undefined,
    async setFile(cle, octets) {
      ecrites.push({ cle: `files:${cle}`, valeur: octets });
      echoue();
      return cle;
    },
    dump: async () => ({}),
    async garderBrouillon(valeur) {
      gardes.push(valeur);
    },
    async nouveauBrouillon() {
      echoue();
      etat.nouveaux++;
    },
    saisieEnAttente: () => etat.enAttente,
    brouillonLocal: async () => undefined,
  };
  return { p, ecrites, gardes, etat };
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

describe('changer de document sans rien perdre (mode compte)', () => {
  it('un retour du réseau pendant une session expirée ne bloque pas le rejeu suivant', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'SESSION';
    demarrer(p);
    setForm('buyer.name', 'Tapé hors session');
    await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));
    // `online` alors que la session manque encore : la passe s'arrête aussitôt.
    fenetre.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    etat.refus = undefined;
    ecrites.length = 0;
    ui({ compte: COMPTE });
    await vi.waitFor(() => expect(brouillonsEcrits(ecrites)).toEqual(['Tapé hors session']));
  });

  it('le miroir est écrit 400 ms après la frappe, le serveur au bout du délai', async () => {
    const { p, ecrites, gardes } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'A');
    await vi.advanceTimersByTimeAsync(399);
    expect(gardes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(gardes).toMatchObject([{ form: { buyer: { name: 'A' } } }]);
    expect(ecrites).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(brouillonsEcrits(ecrites)).toEqual(['A']);
  });

  it('hors ligne, ouvrir une facture émise ne fait oublier ni la saisie ni le réseau', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'RESEAU';
    demarrer(p);
    setForm('buyer.name', 'Saisie hors ligne');
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('hors-ligne'));
    // La facture émise s'affiche : son écriture, locale, passe.
    store.set((s) => ({ form: blankForm('2026-11-04'), ui: { ...s.ui, issued: 'facture-7' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ecrites.at(-1)?.valeur).toMatchObject({ issued: 'facture-7' });
    expect(store.get().ui.reseau).toBe('hors-ligne');
    expect(await enregistrerMaintenant()).toBe(false);

    etat.refus = undefined;
    ecrites.length = 0;
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('ok'));
    expect(brouillonsEcrits(ecrites)).toEqual(['Saisie hors ligne']);
  });

  it('enregistrerMaintenant dit si le brouillon est enregistré', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'A');
    expect(await enregistrerMaintenant()).toBe(true);
    etat.refus = 'SESSION';
    setForm('buyer.name', 'AB');
    expect(await enregistrerMaintenant()).toBe(false);
    etat.refus = 'BROUILLON_MODIFIE';
    ui({ compte: COMPTE });
    setForm('buyer.name', 'ABC');
    expect(await enregistrerMaintenant()).toBe(false);
  });

  it('un conflit réglé hors du magasin (« garder la mienne ») ne bloque plus le changement', async () => {
    const { p, etat } = fausseConservation();
    etat.refus = 'BROUILLON_MODIFIE';
    demarrer(p);
    setForm('buyer.name', 'Ma version');
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true));
    // La conservation a imposé la version : le serveur l'a, l'écriture suivante passe.
    etat.refus = undefined;
    ui({ conflit: false });
    expect(await enregistrerMaintenant()).toBe(true);
  });

  it('au démarrage, une saisie que le serveur n’a pas reçue repart, et son échec se voit', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.enAttente = { form: { ...blankForm('2026-11-04'), id: 'F-1' }, appearance: {} };
    etat.refus = 'SESSION';
    demarrer(p);
    await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));
    expect(ecrites[0]?.valeur).toBe(etat.enAttente);

    etat.refus = undefined;
    ui({ compte: COMPTE });
    await vi.waitFor(() => expect(ecrites).toHaveLength(2));
    expect(ecrites[1]?.valeur).toBe(etat.enAttente);
  });

  it('serveur injoignable au démarrage : le miroir suit la frappe, rien ne part', async () => {
    const { p, ecrites, gardes } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    ui({ storage: 'injoignable' });
    setForm('buyer.name', 'Saisie gardée');
    await vi.advanceTimersByTimeAsync(2000);
    expect(gardes).toMatchObject([{ form: { buyer: { name: 'Saisie gardée' } } }]);
    expect(ecrites).toEqual([]);
    expect(await enregistrerMaintenant()).toBe(false);
  });
});

describe('startDraft en mode compte', () => {
  it('la saisie part, puis un nouveau brouillon : l’ancien reste au serveur', async () => {
    const { p, ecrites, etat } = fausseConservation();
    demarrer(p, { options: { delai: 1000 } });
    setForm('buyer.name', 'Original');
    const copie = { ...blankForm('2026-11-04'), id: 'F-copie' };
    expect(await startDraft(copie)).toBe(true);
    expect(brouillonsEcrits(ecrites)).toEqual(['Original']);
    expect(etat.nouveaux).toBe(1);
    expect(store.get().form).toBe(copie);
  });

  it('hors ligne : refusé, la saisie reste à l’écran, et le Studio dit pourquoi', async () => {
    const { p, etat } = fausseConservation();
    etat.refus = 'RESEAU';
    demarrer(p);
    setForm('buyer.name', 'Saisie hors ligne');
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('hors-ligne'));
    expect(await startDraft({ ...blankForm('2026-11-04'), id: 'F-copie' })).toBe(false);
    expect(store.get().form.buyer.name).toBe('Saisie hors ligne');
    expect(etat.nouveaux).toBe(0);
    expect(store.get().ui.toast?.text).toBe(t.compte.conservation.enAttente.reseau);
  });

  it('sans compte, remplace aussitôt, sans rien attendre', () => {
    const { p } = fausseConservation();
    demarrer(p, { sansCompte: true });
    const neuve = { ...blankForm('2026-11-04'), id: 'F-neuve' };
    void startDraft(neuve);
    expect(store.get().form).toBe(neuve);
  });
});

describe('conserver : les écritures des panneaux', () => {
  it('hors ligne : signalées, et la dernière de chaque clé repart au retour du réseau', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'RESEAU';
    demarrer(p);
    const client = (nom: string) => ({ uid: 'c-1', nom });
    expect(await conserver('clients:c-1', () => p.put('clients', client('Avant')))).toBe(false);
    expect(store.get().ui.reseau).toBe('hors-ligne');
    await conserver('clients:c-1', () => p.put('clients', client('Après')));
    await conserver('products:p-1', () => p.put('products', { uid: 'p-1' }));

    etat.refus = undefined;
    ecrites.length = 0;
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.reseau).toBe('ok'));
    expect(ecrites.map((e) => [e.cle, (e.valeur as { nom?: string }).nom])).toEqual([
      ['clients:c-1', 'Après'],
      ['products:p-1', undefined],
    ]);
  });

  it('un fichier refusé : le message le dit, et rien ne repart', async () => {
    const { p, ecrites, etat } = fausseConservation();
    etat.refus = 'FICHIER';
    demarrer(p);
    const ok = await conserver('files:font-1', () => p.setFile('font-1', Uint8Array.of(1)));
    expect(ok).toBe(false);
    expect(store.get().ui.toast?.text).toBe(t.compte.conservation.fichier);
    fenetre.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ecrites).toHaveLength(1);
  });

  it('sans compte, un échec passe sous silence, comme avant', async () => {
    const { p, etat } = fausseConservation();
    etat.refus = new Error('quota');
    demarrer(p, { sansCompte: true });
    expect(await conserver('clients:c-1', () => p.put('clients', { uid: 'c-1' }))).toBe(false);
    expect(store.get().ui.storage).toBe('ok');
    expect(store.get().ui.toast).toBeUndefined();
  });
});
