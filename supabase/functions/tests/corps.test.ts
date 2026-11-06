/**
 * `lireTexte` et `lireObjetPortable` (`_shared/corps.ts`), sans la pile : le corps d'une requête lu
 * avec un plafond, que `content-length` l'annonce ou non, puis lu en JSON portable. Le refus par
 * l'en-tête est aussi éprouvé de bout en bout dans emettre.test.ts.
 */
import { assertEquals } from '@std/assert';
import { lireObjetPortable, lireTexte } from '../_shared/corps.ts';
import { toPortableJson } from '../_vendor/shared/portable.ts';

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

Deno.test('lireObjetPortable : un objet, ses octets rendus en Uint8Array', () => {
  const octets = Uint8Array.of(1, 2, 3);
  const corps = lireObjetPortable(toPortableJson({ pdf: octets, n: 1 }), 'message');
  assertEquals(corps, { pdf: octets, n: 1 });
});

Deno.test('lireObjetPortable : ni du JSON ni un objet, 422 ANOMALIES sous le message donné', async () => {
  for (const texte of ['pas du JSON', '', '[1]', '"texte"', 'null', '{"pdf":{"$bytes":"%%%"}}']) {
    const reponse = await refus(Promise.resolve().then(() => lireObjetPortable(texte, 'message')));
    assertEquals(reponse.status, 422, texte);
    const corps = await reponse.json();
    assertEquals(corps.code, 'ANOMALIES', texte);
    assertEquals(corps.message, 'message', texte);
    assertEquals(corps.details[0].code, 'CORPS', texte);
    assertEquals(corps.details[0].path, '', texte);
  }
});
