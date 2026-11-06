/**
 * Les limites d'une relance (`relancer/limites.ts`) contre une transaction factice, sans la pile : dans
 * quel ordre elles parlent à la base. Le jour de Paris se lit après le verrou de l'entreprise, dans la
 * requête qui compte : une relance qui attend le verrou jusqu'à minuit compte dans le jour où elle est
 * datée. L'horloge de la base ne se simule pas ; l'ordre des requêtes, si, et c'est lui qui tombe quand
 * le calcul du jour revient avant le verrou. Les tests de pile (`relancer.test.ts`) prennent le reste :
 * les bornes du jour à Paris, les comptes, le verrou tenu.
 */
import { assert, assertEquals } from '@std/assert';
import type postgres from 'postgres';
import { appliquerLimites, cleDuVerrou } from '../relancer/limites.ts';
import { avecEnv } from './aide.ts';

const LOCAL = 'http://127.0.0.1:55421';

interface Requete {
  texte: string;
  valeurs: unknown[];
}

interface Etat {
  /** Relances envoyées de la facture, et la date où le délai de 72 heures se libère, s'il y en a. */
  envoyees?: number;
  libreLe?: Date;
  bloquee?: boolean;
  /** Relances envoyées et refusées du jour, et minuit suivant à Paris. */
  duJour?: number;
  refuseesDuJour?: number;
  minuitSuivant?: Date;
  /** Une erreur que le verrou lève (SQLSTATE). */
  erreurVerrou?: string;
}

/** Une transaction qui enregistre ses requêtes (texte, valeurs) et rend les lignes que `etat` décrit. */
function fausseTransaction(etat: Etat = {}) {
  const requetes: Requete[] = [];
  const tx = (chaines: TemplateStringsArray, ...valeurs: unknown[]) => {
    const texte = chaines.join('?');
    requetes.push({ texte, valeurs });
    if (texte.includes('pg_advisory_xact_lock') && etat.erreurVerrou) {
      return Promise.reject(Object.assign(new Error('lock timeout'), { code: etat.erreurVerrou }));
    }
    if (texte.includes('libre_le')) {
      return Promise.resolve([
        {
          envoyees: etat.envoyees ?? 0,
          bloquee: etat.bloquee ?? null,
          libre_le: etat.libreLe ?? null,
        },
      ]);
    }
    if (texte.includes('minuit_suivant')) {
      return Promise.resolve([
        {
          envoyees_du_jour: etat.duJour ?? 0,
          refusees_du_jour: etat.refuseesDuJour ?? 0,
          minuit_suivant: etat.minuitSuivant ?? new Date('2026-11-06T23:00:00Z'),
        },
      ]);
    }
    return Promise.resolve([{}]);
  };
  return { tx: tx as unknown as postgres.ISql, requetes };
}

const requete = (date?: string) =>
  new Request('http://localhost/', { headers: date ? { 'x-facturx-aujourdhui': date } : {} });

Deno.test('le verrou est pris avant tout comptage, et le jour est lu après lui, dans la requête qui compte', async () => {
  const { tx, requetes } = fausseTransaction();
  assertEquals(await appliquerLimites(tx, 'entreprise-1', 'facture-1', requete()), 1);

  // L'attente du verrou est bornée, puis le verrou de l'entreprise, puis les comptes.
  assert(requetes[0].texte.includes('lock_timeout'), requetes[0].texte);
  assertEquals(requetes[0].valeurs, ['10s']);
  assert(requetes[1].texte.includes('pg_advisory_xact_lock'), requetes[1].texte);
  assertEquals(requetes[1].valeurs, [cleDuVerrou('entreprise-1')]);
  assertEquals(requetes.length, 4);
  for (const compte of requetes.slice(2)) assert(compte.texte.includes('public.relances'));

  // Le jour n'est lu qu'une fois, par l'horloge de la base, après le verrou : nulle part avant.
  const horloges = requetes
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.texte.includes('clock_timestamp() at time zone'));
  assertEquals(horloges.length, 1);
  assert(horloges[0].i > 1, 'l’horloge de la base est lue avant le verrou');
  assert(horloges[0].r.texte.includes("'Europe/Paris'"));
  // Aucun jour n'est passé en paramètre : c'est la base qui le donne.
  assert(horloges[0].r.valeurs.includes(null));
});

Deno.test('le jour que l’en-tête de test impose remplace l’horloge de la base, sous les mêmes gardes', async () => {
  await avecEnv({ FACTURX_TESTS: '1', SUPABASE_URL: LOCAL }, async () => {
    const { tx, requetes } = fausseTransaction();
    await appliquerLimites(tx, 'e', 'f', requete('2026-07-15'));
    const jour = requetes.find((r) => r.texte.includes('clock_timestamp() at time zone'));
    assert(jour?.valeurs.includes('2026-07-15'));
  });
  // Sans FACTURX_TESTS, l'en-tête n'est pas lu.
  await avecEnv({ FACTURX_TESTS: undefined, SUPABASE_URL: LOCAL }, async () => {
    const { tx, requetes } = fausseTransaction();
    await appliquerLimites(tx, 'e', 'f', requete('2026-07-15'));
    const jour = requetes.find((r) => r.texte.includes('clock_timestamp() at time zone'));
    assert(jour?.valeurs.includes(null));
    assert(!jour?.valeurs.includes('2026-07-15'));
  });
});

Deno.test('le niveau : relances envoyées de la facture plus un, au plus 3', async () => {
  for (const [envoyees, niveau] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 3],
    [7, 3],
  ]) {
    const { tx } = fausseTransaction({ envoyees });
    assertEquals(await appliquerLimites(tx, 'e', 'f', requete()), niveau);
  }
});

/** Ce que `promesse` lève (une `Response` pour un refus des fonctions), ou échoue si elle aboutit. */
async function leve(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse;
  } catch (e) {
    return e;
  }
  throw new Error('aucun refus');
}

async function limite(etat: Etat): Promise<{ status: number; corps: Record<string, unknown> }> {
  const { tx } = fausseTransaction(etat);
  const reponse = await leve(appliquerLimites(tx, 'e', 'f', requete()));
  assert(reponse instanceof Response);
  return { status: reponse.status, corps: await reponse.json() };
}

Deno.test('le délai, le plafond du jour et le plafond des refus : 429 LIMITE, la plus tardive des échéances', async () => {
  const minuit = new Date('2026-11-06T23:00:00Z');
  const libre = new Date('2026-11-09T10:00:00Z');

  const delai = await limite({ envoyees: 1, bloquee: true, libreLe: libre, minuitSuivant: minuit });
  assertEquals(delai.status, 429);
  assertEquals(delai.corps.code, 'LIMITE');
  assertEquals(delai.corps.details, { reessayerApres: libre.toISOString() });

  // Vingt envoyées dans le jour : minuit ; dix-neuf : rien.
  const jour = await limite({ duJour: 20, minuitSuivant: minuit });
  assertEquals(jour.corps.details, { reessayerApres: minuit.toISOString() });
  const refus = await limite({ refuseesDuJour: 60, minuitSuivant: minuit });
  assertEquals(refus.corps.details, { reessayerApres: minuit.toISOString() });
  const { tx } = fausseTransaction({ duJour: 19, refuseesDuJour: 59, minuitSuivant: minuit });
  assertEquals(await appliquerLimites(tx, 'e', 'f', requete()), 1);

  // Le délai de la facture se libère après minuit : c'est lui qu'on annonce ; avant minuit, minuit.
  const ensemble = await limite({
    envoyees: 1,
    bloquee: true,
    libreLe: libre,
    duJour: 20,
    minuitSuivant: minuit,
  });
  assertEquals(ensemble.corps.details, { reessayerApres: libre.toISOString() });
  const tot = new Date('2026-11-06T20:00:00Z');
  const ensembleTot = await limite({
    envoyees: 1,
    bloquee: true,
    libreLe: tot,
    duJour: 20,
    minuitSuivant: minuit,
  });
  assertEquals(ensembleTot.corps.details, { reessayerApres: minuit.toISOString() });
  // Un délai déjà échu ne bloque pas.
  const { tx: echu } = fausseTransaction({ envoyees: 2, bloquee: false, libreLe: tot });
  assertEquals(await appliquerLimites(echu, 'e', 'f', requete()), 3);
});

Deno.test('un verrou qui n’est pas venu à temps (55P03) : 429 LIMITE, réessayer dans quelques secondes', async () => {
  const avant = Date.now();
  const { status, corps } = await limite({ erreurVerrou: '55P03' });
  assertEquals(status, 429);
  assertEquals(corps.code, 'LIMITE');
  const apres = new Date((corps.details as { reessayerApres: string }).reessayerApres).getTime();
  assert(apres >= avant + 9_000 && apres <= Date.now() + 11_000, String(apres - avant));

  // Toute autre erreur du verrou est une panne, pas une limite.
  const { tx } = fausseTransaction({ erreurVerrou: '08006' });
  const panne = await leve(appliquerLimites(tx, 'e', 'f', requete()));
  assert(panne instanceof Error);
  assert(!(panne instanceof Response));
});
