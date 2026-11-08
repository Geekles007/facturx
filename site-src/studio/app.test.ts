/**
 * Le dialogue d'émission et le dépôt de fichier, sans DOM : les crochets de Preact sont remplacés,
 * les composants appelés comme des fonctions, et les gestionnaires repris dans l'arbre rendu. On ne
 * repère rien par l'ordre des crochets : la racine par son gestionnaire `onDrop`, le dialogue par son
 * nom, et l'état « occupé » par ce qu'il reçoit (le seul état passé à `true` pendant l'émission).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** Chaque `useState` rendu : sa valeur initiale et son setter espion. */
const etats: { valeur: unknown; set: ReturnType<typeof vi.fn> }[] = [];
/** Chaque `useEffect` rendu, gardé sans être lancé : un test le lance s'il le veut. */
const effets: (() => unknown)[] = [];
/** Les valeurs que prendront les prochains `useState`, à la place de leur valeur initiale. */
const forces: { valeur: unknown }[] = [];

vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => {
    const force = forces.shift();
    const valeur = force
      ? force.valeur
      : typeof init === 'function'
        ? (init as () => unknown)()
        : init;
    const set = vi.fn();
    etats.push({ valeur, set });
    return [valeur, set];
  },
  useEffect: (effet: () => unknown) => {
    effets.push(effet);
  },
  useLayoutEffect: () => undefined,
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useRef: (v: unknown) => ({ current: v }),
  useContext: (c: { __?: unknown }) => c.__,
  useId: () => 'id',
  useReducer: (_r: unknown, init: unknown) => [init, vi.fn()],
}));

// La navigation du compte ne se charge pas (réseau coupé) : seul l'effet qui l'importe la demande.
vi.mock('./compte/navigation.js', () => {
  throw new Error('chargement impossible');
});
// Le module des brouillons non plus : seuls les boutons des bandeaux de conflit le demandent.
vi.mock('./compte/brouillons.js', () => {
  throw new Error('chargement impossible');
});

// L'enregistrement qui précède un rechargement de la page : on en tient l'issue.
const enregistrer = vi.fn(async () => true);
vi.mock('./store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.js')>()),
  enregistrerMaintenant: () => enregistrer(),
}));

const issueInvoice = vi.fn();
vi.mock('./workflows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflows.js')>()),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
}));

const { App } = await import('./app.js');
const { store, ui } = await import('./store.js');
const { t } = await import('./i18n.js');

type VNode = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Tous les nœuds de l'arbre rendu, y compris ceux passés en `actions`. */
function* parcourir(n: unknown): Generator<VNode> {
  if (Array.isArray(n)) {
    for (const x of n) yield* parcourir(x);
    return;
  }
  if (!n || typeof n !== 'object' || !('props' in n)) return;
  const v = n as VNode;
  yield v;
  yield* parcourir(v.props.children);
  if (v.props.actions) yield* parcourir(v.props.actions);
}

/** Le conteneur du Studio : celui qui reçoit les fichiers déposés. */
function racine(): VNode {
  for (const v of parcourir(App())) if (v.type === 'div' && v.props.onDrop) return v;
  throw new Error('racine absente');
}

const uiAvant = store.get().ui;

beforeEach(() => {
  etats.length = 0;
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  store.set({ ui: uiAvant });
  issueInvoice.mockReset();
  enregistrer.mockClear();
  forces.length = 0;
  vi.unstubAllGlobals();
});

describe('un fichier déposé pendant l’émission', () => {
  test('retenu au survol et au dépôt (le navigateur ne l’ouvre pas), et rien ne s’ouvre', () => {
    ui({ emissionEnCours: true });
    const div = racine();
    const surDrag = vi.fn();
    (div.props.onDragOver as (e: unknown) => void)({
      dataTransfer: { types: ['Files'] },
      preventDefault: surDrag,
    });
    expect(surDrag).toHaveBeenCalledTimes(1);
    // La zone de dépôt ne s'affiche pas : aucun état ne passe à `true`.
    for (const e of etats) expect(e.set).not.toHaveBeenCalledWith(true);
    const surDrop = vi.fn();
    const lire = vi.fn(async () => new ArrayBuffer(0));
    (div.props.onDrop as (e: unknown) => void)({
      dataTransfer: { files: [{ name: 'x.pdf', arrayBuffer: lire }] },
      preventDefault: surDrop,
    });
    expect(surDrop).toHaveBeenCalledTimes(1);
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(lire).not.toHaveBeenCalled();
  });

  test('hors émission, le dépôt ouvre le fichier (témoin)', async () => {
    const div = racine();
    const lire = vi.fn(async () => new ArrayBuffer(0));
    (div.props.onDrop as (e: unknown) => void)({
      dataTransfer: { files: [{ name: 'x.pdf', arrayBuffer: lire }] },
      preventDefault: vi.fn(),
    });
    await vi.waitFor(() => expect(lire).toHaveBeenCalled());
  });
});

describe('la navigation du compte remplace le bouton Bibliothèque', () => {
  /** La barre du haut, rendue. */
  function barre(): VNode[] {
    for (const v of parcourir(App())) {
      if (typeof v.type === 'function' && (v.type as { name: string }).name === 'TopBar')
        return [...parcourir((v.type as (p: unknown) => unknown)(v.props))];
    }
    throw new Error('TopBar absente');
  }
  const nom = (v: VNode) => (typeof v.type === 'function' ? (v.type as { name: string }).name : '');
  const bibliotheque = (noeuds: VNode[]) => noeuds.filter((v) => nom(v) === 'BoutonBibliotheque');
  const navigation = (noeuds: VNode[]) => noeuds.filter((v) => nom(v) === 'NavigationALaDemande');
  /** Le composant `v`, rendu. */
  const rendre = (v: VNode | undefined): VNode[] =>
    v ? [...parcourir((v.type as (p: unknown) => unknown)(v.props))] : [];

  test('sans compte : le bouton Bibliothèque, comme toujours, et aucune navigation', () => {
    ui({ compte: undefined });
    const noeuds = barre();
    expect(bibliotheque(noeuds)).toHaveLength(1);
    expect(navigation(noeuds)).toHaveLength(0);
    const [bouton] = rendre(bibliotheque(noeuds)[0]);
    if (!bouton) throw new Error('bouton absent');
    expect(bouton.props.title).toBe(t.app.library);
    (bouton.props.onClick as () => void)();
    expect(store.get().ui.library).toBe('company');
  });

  test('connecté : la navigation à sa place ; la bibliothèque, le temps de la charger', () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    });
    const noeuds = barre();
    expect(navigation(noeuds)).toHaveLength(1);
    expect(bibliotheque(noeuds)).toHaveLength(0);
    // Avant que son module ne soit chargé, la navigation laisse la bibliothèque à sa place.
    expect(bibliotheque(rendre(navigation(noeuds)[0]))).toHaveLength(1);
  });

  test('la navigation ne se charge pas : recharger la page, après avoir enregistré la saisie', async () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    });
    const nav = navigation(barre())[0];
    etats.length = 0;
    effets.length = 0;
    // La bibliothèque reste à sa place pendant ce temps.
    expect(bibliotheque(rendre(nav))).toHaveLength(1);
    const [, echec] = etats;
    expect(echec?.valeur).toBe(false);
    for (const effet of effets) effet();
    await vi.waitFor(() => expect(store.get().ui.toast?.text).toBe(t.compte.navigation.chargement));
    // L'échec est retenu : la barre garde de quoi recharger quand le message est parti.
    expect(echec?.set).toHaveBeenCalledWith(true);
    const action = store.get().ui.toast?.action;
    expect(action?.label).toBe(t.compte.conservation.rechargerPage);
    // Un nouvel `import()` échouerait aussitôt : la page se recharge, une fois la saisie partie.
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    let enregistree: (fait: boolean) => void = () => undefined;
    enregistrer.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          enregistree = r;
        }),
    );
    const rechargement = action?.run();
    await vi.waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();
    enregistree(true);
    await rechargement;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('tant que la navigation n’est pas chargée, la barre garde « Recharger la page »', async () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    });
    const nav = navigation(barre())[0];
    // Rendue après l'échec : pas de navigation, la bibliothèque, et le bouton de rechargement.
    forces.push({ valeur: undefined }, { valeur: true });
    const noeuds = rendre(nav);
    expect(forces).toEqual([]);
    expect(bibliotheque(noeuds)).toHaveLength(1);
    const bouton = noeuds.find((v) => v.props.title === t.compte.conservation.rechargerPage);
    if (!bouton) throw new Error('bouton de rechargement absent');
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    await (bouton.props.onClick as () => Promise<void>)();
    expect(enregistrer).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    // Avant tout échec, rien de tel.
    expect(rendre(nav).some((v) => v.props.title === t.compte.conservation.rechargerPage)).toBe(
      false,
    );
  });
});

describe('le module des brouillons ne se charge pas', () => {
  test('le bandeau de conflit le dit, en nommant ce module, et propose de recharger la page', async () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
      conflit: true,
      issued: undefined,
      sample: false,
    });
    let bandeaux: VNode | undefined;
    for (const v of parcourir(App())) {
      if (typeof v.type === 'function' && (v.type as { name: string }).name === 'Banners') {
        for (const w of parcourir((v.type as (p: unknown) => unknown)(v.props))) {
          if (typeof w.type === 'function' && (w.type as { name: string }).name === 'CompteBanners')
            bandeaux = w;
        }
      }
    }
    if (!bandeaux) throw new Error('CompteBanners absent');
    const noeuds = [...parcourir((bandeaux.type as (p: unknown) => unknown)(bandeaux.props))];
    const recharger = noeuds.find((v) => v.props.children === t.compte.conservation.recharger);
    if (!recharger) throw new Error('bouton absent');
    (recharger.props.onClick as () => void)();
    await vi.waitFor(() =>
      expect(store.get().ui.toast?.text).toBe(t.compte.brouillons.moduleNonCharge),
    );
    expect(store.get().ui.toast?.text).not.toBe(t.compte.errors.loadFailed);
    expect(store.get().ui.toast?.action?.label).toBe(t.compte.conservation.rechargerPage);
  });
});

describe('le pied de l’éditeur dit où sont les données, selon le mode', () => {
  /** Le premier paragraphe du pied de l'éditeur, rendu : celui qui parle des données. */
  function pied(): string {
    // Le lien vers les licences des polices se résout contre l'adresse de la page.
    vi.stubGlobal('document', { baseURI: 'http://127.0.0.1/studio/', body: { dataset: {} } });
    for (const v of parcourir(App())) {
      if (typeof v.type !== 'function' || (v.type as { name: string }).name !== 'ContentEditor') {
        continue;
      }
      for (const n of parcourir((v.type as (p: unknown) => unknown)(v.props))) {
        if (n.type !== 'footer') continue;
        for (const p of parcourir(n)) if (p.type === 'p') return String(p.props.children);
      }
    }
    throw new Error('pied absent');
  }

  test('sans compte : rien ne quitte ce navigateur', () => {
    ui({ compte: undefined });
    expect(pied()).toBe(t.app.footPrivacy);
  });

  test('connecté : le pied dit le serveur, et ne promet pas que rien ne quitte le navigateur', () => {
    ui({
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    });
    expect(pied()).toBe(t.app.footPrivacyCompte);
    expect(t.app.footPrivacyCompte).not.toBe(t.app.footPrivacy);
    expect(t.app.footPrivacyCompte).not.toMatch(/quitte|leaves/);
  });
});

describe('le dialogue d’émission', () => {
  test('une exception de l’émission : le dialogue redevient fermable (occupé, puis libre)', async () => {
    let dialogue: VNode | undefined;
    for (const v of parcourir(App())) {
      if (typeof v.type === 'function' && (v.type as { name: string }).name === 'IssueDialog')
        dialogue = v;
    }
    if (!dialogue) throw new Error('IssueDialog absent');
    etats.length = 0;
    const rendu = (dialogue.type as (p: unknown) => unknown)({
      ...dialogue.props,
      derived: { ...(dialogue.props.derived as object), assets: {} },
    });
    let confirmer: (() => Promise<void>) | undefined;
    for (const v of parcourir(rendu)) {
      if (v.props.variant === 'primary') confirmer = v.props.onClick as () => Promise<void>;
    }
    if (!confirmer) throw new Error('bouton absent');
    issueInvoice.mockRejectedValue(new Error('boum'));
    await expect(confirmer()).rejects.toThrow('boum');
    // L'état « occupé » : celui qui est passé à `true` au clic ; il doit finir à `false`.
    const occupes = etats.filter((e) => e.set.mock.calls.some(([v]) => v === true));
    expect(occupes).toHaveLength(1);
    expect(occupes[0]?.set.mock.calls.at(-1)).toEqual([false]);
  });
});
