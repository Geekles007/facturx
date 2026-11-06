/**
 * `lireTexte` et `lireObjetPortable` (`_shared/corps.ts`), sans la pile : le corps d'une requête lu
 * avec un plafond, que `content-length` l'annonce ou non, puis lu en JSON portable. Le refus par
 * l'en-tête est aussi éprouvé de bout en bout dans emettre.test.ts.
 */
import { assert, assertEquals } from '@std/assert';
import {
  cheminInadmissible,
  exigerAdmissible,
  lireObjetPortable,
  lireTexte,
} from '../_shared/corps.ts';
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

Deno.test('cheminInadmissible : un texte propre, des paires de substituts valides, des octets', () => {
  assertEquals(
    cheminInadmissible({ a: ['é', '🙂', { b: 'x' }], '🙂': 1, n: 3, v: null }),
    undefined,
  );
  assertEquals(cheminInadmissible({ pdf: Uint8Array.of(0, 1, 2) }), undefined);
  assertEquals(cheminInadmissible('texte'), undefined);
});

Deno.test('cheminInadmissible : le chemin du premier caractère nul ou demi-substitut isolé', () => {
  assertEquals(cheminInadmissible({ a: 'x\u0000' }), '.a');
  assertEquals(
    cheminInadmissible({ lignes: [{ ok: 1 }, { b: ['x', 'y\ud800z'] }] }),
    '.lignes[1].b[1]',
  );
  // Moitié haute en fin de texte, moitié basse seule.
  assertEquals(cheminInadmissible(['\ud83d']), '[0]');
  assertEquals(cheminInadmissible(['\ude00 ']), '[0]');
  // Le premier dans l'ordre du document.
  assertEquals(cheminInadmissible({ a: '\u0000', b: { c: '\u0000' } }), '.a');
  // Une clé fautive : le chemin est celui de l'objet qui la porte, la clé n'est pas rendue.
  assertEquals(cheminInadmissible({ x: { 'k\u0000': 1 } }), '.x');
  // Un chemin démesuré est tronqué.
  const cle = 'k'.repeat(1000);
  assert((cheminInadmissible({ [cle]: '\u0000' }) ?? '').length <= 201);
});

Deno.test('cheminInadmissible : une imbrication très profonde ne fait pas déborder la pile', () => {
  let profond: unknown = 'x';
  for (let i = 0; i < 100_000; i++) profond = [profond];
  assertEquals(cheminInadmissible(profond), undefined);
  let fautif: unknown = '\u0000';
  for (let i = 0; i < 100_000; i++) fautif = { a: fautif };
  assert((cheminInadmissible(fautif) ?? '').length <= 201);
});

Deno.test('cheminInadmissible avec contrôles : tout caractère C0 refusé, sauf tabulation et fins de ligne', () => {
  // Sans l'option, seuls le NUL et les demi-substituts sont refusés (ce que jsonb refuse).
  assertEquals(cheminInadmissible({ a: 'x\u0001' }), undefined);
  assertEquals(cheminInadmissible({ a: 'x\u0001' }, true), '.a');
  for (const code of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f]) {
    assertEquals(
      cheminInadmissible(['ok', `a${String.fromCharCode(code)}`], true),
      '[1]',
      `${code}`,
    );
  }
  // Tabulation, saut de ligne, retour chariot, DEL, C1 et caractères non ASCII passent.
  assertEquals(cheminInadmissible(['a\tb\nc\r\nd\u007f\u0085é€🙂'], true), undefined);
  // Les demi-substituts et les clés restent refusés.
  assertEquals(cheminInadmissible({ a: 'x\ud800' }, true), '.a');
  assertEquals(cheminInadmissible({ x: { 'k\u0001': 1 } }, true), '.x');
});

Deno.test('exigerAdmissible avec contrôles : 422 ANOMALIES, le chemin du champ en cause', async () => {
  exigerAdmissible({ objet: 'a\tb', corps: 'a\r\nb' }, '', 'CORPS', 'refusé', true);
  const refus = (valeur: unknown): Response => {
    try {
      exigerAdmissible(valeur, '', 'CORPS', 'refusé', true);
    } catch (e) {
      return e as Response;
    }
    throw new Error('aucun refus');
  };
  for (const [valeur, path] of [
    [{ objet: 'a', corps: 'x\u0000y' }, 'corps'],
    [{ objet: 'a\u001b', corps: 'x' }, 'objet'],
    [{ objet: 'a', corps: 'x\udc00' }, 'corps'],
  ] as const) {
    const reponse = refus(valeur);
    assertEquals(reponse.status, 422);
    const corps = await reponse.json();
    assertEquals(corps.code, 'ANOMALIES');
    assertEquals(corps.message, 'refusé');
    assertEquals(
      corps.details.map((d: { code: string; path: string }) => [d.code, d.path]),
      [['CORPS', path]],
    );
  }
});
