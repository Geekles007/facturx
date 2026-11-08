// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import { defaultAppearance, defaultNumbering, type SavedInvoice } from '../library.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { enregistrerMaintenant, setForm, startPersistence, store } from '../store.js';
import { emettreSurServeur } from './emission.js';
import { supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest } from './test-aide.js';

/**
 * Le plafond du gel (`DELAI_GEL_MS`) contre le vrai `emettre` (`FACTURX_EMETTRE=1`, fonctions
 * servies), raccourci pour l'essai : à part, pour qu'il ne touche pas les autres émissions réelles.
 * Une émission dont le brouillon est déjà quitté (`brouillonEmis`) ne s'abandonne plus : le plafond
 * attend la fin, elle-même bornée (relecture de l'historique, sinon la facture reconstituée).
 */

vi.mock('./delais.js', async (original) => ({
  ...(await original<typeof import('./delais.js')>()),
  DELAI_GEL_MS: 3_000,
  DELAI_RELECTURE_MS: 6_000,
}));

/** Le client de la session de l'essai en cours : `emettreSurServeur` l'emploie par `client()`. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

const aujourdhuiParis = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const uiAvant = store.get().ui;
let arreter: (() => void) | undefined;

afterEach(() => {
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  store.set({ ui: uiAvant, history: [] });
});

describe.skipIf(!process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1')(
  'le plafond du gel, `emettre` servie',
  () => {
    test('plafond tombé pendant la relecture, après le départ du brouillon : on va jusqu’au bout', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      session.sb = sb as SupabaseClient;
      const p = supabasePersistence(sb, entrepriseId);
      const numbering =
        (await p.get<ReturnType<typeof defaultNumbering>>('numbering')) ?? defaultNumbering();
      const fenetre = new EventTarget();
      vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
      vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
      utiliser(p);
      store.set((s) => ({
        form: sampleForm(aujourdhuiParis()),
        appearance: defaultAppearance(),
        numbering,
        clients: [],
        history: [],
        ui: {
          ...s.ui,
          storage: 'ok',
          compte: {
            email: 'essai@facturx.test',
            confirme: true,
            entrepriseId,
            suppressionDemandeeLe: undefined,
            session: 'active',
          },
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
      setForm('buyer.name', 'Relecture lente');
      expect(await enregistrerMaintenant()).toBe(true);

      // La relecture de l'historique, après l'émission, ne répond pas avant qu'on la libère.
      let liberer: () => void = () => undefined;
      const porte = new Promise<void>((r) => {
        liberer = r;
      });
      const lire = p.list.bind(p);
      (p as { list: unknown }).list = async <T>(magasin: 'invoices' | 'clients' | 'products') => {
        if (magasin === 'invoices') await porte;
        return lire<T>(magasin);
      };
      const debut = Date.now();
      const emission = emettreSurServeur();
      // Après le plafond (3 s) : l'émission n'est pas abandonnée, l'éditeur reste figé.
      await dormir(4_000);
      expect(store.get().ui.emissionEnCours).toBe(true);
      setForm('buyer.name', 'Tapé pendant');
      expect(store.get().form.buyer.name).toBe('Relecture lente');
      // La relecture bornée (6 s) laisse place à la facture reconstituée, qui s'ouvre.
      expect(await emission).toBe(true);
      expect(Date.now() - debut).toBeGreaterThanOrEqual(6_000);
      const { data } = await adminDeTest()
        .from('factures')
        .select('id, numero')
        .eq('entreprise_id', entrepriseId);
      const factures = (data ?? []) as { id: string; numero: string }[];
      expect(factures).toHaveLength(1);
      const s = store.get();
      expect(s.ui.emissionEnCours).toBe(false);
      expect(s.ui.issued).toBe(factures[0]?.id);
      expect(s.form.id).toBe(factures[0]?.numero);
      expect(s.ui.conflit).toBe(false);
      expect(s.ui.toast?.text).toBe(t.compte.emission.emise(factures[0]?.numero ?? ''));
      const { data: brouillons } = await adminDeTest()
        .from('brouillons')
        .select('id')
        .eq('entreprise_id', entrepriseId);
      expect(brouillons).toEqual([]);
      // La relecture finit par répondre : l'historique se met à jour, la facture reste ouverte.
      liberer();
      await vi.waitFor(() =>
        expect(store.get().history.map((h: SavedInvoice) => h.uid)).toEqual([factures[0]?.id]),
      );
      expect(store.get().ui.issued).toBe(factures[0]?.id);
    }, 30_000);
  },
);
