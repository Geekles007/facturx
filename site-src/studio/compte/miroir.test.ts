// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultAppearance } from '../library.js';
import { blankForm, blankParty } from '../model.js';
import { indexedDbPersistence as local } from '../storage.js';
import type { Loaded } from '../store.js';
import { clesDuNavigateur, type Miroir, supabasePersistence } from './persistence.js';

/**
 * Sonde D (relecture finale) : le miroir local du brouillon ouvert est illisible au démarrage
 * (IndexedDB ne répond pas), puis la base rouvre et l'écriture passe. Lu comme absent, il était
 * remplacé à la frappe suivante, et la saisie que le serveur n'avait pas reçue était perdue. Un
 * miroir illisible n'est pas un miroir absent : la lecture est réessayée, puis, tant qu'elle n'a pas
 * réussi, le miroir est relu avant toute écriture, et une saisie non envoyée qu'il garde est mise de
 * côté (sous une autre clé, et dite), jamais écrasée. Sans pile : ces chemins ne lisent rien du
 * serveur, ou n'en reçoivent qu'une réponse vide.
 */

type Brouillon = NonNullable<Loaded['draft']>;

function brouillon(client: string): Brouillon {
  const form = blankForm('2026-11-07');
  form.buyer = { ...blankParty(), name: client };
  return { form, appearance: { ...defaultAppearance() } };
}

/** Un client Supabase qui n'a rien : chaque requête rend une ligne absente, sans erreur. */
function serveurVide(): SupabaseClient {
  const vide = { data: null, error: null, status: 200 };
  const chaine: unknown = new Proxy(() => undefined, {
    get: (_cible, nom) =>
      nom === 'then'
        ? undefined
        : nom === 'maybeSingle' || nom === 'single'
          ? () => Promise.resolve(vide)
          : chaine,
    apply: () => chaine,
  });
  return chaine as SupabaseClient;
}

/** La saisie que le serveur n'a pas reçue, gardée par le miroir avant la fermeture de la page. */
const NON_ENVOYEE: Miroir = {
  ...brouillon('Saisie jamais partie'),
  brouillon: { id: 'b-1', version: 3 },
  idPrevu: 'b-1',
  envoye: false,
};

/** Une entreprise neuve, son miroir garni ; `get` du miroir échoue `echecs` fois (Infinity : toujours). */
async function preparer(echecs: number) {
  const E = `e-${crypto.randomUUID()}`;
  const cles = clesDuNavigateur(E);
  await local.set(cles.miroir, NON_ENVOYEE);
  const lire = local.get.bind(local);
  let restants = echecs;
  vi.spyOn(local, 'get').mockImplementation(async (cle: string) => {
    if (cle === cles.miroir && restants > 0) {
      restants--;
      throw new Error('IndexedDB : lecture impossible');
    }
    return lire(cle);
  });
  const signal = vi.fn();
  const p = supabasePersistence(serveurVide(), E, { surSaisieMiseDeCote: signal });
  /** Le miroir tel qu'il est dans IndexedDB, lu sans l'espion. */
  const miroir = () => lire<Miroir>(cles.miroir);
  return { p, signal, miroir, cles, lire };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sonde D : un miroir illisible au démarrage ne fait rien perdre', () => {
  test('lecture en échec au démarrage (serveur injoignable), puis frappe : la saisie est mise de côté et dite', async () => {
    const { p, signal, miroir } = await preparer(3);
    // Illisible malgré les nouveaux essais : rien à reprendre, l'éditeur montre l'exemple.
    expect(await p.brouillonLocal()).toBeUndefined();
    await p.garderBrouillon(brouillon('Tapé ensuite'));

    // La frappe est dans le miroir, et la saisie qu'il gardait n'est pas perdue : elle est encore
    // dans ce navigateur.
    expect((await miroir())?.form.buyer.name).toBe('Tapé ensuite');
    const { kv } = (await local.dump()) as { kv: Record<string, unknown> };
    expect(JSON.stringify(kv)).toContain('Saisie jamais partie');
    const abri = await p.saisieMiseDeCote();
    expect(abri?.saisie.form.buyer.name).toBe('Saisie jamais partie');
    expect(signal).toHaveBeenCalledOnce();
    // La frappe suivante n'y touche plus : une seule copie, un seul message.
    await p.garderBrouillon(brouillon('Tapé encore'));
    expect((await miroir())?.form.buyer.name).toBe('Tapé encore');
    expect(signal).toHaveBeenCalledOnce();
    expect((await p.saisieMiseDeCote())?.saisie.form.buyer.name).toBe('Saisie jamais partie');
  });

  test('lecture en échec au démarrage (serveur joignable), puis frappe : de même', async () => {
    const { p, signal, miroir } = await preparer(3);
    // Le serveur n'a aucun brouillon : l'exemple s'affiche.
    expect(await p.get('draft')).toBeUndefined();
    await p.garderBrouillon(brouillon('Tapé ensuite'));
    expect((await miroir())?.form.buyer.name).toBe('Tapé ensuite');
    expect((await p.saisieMiseDeCote())?.saisie.form.buyer.name).toBe('Saisie jamais partie');
    expect(signal).toHaveBeenCalledOnce();
  });

  test('une lecture qui réussit au nouvel essai : la saisie reprend, rien n’est mis de côté', async () => {
    const { p, signal } = await preparer(1);
    expect((await p.brouillonLocal()) as Brouillon).toMatchObject({
      form: { buyer: { name: 'Saisie jamais partie' } },
    });
    expect((p.saisieEnAttente() as Brouillon).form.buyer.name).toBe('Saisie jamais partie');
    expect(await p.saisieMiseDeCote()).toBeUndefined();
    expect(signal).not.toHaveBeenCalled();
  });

  test('toujours illisible à la frappe : rien n’est écrit, le miroir garde la saisie ; relu ensuite, elle est mise de côté', async () => {
    const { p, signal, miroir } = await preparer(Number.POSITIVE_INFINITY);
    expect(await p.brouillonLocal()).toBeUndefined();
    await p.garderBrouillon(brouillon('Tapé pendant la panne'));
    expect((await miroir())?.form.buyer.name).toBe('Saisie jamais partie');
    expect(signal).not.toHaveBeenCalled();

    // IndexedDB répond de nouveau : la frappe suivante relit d'abord.
    vi.restoreAllMocks();
    await p.garderBrouillon(brouillon('Tapé après la panne'));
    expect((await miroir())?.form.buyer.name).toBe('Tapé après la panne');
    expect((await p.saisieMiseDeCote())?.saisie.form.buyer.name).toBe('Saisie jamais partie');
    expect(signal).toHaveBeenCalledOnce();
  });

  test('un miroir illisible relu vide ou déjà envoyé : rien n’est mis de côté', async () => {
    const { p, signal, miroir, cles } = await preparer(3);
    await local.set(cles.miroir, { ...NON_ENVOYEE, envoye: true });
    expect(await p.brouillonLocal()).toBeUndefined();
    await p.garderBrouillon(brouillon('Tapé ensuite'));
    expect((await miroir())?.form.buyer.name).toBe('Tapé ensuite');
    expect(await p.saisieMiseDeCote()).toBeUndefined();
    expect(signal).not.toHaveBeenCalled();
  });

  test('mise de côté, elle est redite au prochain démarrage, et s’oublie une fois reprise', async () => {
    const premier = await preparer(3);
    await premier.p.brouillonLocal();
    await premier.p.garderBrouillon(brouillon('Tapé ensuite'));
    const abri = await premier.p.saisieMiseDeCote();
    vi.restoreAllMocks();

    // Le Studio rouvert : le miroir se lit, la saisie mise de côté est redite, une fois.
    const signal = vi.fn();
    const E = premier.cles.miroir.replace('draft-compte-', '');
    const p = supabasePersistence(serveurVide(), E, { surSaisieMiseDeCote: signal });
    await p.brouillonLocal();
    await vi.waitFor(() => expect(signal).toHaveBeenCalledOnce());
    if (!abri) throw new Error('rien de mis de côté');
    await p.oublierSaisieMiseDeCote(abri.id);
    expect(await p.saisieMiseDeCote()).toBeUndefined();
  });

  test('le miroir retiré pendant qu’il est illisible (saisie abandonnée) : ce qu’il cachait est mis de côté d’abord', async () => {
    const { p, signal, miroir } = await preparer(3);
    expect(await p.brouillonLocal()).toBeUndefined();
    await p.abandonnerSaisie();
    await vi.waitFor(async () => expect(await miroir()).toBeUndefined());
    expect((await p.saisieMiseDeCote())?.saisie.form.buyer.name).toBe('Saisie jamais partie');
    expect(signal).toHaveBeenCalledOnce();
  });
});
