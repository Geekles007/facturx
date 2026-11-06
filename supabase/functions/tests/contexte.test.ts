// L'horloge des fonctions (`_shared/contexte.ts`), sans la pile : l'en-tête de test n'est lu que si
// `FACTURX_TESTS` vaut exactement `1` (fichier .env local et CI) et hors d'un projet hébergé par
// Supabase, jamais en production.
import { assertEquals } from '@std/assert';
import { aujourdhui } from '../_shared/contexte.ts';
import { aujourdhuiParis } from '../emettre/regles.ts';
import { avecEnv } from './aide.ts';

const requete = (date?: string) =>
  new Request('http://localhost/', { headers: date ? { 'x-facturx-aujourdhui': date } : {} });

const LOCAL = 'http://127.0.0.1:55421';

Deno.test('sans FACTURX_TESTS, aujourdhui() ignore l’en-tête x-facturx-aujourdhui', async () => {
  for (const valeur of [undefined, '', '0', 'true', ' 1']) {
    await avecEnv({ FACTURX_TESTS: valeur, SUPABASE_URL: LOCAL }, () => {
      assertEquals(aujourdhui(requete('2001-02-03')), aujourdhuiParis(new Date()));
    });
  }
});

Deno.test('avec FACTURX_TESTS=1, aujourdhui() lit l’en-tête, et la date de Paris sans lui', async () => {
  await avecEnv({ FACTURX_TESTS: '1', SUPABASE_URL: LOCAL }, () => {
    assertEquals(aujourdhui(requete('2001-02-03')), '2001-02-03');
    assertEquals(aujourdhui(requete()), aujourdhuiParis(new Date()));
    // Un en-tête qui n'est pas une date ISO ne remplace pas l'horloge.
    assertEquals(aujourdhui(requete('demain')), aujourdhuiParis(new Date()));
  });
});

Deno.test('même avec FACTURX_TESTS=1, un projet hébergé par Supabase ignore l’en-tête', async () => {
  // Une adresse absente ou illisible compte comme hébergée : la garde ferme par défaut.
  for (const url of [
    'https://abcdefgh.supabase.co',
    'https://supabase.co',
    undefined,
    'pas une URL',
  ]) {
    await avecEnv({ FACTURX_TESTS: '1', SUPABASE_URL: url }, () => {
      assertEquals(aujourdhui(requete('2001-02-03')), aujourdhuiParis(new Date()));
    });
  }
});
