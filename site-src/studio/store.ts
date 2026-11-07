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
  fill,
  hydrateForm,
  type Numbering,
  type ProductRecord,
  type SavedInvoice,
} from './library.js';
import { blankForm, type InvoiceForm } from './model.js';
import { ErreurConservation, estDuCompte } from './persistence.js';
import { sampleForm } from './sample.js';
import { storage } from './storage.js';

export type Tab = 'content' | 'appearance' | 'check' | 'code';
export type LibraryTab = 'company' | 'clients' | 'products' | 'history' | 'numbering' | 'backup';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
  /** Ce que le message propose de faire (renvoyer la confirmation, par exemple). */
  action?: { label: string; run: () => Promise<void> } | undefined;
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
  /**
   * Conservation : en attente, active, ou indisponible (le Studio travaille en mémoire). En mode
   * compte, `injoignable` : le serveur n'a pas répondu au démarrage ; rien n'est lu ni envoyé, la
   * saisie reste dans le miroir local jusqu'au rechargement.
   */
  storage: 'pending' | 'ok' | 'memory' | 'injoignable';
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
   * serveur a refusé d'écrire sur une version périmée (`true`), ou il n'existe plus, supprimé
   * ailleurs (`'supprime'`). Rien n'est rechargé ni recréé sans l'utilisateur.
   */
  conflit: boolean | 'supprime';
  /**
   * Le serveur refuse le brouillon (4xx autre qu'un conflit) : la cause, telle qu'il la donne.
   * Le Studio le dit et propose d'abandonner la saisie ; sans quoi on ne quitte pas ce brouillon.
   */
  brouillonRefuse: string | undefined;
  /** Volet du dialogue de connexion ouvert, ou rien. */
  connexion: VoletConnexion | undefined;
  /**
   * Les anomalies que le serveur a relevées à l'émission (422), avec le formulaire et l'apparence
   * envoyés : l'onglet Contrôle les montre tant que l'écran montre ces objets-là, pas au-delà.
   */
  refusServeur: RefusServeur | undefined;
  /**
   * Une émission est en cours (mode compte) : le document affiché part au serveur tel quel. Rien
   * ne s'y tape, et l'éditeur est inerte, jusqu'à la réponse.
   */
  emissionEnCours: boolean;
  /**
   * La facture à relancer (mode compte) : « Relancer » la pose, pour le dialogue de relance, qui la
   * lit. Rien d'autre ne s'en sert.
   */
  relance: string | undefined;
}

/** Ce que le serveur a refusé d'émettre, et pourquoi (des `Issue` du SDK, et les siennes). */
export interface RefusServeur {
  form: InvoiceForm;
  appearance: Appearance;
  issues: { code: string; path: string; message: string }[];
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
  brouillonRefuse: undefined,
  connexion: undefined,
  refusServeur: undefined,
  emissionEnCours: false,
  relance: undefined,
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

/**
 * Taper sur l'exemple en fait une saisie : en mode compte, elle commence un nouveau brouillon,
 * jamais celui que l'exemple recouvrait.
 */
function avantDeTaper(): void {
  if (state.ui.sample && !state.ui.issued && estDuCompte(storage)) storage.saisieSurLExemple();
}

/**
 * Pendant une émission, le document ne change pas : ce que le serveur numérote est ce qui était à
 * l'écran au moment de confirmer, et une frappe partie entre-temps viserait un brouillon supprimé.
 */
const figee = (): boolean => state.ui.emissionEnCours;

export const setForm = (path: string, value: unknown): void => {
  if (figee()) return;
  avantDeTaper();
  store.set((s) =>
    s.ui.issued ? {} : { form: setIn(s.form, path, value), ui: { ...s.ui, sample: false } },
  );
};

export function updateForm<V>(path: string, fn: (current: V) => V): void {
  if (figee()) return;
  avantDeTaper();
  store.set((s) =>
    s.ui.issued ? {} : { form: updateIn(s.form, path, fn), ui: { ...s.ui, sample: false } },
  );
}

export const setAppearance = (patch: Partial<Appearance>): void => {
  if (figee()) return;
  store.set((s) => ({ appearance: { ...s.appearance, ...patch } }));
};

/**
 * Les réglages de l'onglet Apparence qu'atteint un chemin `appearance.*` des anomalies du serveur :
 * le `data-field` de leur section. Un autre réglage ouvre l'onglet sans rien viser.
 */
const REGLAGES: Record<string, string> = {
  logo: 'logo',
  font: 'font',
  customFont: 'font',
  footer: 'footer',
};

/** Vrai si `path` désigne un champ du formulaire (sa racine en est une clé). */
export function estUnChamp(path: string): boolean {
  const racine = path.split(/[.[]/)[0] ?? '';
  return racine !== '' && Object.hasOwn(state.form, racine);
}

let focusNonce = 0;
/**
 * Conduit l'éditeur jusqu'à un champ (depuis l'aperçu, une anomalie, un raccourci). En mode compte,
 * les anomalies du serveur s'y ajoutent : un chemin de l'apparence (`appearance.font`) mène à
 * l'onglet Apparence ; un chemin vide, ou qui ne désigne aucun champ du formulaire (`brouillonId`,
 * `invoice`), à l'onglet Contrôle, sans rien viser. Vers l'onglet Contrôle, `path` désigne
 * l'anomalie de ce chemin.
 */
export function focusField(path: string, tab: Tab = 'content'): void {
  // Sans compte, aucun chemin ne vient du serveur : rien ne change.
  if (!state.ui.compte) {
    ui({ focus: { path, nonce: ++focusNonce }, tab, mobile: 'edit' });
    return;
  }
  const apparence = /^appearance(?:\.([^.[]+))?/.exec(path);
  const [onglet, cible]: [Tab, string | undefined] =
    tab === 'check' || path === ''
      ? ['check', path || undefined]
      : apparence
        ? ['appearance', REGLAGES[apparence[1] ?? '']]
        : tab === 'content' && !estUnChamp(path)
          ? ['check', undefined]
          : [tab, path];
  ui({
    focus: cible ? { path: cible, nonce: ++focusNonce } : undefined,
    tab: onglet,
    mobile: 'edit',
  });
}

let toastId = 0;
/**
 * Affiche un message ; `duration` (ms) prolonge celui d'un texte long, qui ne se lit pas en 3 s.
 * `action` : un bouton dans le message, qui le ferme et fait ce qu'il dit.
 */
export function toast(
  text: string,
  kind: Toast['kind'] = 'ok',
  duration?: number,
  action?: Toast['action'],
): void {
  const id = ++toastId;
  ui({ toast: { id, kind, text, action } });
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

/**
 * Relit ce qui est conservé. `{ brouillon: false }` laisse le brouillon de côté (la reprise après un
 * serveur injoignable le lit à part, pour pouvoir renoncer à l'ouvrir).
 */
export async function loadPersisted(
  options: { brouillon?: boolean } = {},
): Promise<Loaded | undefined> {
  if (!(await storage.available())) return undefined;
  const [draft, company, numbering, clients, products, history] = await Promise.all([
    options.brouillon === false ? undefined : storage.get<Loaded['draft']>(KEYS.draft),
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

/** Ce que la conservation en cours expose au reste du Studio ; rien quand elle ne tourne pas. */
interface Suivi {
  conserver(cle: string, faire: () => Promise<unknown>): Promise<boolean>;
  enregistrerMaintenant(): Promise<boolean>;
  oublierLeBrouillonRefuse(): void;
  enAttente(cle: string): boolean;
}
let suivi: Suivi | undefined;

/** Vrai si l'écriture de `cle` attend le réseau ou la reconnexion pour repartir. */
export function estEnAttente(cle: string): boolean {
  return suivi?.enAttente(cle) ?? false;
}

/**
 * Écrit sans attendre le délai ce qui a changé, renvoie ce qui attendait (réseau revenu,
 * reconnexion), et attend les réponses. Vrai si le brouillon affiché est enregistré : faux s'il
 * n'a pas pu partir (hors ligne, session expirée, conflit, refus). À appeler avant de changer de
 * document, pour ne rien perdre de la saisie. Ne lève pas.
 */
export function enregistrerMaintenant(): Promise<boolean> {
  return suivi?.enregistrerMaintenant() ?? Promise.resolve(true);
}

/**
 * Une écriture faite hors de l'enregistrement différé (un client, un produit, l'apparence par
 * défaut, un fichier), sous une clé qui la désigne (`clients:<uid>`…). En mode compte, son échec
 * suit le même chemin que celui du brouillon : message, hors ligne ou session expirée, et la
 * dernière écriture de chaque clé repart au retour du réseau ou après la reconnexion. Sans
 * compte, rien ne change : un échec passe sous silence, comme avant. Vrai si elle est passée.
 */
export function conserver(cle: string, faire: () => Promise<unknown>): Promise<boolean> {
  if (suivi) return suivi.conserver(cle, faire);
  return faire().then(
    () => true,
    () => false,
  );
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
 * Après « abandonner cette saisie » : le brouillon refusé par le serveur n'attend plus rien, et
 * le Studio ne le signale plus.
 */
export function oublierLeBrouillonRefuse(): void {
  suivi?.oublierLeBrouillonRefuse();
  ui({ brouillonRefuse: undefined, conflit: false });
}

/** Une facture émise ou l'exemple affichés : une vue, pas un brouillon. */
const estUneVue = (draft: NonNullable<Loaded['draft']>): boolean =>
  draft.issued !== undefined || draft.sample === true;

/** Le brouillon tel qu'il s'enregistre sous `draft`. */
function brouillonDe(s: StudioState): NonNullable<Loaded['draft']> {
  const draft: NonNullable<Loaded['draft']> = { form: s.form, appearance: s.appearance };
  if (s.ui.issued) draft.issued = s.ui.issued;
  // L'exemple reste signalé comme tel d'une visite à l'autre, tant qu'il n'a pas été modifié.
  if (s.ui.sample) draft.sample = true;
  return draft;
}

/**
 * Ce que l'écran montre, tel que le Studio l'enregistre (le formulaire et l'apparence sont les
 * objets mêmes du magasin) : pour vérifier, au moment de changer de document, qu'il est sur le
 * serveur.
 */
export const brouillonAffiche = (): NonNullable<Loaded['draft']> => brouillonDe(state);

/** Une écriture, de quoi la refaire, et si elle s'adresse au serveur (ou à ce navigateur seul). */
interface Ecriture {
  faire: () => Promise<unknown>;
  locale: boolean;
}

/**
 * Écrit le brouillon, l'entreprise et la numérotation quand ils changent, `delai` ms après la
 * dernière modification (400 par défaut). Rend de quoi arrêter.
 *
 * Sans compte, un échec fait passer le Studio en mémoire, comme toujours. Avec un compte, le
 * brouillon est d'abord recopié dans ce navigateur (`garderBrouillon`, 400 ms après la frappe),
 * et la conservation dit pourquoi une écriture n'est pas passée (`ErreurConservation`) :
 *   - réseau : `ui.reseau = 'hors-ligne'` ; la dernière écriture de chaque clé est gardée, et
 *     repart à l'évènement `online` (une passe : pas de boucle de nouveaux essais) ;
 *   - session : `ui.compte.session = 'expiree'`, et la connexion s'ouvre, une seule fois ;
 *     l'écriture repart quand la session redevient active ;
 *   - conflit : `ui.conflit = true` ; rien ne repart ni ne se recharge sans l'utilisateur ;
 *   - refus (4xx) : un message, et rien ne repart.
 * Une facture émise ou l'exemple affichés ne sont qu'une vue, gardée dans ce navigateur : leur
 * écriture ne touche ni à l'attente du brouillon ni à l'état du réseau. Au démarrage, une saisie
 * que le serveur n'a pas reçue (`saisieEnAttente`) repart aussitôt, par le même chemin.
 */
export function startPersistence(options: { delai?: number } = {}): () => void {
  const delai = options.delai ?? DELAI_LOCAL_MS;
  const miroir = estDuCompte(storage) ? storage : undefined;
  let previous = state;
  let vu = state;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerMiroir: ReturnType<typeof setTimeout> | undefined;
  /** La dernière écriture soumise pour chaque clé : seule son issue compte. */
  const derniere = new Map<string, Ecriture>();
  /** Ce qui reste à écrire après une coupure du réseau ou une session expirée. */
  const enAttente = new Map<string, Ecriture>();
  /** Les clés dont la dernière écriture n'est pas passée, quelle qu'en soit la raison. */
  const enEchec = new Set<string>();

  const echec = (cle: string, e: Ecriture, erreur: unknown): void => {
    const compte = state.ui.compte;
    if (!compte) {
      if (state.ui.storage === 'ok') ui({ storage: 'memory' });
      return;
    }
    const actuelle = derniere.get(cle) === e;
    if (actuelle) enEchec.add(cle);
    const code = erreur instanceof ErreurConservation ? erreur.code : 'REFUS';
    if (code === 'RESEAU' || code === 'SESSION') {
      if (actuelle) enAttente.set(cle, e);
      if (code === 'RESEAU') {
        if (state.ui.reseau !== 'hors-ligne') ui({ reseau: 'hors-ligne' });
      } else if (compte.session === 'active') {
        ui({ compte: { ...compte, session: 'expiree' }, connexion: 'connexion' });
      }
      return;
    }
    if (actuelle) enAttente.delete(cle);
    if (code === 'BROUILLON_MODIFIE') {
      const supprime = erreur instanceof ErreurConservation && erreur.detail === 'SUPPRIME';
      const valeur = supprime ? 'supprime' : true;
      if (state.ui.conflit !== valeur) ui({ conflit: valeur });
      return;
    }
    if (cle === 'draft' && actuelle) {
      // Le brouillon refusé reste à l'écran et dans le miroir : un bandeau dit pourquoi, et
      // propose de l'abandonner (sinon on ne le quitte pas, pour ne pas le perdre).
      const cause = erreur instanceof ErreurConservation ? (erreur.detail ?? code) : code;
      if (state.ui.brouillonRefuse !== cause) ui({ brouillonRefuse: cause });
      return;
    }
    const texte = messageDeRefus(erreur);
    if (state.ui.toast?.text !== texte) toast(texte, 'error');
  };

  const ecrire = async (cle: string, e: Ecriture): Promise<boolean> => {
    try {
      await e.faire();
      if (derniere.get(cle) === e) {
        enAttente.delete(cle);
        enEchec.delete(cle);
        if (cle === 'draft' && state.ui.brouillonRefuse !== undefined)
          ui({ brouillonRefuse: undefined });
      }
      // Une écriture locale ne dit rien du réseau.
      if (!e.locale && state.ui.reseau === 'hors-ligne') ui({ reseau: 'ok' });
      return true;
    } catch (erreur) {
      echec(cle, e, erreur);
      return false;
    }
  };

  const soumettre = (cle: string, e: Ecriture): Promise<boolean> => {
    derniere.set(cle, e);
    return ecrire(cle, e);
  };

  /** Le brouillon de `s` : une vue (facture émise, exemple) ou une saisie, sous deux clés. */
  const ecritureDuBrouillon = (s: StudioState): [string, Ecriture] => {
    const draft = brouillonDe(s);
    const vue = draft.issued !== undefined || draft.sample === true;
    return [vue ? 'vue' : 'draft', { faire: () => storage.set(KEYS.draft, draft), locale: vue }];
  };

  /** Écrit ce qui a changé entre le dernier état écrit et `s`. */
  const flush = (s: StudioState = state): Promise<unknown> => {
    clearTimeout(timer);
    timer = undefined;
    const writes: Promise<boolean>[] = [];
    if (
      s.form !== previous.form ||
      s.appearance !== previous.appearance ||
      s.ui.issued !== previous.ui.issued ||
      s.ui.sample !== previous.ui.sample
    ) {
      writes.push(soumettre(...ecritureDuBrouillon(s)));
    }
    if (s.company !== previous.company) {
      const company = s.company;
      writes.push(
        soumettre(KEYS.company, { faire: () => storage.set(KEYS.company, company), locale: false }),
      );
    }
    if (s.numbering !== previous.numbering) {
      const numbering = s.numbering;
      writes.push(
        soumettre(KEYS.numbering, {
          faire: () => storage.set(KEYS.numbering, numbering),
          locale: false,
        }),
      );
    }
    previous = s;
    return Promise.all(writes);
  };

  /** Recopie dans ce navigateur, sans l'envoyer, le brouillon de `s` (mode compte). */
  const garder = (s: StudioState = state): Promise<void> => {
    clearTimeout(timerMiroir);
    timerMiroir = undefined;
    return miroir
      ? miroir.garderBrouillon(brouillonDe(s)).catch(() => undefined)
      : Promise.resolve();
  };

  /** Renvoie ce qui attend, une clé après l'autre ; s'arrête si le réseau ou la session manque. */
  let rejeu: Promise<void> | undefined;
  const rejouer = (): Promise<void> => {
    if (rejeu) return rejeu;
    // La passe peut finir sans rien attendre (session expirée) : `finally` s'exécute alors plus
    // tard que l'affectation, jamais avant, et la passe suivante n'est pas bloquée.
    const passe = (async () => {
      for (const [cle, e] of [...enAttente]) {
        if (state.ui.compte?.session === 'expiree') return;
        if (enAttente.get(cle) !== e) continue;
        await ecrire(cle, e);
        if (state.ui.reseau === 'hors-ligne') return;
      }
    })().finally(() => {
      if (rejeu === passe) rejeu = undefined;
    });
    rejeu = passe;
    return passe;
  };

  const desabonner = store.subscribe(() => {
    const s = state;
    const avant = vu;
    vu = s;
    // Reconnecté après une session expirée : ce que le serveur avait refusé repart.
    if (avant.ui.compte?.session === 'expiree' && s.ui.compte?.session === 'active') {
      void rejouer();
    }
    if (s.ui.storage !== 'ok' && s.ui.storage !== 'injoignable') return;
    if (
      s.ui.storage === 'injoignable' &&
      (s.company !== avant.company || s.numbering !== avant.numbering)
    ) {
      // Rien n'a été lu du serveur : l'entreprise et la numérotation affichées sont celles par
      // défaut, et les enregistrer remplacerait les vraies. Elles ne changent pas avant son retour.
      // De nouveaux objets, pour que les onglets ouverts se redessinent et effacent la frappe.
      const company = { ...avant.company };
      const numbering = { ...avant.numbering };
      vu = { ...avant, company, numbering };
      store.set({ company, numbering });
      toast(t.compte.conservation.injoignableVerrou, 'error');
      return;
    }
    const brouillon =
      s.form !== avant.form ||
      s.appearance !== avant.appearance ||
      s.ui.issued !== avant.ui.issued ||
      s.ui.sample !== avant.ui.sample;
    // Le reste (survol, onglet, message) ne repousse pas l'enregistrement.
    if (!brouillon && s.company === avant.company && s.numbering === avant.numbering) return;
    // Une facture émise ouverte remplace la saisie : ce qui attendait le délai part avant elle.
    if (s.ui.issued !== avant.ui.issued) {
      if (timerMiroir !== undefined) void garder(avant);
      if (timer !== undefined) void flush(avant);
    }
    if (brouillon && miroir) {
      clearTimeout(timerMiroir);
      timerMiroir = setTimeout(() => void garder(), DELAI_LOCAL_MS);
    }
    // Serveur injoignable au démarrage : rien n'a été lu, donc rien ne part ; le miroir suffit.
    if (s.ui.storage === 'injoignable') return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delai);
  });

  /**
   * Serveur injoignable au démarrage : dès qu'il répond (retour du réseau, ou toutes les 30 s), ce
   * qui n'avait pas pu être lu l'est, sans recharger la page. Rien tapé pendant son absence :
   * l'écran prend le brouillon du serveur (ou la saisie que le miroir gardait), confirmé aussitôt.
   * Tapé avant ou pendant la lecture : la saisie reste à l'écran, sur le document que `garder` lui a
   * rattaché en mémoire, et part avec la vérification de version (conflit signalé, rien d'écrasé).
   */
  let reprise: Promise<void> | undefined;
  const reprendre = (): Promise<void> => {
    if (state.ui.storage !== 'injoignable' || !miroir) return Promise.resolve();
    if (reprise) return reprise;
    const essai = (async () => {
      const vue = estUneVue(brouillonDe(state));
      // Tapé pendant l'absence du serveur ? La saisie rejoint d'abord son document (celui du
      // miroir, tenu en mémoire), avant toute lecture : son envoi passera par la vérification de
      // version, même si l'écriture du miroir échoue.
      const tapeAvant =
        !vue && (state.form !== previous.form || state.appearance !== previous.appearance);
      if (tapeAvant) await garder();
      const avant = { form: state.form, appearance: state.appearance };
      // Le brouillon est lu sans être ouvert : si une lecture échoue, rien ne change.
      const [lu, lecture] = await Promise.all([
        loadPersisted({ brouillon: false }),
        miroir.preparerBrouillon(),
      ]).catch(() => [undefined, undefined] as const);
      if (!lu || !lecture || state.ui.storage !== 'injoignable') return;
      // Rien tapé : l'écran prend le brouillon lu (celui du serveur, ou la saisie en attente du
      // miroir). Tapé avant ou pendant la lecture : la saisie reste à l'écran, et le document reste
      // celui qu'elle a en mémoire — jamais celui que la lecture vient de trouver.
      const tapePendant = state.form !== avant.form || state.appearance !== avant.appearance;
      const ecranGarde = tapeAvant || tapePendant;
      if (!ecranGarde) lecture.appliquer();
      // Plus aucun brouillon sur le serveur (supprimé ou émis ailleurs) et rien tapé : l'exemple,
      // comme au démarrage, plutôt qu'un contenu périmé qui renaîtrait en brouillon.
      const serveur = ecranGarde
        ? undefined
        : ((lecture.brouillon as Loaded['draft']) ?? {
            form: sampleForm(),
            appearance: defaultAppearance(),
            sample: true,
          });
      store.set((s) => ({
        company: fill(defaultCompany(), lu.company),
        numbering: fill(defaultNumbering(), lu.numbering),
        clients: lu.clients,
        products: lu.products,
        history: lu.history,
        ...(serveur
          ? {
              form: hydrateForm(serveur.form),
              appearance: fill(defaultAppearance(), serveur.appearance),
            }
          : {}),
        ui: {
          ...s.ui,
          storage: 'ok',
          ...(serveur ? { issued: serveur.issued, sample: serveur.sample === true } : {}),
        },
      }));
      // L'entreprise et la numérotation lues sont ce que le serveur a : rien à renvoyer.
      previous = state;
      // Le brouillon affiché part une fois, ce qui le confirme (sinon le miroir le tiendrait pour
      // une saisie non envoyée) : la saisie, avec la vérification de version ; le brouillon du
      // serveur, sans écriture s'il est identique, par une écriture contrôlée par version si
      // l'écran l'a complété (ancien format). Une vue : la saisie que le miroir gardait.
      const [cle, e] = ecritureDuBrouillon(state);
      const aRejouer = miroir.saisieEnAttente();
      if (cle === 'draft') void soumettre(cle, e);
      else if (aRejouer !== undefined)
        void soumettre('draft', { faire: () => storage.set(KEYS.draft, aRejouer), locale: false });
    })().finally(() => {
      if (reprise === essai) reprise = undefined;
    });
    reprise = essai;
    return essai;
  };
  const relance = miroir ? setInterval(() => void reprendre(), 30_000) : undefined;

  const auDepart = (): void => {
    if (timerMiroir !== undefined) void garder();
    if (state.ui.storage === 'ok') void flush();
  };
  const auRetour = (): void => {
    void rejouer();
    void reprendre();
  };
  // Hors d'un navigateur (tests), pas d'évènements de fenêtre.
  globalThis.addEventListener?.('pagehide', auDepart);
  globalThis.addEventListener?.('online', auRetour);

  suivi = {
    conserver: (cle, faire) =>
      state.ui.compte
        ? soumettre(cle, { faire, locale: false })
        : faire().then(
            () => true,
            () => false,
          ),
    async enregistrerMaintenant() {
      if (timerMiroir !== undefined) await garder();
      if (state.ui.storage !== 'ok') return state.ui.storage !== 'injoignable';
      // L'écran n'a-t-il rien de neuf pour `flush` (rechargement, brouillon rouvert, échec réglé
      // ailleurs) ? Il repart quand même, une fois : la conservation reconnaît alors ces objets-là
      // pour ce que le serveur a, sans rien envoyer si le contenu est le même.
      const rienDeNeuf =
        state.form === previous.form &&
        state.appearance === previous.appearance &&
        state.ui.issued === previous.ui.issued &&
        state.ui.sample === previous.ui.sample;
      await flush();
      await rejouer();
      const [cle, e] = ecritureDuBrouillon(state);
      if (
        miroir &&
        cle === 'draft' &&
        !enAttente.has('draft') &&
        (rienDeNeuf || enEchec.has('draft'))
      )
        await soumettre(cle, e);
      return !enEchec.has('draft');
    },
    oublierLeBrouillonRefuse() {
      derniere.delete('draft');
      enAttente.delete('draft');
      enEchec.delete('draft');
    },
    enAttente: (cle) => enAttente.has(cle),
  };

  // Une saisie que le serveur n'a pas reçue avant la fermeture : elle repart dès maintenant, et
  // son échec se voit (hors ligne, session expirée, conflit) comme celui d'une frappe.
  const aRejouer = miroir?.saisieEnAttente();
  if (aRejouer !== undefined && state.ui.storage === 'ok') {
    void soumettre('draft', { faire: () => storage.set(KEYS.draft, aRejouer), locale: false });
  }

  return () => {
    desabonner();
    clearTimeout(timer);
    clearTimeout(timerMiroir);
    clearInterval(relance);
    globalThis.removeEventListener?.('pagehide', auDepart);
    globalThis.removeEventListener?.('online', auRetour);
    suivi = undefined;
  };
}

export const persistKeys = KEYS;
