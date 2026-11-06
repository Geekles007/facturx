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
  OUVRANTS_MAX,
  PROFONDEUR_MAX,
  serialiser,
  VIRGULES_MAX,
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

/** Un corps à `n` conteneurs ouverts à la fois : `{"a":{"a":…0…}}`. */
const imbrique = (n: number): string => `${'{"a":'.repeat(n)}0${'}'.repeat(n)}`;

/** Un corps `{"a":[0,0,…]}` qui compte exactement `virgules` virgules hors chaînes (2 conteneurs). */
const large = (virgules: number): string =>
  `{"a":[${Array(virgules + 1)
    .fill(0)
    .join(',')}]}`;

/** Un corps `{"a":[[],[],…]}` qui compte exactement `n` conteneurs (n - 3 virgules). */
const conteneurs = (n: number): string =>
  `{"a":[${Array(n - 2)
    .fill('[]')
    .join(',')}]}`;

/** Refuse `texte` : 422 `ANOMALIES`, une `Issue` `CORPS` au chemin vide dont le message cite `plafond`. */
async function refuseParLePlafond(texte: string, plafond: number): Promise<void> {
  const reponse = await refus(Promise.resolve().then(() => lireObjetPortable(texte, 'message')));
  assertEquals(reponse.status, 422);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.message, 'message');
  assertEquals(corps.details.length, 1);
  assertEquals(corps.details[0].code, 'CORPS');
  assertEquals(corps.details[0].path, '');
  assert(corps.details[0].message.includes(String(plafond)), corps.details[0].message);
}

Deno.test('lireObjetPortable : profondeur plafonnée (PROFONDEUR_MAX), avant le décodage', async () => {
  assertEquals(Object.keys(lireObjetPortable(imbrique(PROFONDEUR_MAX), 'message')), ['a']);
  await refuseParLePlafond(imbrique(PROFONDEUR_MAX + 1), PROFONDEUR_MAX);
});

Deno.test('lireObjetPortable : virgules plafonnées (VIRGULES_MAX), avant le décodage', async () => {
  assertEquals(Object.keys(lireObjetPortable(large(VIRGULES_MAX), 'message')), ['a']);
  await refuseParLePlafond(large(VIRGULES_MAX + 1), VIRGULES_MAX);
});

Deno.test('lireObjetPortable : conteneurs plafonnés (OUVRANTS_MAX), avant le décodage', async () => {
  assertEquals(Object.keys(lireObjetPortable(conteneurs(OUVRANTS_MAX), 'message')), ['a']);
  await refuseParLePlafond(conteneurs(OUVRANTS_MAX + 1), OUVRANTS_MAX);
});

Deno.test('lireObjetPortable : 300 000 chaînes de 16 tableaux (peu de virgules, 4,8 millions de conteneurs) sont refusées', async () => {
  // Le premier enfant d'un conteneur n'a pas de virgule : les virgules (299 999) comptent des
  // voisins, non des conteneurs. Ce corps de 9,7 Mio passait le plafond des virgules et épuisait 256 Mo.
  const seize = `${'['.repeat(16)}0${']'.repeat(16)}`;
  const texte = `{"a":[${Array(300_000).fill(seize).join(',')}]}`;
  await refuseParLePlafond(texte, OUVRANTS_MAX);
});

Deno.test('lireObjetPortable : les crochets, accolades et virgules d’une chaîne ne comptent pas', () => {
  // Plus de virgules, de crochets et d'accolades qu'aucun plafond n'en admet, dans une chaîne : rien à
  // compter.
  const chaine = `${','.repeat(VIRGULES_MAX + 1)}${'['.repeat(OUVRANTS_MAX + 1)}${'{'.repeat(PROFONDEUR_MAX + 1)}`;
  assertEquals(lireObjetPortable(JSON.stringify({ a: chaine, b: [1, 2] }), 'message').b, [1, 2]);
});

Deno.test('lireObjetPortable : les guillemets échappés et les barres obliques inverses ne trompent pas le pré-examen', async () => {
  const BARRE = '\\';
  const ouvrants = '['.repeat(PROFONDEUR_MAX + 6);
  // Barre puis guillemet : le guillemet est échappé, la chaîne continue, et les `[` en font partie.
  const dansLaChaine = `{"a":"x${BARRE}"${ouvrants}"}`;
  assertEquals(lireObjetPortable(dansLaChaine, 'message').a, `x"${ouvrants}`);
  // Deux barres puis un guillemet : une barre échappée, le guillemet ferme la chaîne, et les `[`
  // qui suivent sont du JSON.
  const horsDeLaChaine = `{"a":"x${BARRE}${BARRE}","b":${ouvrants}${']'.repeat(PROFONDEUR_MAX + 6)}}`;
  const reponse = await refus(
    Promise.resolve().then(() => lireObjetPortable(horsDeLaChaine, 'message')),
  );
  assertEquals(reponse.status, 422);
  // Une suite de barres : de rang pair, le guillemet ferme la chaîne ; de rang impair, il est échappé.
  assertEquals(lireObjetPortable(`{"a":"${BARRE.repeat(4)}"}`, 'message').a, BARRE.repeat(2));
  assertEquals(lireObjetPortable(`{"a":"${BARRE.repeat(3)}""}`, 'message').a, `${BARRE}"`);
});

Deno.test('lireObjetPortable : sous 256 Mo, les corps de 10 Mio qui épuiseraient le tas sont refusés, et la pire forme admise traverse tout le chemin sous 160 Mio', async () => {
  // `JSON.parse` et son réviseur coûtent bien plus que le texte : un worker qui meurt de mémoire
  // emporte les requêtes des autres. Un processus à part, au tas plafonné. Les plafonds sont choisis
  // par cette mesure : la pire forme qu'ils admettent (conteneurs `{"$bytes":""}` et entrées de clé
  // et de chaîne, tous deux à leur plafond) doit finir sous 160 Mio, décodée, contrôlée et sérialisée.
  const chemin = (nom: string) => decodeURIComponent(new URL(nom, import.meta.url).pathname);
  const sortie = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--config',
      chemin('../deno.json'),
      '--v8-flags=--max-old-space-size=256,--expose-gc',
      chemin('./decodage-large.ts'),
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const decoder = new TextDecoder();
  assertEquals(sortie.code, 0, decoder.decode(sortie.stderr).slice(0, 500));
  const resultat = JSON.parse(decoder.decode(sortie.stdout));
  assertEquals(resultat.refusees, {
    objets_vides: 422,
    tableaux_de_un: 422,
    objets_de_un: 422,
    chaines_de_seize: 422,
    ouvrants: 422,
  });
  // La forme mesurée est bien la pire admise : elle atteint les deux plafonds.
  assertEquals(resultat.pire.conteneurs, OUVRANTS_MAX);
  assertEquals(resultat.pire.virgules, VIRGULES_MAX);
  assert(resultat.pire.tas_Mio < 160, `tas final : ${resultat.pire.tas_Mio} Mio`);
  assert(resultat.pire.vivant_Mio < 160, `tas vivant : ${resultat.pire.vivant_Mio} Mio`);
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

Deno.test('cheminInadmissible : la mémoire suit la profondeur, non la largeur (5 millions d’éléments sous 256 Mo)', async () => {
  // Un tableau large qu'un corps de 10 Mio peut porter : un parcours qui empile chaque élément avant de
  // le visiter dépasse 256 Mo (la limite des Edge Functions hébergées). Un processus à part, au tas
  // plafonné, pour qu'il meure là et non avec les tests.
  const chemin = (nom: string) => decodeURIComponent(new URL(nom, import.meta.url).pathname);
  const sortie = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--config',
      chemin('../deno.json'),
      '--v8-flags=--max-old-space-size=256',
      chemin('./parcours-large.ts'),
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const decoder = new TextDecoder();
  assertEquals(sortie.code, 0, decoder.decode(sortie.stderr).slice(0, 500));
  assertEquals(JSON.parse(decoder.decode(sortie.stdout)), {
    propre: null,
    fautif: '.form.a[4999999]',
  });
});

Deno.test('serialiser : le JSON portable de la valeur ; trop imbriquée, 422 ANOMALIES sous le chemin donné', async () => {
  const valeur = { a: [1, 'é'], pdf: Uint8Array.of(1, 2, 3) };
  assertEquals(serialiser(valeur, 'form', 'CORPS', 'refusé'), toPortableJson(valeur));

  // `toPortableJson` (un remplaçant par nœud) lève bien avant le JSON ordinaire : la lecture du corps
  // en admet davantage que l'écriture.
  let profond: unknown = 'x';
  for (let i = 0; i < 20_000; i++) profond = [profond];
  let reponse: Response | undefined;
  try {
    serialiser(profond, 'form', 'CORPS', 'refusé');
  } catch (e) {
    reponse = e as Response;
  }
  assert(reponse instanceof Response, 'aucun refus');
  assertEquals(reponse.status, 422);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.message, 'refusé');
  assertEquals(
    corps.details.map((d: { code: string; path: string }) => [d.code, d.path]),
    [['CORPS', 'form']],
  );
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
