/**
 * État du Studio : un seul objet, des mises à jour immuables par chemin, et une conservation
 * différée (IndexedDB, ou le serveur en mode compte).
 *
 * Les chemins sont ceux des anomalies du SDK (`lines[2].unitPrice`) : le même texte désigne un
 * champ du formulaire, une zone de l'aperçu et une règle en échec.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './i18n.js';
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
import { ErreurConservation } from './persistence.js';
import { storage } from './storage.js';

export type Tab = 'content' | 'appearance' | 'check' | 'code';
export type LibraryTab = 'company' | 'clients' | 'products' | 'history' | 'numbering' | 'backup';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

/** Le compte connecté, tel que `compte/demarrer` l'a relevé sur le serveur. */
export interface CompteUi {
  email: string;
  /** Adresse confirmée ; le serveur refuse d'émettre tant qu'elle ne l'est pas. */
  confirme: boolean;
  entrepriseId: string;
  /** Date de la demande de suppression du compte (délai de grâce en cours), sinon rien. */
  suppressionDemandeeLe: string | undefined;
  /** `expiree` : le serveur a refusé le jeton ; la saisie reste en local jusqu'à la reconnexion. */
  session: 'active' | 'expiree';
}

/** Volet du dialogue de connexion. */
export type VoletConnexion = 'connexion' | 'inscription' | 'oubli';

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
  /** Défini quand une session a été restaurée au démarrage ; sans lui, le Studio est local. */
  compte: CompteUi | undefined;
  /**
   * Les écritures sur le serveur passent-elles ? Sans compte, toujours `ok`. Hors ligne, la saisie
   * reste dans IndexedDB et la dernière écriture de chaque clé repart au retour du réseau.
   */
  reseau: 'ok' | 'hors-ligne';
  /**
   * Le brouillon a été enregistré ailleurs (autre onglet, autre appareil) depuis sa lecture : le
   * serveur a refusé d'écrire sur une version périmée. Rien n'est rechargé sans l'utilisateur.
   */
  conflit: boolean;
  /** Volet du dialogue de connexion ouvert, ou rien. */
  connexion: VoletConnexion | undefined;
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
  compte: undefined,
  reseau: 'ok',
  conflit: false,
  connexion: undefined,
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
/** Affiche un message ; `duration` (ms) prolonge celui d'un texte long, qui ne se lit pas en 3 s. */
export function toast(text: string, kind: Toast['kind'] = 'ok', duration?: number): void {
  const id = ++toastId;
  ui({ toast: { id, kind, text } });
  setTimeout(
    () => {
      if (store.get().ui.toast?.id === id) ui({ toast: undefined });
    },
    duration ?? (kind === 'error' ? 7000 : 3500),
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

/** Délai d'enregistrement après la dernière modification : 400 ms en local, 1 000 en mode compte. */
export const DELAI_LOCAL_MS = 400;
export const DELAI_COMPTE_MS = 1000;

/** Écrit tout de suite ce qui attend le délai ; défini tant que la conservation tourne. */
let enregistrerEnAttente: (() => Promise<void>) | undefined;

/**
 * Écrit sans attendre le délai ce qui a changé (avant d'ouvrir un autre brouillon, avant
 * d'émettre), et attend la réponse. Ne lève pas : un échec suit le chemin de l'enregistrement
 * différé.
 */
export function enregistrerMaintenant(): Promise<void> {
  return enregistrerEnAttente?.() ?? Promise.resolve();
}

/** Le message d'un enregistrement que le serveur refuse. */
function messageDeRefus(erreur: unknown): string {
  const phrases = t.compte.conservation;
  if (erreur instanceof ErreurConservation) {
    if (erreur.detail === 'NUMEROTATION_RECUL') return phrases.recul;
    if (erreur.code === 'FICHIER') return phrases.fichier;
  }
  return phrases.refus;
}

/**
 * Écrit le brouillon, l'entreprise et la numérotation quand ils changent, `delai` ms après la
 * dernière modification (400 par défaut). Rend de quoi arrêter.
 *
 * Sans compte, un échec fait passer le Studio en mémoire, comme toujours. Avec un compte, la
 * conservation dit pourquoi une écriture n'est pas passée (`ErreurConservation`) :
 *   - réseau : `ui.reseau = 'hors-ligne'` ; la dernière valeur de chaque clé est gardée, et repart
 *     à l'évènement `online`, une fois (pas de boucle de nouveaux essais) ;
 *   - session : `ui.compte.session = 'expiree'`, et la connexion s'ouvre, une seule fois ; la
 *     valeur est gardée, et repart quand la session redevient active ;
 *   - conflit : `ui.conflit = true` ; rien ne repart ni ne se recharge sans l'utilisateur ;
 *   - refus (4xx) : un message, et rien ne repart.
 * Dans tous ces cas, le miroir local du brouillon (`compte/persistence.ts`) garde la saisie.
 */
export function startPersistence(options: { delai?: number } = {}): () => void {
  const delai = options.delai ?? DELAI_LOCAL_MS;
  let previous = state;
  let vu = state;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** La dernière valeur soumise pour chaque clé : seule son issue compte. */
  const derniere = new Map<string, unknown>();
  /** Ce qui reste à écrire après une coupure du réseau ou une session expirée. */
  const enAttente = new Map<string, unknown>();

  const echec = (cle: string, valeur: unknown, erreur: unknown): void => {
    const compte = state.ui.compte;
    if (!compte) {
      if (state.ui.storage === 'ok') ui({ storage: 'memory' });
      return;
    }
    const code = erreur instanceof ErreurConservation ? erreur.code : 'REFUS';
    const actuelle = derniere.get(cle) === valeur;
    if (code === 'RESEAU' || code === 'SESSION') {
      if (actuelle) enAttente.set(cle, valeur);
      if (code === 'RESEAU') {
        if (state.ui.reseau !== 'hors-ligne') ui({ reseau: 'hors-ligne' });
      } else if (compte.session === 'active') {
        ui({ compte: { ...compte, session: 'expiree' }, connexion: 'connexion' });
      }
      return;
    }
    if (actuelle) enAttente.delete(cle);
    if (code === 'BROUILLON_MODIFIE') {
      if (!state.ui.conflit) ui({ conflit: true });
      return;
    }
    const texte = messageDeRefus(erreur);
    if (state.ui.toast?.text !== texte) toast(texte, 'error');
  };

  const ecrire = async (cle: string, valeur: unknown): Promise<void> => {
    try {
      await storage.set(cle, valeur);
      if (derniere.get(cle) === valeur) enAttente.delete(cle);
      if (state.ui.reseau === 'hors-ligne') ui({ reseau: 'ok' });
    } catch (erreur) {
      echec(cle, valeur, erreur);
    }
  };

  const soumettre = (cle: string, valeur: unknown): Promise<void> => {
    derniere.set(cle, valeur);
    return ecrire(cle, valeur);
  };

  /** Écrit ce qui a changé entre le dernier état écrit et `s`. */
  const flush = (s: StudioState = state): Promise<unknown> => {
    clearTimeout(timer);
    timer = undefined;
    const writes: Promise<void>[] = [];
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
      writes.push(soumettre(KEYS.draft, draft));
    }
    if (s.company !== previous.company) writes.push(soumettre(KEYS.company, s.company));
    if (s.numbering !== previous.numbering) writes.push(soumettre(KEYS.numbering, s.numbering));
    previous = s;
    return Promise.all(writes);
  };

  /** Renvoie ce qui attend, une clé après l'autre ; s'arrête si le réseau ou la session manque. */
  let rejeu: Promise<void> | undefined;
  const rejouer = (): Promise<void> => {
    rejeu ??= (async () => {
      try {
        for (const [cle, valeur] of [...enAttente]) {
          if (state.ui.compte?.session === 'expiree') return;
          if (enAttente.get(cle) !== valeur) continue;
          await ecrire(cle, valeur);
          if (state.ui.reseau === 'hors-ligne') return;
        }
      } finally {
        rejeu = undefined;
      }
    })();
    return rejeu;
  };

  const desabonner = store.subscribe(() => {
    const s = state;
    const avant = vu;
    vu = s;
    // Reconnecté après une session expirée : ce que le serveur avait refusé repart.
    if (avant.ui.compte?.session === 'expiree' && s.ui.compte?.session === 'active') {
      void rejouer();
    }
    if (s.ui.storage !== 'ok') return;
    const document =
      s.form !== avant.form ||
      s.appearance !== avant.appearance ||
      s.company !== avant.company ||
      s.numbering !== avant.numbering ||
      s.ui.issued !== avant.ui.issued ||
      s.ui.sample !== avant.ui.sample;
    // Le reste (survol, onglet, message) ne repousse pas l'enregistrement.
    if (!document) return;
    // Une facture émise ouverte remplace la saisie : ce qui attendait le délai part avant elle.
    if (timer !== undefined && s.ui.issued !== avant.ui.issued) void flush(avant);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delai);
  });

  const auDepart = (): void => {
    if (state.ui.storage === 'ok') void flush();
  };
  const auRetour = (): void => void rejouer();
  // Hors d'un navigateur (tests), pas d'évènements de fenêtre.
  globalThis.addEventListener?.('pagehide', auDepart);
  globalThis.addEventListener?.('online', auRetour);

  enregistrerEnAttente = async () => {
    if (state.ui.storage === 'ok') await flush();
  };

  return () => {
    desabonner();
    clearTimeout(timer);
    globalThis.removeEventListener?.('pagehide', auDepart);
    globalThis.removeEventListener?.('online', auRetour);
    enregistrerEnAttente = undefined;
  };
}

export const persistKeys = KEYS;
