/**
 * État du Studio : un seul objet, des mises à jour immuables par chemin, et une conservation
 * locale différée.
 *
 * Les chemins sont ceux des anomalies du SDK (`lines[2].unitPrice`) : le même texte désigne un
 * champ du formulaire, une zone de l'aperçu et une règle en échec.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type Appearance,
  type ClientRecord,
  type CompanyProfile,
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  type Numbering,
  type ProductRecord,
  type SavedInvoice,
} from './library.js';
import { blankForm, type InvoiceForm } from './model.js';
import { storage } from './storage.js';

export type Tab = 'content' | 'appearance' | 'check' | 'code';
export type LibraryTab = 'company' | 'clients' | 'products' | 'history' | 'numbering' | 'backup';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

export interface UiState {
  tab: Tab;
  /** Champ à atteindre : l'éditeur y fait défiler, l'ouvre s'il est replié, et le met en valeur. */
  focus: { path: string; nonce: number } | undefined;
  /** Zone survolée dans l'aperçu, ou champ survolé dans l'éditeur. */
  hover: string | undefined;
  /** Zoom de l'aperçu ; 0 : ajusté à la largeur. */
  zoom: number;
  library: LibraryTab | undefined;
  mobile: 'edit' | 'preview';
  toast: Toast | undefined;
  /** Conservation locale : en attente, active, ou indisponible (le Studio travaille en mémoire). */
  storage: 'pending' | 'ok' | 'memory';
  /** Facture de l'historique affichée : émise, donc en lecture seule. */
  issued: string | undefined;
  /** Première visite : l'exemple est affiché. */
  sample: boolean;
}

export interface StudioState {
  form: InvoiceForm;
  appearance: Appearance;
  company: CompanyProfile;
  numbering: Numbering;
  clients: ClientRecord[];
  products: ProductRecord[];
  history: SavedInvoice[];
  ui: UiState;
}

// ---------- chemins ----------

type Key = string | number;

export function parsePath(path: string): Key[] {
  const keys: Key[] = [];
  for (const part of path.split('.')) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      keys.push(part);
      continue;
    }
    if (match[1]) keys.push(match[1]);
    for (const index of (match[2] ?? '').matchAll(/\[(\d+)\]/g)) keys.push(Number(index[1]));
  }
  return keys;
}

export function getIn<T = unknown>(value: unknown, path: string): T {
  let node = value as Record<Key, unknown> | undefined;
  for (const key of parsePath(path)) {
    if (node === undefined || node === null) return undefined as T;
    node = node[key] as Record<Key, unknown> | undefined;
  }
  return node as T;
}

/** Copie de `value` où seul le chemin change ; le reste est partagé (les octets des pièces jointes aussi). */
export function setIn<T>(value: T, path: string, next: unknown): T {
  const keys = parsePath(path);
  const rec = (node: unknown, i: number): unknown => {
    if (i === keys.length) return next;
    const key = keys[i] as Key;
    const copy: Record<Key, unknown> = Array.isArray(node)
      ? ([...node] as unknown as Record<Key, unknown>)
      : { ...((node ?? {}) as Record<Key, unknown>) };
    copy[key] = rec((node as Record<Key, unknown> | undefined)?.[key], i + 1);
    return copy;
  };
  return rec(value, 0) as T;
}

export function updateIn<T, V>(value: T, path: string, fn: (current: V) => V): T {
  return setIn(value, path, fn(getIn<V>(value, path)));
}

// ---------- magasin ----------

const initialUi = (): UiState => ({
  tab: 'content',
  focus: undefined,
  hover: undefined,
  zoom: 0,
  library: undefined,
  mobile: 'edit',
  toast: undefined,
  storage: 'pending',
  issued: undefined,
  sample: false,
});

let state: StudioState = {
  form: blankForm(),
  appearance: defaultAppearance(),
  company: defaultCompany(),
  numbering: defaultNumbering(),
  clients: [],
  products: [],
  history: [],
  ui: initialUi(),
};

const listeners = new Set<() => void>();

export const store = {
  get: (): StudioState => state,
  set(update: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)): void {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Lit une partie de l'état ; le composant ne se redessine que si elle change. */
export function useStudio<T>(select: (s: StudioState) => T): T {
  const [value, setValue] = useState(() => select(state));
  const selectRef = useRef(select);
  selectRef.current = select;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const check = () => {
      const next = selectRef.current(state);
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        setValue(() => next);
      }
    };
    check();
    return store.subscribe(check);
  }, []);
  return value;
}

// ---------- actions courantes ----------

export const ui = (patch: Partial<UiState>): void =>
  store.set((s) => ({ ui: { ...s.ui, ...patch } }));

export const setForm = (path: string, value: unknown): void =>
  store.set((s) =>
    s.ui.issued ? {} : { form: setIn(s.form, path, value), ui: { ...s.ui, sample: false } },
  );

export function updateForm<V>(path: string, fn: (current: V) => V): void {
  store.set((s) =>
    s.ui.issued ? {} : { form: updateIn(s.form, path, fn), ui: { ...s.ui, sample: false } },
  );
}

export const setAppearance = (patch: Partial<Appearance>): void =>
  store.set((s) => ({ appearance: { ...s.appearance, ...patch } }));

let focusNonce = 0;
/** Conduit l'éditeur jusqu'à un champ (depuis l'aperçu, une anomalie, un raccourci). */
export function focusField(path: string, tab: Tab = 'content'): void {
  ui({ focus: { path, nonce: ++focusNonce }, tab, mobile: 'edit' });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const id = ++toastId;
  ui({ toast: { id, kind, text } });
  setTimeout(
    () => {
      if (store.get().ui.toast?.id === id) ui({ toast: undefined });
    },
    kind === 'error' ? 7000 : 3500,
  );
}

// ---------- conservation ----------

const KEYS = {
  draft: 'draft',
  company: 'company',
  numbering: 'numbering',
  appearance: 'appearance-default',
} as const;

export interface Loaded {
  draft?: { form: InvoiceForm; appearance: Appearance; issued?: string; sample?: boolean };
  company?: CompanyProfile;
  numbering?: Numbering;
  clients: ClientRecord[];
  products: ProductRecord[];
  history: SavedInvoice[];
}

export async function loadPersisted(): Promise<Loaded | undefined> {
  if (!(await storage.available())) return undefined;
  const [draft, company, numbering, clients, products, history] = await Promise.all([
    storage.get<Loaded['draft']>(KEYS.draft),
    storage.get<CompanyProfile>(KEYS.company),
    storage.get<Numbering>(KEYS.numbering),
    storage.list<ClientRecord>('clients'),
    storage.list<ProductRecord>('products'),
    storage.list<SavedInvoice>('invoices'),
  ]);
  const loaded: Loaded = { clients, products, history };
  if (draft) loaded.draft = draft;
  if (company) loaded.company = company;
  if (numbering) loaded.numbering = numbering;
  return loaded;
}

/** Écrit le brouillon, l'entreprise et la numérotation quand ils changent, avec un léger différé. */
export function startPersistence(): void {
  let previous = state;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const s = state;
    const writes: Promise<unknown>[] = [];
    if (
      s.form !== previous.form ||
      s.appearance !== previous.appearance ||
      s.ui.issued !== previous.ui.issued ||
      s.ui.sample !== previous.ui.sample
    ) {
      const draft: Loaded['draft'] = { form: s.form, appearance: s.appearance };
      if (s.ui.issued) draft.issued = s.ui.issued;
      // L'exemple reste signalé comme tel d'une visite à l'autre, tant qu'il n'a pas été modifié.
      if (s.ui.sample) draft.sample = true;
      writes.push(storage.set(KEYS.draft, draft));
    }
    if (s.company !== previous.company) writes.push(storage.set(KEYS.company, s.company));
    if (s.numbering !== previous.numbering) writes.push(storage.set(KEYS.numbering, s.numbering));
    previous = s;
    Promise.all(writes).catch(() => {
      if (state.ui.storage === 'ok') {
        ui({ storage: 'memory' });
      }
    });
  };
  store.subscribe(() => {
    if (state.ui.storage !== 'ok') return;
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  });
  addEventListener('pagehide', () => {
    if (state.ui.storage === 'ok') flush();
  });
}

export const persistKeys = KEYS;
