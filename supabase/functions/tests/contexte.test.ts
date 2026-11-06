// L'horloge des fonctions (`_shared/contexte.ts`), sans la pile : l'en-tête de test n'est lu que si
// `FACTURX_TESTS` vaut exactement `1` (fichier .env local et CI), jamais en production.
import { assertEquals } from '@std/assert';
import { aujourdhui } from '../_shared/contexte.ts';
import { aujourdhuiParis } from '../emettre/regles.ts';

const requete = (date?: string) =>
  new Request('http://localhost/', { headers: date ? { 'x-facturx-aujourdhui': date } : {} });

/** Exécute `f` avec `FACTURX_TESTS` à `valeur` (absente si `undefined`), puis rétablit l'ancienne. */
function avecFacturxTests(valeur: string | undefined, f: () => void): void {
  const avant = Deno.env.get('FACTURX_TESTS');
  try {
    if (valeur === undefined) Deno.env.delete('FACTURX_TESTS');
    else Deno.env.set('FACTURX_TESTS', valeur);
    f();
  } finally {
    if (avant === undefined) Deno.env.delete('FACTURX_TESTS');
    else Deno.env.set('FACTURX_TESTS', avant);
  }
}

Deno.test('sans FACTURX_TESTS, aujourdhui() ignore l’en-tête x-facturx-aujourdhui', () => {
  for (const valeur of [undefined, '', '0', 'true', ' 1']) {
    avecFacturxTests(valeur, () => {
      assertEquals(aujourdhui(requete('2001-02-03')), aujourdhuiParis(new Date()));
    });
  }
});

Deno.test('avec FACTURX_TESTS=1, aujourdhui() lit l’en-tête, et la date de Paris sans lui', () => {
  avecFacturxTests('1', () => {
    assertEquals(aujourdhui(requete('2001-02-03')), '2001-02-03');
    assertEquals(aujourdhui(requete()), aujourdhuiParis(new Date()));
    // Un en-tête qui n'est pas une date ISO ne remplace pas l'horloge.
    assertEquals(aujourdhui(requete('demain')), aujourdhuiParis(new Date()));
  });
});
