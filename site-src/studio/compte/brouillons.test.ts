// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test, vi } from 'vitest';

// La liste des brouillons appelée comme une simple fonction : ses crochets deviennent triviaux, et
// la liste lue est celle que le test y met.
const h = vi.hoisted(() => ({ liste: undefined as unknown }));
vi.mock('preact/hooks', async (original) => {
  const reel = await original<typeof import('preact/hooks')>();
  return {
    ...reel,
    useState: (initial: unknown) => {
      if (initial === undefined)
        return [
          h.liste,
          (v: unknown) => {
            h.liste = v;
          },
        ];
      return [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        () => undefined,
      ];
    },
    useEffect: () => undefined,
    useRef: (v: unknown) => ({ current: v }),
  };
});

import { t } from '../i18n.js';
import {
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  fill,
  hydrateForm,
} from '../library.js';
import { blankForm, blankParty } from '../model.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { type Loaded, loadPersisted, setForm, startPersistence, store } from '../store.js';
import { IconButton } from '../ui.js';
import { startDraft } from '../workflows.js';
import { Brouillons } from './brouillons.js';
import { type ResumeBrouillon, supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest } from './test-aide.js';

/** La liste des brouillons, contre la pile locale : ce qui suit la suppression du brouillon ouvert. */

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

const uiAvant = store.get().ui;
const fetchOrigine = globalThis.fetch;
let arreter: (() => void) | undefined;

afterEach(() => {
  globalThis.fetch = fetchOrigine;
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  store.set({ ui: uiAvant });
});

/** Comme `main.tsx` : lecture, magasin rempli de copies complétées, puis la conservation. */
async function demarrerCommeMain(p: ReturnType<typeof supabasePersistence>, entrepriseId: string) {
  const fenetre = new EventTarget();
  vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
  vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
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
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId,
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    },
  }));
  const lu = await loadPersisted();
  if (!lu) throw new Error('rien lu');
  const draft = lu.draft;
  store.set((s) => ({
    form: draft ? hydrateForm(draft.form) : sampleForm(),
    appearance: draft ? fill(defaultAppearance(), draft.appearance) : defaultAppearance(),
    company: fill(defaultCompany(), lu.company),
    numbering: fill(defaultNumbering(), lu.numbering),
    ui: {
      ...s.ui,
      storage: 'ok',
      sample: draft ? draft.sample === true : true,
      issued: draft?.issued,
    },
  }));
  arreter = startPersistence({ delai: 1000 });
}

/** Les éléments d'un arbre de vnodes qui répondent à `cherche`. */
function trouver(
  n: unknown,
  cherche: (v: { type: unknown; props: Record<string, unknown> }) => boolean,
  trouves: { type: unknown; props: Record<string, unknown> }[] = [],
) {
  if (Array.isArray(n)) for (const c of n) trouver(c, cherche, trouves);
  else if (n && typeof n === 'object' && 'props' in n) {
    const v = n as { type: unknown; props: Record<string, unknown> };
    if (cherche(v)) trouves.push(v);
    trouver(v.props.children, cherche, trouves);
    for (const k of Object.keys(v.props))
      if (k !== 'children') trouver(v.props[k], cherche, trouves);
  }
  return trouves;
}

describe.skipIf(!process.env.SUPABASE_URL)(
  'supprimer le brouillon ouvert, et la suite échoue',
  () => {
    for (const variante of ['liste', 'ouverture'] as const) {
      test(`échec de la ${variante} : une facture vierge, le Studio le dit, la frappe suivante part`, async () => {
        const { sb, entrepriseId } = await compteDeTest();
        await supabasePersistence(sb, entrepriseId).set('draft', brouillon('Autre'));
        const p = supabasePersistence(sb, entrepriseId);
        await demarrerCommeMain(p, entrepriseId);
        const autre = p.brouillonCourant()?.id;
        expect(store.get().form.buyer.name).toBe('Autre');
        const ouvert = { ...blankForm('2026-11-04'), buyer: { ...blankParty(), name: 'Ouvert' } };
        expect(await startDraft(ouvert)).toBe(true);
        await vi.waitFor(
          async () =>
            expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name).sort()).toEqual([
              'Autre',
              'Ouvert',
            ]),
          { timeout: 5000 },
        );
        expect(p.brouillonCourant()?.id).not.toBe(autre);

        vi.stubGlobal('confirm', () => true);
        h.liste = await p.brouillons();
        const courant = p.brouillonCourant()?.id;
        const vnode = Brouillons({ open: true, onClose: () => undefined });
        const corbeilles = trouver(vnode, (v) => v.type === IconButton && v.props.icon === 'trash');
        const i = (h.liste as ResumeBrouillon[]).findIndex((b) => b.id === courant);
        expect(i).toBeGreaterThanOrEqual(0);
        globalThis.fetch = async (entree, init) => {
          const url = String(entree instanceof Request ? entree.url : entree);
          const methode = (init?.method ?? 'GET').toUpperCase();
          if (methode === 'GET' && url.includes('/rest/v1/brouillons')) {
            const lecture = /[?&]id=eq\./.test(url);
            if ((variante === 'liste' && !lecture) || (variante === 'ouverture' && lecture))
              throw new TypeError('Failed to fetch');
          }
          return fetchOrigine(entree, init);
        };
        const supprimer = corbeilles[i]?.props.onClick as (() => Promise<void>) | undefined;
        expect(supprimer).toBeDefined();
        await supprimer?.();
        globalThis.fetch = fetchOrigine;

        expect(store.get().form.buyer.name).toBe('');
        // La liste du dialogue ne montre plus le brouillon supprimé, même sans avoir pu la relire.
        expect((h.liste as ResumeBrouillon[]).some((b) => b.id === courant)).toBe(false);
        expect(store.get().ui.toast?.kind).toBe('info');
        expect(store.get().ui.toast?.text).toBe(t.compte.brouillons.repli);
        setForm('buyer.name', 'Après la suppression');
        await vi.waitFor(
          async () =>
            expect((await lignes(entrepriseId)).map((l) => l.form.buyer.name).sort()).toEqual([
              'Après la suppression',
              'Autre',
            ]),
          { timeout: 5000 },
        );
      }, 30_000);
    }
  },
);
