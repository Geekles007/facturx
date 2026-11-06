/**
 * `traiter` (`_shared/erreurs.ts`), sans la pile : le préflight CORS, les en-têtes CORS sur toutes
 * les réponses, et le 500 `INTERNE` qui ne laisse rien fuir. Le Kong de la pile locale répond lui-même
 * aux préflights (`*`) : c'est ici seulement que la règle des fonctions se voit.
 */
import { assert, assertEquals } from '@std/assert';
import { erreur, json, traiter } from '../_shared/erreurs.ts';
import { avecEnv } from './aide.ts';

const STUDIO = 'http://localhost:8080';
const ORIGINES = `${STUDIO}, https://facturx.example`;

const requete = (method: string, origine?: string) =>
  new Request('http://localhost/functions/v1/emettre', {
    method,
    headers: origine ? { origin: origine } : {},
  });

/** Les en-têtes CORS attendus sur toute réponse, l'origine à part. */
function assertCors(reponse: Response, origine: string | null): void {
  assertEquals(reponse.headers.get('access-control-allow-origin'), origine);
  assertEquals(reponse.headers.get('vary'), 'Origin');
  assertEquals(reponse.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assertEquals(
    reponse.headers.get('access-control-allow-headers'),
    'authorization, apikey, content-type, x-client-info',
  );
}

Deno.test('préflight d’une origine admise : 204, sans jeton ni appel du gestionnaire', async () => {
  let appele = false;
  const servir = traiter(() => {
    appele = true;
    return Promise.resolve(json({}));
  });
  await avecEnv({ FACTURX_ORIGINES: ORIGINES }, async () => {
    const reponse = await servir(requete('OPTIONS', STUDIO));
    assertEquals(reponse.status, 204);
    assertEquals(await reponse.text(), '');
    assertCors(reponse, STUDIO);
  });
  assertEquals(appele, false);
});

Deno.test('origine inconnue, ou aucune origine admise : pas d’en-tête d’origine', async () => {
  const servir = traiter(() => Promise.resolve(json({})));
  await avecEnv({ FACTURX_ORIGINES: ORIGINES }, async () => {
    const inconnue = await servir(requete('OPTIONS', 'https://ailleurs.example'));
    assertEquals(inconnue.status, 204);
    assertCors(inconnue, null);
    // Une origine admise par préfixe seulement ne l'est pas.
    assertCors(await servir(requete('OPTIONS', `${STUDIO}.ailleurs.example`)), null);
  });
  // Sans la variable, rien n'est admis : fermé par défaut.
  await avecEnv({ FACTURX_ORIGINES: undefined }, async () => {
    assertCors(await servir(requete('OPTIONS', STUDIO)), null);
  });
});

Deno.test('les en-têtes CORS sont sur une erreur levée (401) et sur un succès', async () => {
  await avecEnv({ FACTURX_ORIGINES: ORIGINES }, async () => {
    const refus = await traiter(() => {
      throw erreur(401, 'SESSION', 'Session absente.');
    })(requete('POST', STUDIO));
    assertEquals(refus.status, 401);
    assertEquals((await refus.json()).code, 'SESSION');
    assertCors(refus, STUDIO);

    const succes = await traiter(() => Promise.resolve(json({ id: 'x' }, 201)))(
      requete('POST', STUDIO),
    );
    assertEquals(succes.status, 201);
    await succes.body?.cancel();
    assertCors(succes, STUDIO);
  });
});

Deno.test('500 INTERNE : message générique, rien de l’exception dans la réponse, CORS compris', async () => {
  const journal: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => journal.push(args.map(String).join(' '));
  try {
    await avecEnv({ FACTURX_ORIGINES: ORIGINES }, async () => {
      const reponse = await traiter(() => {
        throw new Error('détail interne : mot de passe hunter2');
      })(requete('POST', STUDIO));
      assertEquals(reponse.status, 500);
      const texte = await reponse.text();
      assert(!texte.includes('hunter2') && !texte.includes('détail interne'), texte);
      const corps = JSON.parse(texte);
      assertEquals(corps.code, 'INTERNE');
      assert(/^[0-9a-f-]{36}$/.test(corps.details.requete));
      assertCors(reponse, STUDIO);
      // Le détail va aux journaux, avec l'identifiant de la requête.
      assertEquals(journal.length, 1);
      assert(journal[0].includes(corps.details.requete) && journal[0].includes('hunter2'));
    });
  } finally {
    console.error = consoleError;
  }
});
