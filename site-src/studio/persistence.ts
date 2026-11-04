/**
 * Ce que le Studio demande à sa conservation, sans dire où elle vit.
 *
 * Aujourd'hui, une seule réponse : IndexedDB, dans le navigateur. Une seconde, côté compte, viendra
 * se placer derrière la même interface ; `store.ts`, `files.ts` et les panneaux n'ont pas à savoir
 * laquelle des deux répond. Les signatures reprennent donc celles de `storage.ts`, à l'identique.
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
