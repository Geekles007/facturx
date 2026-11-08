/**
 * Le dialogue de connexion, sans DOM : les crochets de Preact sont remplacés, le composant appelé
 * comme une fonction, et l'arbre rendu parcouru (comme dans app.test.ts). La case des CGU, à
 * l'inscription, porte un nom accessible : le texte de son étiquette, et non sa valeur (« on »).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

/** Chaque `useId` rendu donne un identifiant distinct, comme Preact. */
let ids = 0;

vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    vi.fn(),
  ],
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useRef: (v: unknown) => ({ current: v }),
  useContext: (c: { __?: unknown }) => c.__,
  useId: () => `id-${++ids}`,
}));

const { Connexion } = await import('./connexion.js');
const { store, ui } = await import('../store.js');
const { t } = await import('../i18n.js');

type VNode = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Tous les nœuds de l'arbre rendu ; les composants (fonctions) sont rendus à leur tour. */
function* parcourir(n: unknown): Generator<VNode> {
  if (Array.isArray(n)) {
    for (const x of n) yield* parcourir(x);
    return;
  }
  if (!n || typeof n !== 'object' || !('props' in n)) return;
  const v = n as VNode;
  yield v;
  if (typeof v.type === 'function') {
    yield* parcourir((v.type as (p: unknown) => unknown)(v.props));
    return;
  }
  yield* parcourir(v.props.children);
  if (v.props.actions) yield* parcourir(v.props.actions);
}

/** Le texte d'un nœud et de ses enfants. */
function texte(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(texte).join('');
  if (!n || typeof n !== 'object' || !('props' in n)) return '';
  return texte((n as VNode).props.children);
}

const uiAvant = store.get().ui;
afterEach(() => store.set({ ui: uiAvant }));

describe('l’inscription', () => {
  test('la case des CGU est nommée par son étiquette', () => {
    ui({ connexion: 'inscription' });
    const noeuds = [...parcourir(Connexion())];
    const caseCgu = noeuds.find((v) => v.type === 'input' && v.props.type === 'checkbox');
    if (!caseCgu) throw new Error('case des CGU absente');
    const id = caseCgu.props['aria-labelledby'];
    expect(typeof id).toBe('string');
    const etiquette = noeuds.find((v) => v.props.id === id);
    expect(texte(etiquette)).toBe(`${t.compte.acceptBefore}${t.compte.acceptLink}`);
    expect(caseCgu.props['aria-required']).toBe('true');
  });
});
