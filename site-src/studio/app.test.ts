/**
 * Le dialogue d'émission et le dépôt de fichier, sans DOM : les crochets de Preact sont remplacés,
 * les composants appelés comme des fonctions, et les gestionnaires repris dans l'arbre rendu. On ne
 * repère rien par l'ordre des crochets : la racine par son gestionnaire `onDrop`, le dialogue par son
 * nom, et l'état « occupé » par ce qu'il reçoit (le seul état passé à `true` pendant l'émission).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** Chaque `useState` rendu : sa valeur initiale et son setter espion. */
const etats: { valeur: unknown; set: ReturnType<typeof vi.fn> }[] = [];

vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => {
    const valeur = typeof init === 'function' ? (init as () => unknown)() : init;
    const set = vi.fn();
    etats.push({ valeur, set });
    return [valeur, set];
  },
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useRef: (v: unknown) => ({ current: v }),
  useContext: (c: { __?: unknown }) => c.__,
  useId: () => 'id',
  useReducer: (_r: unknown, init: unknown) => [init, vi.fn()],
}));

const issueInvoice = vi.fn();
vi.mock('./workflows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflows.js')>()),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
}));

const { App } = await import('./app.js');
const { store, ui } = await import('./store.js');

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
