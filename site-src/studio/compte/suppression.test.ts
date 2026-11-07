// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatDate, t } from '../i18n.js';
import { defaultAppearance, defaultNumbering } from '../library.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { setForm, startPersistence, store } from '../store.js';
import { emettreSurServeur } from './emission.js';
import { telechargerExport } from './export.js';
import { demarrer } from './index.js';
import { supabasePersistence } from './persistence.js';
import { aujourdhuiParis } from './suivi.js';
import {
  annulerSuppression,
  DELAI_GRACE_JOURS,
  datePurge,
  demanderSuppression,
  exportDeLaSession,
  peutSupprimer,
} from './suppression.js';
import { adminDeTest, compteDeTest, refusDeFonction } from './test-aide.js';

/**
 * Supprimer le compte en deux temps (spec § 12) : l'export imposé, la demande, puis l'annulation
 * pendant les 30 jours de grâce. Sans pile, ce que le Studio fait des réponses de `supprimer-compte` ;
 * contre la pile, avec les fonctions servies (`FACTURX_EMETTRE=1`), une vraie demande, ce qu'elle
 * ferme, et son annulation, puis l'annulation refusée d'une demande de plus de 30 jours.
 */

/** Le client de l'essai en cours : `suppression.ts`, `index.ts` et l'émission l'emploient par `client()`. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined as string | undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;
/** Les entreprises dont un essai a demandé la suppression : remises en règle à la fin de l'essai. */
const demandees = new Set<string>();
let arreter: (() => void) | undefined;

afterEach(async () => {
  arreter?.();
  arreter = undefined;
  session.sb = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store.set({ ui: uiAvant, history: [] });
  // Une demande laissée en place deviendrait échue dans 30 jours, et `purger` (les tests Deno de
  // `pnpm compte:test`) refuse de tourner tant qu'une entreprise échue n'est pas la sienne.
  const ids = [...demandees];
  demandees.clear();
  if (ids.length > 0) {
    const { error } = await adminDeTest()
      .from('entreprises')
      .update({ suppression_demandee_le: null })
      .in('id', ids);
    if (error) throw error;
  }
});

/** Un client factice dont `functions.invoke` rend `reponse`. */
function fonction(reponse: unknown) {
  const invoke = vi.fn(async () => {
    if (reponse instanceof Error) throw reponse;
    return reponse;
  });
  session.sb = { functions: { invoke } };
  return invoke;
}

describe('l’export imposé avant la demande', () => {
  test('sans export pendant cette session, la suppression ne se demande pas', () => {
    expect(peutSupprimer({})).toBe(false);
    expect(peutSupprimer({ exportFaitLe: '2026-11-07T10:00:00.000Z' })).toBe(true);
  });

  test('un export qui n’aboutit pas ne compte pas', async () => {
    // Sans conservation du compte, aucune archive n'est produite.
    expect(await telechargerExport()).toBe(false);
    expect(peutSupprimer(exportDeLaSession())).toBe(false);
  });

  test('la purge a lieu 30 jours après la demande', () => {
    expect(DELAI_GRACE_JOURS).toBe(30);
    expect(datePurge('2026-11-07T10:00:00.000Z')).toBe('2026-12-07');
    // Le jour de Paris : 23 h 30 UTC le 6 décembre, c'est déjà le 7 à Paris.
    expect(datePurge('2026-11-06T23:30:00.000Z')).toBe('2026-12-07');
  });
});

describe('les réponses de `supprimer-compte`', () => {
  test('demander : le corps attendu, la date rendue, et le compte qui la porte', async () => {
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1') } }));
    const invoke = fonction({ data: { suppressionDemandeeLe: '2026-11-07T10:00:00.000Z' } });
    expect(await demanderSuppression()).toBe('2026-11-07T10:00:00.000Z');
    expect(invoke).toHaveBeenCalledWith('supprimer-compte', { body: { action: 'demander' } });
    expect(store.get().ui.compte?.suppressionDemandeeLe).toBe('2026-11-07T10:00:00.000Z');
  });

  test('annuler : le compte ne porte plus de date', async () => {
    store.set((s) => ({
      ui: {
        ...s.ui,
        compte: { ...compteUi('e-1'), suppressionDemandeeLe: '2026-11-07T10:00:00.000Z' },
      },
    }));
    const invoke = fonction({ data: { suppressionDemandeeLe: null }, error: null });
    await annulerSuppression();
    expect(invoke).toHaveBeenCalledWith('supprimer-compte', { body: { action: 'annuler' } });
    expect(store.get().ui.compte?.suppressionDemandeeLe).toBeUndefined();
  });

  test('annuler passé 30 jours : 409 `SUPPRESSION`, dit dans la langue de l’interface', async () => {
    fonction(
      refusDeFonction(409, {
        code: 'SUPPRESSION',
        message: 'La suppression du compte a été demandée il y a plus de 30 jours.',
        details: { suppressionDemandeeLe: '2026-09-01T08:00:00.000Z' },
      }),
    );
    await expect(annulerSuppression()).rejects.toThrow(
      t.compte.suppression.tropTard(formatDate('2026-09-01')),
    );
  });

  test('session refusée : la connexion s’ouvre, et la phrase le dit', async () => {
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1') } }));
    fonction(refusDeFonction(401, { code: 'SESSION', message: 'Session absente.' }));
    await expect(demanderSuppression()).rejects.toThrow(t.compte.suppression.session);
    expect(store.get().ui.compte?.session).toBe('expiree');
    expect(store.get().ui.connexion).toBe('connexion');
  });

  test('sans réponse : rien n’a changé, réessayer', async () => {
    fonction({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    await expect(annulerSuppression()).rejects.toThrow(t.compte.suppression.reseau);
    fonction(new TypeError('Failed to fetch'));
    await expect(demanderSuppression()).rejects.toThrow(t.compte.suppression.reseau);
  });

  test('les autres refus passent par les phrases du § 13', async () => {
    fonction(refusDeFonction(403, { code: 'DROITS', message: 'Pas membre.' }));
    await expect(demanderSuppression()).rejects.toThrow(t.compte.erreurs.droits);
    fonction(
      refusDeFonction(500, { code: 'INTERNE', message: 'Erreur.', details: { requete: 'r-1' } }),
    );
    await expect(demanderSuppression()).rejects.toThrow(t.compte.erreurs.interne('r-1'));
  });
});

// ---------- contre la pile ----------

const pile = !process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1';

describe.skipIf(pile)('la suppression contre la pile, fonctions servies', () => {
  /** Le Studio connecté au compte de l'essai, l'exemple du jour à l'écran, enregistré au délai d'une seconde. */
  async function studioConnecte() {
    const { sb, entrepriseId } = await compteDeTest();
    session.sb = sb as SupabaseClient;
    const p = supabasePersistence(sb, entrepriseId);
    const numbering = (await p.get<ReturnType<typeof defaultNumbering>>('numbering')) ?? {
      ...defaultNumbering(),
    };
    const fenetre = new EventTarget();
    vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
    vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
    utiliser(p);
    store.set((s) => ({
      form: sampleForm(aujourdhuiParis()),
      appearance: defaultAppearance(),
      numbering,
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
      },
    }));
    arreter = startPersistence({ delai: 1000 });
    return { sb: sb as SupabaseClient, entrepriseId };
  }

  /** La date de la demande, telle que la base la garde. */
  async function dateEnBase(entrepriseId: string): Promise<string | null> {
    const { data, error } = await adminDeTest()
      .from('entreprises')
      .select('suppression_demandee_le')
      .eq('id', entrepriseId)
      .single<{ suppression_demandee_le: string | null }>();
    if (error) throw error;
    return data.suppression_demandee_le;
  }

  test('après une demande, `emettre` répond 403 SUPPRESSION et demarrer() la rend ; après l’annulation, tout redevient normal', async () => {
    const { sb, entrepriseId } = await studioConnecte();
    demandees.add(entrepriseId);

    const le = await demanderSuppression();
    const enBase = await dateEnBase(entrepriseId);
    expect(enBase && new Date(enBase).getTime()).toBe(new Date(le).getTime());
    // Une seconde demande ne repousse pas le délai.
    expect(new Date(await demanderSuppression()).getTime()).toBe(new Date(le).getTime());

    const refus = await sb.functions.invoke('emettre', { body: {} });
    expect(refus.error).toBeInstanceOf(FunctionsHttpError);
    const reponse = (refus.error as FunctionsHttpError).context as Response;
    expect(reponse.status).toBe(403);
    expect(((await reponse.json()) as { code: string }).code).toBe('SUPPRESSION');

    const compte = await demarrer();
    expect(compte?.entrepriseId).toBe(entrepriseId);
    expect(compte?.suppressionDemandeeLe && new Date(compte.suppressionDemandeeLe).getTime()).toBe(
      new Date(le).getTime(),
    );

    await annulerSuppression();
    expect(await dateEnBase(entrepriseId)).toBeNull();
    expect((await demarrer())?.suppressionDemandeeLe).toBeUndefined();
    // `demarrer` a remis une conservation neuve derrière `storage` : le Studio émet de nouveau.
    arreter?.();
    await studioConnecteSur(sb, entrepriseId);
    setForm('buyer.name', 'Client après annulation');
    expect(await emettreSurServeur()).toBe(true);
    expect(store.get().history[0]?.summary.id).toBe(`F-${aujourdhuiParis().slice(0, 4)}-0001`);
  }, 30_000);

  test('annuler une demande de plus de 30 jours : 409, dit ; la demande reste', async () => {
    const { entrepriseId } = await studioConnecte();
    demandees.add(entrepriseId);
    const anciennete = new Date(Date.now() - (DELAI_GRACE_JOURS + 1) * 86_400_000).toISOString();
    const { error } = await adminDeTest()
      .from('entreprises')
      .update({ suppression_demandee_le: anciennete })
      .eq('id', entrepriseId);
    if (error) throw error;

    await expect(annulerSuppression()).rejects.toThrow(
      t.compte.suppression.tropTard(formatDate(aujourdhuiParis(new Date(anciennete)))),
    );
    const enBase = await dateEnBase(entrepriseId);
    expect(enBase && new Date(enBase).getTime()).toBe(new Date(anciennete).getTime());
  }, 30_000);

  /** Le même compte, de nouveau à l'écran, sur la conservation que `demarrer` a posée. */
  async function studioConnecteSur(sb: SupabaseClient, entrepriseId: string) {
    const p = supabasePersistence(sb, entrepriseId);
    utiliser(p);
    const numbering = await p.get<ReturnType<typeof defaultNumbering>>('numbering');
    store.set((s) => ({
      form: sampleForm(aujourdhuiParis()),
      appearance: defaultAppearance(),
      ...(numbering ? { numbering } : {}),
      history: [],
      ui: { ...s.ui, storage: 'ok', compte: compteUi(entrepriseId), toast: undefined },
    }));
    arreter = startPersistence({ delai: 1000 });
  }
});
