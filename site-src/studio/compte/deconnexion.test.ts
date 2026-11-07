// Les données du compte et celles du mode local vivent dans IndexedDB : le faux doit exister avant
// l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import { defaultCompany, defaultNumbering } from '../library.js';
import { ErreurConservation } from '../persistence.js';
import { indexedDbPersistence as local, utiliser } from '../storage.js';
import { startPersistence, store } from '../store.js';
import { deconnecter } from './index.js';
import { conservationEnMemoire } from './test-aide.js';

/**
 * La déconnexion sur un poste partagé (relevé aux tâches 15-16) : une fois les écritures parties, le
 * miroir du brouillon, les valeurs locales (`kv-compte-*`), la vue, le brouillon courant et la marque
 * d'import de ce compte quittent IndexedDB ; les données du Studio sans compte, et celles d'un autre
 * compte, restent. Une saisie que le serveur n'a pas reçue n'est effacée qu'avec l'accord de
 * l'utilisateur ; sans lui, rien ne change, et la session reste ouverte.
 */

const auth = vi.hoisted(() => ({ signOut: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('./client.js', () => ({ client: () => ({ auth }) }));

const E = 'e-ce-compte';
const AUTRE = 'e-autre-compte';
const reload = vi.fn();
const confirmer = vi.fn();
const uiAvant = store.get().ui;
let arreter: (() => void) | undefined;

/** Les clés que ce navigateur garde pour l'entreprise `e`. */
const clesDuCompte = (e: string) => [
  `brouillon-courant-${e}`,
  `draft-compte-${e}`,
  `vue-compte-${e}`,
  `kv-compte-${e}`,
  `import-local-${e}`,
];

const brouillon = { form: { id: 'F-1' }, appearance: {} };
const entreprise = defaultCompany();

/** Ce navigateur : le Studio sans compte, ce compte (miroir envoyé ou non), et un autre compte. */
async function remplir(miroirEnvoye: boolean): Promise<void> {
  await local.set('draft', brouillon);
  await local.set('company', entreprise);
  await local.put('clients', { uid: 'c-1', party: { name: 'Client local' } });
  await local.setFile('logo-local', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  for (const e of [E, AUTRE]) {
    await local.set(`brouillon-courant-${e}`, 'b-1');
    await local.set(`draft-compte-${e}`, { ...brouillon, envoye: e === E ? miroirEnvoye : true });
    await local.set(`vue-compte-${e}`, { ...brouillon, issued: 'f-1' });
    await local.set(`kv-compte-${e}`, { reglage: 1 });
    await local.set(`import-local-${e}`, { etat: 'fait', le: '2026-11-07T10:00:00.000Z' });
  }
}

/** Les valeurs de `cles` dans IndexedDB. */
const lire = (cles: string[]) => Promise.all(cles.map((cle) => local.get(cle)));

beforeEach(() => {
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('confirm', confirmer);
  auth.signOut.mockResolvedValue({ error: null });
  store.set((s) => ({
    ui: {
      ...s.ui,
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: E,
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    },
  }));
});

afterEach(async () => {
  arreter?.();
  arreter = undefined;
  utiliser(local);
  store.set({ ui: uiAvant, company: defaultCompany(), numbering: defaultNumbering() });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  const tout = (await local.dump()) as { kv: Record<string, unknown> };
  for (const cle of Object.keys(tout.kv)) await local.remove('kv', cle);
  await local.remove('clients', 'c-1');
  await local.remove('files', 'logo-local');
});

describe('se déconnecter efface de ce navigateur les données du compte', () => {
  test('tout est parti : les clés de ce compte s’en vont, le mode local et l’autre compte restent', async () => {
    await remplir(true);
    await deconnecter();
    expect(confirmer).not.toHaveBeenCalled();
    expect(await lire(clesDuCompte(E))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Le Studio sans compte garde tout.
    expect(await local.get('draft')).toEqual(brouillon);
    expect(await local.get('company')).toEqual(entreprise);
    expect(await local.list('clients')).toHaveLength(1);
    expect(await local.getFile('logo-local')).toBeDefined();
    // Un autre compte de ce navigateur aussi.
    expect((await lire(clesDuCompte(AUTRE))).every((v) => v !== undefined)).toBe(true);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(reload).toHaveBeenCalledOnce();
  });

  test('une saisie que le serveur n’a pas reçue : rien n’est effacé sans l’accord de l’utilisateur', async () => {
    await remplir(false);
    confirmer.mockReturnValue(false);
    await deconnecter();
    expect(confirmer).toHaveBeenCalledWith(
      t.compte.deconnexion.nonEnvoye([t.compte.deconnexion.elements.draft]),
    );
    // Refusé : la session reste ouverte, et rien ne quitte ce navigateur.
    expect((await lire(clesDuCompte(E))).every((v) => v !== undefined)).toBe(true);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    confirmer.mockReturnValue(true);
    await deconnecter();
    expect(await lire(clesDuCompte(E))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect((await lire(clesDuCompte(AUTRE))).every((v) => v !== undefined)).toBe(true);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  test('une écriture que le serveur n’a pas prise est dite, puis plus rien ne s’écrit', async () => {
    await remplir(true);
    const { p, journal } = conservationEnMemoire();
    // Le serveur ne répond pas : l'entreprise attend le retour du réseau.
    const set = p.set.bind(p);
    p.set = async (cle, valeur) => {
      if (cle === 'company') throw new ErreurConservation('RESEAU');
      return set(cle, valeur);
    };
    utiliser(p);
    store.set((s) => ({ ui: { ...s.ui, storage: 'ok' } }));
    arreter = startPersistence({ delai: 10 });
    const company = defaultCompany();
    company.seller.name = 'Atelier modifié';
    store.set({ company });
    confirmer.mockReturnValue(true);

    await deconnecter();
    expect(confirmer).toHaveBeenCalledWith(
      t.compte.deconnexion.nonEnvoye([t.compte.deconnexion.elements.company]),
    );
    expect(await lire(clesDuCompte(E))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // La conservation est arrêtée : une modification de plus (la numérotation, qu'elle aurait
    // écrite) ne part ni au serveur ni ici.
    const ecrites = journal.length;
    store.set((s) => ({ numbering: { ...s.numbering, next: s.numbering.next + 5 } }));
    await new Promise((fin) => setTimeout(fin, 50));
    expect(journal).toHaveLength(ecrites);
    expect(await local.get(`draft-compte-${E}`)).toBeUndefined();
  });
});
