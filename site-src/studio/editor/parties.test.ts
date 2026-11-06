import { afterEach, describe, expect, it } from 'vitest';
import { cleClient } from '../library.js';
import { blankParty } from '../model.js';
import { store } from '../store.js';
import { saveClient } from './parties.js';

afterEach(() => {
  store.set({ clients: [] });
});

describe('le carnet de clients', () => {
  it('la clé d’un client : séparateurs retirés, lettres et chiffres gardés, en majuscules', () => {
    const avec = (siren: string, name = 'Nom') => cleClient({ ...blankParty(), name, siren });
    expect(avec('732 829 320')).toBe('732829320');
    expect(avec('732.829.320')).toBe('732829320');
    expect(avec('732-829-320')).toBe('732829320');
    expect(avec('sc-123.456')).toBe('SC123456');
    expect(avec('SC123456')).not.toBe(avec('NI123456'));
    expect(avec('', '  Atelier Lilas ')).toBe('atelier lilas');
  });

  it('deux identifiants qui ne diffèrent que par les lettres : deux clients, aucun écrasé', () => {
    store.set({ clients: [] });
    saveClient({ ...blankParty(), name: 'Client SC', siren: 'SC123456' });
    saveClient({ ...blankParty(), name: 'Client NI', siren: 'NI123456' });
    expect(store.get().clients.map((c) => c.party.name)).toEqual(['Client SC', 'Client NI']);
    // Le même identifiant, tapé autrement : le même client, mis à jour.
    saveClient({ ...blankParty(), name: 'Client SC, renommé', siren: 'sc 123.456' });
    expect(store.get().clients.map((c) => c.party.name)).toEqual([
      'Client SC, renommé',
      'Client NI',
    ]);
  });
});
