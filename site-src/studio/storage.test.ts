// Le faux IndexedDB doit exister avant l'évaluation de storage.ts : l'import vient donc en premier.
// storage.ts garde sa base ouverte pour tout le module, d'où une seule base par fichier de test.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { contratPersistence } from './persistence.contract.js';
import { indexedDbPersistence, storage, utiliser } from './storage.js';

contratPersistence('IndexedDB', async () => indexedDbPersistence);

describe('utiliser', () => {
  afterEach(() => utiliser(indexedDbPersistence));

  it('IndexedDB répond tant qu’on n’en a pas choisi une autre', () => {
    expect(storage).toBe(indexedDbPersistence);
  });

  it('change ce que voient ceux qui ont déjà importé storage', async () => {
    const autre = { ...indexedDbPersistence, available: async () => false };
    utiliser(autre);
    expect(storage).toBe(autre);
    expect(await storage.available()).toBe(false);
  });
});
