// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import {
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  fill,
  hydrateForm,
  type SavedInvoice,
} from '../library.js';
import { blankForm, blankParty } from '../model.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import {
  brouillonAffiche,
  type Loaded,
  loadPersisted,
  setForm,
  startPersistence,
  store,
} from '../store.js';
import { duplicateForm, openIssued, quitterLeBrouillon, startDraft } from '../workflows.js';
import {
  abandonnerSaisie,
  garderMaVersion,
  ouvrirLeBrouillonEnConflit,
  rechargerBrouillon,
  recreerBrouillon,
} from './brouillons.js';
import { direSaisieMiseDeCote } from './index.js';
import { type Miroir, supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest, perimerJeton } from './test-aide.js';

/**
 * Le Studio connecté rechargé, rouvert, ou démarré sans serveur : changer de document sans rien
 * taper, reprendre sans rien écraser, abandonner sans piège. Contre la pile locale.
 */

type Brouillon = NonNullable<Loaded['draft']>;

function brouillon(client: string): Brouillon {
  const form = blankForm('2026-11-04');
  form.buyer = { ...blankParty(), name: client };
  return { form, appearance: { ...defaultAppearance() } };
}

async function lignes(entrepriseId: string) {
  const { data, error } = await adminDeTest()
    .from('brouillons')
    .select('id, form, version')
    .eq('entreprise_id', entrepriseId);
  if (error) throw error;
  return data as { id: string; form: { buyer: { name: string } }; version: number }[];
}

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;
let fenetre: EventTarget;
let arreter: (() => void) | undefined;

/** La fenêtre : ses évènements (`online`, `pagehide`) sont ceux d'un `EventTarget` à nous. */
function fenetreDeTest(): void {
  fenetre = new EventTarget();
  vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
  vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
}

afterEach(() => {
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store.set({ ui: uiAvant });
});

/** Comme `main.tsx` : lecture, magasin rempli de copies complétées, puis la conservation. */
async function demarrerCommeMain(p: ReturnType<typeof supabasePersistence>, entrepriseId: string) {
  fenetreDeTest();
  utiliser(p);
  store.set((s) => ({
    ui: {
      ...s.ui,
      storage: 'pending',
      issued: undefined,
      sample: false,
      conflit: false,
      reseau: 'ok',
      connexion: undefined,
      toast: undefined,
      brouillonRefuse: undefined,
      compte: compteUi(entrepriseId),
    },
  }));
  const loaded = await loadPersisted();
  if (!loaded) throw new Error('rien lu');
  const draft = loaded.draft;
  store.set((s) => ({
    form: draft ? hydrateForm(draft.form) : blankForm('2026-11-04'),
    appearance: draft ? fill(defaultAppearance(), draft.appearance) : defaultAppearance(),
    company: fill(defaultCompany(), loaded.company),
    numbering: fill(defaultNumbering(), loaded.numbering),
    ui: { ...s.ui, storage: 'ok', sample: draft?.sample === true, issued: draft?.issued },
  }));
  arreter = startPersistence({ delai: 1000 });
}

/** Comme `main.tsx` quand la lecture échoue : `injoignable`, le brouillon local à l'écran. */
async function demarrerInjoignable(
  p: ReturnType<typeof supabasePersistence>,
  entrepriseId: string,
) {
  fenetreDeTest();
  utiliser(p);
  const local = (await p.brouillonLocal()) as Brouillon | undefined;
  store.set((s) => ({
    form: local ? hydrateForm(local.form) : sampleForm(),
    appearance: local ? fill(defaultAppearance(), local.appearance) : defaultAppearance(),
    ui: {
      ...s.ui,
      storage: 'injoignable',
      sample: local ? local.sample === true : true,
      issued: local?.issued,
      compte: compteUi(entrepriseId),
      conflit: false,
      reseau: 'ok',
      toast: undefined,
      brouillonRefuse: undefined,
      connexion: undefined,
    },
  }));
  arreter = startPersistence({ delai: 1000 });
}

describe.skipIf(!process.env.SUPABASE_URL)('après un rechargement, sans rien taper', () => {
  test('« Dupliquer » passe', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    await supabasePersistence(sb, entrepriseId).set('draft', brouillon('Existant'));
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerCommeMain(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Existant');
    expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
    // Rien n'est parti pour rien : la version n'a pas bougé.
    expect((await lignes(entrepriseId)).map((l) => [l.form.buyer.name, l.version])).toEqual([
      ['Existant', 1],
    ]);
  }, 20_000);

  test('ouvrir un autre brouillon passe', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    const autre = brouillon('Autre');
    await avant.set('draft', autre);
    const idAutre = avant.brouillonCourant()?.id as string;
    expect(avant.quitterBrouillon(autre)).toBe(true);
    await avant.set('draft', brouillon('Existant'));

    const p = supabasePersistence(sb, entrepriseId);
    await demarrerCommeMain(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Existant');
    expect((await p.ouvrirBrouillon(idAutre, brouillonAffiche))?.form.buyer.name).toBe('Autre');
  }, 20_000);

  test('le miroir rejoué au démarrage, puis « Dupliquer » sans frappe : passe', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Version 1'));
    const retablir = perimerJeton(sb);
    await expect(avant.set('draft', brouillon('Tapé, jamais parvenu'))).rejects.toThrow('SESSION');
    retablir();

    const p = supabasePersistence(sb, entrepriseId);
    await demarrerCommeMain(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Tapé, jamais parvenu');
    await vi.waitFor(
      async () =>
        expect((await lignes(entrepriseId))[0]?.form.buyer.name).toBe('Tapé, jamais parvenu'),
      { timeout: 5000 },
    );
    expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
  }, 20_000);

  test('juste après une saisie confirmée, « Dupliquer » passe', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    await supabasePersistence(sb, entrepriseId).set('draft', brouillon('Existant'));
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerCommeMain(p, entrepriseId);
    setForm('buyer.name', 'Existant 2');
    await new Promise((r) => setTimeout(r, 1600));
    expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
  }, 20_000);
});

describe.skipIf(!process.env.SUPABASE_URL)('serveur injoignable, puis de retour', () => {
  test('rien tapé, brouillon modifié ailleurs entre-temps : la reprise l’affiche, sans l’écraser', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    // Un autre appareil modifie le brouillon (version 2) pendant que ce navigateur n'atteint rien.
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Appareil 2' } },
      })
      .eq('id', id);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Appareil 1');

    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(store.get().form.buyer.name).toBe('Appareil 2');
    expect((await lignes(entrepriseId)).map((l) => [l.form.buyer.name, l.version])).toEqual([
      ['Appareil 2', 2],
    ]);
  }, 20_000);

  test('navigateur neuf, exemple tapé sans pause : la saisie devient un brouillon, le vrai reste', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    await supabasePersistence(sb, entrepriseId).set('draft', brouillon('Vrai brouillon'));
    // Navigateur neuf : ni miroir, ni brouillon courant.
    await indexedDbPersistence.remove('kv', `draft-compte-${entrepriseId}`);
    await indexedDbPersistence.remove('kv', `brouillon-courant-${entrepriseId}`);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    expect(store.get().ui.sample).toBe(true);
    setForm('buyer.name', 'Tapé sur l’exemple');
    // Le serveur répond pendant la frappe, avant la pause de 400 ms.
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    await vi.waitFor(
      async () => {
        const noms = (await lignes(entrepriseId)).map((x) => x.form.buyer.name);
        expect(noms.sort()).toEqual(['Tapé sur l’exemple', 'Vrai brouillon'].sort());
      },
      { timeout: 5000 },
    );
  }, 20_000);

  test('tapé pendant l’absence, brouillon modifié ailleurs : conflit signalé, rien d’écrasé', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Appareil 2' } },
      })
      .eq('id', id);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    setForm('buyer.name', 'Appareil 1, tapé hors serveur');

    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true), { timeout: 5000 });
    expect(store.get().form.buyer.name).toBe('Appareil 1, tapé hors serveur');
    expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Appareil 2']);
  }, 20_000);

  test('tapé pendant la lecture de la reprise, brouillon modifié ailleurs : rien d’écrasé', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Appareil 2' } },
      })
      .eq('id', id);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    // Les lectures de la reprise mettent 300 ms ; on tape 50 ms après le retour du serveur.
    const fetchOrigine = globalThis.fetch;
    globalThis.fetch = async (entree, init) => {
      if ((init?.method ?? 'GET') === 'GET') await new Promise((r) => setTimeout(r, 300));
      return fetchOrigine(entree, init);
    };
    try {
      fenetre.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 50));
      setForm('buyer.name', 'Appareil 1, tapé pendant la reprise');
      await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    } finally {
      globalThis.fetch = fetchOrigine;
    }
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true), { timeout: 5000 });
    expect(store.get().form.buyer.name).toBe('Appareil 1, tapé pendant la reprise');
    expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Appareil 2']);
  }, 20_000);

  test('l’entreprise modifiée pendant l’absence n’atteint pas le serveur ; la saisie, si', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    const profil = (await avant.get('company')) as ReturnType<typeof defaultCompany>;
    await avant.set('company', {
      ...profil,
      seller: { ...blankParty(), name: 'Vraie entreprise' },
    });
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    const affichee = store.get().company;
    store.set((s) => ({
      company: { ...s.company, seller: { ...s.company.seller, name: 'Défaut retouché' } },
    }));
    expect(store.get().company).toEqual(affichee);
    setForm('buyer.name', 'Saisie pendant');
    await new Promise((r) => setTimeout(r, 500));

    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    expect(store.get().company.seller.name).toBe('Vraie entreprise');
    await vi.waitFor(
      async () =>
        expect((await lignes(entrepriseId)).map((x) => x.form.buyer.name)).toContain(
          'Saisie pendant',
        ),
      { timeout: 5000 },
    );
    const { data } = await adminDeTest()
      .from('entreprises')
      .select('profil')
      .eq('id', entrepriseId)
      .single();
    const profilServeur = data?.profil as { seller: { name: string } } | undefined;
    expect(profilServeur?.seller.name).toBe('Vraie entreprise');
  }, 20_000);
});

describe.skipIf(!process.env.SUPABASE_URL)('abandonner une saisie refusée', () => {
  test('l’abandon échoue (réseau) : rien ne change, la frappe suivante part', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    fenetreDeTest();
    vi.stubGlobal('confirm', () => true);
    utiliser(p);
    store.set((s) => ({
      form: blankForm('2026-11-04'),
      ui: {
        ...s.ui,
        storage: 'ok',
        issued: undefined,
        sample: false,
        conflit: false,
        reseau: 'ok',
        toast: undefined,
        brouillonRefuse: undefined,
        connexion: undefined,
        compte: compteUi(entrepriseId),
      },
    }));
    arreter = startPersistence({ delai: 0 });
    setForm('buyer.name', 'Propre');
    await vi.waitFor(
      async () => expect((await lignes(entrepriseId))[0]?.form.buyer.name).toBe('Propre'),
      { timeout: 5000 },
    );
    setForm('buyer.name', 'Avec\u0000nul');
    await vi.waitFor(() => expect(store.get().ui.brouillonRefuse).toBeTruthy());

    const fetchOrigine = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    try {
      await abandonnerSaisie();
    } finally {
      globalThis.fetch = fetchOrigine;
    }
    // L'abandon n'a pas eu lieu : la saisie et son bandeau restent.
    expect(store.get().form.buyer.name).toBe('Avec\u0000nul');
    expect(store.get().ui.brouillonRefuse).toBeTruthy();

    // Le réseau est revenu ; l'utilisateur corrige : la correction part, le bandeau s'en va.
    setForm('buyer.name', 'Corrigé après l’échec');
    await vi.waitFor(
      async () =>
        expect((await lignes(entrepriseId))[0]?.form.buyer.name).toBe('Corrigé après l’échec'),
      { timeout: 5000 },
    );
    expect(store.get().ui.brouillonRefuse).toBeUndefined();
    const miroir = await indexedDbPersistence.get<Miroir>(`draft-compte-${entrepriseId}`);
    expect([miroir?.form.buyer.name, miroir?.envoye]).toEqual(['Corrigé après l’échec', true]);
    expect(await quitterLeBrouillon()).toBe(true);
  }, 20_000);
});

describe.skipIf(!process.env.SUPABASE_URL)('reprise, puis rechargement', () => {
  test('rien tapé : la reprise confirme le brouillon du serveur, le rechargement prend la suite', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    const ailleurs = (nom: string) =>
      adminDeTest()
        .from('brouillons')
        .update({ form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: nom } } })
        .eq('id', id);
    await ailleurs('Appareil 2');
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1600));
    // Le brouillon du serveur, à l'écran, n'est pas une saisie à envoyer.
    const miroir = await indexedDbPersistence.get<Miroir>(`draft-compte-${entrepriseId}`);
    expect([miroir?.form.buyer.name, miroir?.envoye, miroir?.brouillon?.version]).toEqual([
      'Appareil 2',
      true,
      2,
    ]);
    expect(p.saisieEnAttente()).toBeUndefined();

    // Un autre appareil continue ; ce navigateur, rechargé, prend sa version, sans conflit.
    await ailleurs('Appareil 3');
    arreter?.();
    arreter = undefined;
    await demarrerCommeMain(supabasePersistence(sb, entrepriseId), entrepriseId);
    await new Promise((r) => setTimeout(r, 1600));
    expect(store.get().form.buyer.name).toBe('Appareil 3');
    expect(store.get().ui.conflit).toBe(false);
    expect((await lignes(entrepriseId)).map((l) => [l.form.buyer.name, l.version])).toEqual([
      ['Appareil 3', 3],
    ]);
  }, 20_000);

  test('tapé pendant l’absence, miroir non écrit (quota), modifié ailleurs : conflit, rien d’écrasé', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Appareil 2' } },
      })
      .eq('id', id);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    const ecrire = indexedDbPersistence.set.bind(indexedDbPersistence);
    vi.spyOn(indexedDbPersistence, 'set').mockImplementation(async (cle, valeur) => {
      if (String(cle).startsWith('draft-compte-'))
        throw new DOMException('quota', 'QuotaExceededError');
      return ecrire(cle, valeur);
    });
    setForm('buyer.name', 'Appareil 1, tapé hors serveur');
    await new Promise((r) => setTimeout(r, 600));
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true), { timeout: 5000 });
    expect(store.get().form.buyer.name).toBe('Appareil 1, tapé hors serveur');
    expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Appareil 2']);
  }, 20_000);

  test('saisie non envoyée d’une session précédente, modifié ailleurs, rien tapé : conflit, rien d’écrasé', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Appareil 1'));
    const id = avant.brouillonCourant()?.id as string;
    // Tapé, gardé dans le miroir, jamais envoyé.
    await avant.garderBrouillon(brouillon('Tapé, jamais parvenu'));
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Appareil 2' } },
      })
      .eq('id', id);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Tapé, jamais parvenu');
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true), { timeout: 5000 });
    expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Appareil 2']);
    expect(store.get().form.buyer.name).toBe('Tapé, jamais parvenu');
  }, 20_000);

  test('rien tapé, brouillon supprimé ailleurs pendant l’absence : l’exemple, rien ne renaît', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Supprimé ailleurs'));
    await adminDeTest().from('brouillons').delete().eq('entreprise_id', entrepriseId);
    const p = supabasePersistence(sb, entrepriseId);
    await demarrerInjoignable(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Supprimé ailleurs');
    fenetre.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
    expect(store.get().ui.sample).toBe(true);
    await new Promise((r) => setTimeout(r, 1600));
    expect(await lignes(entrepriseId)).toEqual([]);
  }, 20_000);
});

describe.skipIf(!process.env.SUPABASE_URL)('comparaison par contenu, renvoi unique', () => {
  test('pièce jointe (octets) : rechargement puis « Dupliquer » sans frappe, sans écriture', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const b = brouillon('Avec PJ');
    b.form.attachments = [
      {
        uid: 'u1',
        id: 'A1',
        description: 'd',
        uri: '',
        file: { name: 'x.pdf', mimeType: 'application/pdf', bytes: Uint8Array.of(1, 2, 3, 250) },
      },
    ];
    await supabasePersistence(sb, entrepriseId).set('draft', b);
    await demarrerCommeMain(supabasePersistence(sb, entrepriseId), entrepriseId);
    expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
    const l = await lignes(entrepriseId);
    expect(l.find((x) => x.form.buyer.name === 'Avec PJ')?.version).toBe(1);
  }, 20_000);

  test('ancien format (champ absent), modifié ailleurs après lecture : le renvoi n’écrase pas', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const b = brouillon('Ancien format');
    delete (b.form as Partial<typeof b.form>).notes;
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', b);
    const id = avant.brouillonCourant()?.id as string;
    await demarrerCommeMain(supabasePersistence(sb, entrepriseId), entrepriseId);
    await adminDeTest()
      .from('brouillons')
      .update({
        form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Ailleurs' } },
      })
      .eq('id', id);
    expect(await startDraft(duplicateForm(store.get().form))).toBe(false);
    expect(store.get().ui.conflit).toBe(true);
    expect((await lignes(entrepriseId)).map((x) => x.form.buyer.name)).toEqual(['Ailleurs']);
  }, 20_000);

  test('ancien format, personne d’autre : « Dupliquer » passe (une écriture, la forme complétée)', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const b = brouillon('Ancien format');
    delete (b.form as Partial<typeof b.form>).notes;
    await supabasePersistence(sb, entrepriseId).set('draft', b);
    await demarrerCommeMain(supabasePersistence(sb, entrepriseId), entrepriseId);
    expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
    const l = await lignes(entrepriseId);
    expect(l.find((x) => x.form.buyer.name === 'Ancien format')?.version).toBe(2);
  }, 20_000);
});

/** Une facture émise de l'historique, telle que `openIssued` l'ouvre. */
function emise(client: string): SavedInvoice {
  const b = brouillon(client);
  return {
    uid: `emise-${client}`,
    status: 'issued',
    form: b.form,
    appearance: b.appearance,
  } as SavedInvoice;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const modifierAilleurs = (id: string, nom: string) =>
  adminDeTest()
    .from('brouillons')
    .update({ form: { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: nom } } })
    .eq('id', id);

describe.skipIf(!process.env.SUPABASE_URL)(
  'une vue à l’écran : la saisie ne s’attache à aucun autre brouillon',
  () => {
    test('exemple ouvert, démarrage injoignable, frappe sur l’exemple : X intact, un nouveau brouillon', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      const x = brouillon('X — travail réel');
      await avant.set('draft', x);
      const idX = avant.brouillonCourant()?.id;
      // « Nouvel exemple » : le brouillon X quitté, puis l'exemple (une vue). Le miroir tient X, envoyé.
      expect(avant.quitterBrouillon(x)).toBe(true);
      await avant.set('draft', {
        form: sampleForm(),
        appearance: defaultAppearance(),
        sample: true,
      });
      await attendre(200);
      const p = supabasePersistence(sb, entrepriseId);
      await demarrerInjoignable(p, entrepriseId);
      expect(store.get().ui.sample).toBe(true);
      setForm('buyer.name', 'Tapé sur l’exemple');
      await attendre(600);
      fenetre.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(store.get().ui.storage).toBe('ok'), { timeout: 5000 });
      await vi.waitFor(async () => expect(await lignes(entrepriseId)).toHaveLength(2), {
        timeout: 5000,
      });
      const l = await lignes(entrepriseId);
      expect(l.find((r) => r.id === idX)?.form.buyer.name).toBe('X — travail réel');
      expect(l.find((r) => r.id === idX)?.version).toBe(1);
      expect(l.find((r) => r.id !== idX)?.form.buyer.name).toBe('Tapé sur l’exemple');
      expect(store.get().ui.conflit).toBe(false);
    }, 20_000);

    test('exemple affiché sur le brouillon courant X (en ligne), frappe : X intact, un nouveau brouillon', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      await avant.set('draft', brouillon('X — travail réel'));
      const idX = avant.brouillonCourant()?.id;
      await avant.set('draft', {
        form: sampleForm(),
        appearance: defaultAppearance(),
        sample: true,
      });
      await demarrerCommeMain(supabasePersistence(sb, entrepriseId), entrepriseId);
      expect(store.get().ui.sample).toBe(true);
      setForm('buyer.name', 'Tapé sur l’exemple');
      await vi.waitFor(async () => expect(await lignes(entrepriseId)).toHaveLength(2), {
        timeout: 5000,
      });
      const l = await lignes(entrepriseId);
      expect(l.find((r) => r.id === idX)?.form.buyer.name).toBe('X — travail réel');
      expect(l.find((r) => r.id !== idX)?.form.buyer.name).toBe('Tapé sur l’exemple');
    }, 20_000);

    test('saisie en attente sous l’exemple, modifiée ailleurs : l’exemple ne la cache pas, « Garder » la garde', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      await avant.set('draft', brouillon('Appareil 1'));
      const id = avant.brouillonCourant()?.id as string;
      await avant.garderBrouillon(brouillon('Tapé, jamais parvenu'));
      await avant.set('draft', {
        form: sampleForm(),
        appearance: defaultAppearance(),
        sample: true,
      });
      await modifierAilleurs(id, 'Appareil 2');
      const p = supabasePersistence(sb, entrepriseId);
      await demarrerInjoignable(p, entrepriseId);
      expect(store.get().ui.sample).toBe(false);
      expect(store.get().form.buyer.name).toBe('Tapé, jamais parvenu');
      fenetre.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true), { timeout: 5000 });
      vi.stubGlobal('confirm', () => true);
      await garderMaVersion();
      expect((await lignes(entrepriseId)).map((l) => [l.form.buyer.name, l.version])).toEqual([
        ['Tapé, jamais parvenu', 3],
      ]);
      const m = await indexedDbPersistence.get<Miroir>(`draft-compte-${entrepriseId}`);
      expect([m?.form.buyer.name, m?.envoye]).toEqual(['Tapé, jamais parvenu', true]);
    }, 20_000);

    /** Un brouillon tapé, en conflit (modifié ou supprimé ailleurs), puis une facture émise ouverte. */
    async function conflitSousUneFactureEmise(ailleurs: 'modifie' | 'supprime') {
      const { sb, entrepriseId } = await compteDeTest();
      await supabasePersistence(sb, entrepriseId).set('draft', brouillon('Version 1'));
      const p = supabasePersistence(sb, entrepriseId);
      await demarrerCommeMain(p, entrepriseId);
      const id = p.brouillonCourant()?.id as string;
      if (ailleurs === 'modifie') await modifierAilleurs(id, 'Ailleurs');
      else await adminDeTest().from('brouillons').delete().eq('id', id);
      setForm('buyer.name', 'Ma saisie');
      await vi.waitFor(() => expect(store.get().ui.conflit).not.toBe(false), { timeout: 5000 });
      openIssued(emise('Facture émise'));
      await attendre(1500);
      expect(store.get().ui.issued).toBe('emise-Facture émise');
      return { p, entrepriseId };
    }

    test('conflit sous une facture émise : « Garder ma version » envoie la saisie, pas la facture', async () => {
      const { entrepriseId } = await conflitSousUneFactureEmise('modifie');
      vi.stubGlobal('confirm', () => true);
      await garderMaVersion();
      expect((await lignes(entrepriseId)).map((l) => [l.form.buyer.name, l.version])).toEqual([
        ['Ma saisie', 3],
      ]);
      expect(store.get().ui.issued).toBe('emise-Facture émise');
      expect(store.get().ui.conflit).toBe(false);
    }, 20_000);

    test('conflit sous une facture émise : le brouillon en conflit s’ouvre, puis se recharge', async () => {
      const { entrepriseId } = await conflitSousUneFactureEmise('modifie');
      ouvrirLeBrouillonEnConflit();
      expect(store.get().ui.issued).toBeUndefined();
      expect(store.get().form.buyer.name).toBe('Ma saisie');
      expect(store.get().ui.conflit).toBe(true);
      await attendre(1500);
      expect(store.get().ui.conflit).toBe(true);
      expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Ailleurs']);
      await rechargerBrouillon();
      expect(store.get().form.buyer.name).toBe('Ailleurs');
      expect(store.get().ui.conflit).toBe(false);
    }, 20_000);

    test('supprimé ailleurs, sous une facture émise : « Recharger » recrée la saisie, pas la facture', async () => {
      const { entrepriseId } = await conflitSousUneFactureEmise('supprime');
      expect(store.get().ui.conflit).toBe('supprime');
      await rechargerBrouillon();
      expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual(['Ma saisie']);
      expect(store.get().ui.issued).toBe('emise-Facture émise');
    }, 20_000);

    test('tapé pendant l’absence, supprimé ailleurs : « supprimé ailleurs », puis recréé avec la saisie', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      await avant.set('draft', brouillon('Appareil 1'));
      await adminDeTest().from('brouillons').delete().eq('entreprise_id', entrepriseId);
      const p = supabasePersistence(sb, entrepriseId);
      await demarrerInjoignable(p, entrepriseId);
      setForm('buyer.name', 'Tapé hors serveur');
      await attendre(600);
      fenetre.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(store.get().ui.conflit).toBe('supprime'), { timeout: 5000 });
      expect(await lignes(entrepriseId)).toEqual([]);
      await recreerBrouillon();
      expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual([
        'Tapé hors serveur',
      ]);
      expect(store.get().ui.conflit).toBe(false);
      expect(store.get().form.buyer.name).toBe('Tapé hors serveur');
    }, 20_000);
  },
);

describe.skipIf(!process.env.SUPABASE_URL)('sonde D : miroir illisible au démarrage', () => {
  test('la saisie qu’il cachait est mise de côté à la frappe, dite, puis rouverte en brouillon', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const avant = supabasePersistence(sb, entrepriseId);
    await avant.set('draft', brouillon('Version 1'));
    const retablir = perimerJeton(sb);
    await expect(avant.set('draft', brouillon('Tapé, jamais parvenu'))).rejects.toThrow('SESSION');
    retablir();

    // Le Studio rouvert : IndexedDB ne rend pas le miroir, malgré les nouveaux essais.
    const cle = `draft-compte-${entrepriseId}`;
    const lire = indexedDbPersistence.get.bind(indexedDbPersistence);
    let echecs = 3;
    vi.spyOn(indexedDbPersistence, 'get').mockImplementation(async (c: string) => {
      if (c === cle && echecs-- > 0) throw new Error('IndexedDB : lecture impossible');
      return lire(c);
    });
    const p = supabasePersistence(sb, entrepriseId, { surSaisieMiseDeCote: direSaisieMiseDeCote });
    await demarrerCommeMain(p, entrepriseId);
    expect(store.get().form.buyer.name).toBe('Version 1');

    // On tape sur la version du serveur : la saisie cachée est mise de côté, et le Studio le dit.
    // L'enregistrement part une seconde après la frappe : les attentes vont au-delà du délai par
    // défaut de `vi.waitFor` (une seconde), comme les autres tests de ce fichier.
    setForm('buyer.name', 'Tapé après le démarrage');
    await vi.waitFor(
      () => expect(store.get().ui.toast?.text).toBe(t.compte.conservation.miseDeCote),
      { timeout: 5000 },
    );
    await vi.waitFor(
      async () =>
        expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toEqual([
          'Tapé après le démarrage',
        ]),
      { timeout: 5000 },
    );

    // « La rouvrir » : un nouveau brouillon, sur le serveur, et plus rien de côté.
    await store.get().ui.toast?.action?.run();
    expect(store.get().form.buyer.name).toBe('Tapé, jamais parvenu');
    expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name).sort()).toEqual([
      'Tapé après le démarrage',
      'Tapé, jamais parvenu',
    ]);
    expect(await p.saisieMiseDeCote()).toBeUndefined();
  }, 20_000);
});
