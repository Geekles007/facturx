/**
 * Conservation locale : IndexedDB, dans le navigateur de l'utilisateur, et nulle part ailleurs.
 *
 * Une facture est une donnée commerciale ; le Studio n'a pas de serveur où la mettre. Tout ce qui
 * doit survivre à la fermeture de l'onglet — brouillon en cours, entreprise, clients, catalogue,
 * historique, logo, police — vit ici. Si le stockage est indisponible (navigation privée stricte,
 * quota épuisé), le Studio continue en mémoire et le dit ; il ne perd rien en silence.
 */

const DB_NAME = 'facturx-studio';
const VERSION = 1;

export type StoreName = 'kv' | 'invoices' | 'clients' | 'products' | 'files';

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      for (const name of ['invoices', 'clients', 'products'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'uid' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('ouverture impossible'));
    request.onblocked = () => reject(new Error('base bloquée par un autre onglet'));
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = action(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? request.error ?? new Error('transaction échouée'));
        tx.onabort = () => reject(tx.error ?? new Error('transaction annulée'));
      }),
  );
}

export const storage = {
  /** Vrai si le stockage répond ; sinon le Studio travaille en mémoire. */
  async available(): Promise<boolean> {
    try {
      await open();
      return true;
    } catch {
      return false;
    }
  },
  get<T>(key: string): Promise<T | undefined> {
    return run<T | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  set(key: string, value: unknown): Promise<IDBValidKey> {
    return run('kv', 'readwrite', (s) => s.put(value, key));
  },
  list<T>(store: 'invoices' | 'clients' | 'products'): Promise<T[]> {
    return run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  put<T extends { uid: string }>(
    store: 'invoices' | 'clients' | 'products',
    value: T,
  ): Promise<IDBValidKey> {
    return run(store, 'readwrite', (s) => s.put(value));
  },
  remove(store: StoreName, key: string): Promise<undefined> {
    return run(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
  },
  getFile(key: string): Promise<Uint8Array | undefined> {
    return run<Uint8Array | undefined>(
      'files',
      'readonly',
      (s) => s.get(key) as IDBRequest<Uint8Array | undefined>,
    );
  },
  setFile(key: string, bytes: Uint8Array): Promise<IDBValidKey> {
    return run('files', 'readwrite', (s) => s.put(bytes, key));
  },
  /** Tout ce que le Studio conserve, pour une sauvegarde téléchargeable. */
  async dump(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const store of ['invoices', 'clients', 'products'] as const)
      out[store] = await storage.list(store);
    const db = await open();
    for (const store of ['kv', 'files'] as const) {
      out[store] = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const entries: Record<string, unknown> = {};
        const request = db.transaction(store, 'readonly').objectStore(store).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve(entries);
          entries[String(cursor.key)] = cursor.value;
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    }
    return out;
  },
};
