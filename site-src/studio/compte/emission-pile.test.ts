// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import { defaultAppearance, defaultNumbering, type SavedInvoice } from '../library.js';
import { blankForm, blankParty } from '../model.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import {
  enregistrerMaintenant,
  type Loaded,
  setForm,
  startPersistence,
  store,
  updateForm,
} from '../store.js';
import { emettreSurServeur } from './emission.js';
import { supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest } from './test-aide.js';

/**
 * L'émission contre la pile locale : ce que la conservation du compte en sait (le brouillon prêt à
 * émettre, le brouillon émis quitté sans retour, la facture d'une réponse perdue, l'historique sous
 * le numéro attribué) ; et, quand `emettre` est servie (`FACTURX_EMETTRE=1`, avec
 * `supabase functions serve` et les polices déposées), de vraies émissions depuis le Studio.
 */

type Brouillon = NonNullable<Loaded['draft']>;

/** Le client de la session de l'essai en cours : `emettreSurServeur` l'emploie par `client()`. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

function brouillon(client: string): Brouillon {
  const form = blankForm('2026-11-04');
  form.buyer = { ...blankParty(), name: client };
  return { form, appearance: defaultAppearance() };
}

async function lignes(entrepriseId: string) {
  const { data, error } = await adminDeTest()
    .from('brouillons')
    .select('id, form, version')
    .eq('entreprise_id', entrepriseId);
  if (error) throw error;
  return data as { id: string; form: { buyer: { name: string } }; version: number }[];
}

/** Ce que ce navigateur garde du compte (IndexedDB, magasin `kv`). */
const gardeLocale = (cle: string) => indexedDbPersistence.get(cle);

/** Une facture émise, insérée comme `emettre` l'enregistre, avec le formulaire de son brouillon. */
async function insererFacture(
  entrepriseId: string,
  options: { numero: string; form: unknown; brouillonId?: string },
): Promise<string> {
  const admin = adminDeTest();
  const membre = await admin.from('membres').select('user_id').eq('entreprise_id', entrepriseId);
  const id = crypto.randomUUID();
  const { error } = await admin.from('factures').insert({
    id,
    entreprise_id: entrepriseId,
    numero: options.numero,
    type_code: '380',
    date_emission: '2026-11-04',
    client_nom: 'Client',
    devise: 'EUR',
    ht: 100,
    ttc: 120,
    net_a_payer: 120,
    invoice: {},
    form: options.form,
    appearance: defaultAppearance(),
    pdf_chemin: `${entrepriseId}/${id}.pdf`,
    sdk_version: 'essai',
    origine: 'emise',
    brouillon_id: options.brouillonId ?? null,
    emise_par: membre.data?.[0]?.user_id,
  });
  if (error) throw error;
  return id;
}

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;
let arreter: (() => void) | undefined;

afterEach(() => {
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  store.set({ ui: uiAvant, history: [] });
});

/** Le Studio connecté sur `p`, `form` à l'écran (un nouveau brouillon), enregistré au délai d'une seconde. */
function demarrer(
  p: ReturnType<typeof supabasePersistence>,
  entrepriseId: string,
  form = brouillon('Studio').form,
): void {
  const fenetre = new EventTarget();
  vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
  vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
  utiliser(p);
  store.set((s) => ({
    form,
    appearance: defaultAppearance(),
    numbering: defaultNumbering(),
    clients: [],
    history: [],
    ui: {
      ...s.ui,
      storage: 'ok',
      compte: compteUi(entrepriseId),
      conflit: false,
      reseau: 'ok',
      connexion: undefined,
      toast: undefined,
      issued: undefined,
      sample: false,
      brouillonRefuse: undefined,
      refusServeur: undefined,
      tab: 'content',
      focus: undefined,
    },
  }));
  arreter = startPersistence({ delai: 1000 });
}

describe.skipIf(!process.env.SUPABASE_URL)('émettre : la conservation du compte', () => {
  test('brouillonAEmettre : la version enregistrée si l’écran la montre, rien sinon', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    const a = brouillon('A');
    expect(p.brouillonAEmettre(a)).toBeUndefined();
    await p.set('draft', a);
    const [ligne] = await lignes(entrepriseId);
    expect(p.brouillonAEmettre(a)).toEqual({ id: ligne?.id, version: 1 });
    // Des copies du même contenu (l'écran complète ce qu'il lit) : la même version.
    expect(p.brouillonAEmettre(structuredClone(a))).toEqual({ id: ligne?.id, version: 1 });
    // Une saisie que le serveur n'a pas : rien.
    const b = brouillon('A, modifié');
    expect(p.brouillonAEmettre(b)).toBeUndefined();
    await p.set('draft', b);
    expect(p.brouillonAEmettre(b)).toEqual({ id: ligne?.id, version: 2 });
    expect(p.brouillonAEmettre(a)).toBeUndefined();
    // Une vue (facture émise, exemple) n'est pas un brouillon.
    expect(p.brouillonAEmettre({ ...b, issued: 'f-1' })).toBeUndefined();
    expect(p.brouillonAEmettre({ ...b, sample: true })).toBeUndefined();
  });

  test('émis : le brouillon ne revient ni par la frappe, ni par le miroir, ni au démarrage', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    demarrer(p, entrepriseId);
    setForm('buyer.name', 'À émettre');
    expect(await enregistrerMaintenant()).toBe(true);
    const [ligne] = await lignes(entrepriseId);
    if (!ligne) throw new Error('brouillon absent');
    expect(await gardeLocale(`brouillon-courant-${entrepriseId}`)).toBe(ligne.id);

    // Le serveur émet : le brouillon disparaît ; on tape encore pendant ce temps.
    await adminDeTest().from('brouillons').delete().eq('id', ligne.id);
    setForm('buyer.name', 'Tapé pendant l’émission');
    await p.brouillonEmis(ligne.id);
    expect(await enregistrerMaintenant()).toBe(true);
    await p.envoisTermines();

    expect(await lignes(entrepriseId)).toEqual([]);
    expect(store.get().ui.conflit).toBe(false);
    expect(p.brouillonCourant()).toBeUndefined();
    expect(await gardeLocale(`draft-compte-${entrepriseId}`)).toBeUndefined();
    expect(await gardeLocale(`brouillon-courant-${entrepriseId}`)).toBeUndefined();
    // Un nouveau navigateur, ou un rechargement : rien ne rouvre le brouillon émis.
    const rouvert = supabasePersistence(sb, entrepriseId);
    expect(await rouvert.get('draft')).toBeUndefined();
    expect(await rouvert.brouillonLocal()).toBeUndefined();
  });

  test('émis pendant qu’une écriture était en route : aucun conflit signalé, rien de recréé', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    demarrer(p, entrepriseId);
    setForm('buyer.name', 'Version 1');
    expect(await enregistrerMaintenant()).toBe(true);
    const [ligne] = await lignes(entrepriseId);
    if (!ligne) throw new Error('brouillon absent');

    // La mise à jour suivante attend que le serveur ait émis (et supprimé) le brouillon.
    let liberer: () => void = () => undefined;
    const porte = new Promise<void>((r) => {
      liberer = r;
    });
    const fetchOrigine = globalThis.fetch;
    globalThis.fetch = async (entree, init) => {
      if (init?.method === 'PATCH') await porte;
      return fetchOrigine(entree, init);
    };
    try {
      setForm('buyer.name', 'Version 2, en route');
      const enRoute = enregistrerMaintenant();
      await adminDeTest().from('brouillons').delete().eq('id', ligne.id);
      await p.brouillonEmis(ligne.id);
      liberer();
      expect(await enRoute).toBe(true);
    } finally {
      globalThis.fetch = fetchOrigine;
    }
    expect(store.get().ui.conflit).toBe(false);
    expect(await lignes(entrepriseId)).toEqual([]);
  });

  test('factureDuBrouillon : la facture émise depuis ce brouillon, ou rien', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    const brouillonId = crypto.randomUUID();
    const id = await insererFacture(entrepriseId, {
      numero: 'F-2026-0012',
      form: brouillon('Client').form,
      brouillonId,
    });
    expect(await p.factureDuBrouillon(brouillonId)).toEqual({ id, numero: 'F-2026-0012' });
    expect(await p.factureDuBrouillon(crypto.randomUUID())).toBeUndefined();
  });

  test('l’historique : le numéro attribué, et la référence de paiement qui le rappelait', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const propose = { ...brouillon('Rappel').form, id: 'F-2026-0003' };
    propose.remittanceInformation = 'F-2026-0003';
    const libre = { ...brouillon('Libre').form, id: 'F-2026-0004' };
    libre.remittanceInformation = 'Commande 12';
    await insererFacture(entrepriseId, { numero: 'F-2026-0005', form: propose });
    await insererFacture(entrepriseId, { numero: 'F-2026-0006', form: libre });
    // Une facture importée : un formulaire que rien n'a vérifié.
    await insererFacture(entrepriseId, { numero: 'IMP-1', form: { buyer: { name: 'Importée' } } });
    const p = supabasePersistence(sb, entrepriseId);
    const factures = await p.list<SavedInvoice>('invoices');
    const parNumero = Object.fromEntries(factures.map((f) => [f.summary.id, f.form]));
    expect([parNumero['F-2026-0005']?.id, parNumero['F-2026-0005']?.remittanceInformation]).toEqual(
      ['F-2026-0005', 'F-2026-0005'],
    );
    expect([parNumero['F-2026-0006']?.id, parNumero['F-2026-0006']?.remittanceInformation]).toEqual(
      ['F-2026-0006', 'Commande 12'],
    );
    expect(parNumero['IMP-1']?.id).toBe('IMP-1');
  });

  test('la numérotation relue ne repart pas au serveur ; un changement, si', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    const lue = await p.get<ReturnType<typeof defaultNumbering>>('numbering');
    if (!lue) throw new Error('numérotation absente');
    const ecritures: string[] = [];
    const fetchOrigine = globalThis.fetch;
    globalThis.fetch = async (entree, init) => {
      if (init?.method === 'PATCH') ecritures.push(String(entree));
      return fetchOrigine(entree, init);
    };
    try {
      await p.set('numbering', { ...lue });
      expect(ecritures).toEqual([]);
      await p.set('numbering', { ...lue, pattern: 'FA-{AAAA}-{NNNN}' });
      expect(ecritures).toHaveLength(1);
    } finally {
      globalThis.fetch = fetchOrigine;
    }
  });
});

/** Aujourd'hui à Paris, comme le serveur le compte. */
const aujourdhuiParis = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

describe.skipIf(!process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1')(
  'émettre pour de vrai, `emettre` servie',
  () => {
    async function studioConnecte() {
      const { sb, entrepriseId } = await compteDeTest();
      session.sb = sb as SupabaseClient;
      const p = supabasePersistence(sb, entrepriseId);
      const lue = await p.get<ReturnType<typeof defaultNumbering>>('numbering');
      demarrer(p, entrepriseId, sampleForm(aujourdhuiParis()));
      if (lue) store.set({ numbering: lue });
      return { sb, entrepriseId, p };
    }

    test('émise : numéro du serveur, historique, numérotation, PDF, brouillon parti sans retour', async () => {
      const { entrepriseId, p } = await studioConnecte();
      setForm('buyer.name', 'Client réel');
      expect(await emettreSurServeur()).toBe(true);
      const s = store.get();
      const facture = s.history.find((h) => h.uid === s.ui.issued);
      expect(facture?.summary.id).toBe(`F-${aujourdhuiParis().slice(0, 4)}-0001`);
      expect(s.form.id).toBe(facture?.summary.id);
      expect(s.form.buyer.name).toBe('Client réel');
      expect(s.numbering.next).toBe(2);
      expect(s.ui.toast?.text).toBe(t.compte.emission.emise(facture?.summary.id ?? ''));
      expect(await lignes(entrepriseId)).toEqual([]);
      // Le PDF Factur-X est déposé, et se lit depuis la facture ouverte.
      const pdf = await p.getFile(`pdf-${s.ui.issued}`);
      expect(new TextDecoder().decode(pdf?.subarray(0, 5))).toBe('%PDF-');
      // Rien ne recrée le brouillon émis.
      expect(await enregistrerMaintenant()).toBe(true);
      await p.envoisTermines();
      expect(await lignes(entrepriseId)).toEqual([]);
    }, 30_000);

    test('anomalie du serveur (avoir sur une facture inconnue) : onglet Contrôle, rien d’émis', async () => {
      const { entrepriseId } = await studioConnecte();
      updateForm('typeCode', () => '381');
      setForm('references.precedingInvoices', [
        { uid: 'p-1', id: 'F-INCONNUE-1', issueDate: aujourdhuiParis() },
      ]);
      expect(await emettreSurServeur()).toBe(false);
      const ui = store.get().ui;
      expect(ui.tab).toBe('check');
      expect(ui.refusServeur?.issues.map((i) => [i.code, i.path])).toEqual([
        ['ORIGINE', 'references.precedingInvoices[0].id'],
      ]);
      expect(ui.focus?.path).toBe('references.precedingInvoices[0].id');
      expect(ui.toast?.text).toBe(`${t.compte.emission.refus(1)} ${t.compte.emission.aucunNumero}`);
      // Le brouillon reste, intact ; la numérotation n'a pas bougé.
      expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name)).toHaveLength(1);
      const { data } = await adminDeTest()
        .from('numerotation')
        .select('prochain')
        .eq('entreprise_id', entrepriseId)
        .single();
      expect(data?.prochain).toBe(1);
    }, 30_000);

    test('date hors bornes (demain) : les dates admises, le champ de la date', async () => {
      await studioConnecte();
      const demain = new Date(Date.now() + 36 * 3600 * 1000);
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(demain);
      setForm('issueDate', iso);
      expect(await emettreSurServeur()).toBe(false);
      expect(store.get().ui.focus?.path).toBe('issueDate');
      expect(store.get().ui.toast?.text).toContain(t.compte.emission.aucunNumero);
    }, 30_000);
  },
);
