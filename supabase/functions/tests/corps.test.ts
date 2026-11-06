/**
 * `lireTexte` (`_shared/corps.ts`), sans la pile : le corps d'une requête lu avec un plafond, que
 * `content-length` l'annonce ou non. Le refus par l'en-tête est aussi éprouvé de bout en bout dans
 * emettre.test.ts.
 */
import { assertEquals } from '@std/assert';
import { lireTexte } from '../_shared/corps.ts';

/** Un corps envoyé par morceaux, sans `content-length`. */
function parMorceaux(morceaux: string[]): Request {
  const encodeur = new TextEncoder();
  const flux = new ReadableStream<Uint8Array>({
    start(controle) {
      for (const morceau of morceaux) controle.enqueue(encodeur.encode(morceau));
      controle.close();
    },
  });
  return new Request('http://localhost/', { method: 'POST', body: flux });
}

async function refus(promesse: Promise<unknown>): Promise<Response> {
  try {
    await promesse;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  throw new Error('aucun refus');
}

Deno.test('sous le plafond, le corps est rendu en texte, morceaux réassemblés', async () => {
  assertEquals(await lireTexte(parMorceaux(['{"a":', '"é"}']), 100), '{"a":"é"}');
  assertEquals(await lireTexte(new Request('http://localhost/', { method: 'POST' })), '');
});

Deno.test('au-delà du plafond sans content-length : 413 ANOMALIES, Issue CORPS', async () => {
  const reponse = await refus(lireTexte(parMorceaux(['x'.repeat(60), 'x'.repeat(60)]), 100));
  assertEquals(reponse.status, 413);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'CORPS');
});

Deno.test('un content-length au-delà du plafond refuse avant toute lecture', async () => {
  const req = new Request('http://localhost/', {
    method: 'POST',
    body: 'x'.repeat(200),
    headers: { 'content-length': '200' },
  });
  const reponse = await refus(lireTexte(req, 100));
  assertEquals(reponse.status, 413);
  assertEquals(req.bodyUsed, false);
  await reponse.body?.cancel();
});
