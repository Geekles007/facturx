/**
 * Le contrat de `Persistence` : ce que toute conservation du Studio doit tenir, où qu'elle vive.
 *
 * Ce fichier n'est pas un `*.test.ts` : Vitest ne le collecte pas de lui-même. Chaque
 * implémentation a son fichier de test, qui l'appelle avec sa fabrique (`storage.test.ts` pour
 * IndexedDB). Le contrat peut donc tourner sur une conservation qui contient déjà des données, y
 * compris celles d'une exécution précédente : chaque exécution écrit sous des clés et des uid qui
 * lui sont propres, et ne vérifie que ce qu'elle a écrit, jamais un nombre total.
 *
 * Chaque test appelle `fabriquer` lui-même et se suffit : ce que l'implémentation retourne doit
 * partager ses données d'un appel à l'autre, ou n'avoir besoin d'aucun appel précédent.
 *
 * Les fichiers écrits portent la signature de ce que le Studio dépose vraiment (PNG, JPEG, TTF) :
 * la conservation du compte refuse tout autre type, comme son bucket. Les factures, enfin, ne
 * s'écrivent qu'en local : avec un compte, elles s'émettent par le serveur (`emission: 'serveur'`).
 */

import { describe, expect, test } from 'vitest';
import {
  type ClientRecord,
  defaultAppearance,
  type ProductRecord,
  type SavedInvoice,
} from './library.js';
import { blankForm, blankParty } from './model.js';
import type { Persistence } from './persistence.js';

/** Un client dont le nom permet de reconnaître l'écriture. */
function client(uid: string, name: string): ClientRecord {
  return {
    uid,
    party: { ...blankParty(), name, siren: '552100554' },
    updatedAt: '2026-11-04T09:30:00.000Z',
  };
}

function produit(uid: string, name: string): ProductRecord {
  return {
    uid,
    name,
    description: 'Journée de conseil',
    unitCode: 'DAY',
    unitPrice: '650.00',
    vat: 'S:20',
    sellerItemId: 'CONSEIL-1',
    updatedAt: '2026-11-04T09:30:00.000Z',
  };
}

/** Une facture émise en local, telle que l'historique la garde. */
function facture(uid: string, numero: string): SavedInvoice {
  return {
    uid,
    status: 'issued',
    form: { ...blankForm('2026-11-04'), id: numero },
    appearance: defaultAppearance(),
    summary: {
      id: numero,
      typeCode: '380',
      issueDate: '2026-11-04',
      buyerName: 'Atelier des Lilas',
      currency: 'EUR',
      total: 78_000,
      due: 78_000,
    },
    issuedAt: '2026-11-04T09:30:00.000Z',
  };
}

/** Signatures des fichiers que le Studio dépose : un logo PNG ou JPEG, une police TTF. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const TTF = [0x00, 0x01, 0x00, 0x00];

/** Une police TTF suivie des 256 valeurs d'un octet, dans l'ordre : aucune ne doit être altérée. */
function tousLesOctets(): Uint8Array {
  return Uint8Array.from([...TTF, ...Array.from({ length: 256 }, (_, i) => i)]);
}

function octets(bytes: unknown): number[] {
  expect(bytes).toBeInstanceOf(Uint8Array);
  return Array.from(bytes as Uint8Array);
}

export function contratPersistence(
  nom: string,
  fabriquer: () => Promise<Persistence>,
  options: { emission: 'locale' | 'serveur' } = { emission: 'locale' },
): void {
  // Propre à cette exécution : rien de ce qu'une exécution précédente a laissé ne peut y répondre.
  const exec = crypto.randomUUID();
  const cle = (suffixe: string) => `contrat/${exec}/${suffixe}`;
  const uid = () => crypto.randomUUID();

  describe(`Persistence : ${nom}`, () => {
    test('répond', async () => {
      const p = await fabriquer();
      expect(await p.available()).toBe(true);
    });

    test('set puis get relisent la valeur, la dernière écriture l’emporte', async () => {
      const p = await fabriquer();
      const valeur = {
        nom: 'Atelier des Lilas',
        actif: true,
        numero: 42,
        imbrique: { lignes: [1, 2, 3], note: 'é, ç, œ et 日本' },
      };
      await p.set(cle('objet'), valeur);
      expect(await p.get(cle('objet'))).toEqual(valeur);

      await p.set(cle('texte'), 'F-2026-0001');
      expect(await p.get(cle('texte'))).toBe('F-2026-0001');
      await p.set(cle('texte'), 'F-2026-0002');
      expect(await p.get(cle('texte'))).toBe('F-2026-0002');
    });

    test('get d’une clé jamais écrite ne rend rien', async () => {
      const p = await fabriquer();
      expect(await p.get(cle('absente'))).toBeUndefined();
    });

    test('put puis list relisent les clients et les produits, chacun dans son magasin', async () => {
      const p = await fabriquer();
      const unClient = client(uid(), `Client ${exec}`);
      const unProduit = produit(uid(), `Produit ${exec}`);
      await p.put('clients', unClient);
      await p.put('products', unProduit);

      const clients = await p.list<ClientRecord>('clients');
      const produits = await p.list<ProductRecord>('products');
      expect(clients).toContainEqual(unClient);
      expect(produits).toContainEqual(unProduit);
      expect(clients.some((c) => c.uid === unProduit.uid)).toBe(false);
      expect(produits.some((r) => r.uid === unClient.uid)).toBe(false);
    });

    test('put d’un uid déjà écrit remplace l’enregistrement au lieu d’en ajouter un', async () => {
      const p = await fabriquer();
      const id = uid();
      await p.put('clients', client(id, 'Avant'));
      const apres = client(id, 'Après');
      await p.put('clients', apres);

      const memes = (await p.list<ClientRecord>('clients')).filter((c) => c.uid === id);
      expect(memes).toEqual([apres]);
    });

    test('remove supprime une valeur, un client, un produit ou un fichier, et seulement lui', async () => {
      const p = await fabriquer();
      await p.set(cle('a-supprimer'), 'x');
      await p.set(cle('a-garder'), 'y');
      const parti = client(uid(), 'Parti');
      const reste = client(uid(), 'Reste');
      const produitParti = produit(uid(), 'Parti');
      await p.put('clients', parti);
      await p.put('clients', reste);
      await p.put('products', produitParti);
      await p.setFile(cle('fichier'), Uint8Array.of(...PNG, 1, 2, 3));

      await p.remove('kv', cle('a-supprimer'));
      await p.remove('clients', parti.uid);
      await p.remove('products', produitParti.uid);
      await p.remove('files', cle('fichier'));

      expect(await p.get(cle('a-supprimer'))).toBeUndefined();
      expect(await p.get(cle('a-garder'))).toBe('y');
      const clients = await p.list<ClientRecord>('clients');
      expect(clients.some((c) => c.uid === parti.uid)).toBe(false);
      expect(clients).toContainEqual(reste);
      const produits = await p.list<ProductRecord>('products');
      expect(produits.some((r) => r.uid === produitParti.uid)).toBe(false);
      expect(await p.getFile(cle('fichier'))).toBeUndefined();
    });

    test('remove d’une clé absente réussit sans rien changer', async () => {
      const p = await fabriquer();
      await expect(p.remove('kv', cle('jamais-ecrite'))).resolves.toBeUndefined();
      await expect(p.remove('clients', uid())).resolves.toBeUndefined();
      await expect(p.remove('files', cle('jamais-ecrit'))).resolves.toBeUndefined();
    });

    test('setFile puis getFile relisent les octets à l’identique', async () => {
      const p = await fabriquer();
      const png = Uint8Array.of(...PNG, 0x00, 0xff, 0x00);
      await p.setFile(cle('logo'), png);
      await p.setFile(cle('police'), tousLesOctets());

      expect(octets(await p.getFile(cle('logo')))).toEqual(Array.from(png));
      expect(octets(await p.getFile(cle('police')))).toEqual(Array.from(tousLesOctets()));

      // Une seconde écriture sous la même clé remplace la première, même d'un autre type.
      await p.setFile(cle('logo'), Uint8Array.of(...JPEG, 7));
      expect(octets(await p.getFile(cle('logo')))).toEqual([...JPEG, 7]);
    });

    test('getFile d’un fichier jamais écrit ne rend rien', async () => {
      const p = await fabriquer();
      expect(await p.getFile(cle('absent'))).toBeUndefined();
    });

    if (options.emission === 'locale') {
      test('put puis list relisent une facture émise', async () => {
        const p = await fabriquer();
        const emise = facture(uid(), `F-${exec}`);
        await p.put('invoices', emise);
        expect(await p.list<SavedInvoice>('invoices')).toContainEqual(emise);
      });
    } else {
      test('une facture ne s’écrit pas : elle s’émet par le serveur', async () => {
        const p = await fabriquer();
        const emise = facture(uid(), `F-${exec}`);
        await expect(p.put('invoices', emise)).rejects.toThrow('EMISSION_SERVEUR');
        const factures = await p.list<SavedInvoice>('invoices');
        expect(Array.isArray(factures)).toBe(true);
        expect(factures.some((f) => f.uid === emise.uid)).toBe(false);
      });
    }

    test('dump contient tout ce qui a été écrit', async () => {
      const p = await fabriquer();
      const valeur = { entreprise: 'Atelier des Lilas', prochain: 12 };
      const unClient = client(uid(), `Client ${exec}`);
      const unProduit = produit(uid(), `Produit ${exec}`);
      await p.set(cle('dump'), valeur);
      await p.put('clients', unClient);
      await p.put('products', unProduit);
      await p.setFile(cle('dump-fichier'), tousLesOctets());

      const copie = await p.dump();
      // kv et files : un objet clé → valeur ; les trois autres : des listes d'enregistrements.
      expect((copie.kv as Record<string, unknown>)[cle('dump')]).toEqual(valeur);
      expect(copie.clients as ClientRecord[]).toContainEqual(unClient);
      expect(copie.products as ProductRecord[]).toContainEqual(unProduit);
      expect(Array.isArray(copie.invoices)).toBe(true);
      expect(octets((copie.files as Record<string, unknown>)[cle('dump-fichier')])).toEqual(
        Array.from(tousLesOctets()),
      );
    });
  });
}
