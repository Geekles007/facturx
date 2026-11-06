/**
 * Ce que le Studio demande à sa conservation, sans dire où elle vit.
 *
 * Deux réponses : IndexedDB, dans le navigateur (`storage.ts`), et le serveur du compte
 * (`compte/persistence.ts`). `store.ts`, `files.ts` et les panneaux n'ont pas à savoir laquelle
 * des deux répond. Les signatures reprennent celles de `storage.ts`, à l'identique.
 *
 * Les écritures rendent la clé écrite (l'`uid` pour `put`) : c'est ce que rend IndexedDB, et ce
 * que le serveur rend aussi, faute d'autre clé à donner. Personne ne s'en sert pour l'instant.
 */

export type StoreName = 'kv' | 'invoices' | 'clients' | 'products' | 'files';

export interface Persistence {
  /** Vrai si la conservation répond ; sinon le Studio travaille en mémoire. */
  available(): Promise<boolean>;
  /** Une valeur du magasin `kv` (brouillon, entreprise, numérotation, apparence). */
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<IDBValidKey>;
  /** Tous les enregistrements d'un magasin à clé `uid`. */
  list<T>(store: 'invoices' | 'clients' | 'products'): Promise<T[]>;
  /** Écrit ou remplace l'enregistrement de même `uid`. */
  put<T extends { uid: string }>(
    store: 'invoices' | 'clients' | 'products',
    value: T,
  ): Promise<IDBValidKey>;
  remove(store: StoreName, key: string): Promise<undefined>;
  /** Un fichier (logo, police) : les octets, rendus tels qu'ils ont été écrits. */
  getFile(key: string): Promise<Uint8Array | undefined>;
  setFile(key: string, bytes: Uint8Array): Promise<IDBValidKey>;
  /** Tout ce que le Studio conserve, pour une sauvegarde téléchargeable. */
  dump(): Promise<Record<string, unknown>>;
}

/**
 * Pourquoi une écriture n'a pas abouti, quand la conservation sait le dire (celle du compte) :
 *
 *   - `RESEAU` : le serveur ne répond pas (hors ligne, ou erreur 5xx) ; à retenter plus tard ;
 *   - `SESSION` : le serveur refuse le jeton (401) ; à retenter après la reconnexion ;
 *   - `BROUILLON_MODIFIE` : le brouillon a été enregistré ailleurs depuis sa lecture ; rien n'a été
 *     écrasé, l'utilisateur choisit ;
 *   - `REFUS` : le serveur refuse la valeur (4xx) ; la retenter ne changerait rien ;
 *   - `EMISSION_SERVEUR` : une facture et son PDF ne s'écrivent que par l'émission, sur le serveur ;
 *   - `FICHIER` : ni PNG, ni JPEG, ni TTF, ou trop lourd ;
 *   - `EN_ATTENTE` : la saisie du brouillon ouvert n'a pas atteint le serveur, et changer de
 *     document la perdrait ; `detail` dit pourquoi elle n'est pas partie (un des codes ci-dessus).
 *
 * IndexedDB ne lève que des erreurs ordinaires. Le message est le code ; `detail` porte ce que le
 * serveur a dit, s'il a dit quelque chose (`NUMEROTATION_RECUL`, par exemple).
 */
export type CodeConservation =
  | 'RESEAU'
  | 'SESSION'
  | 'BROUILLON_MODIFIE'
  | 'REFUS'
  | 'EMISSION_SERVEUR'
  | 'FICHIER'
  | 'EN_ATTENTE';

export class ErreurConservation extends Error {
  readonly code: CodeConservation;
  readonly detail: string | undefined;
  constructor(code: CodeConservation, detail?: string) {
    super(code);
    this.name = 'ErreurConservation';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Ce que seule la conservation du compte sait faire, et que le magasin, les parcours et le
 * démarrage emploient sans charger le code du compte : tenir plusieurs brouillons, et un miroir
 * du brouillon ouvert dans ce navigateur.
 */
export interface ConservationDuCompte {
  /**
   * Recopie dans ce navigateur, sans l'envoyer, ce que `set('draft')` enverra : le magasin
   * l'appelle peu après la frappe (400 ms), avant l'envoi au serveur (1 s). Une facture émise ou
   * l'exemple affichés sont une vue, gardée à part : ils ne remplacent pas la saisie du brouillon.
   */
  garderBrouillon(valeur: unknown): Promise<void>;
  /** Attend la fin des envois de brouillon en cours. */
  envoisTermines(): Promise<void>;
  /**
   * Quitte le brouillon ouvert pour un nouveau, tout de suite et sans rien attendre, si ce que
   * l'écran montre (`affiche`, le brouillon tel que le magasin l'enregistre, comparé par identité
   * de son formulaire et de son apparence) est exactement ce que le serveur en a reçu — ou si ce
   * brouillon a été supprimé. Sinon rien ne change, et la réponse est fausse : il faut d'abord
   * l'enregistrer. Le prochain `set('draft')` crée un brouillon ; l'ancien reste dans la liste.
   * Synchrone, pour que l'appelant change l'éditeur dans le même temps, sans frappe intercalée.
   */
  quitterBrouillon(affiche: unknown): boolean;
  /** La saisie du brouillon ouvert que le serveur n'a pas encore reçue, s'il y en a une. */
  saisieEnAttente(): unknown;
  /** Le brouillon gardé dans ce navigateur, sans rien demander au serveur (démarrage hors ligne). */
  brouillonLocal(): Promise<unknown>;
  /**
   * Renonce à la saisie du brouillon ouvert que le serveur refuse : le miroir et ce qui attendait
   * s'en vont. Rend la dernière version enregistrée, ou rien si le brouillon ne l'a jamais été.
   */
  abandonnerSaisie(): Promise<unknown>;
}

export function estDuCompte(p: Persistence): p is Persistence & ConservationDuCompte {
  return typeof (p as Partial<ConservationDuCompte>).garderBrouillon === 'function';
}
