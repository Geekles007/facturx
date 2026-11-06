/**
 * Les expéditeurs de relances (`relancer/brevo.ts`), sans la pile et sans jamais joindre Brevo :
 * `fetch` est remplacé le temps du test. Ce que le client fait de la clé et de la réponse du service
 * (spec § 11 : la clé n'existe que dans les secrets des fonctions) et ce que le simulateur de la pile
 * locale accepte.
 */
import { assert, assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { brevo, ErreurBrevo, expediteurConfigure, simule } from '../relancer/brevo.ts';
import type { MessageBrevo } from '../relancer/message.ts';
import { avecEnv } from './aide.ts';

const message: MessageBrevo = {
  sender: { name: 'Atelier via facturx', email: 'relances@facturx.test' },
  to: [{ email: 'compta@client-demo.fr' }],
  replyTo: { email: 'facturation@exemple.fr' },
  subject: 'Relance',
  htmlContent: '<p>Bonjour</p>',
  textContent: 'Bonjour',
  attachment: [{ name: 'F-2026-0001.pdf', content: btoa('%PDF-1.7\n') }],
};

const CLE = 'cle-brevo-factice-0123456789';

interface Appel {
  url: string;
  methode: string;
  entetes: Headers;
  corps: string;
}

/** Remplace `fetch` par `reponse` le temps de `f` ; rend les appels reçus. */
async function avecFetch(
  reponse: (appel: Appel) => Response | Promise<Response>,
  f: () => Promise<void>,
): Promise<Appel[]> {
  const appels: Appel[] = [];
  const reel = globalThis.fetch;
  globalThis.fetch = async (entree, options) => {
    const appel: Appel = {
      url: String(entree),
      methode: options?.method ?? 'GET',
      entetes: new Headers(options?.headers),
      corps: String(options?.body),
    };
    appels.push(appel);
    return await reponse(appel);
  };
  try {
    await f();
  } finally {
    globalThis.fetch = reel;
  }
  return appels;
}

Deno.test('brevo : POST sur l’API des e-mails transactionnels, la clé dans api-key', async () => {
  const appels = await avecFetch(
    () => Response.json({ messageId: '<202611061200.1@smtp-relay.mailin.fr>' }, { status: 201 }),
    async () => {
      const reponse = await brevo(CLE).envoyer(message);
      assertEquals(reponse, { messageId: '<202611061200.1@smtp-relay.mailin.fr>' });
    },
  );
  assertEquals(appels.length, 1);
  assertEquals(appels[0].url, 'https://api.brevo.com/v3/smtp/email');
  assertEquals(appels[0].methode, 'POST');
  assertEquals(appels[0].entetes.get('api-key'), CLE);
  assertEquals(appels[0].entetes.get('content-type'), 'application/json');
  assertEquals(JSON.parse(appels[0].corps), message);
  // La clé voyage dans l'en-tête, jamais dans le corps ni dans l'adresse.
  assert(!appels[0].corps.includes(CLE));
  assert(!appels[0].url.includes(CLE));
});

Deno.test('brevo : un refus lève une erreur qui porte le statut, ni le corps ni la clé', async () => {
  // Brevo cite parfois dans son message l'adresse refusée, voire un fragment de la requête.
  const corpsDeBrevo = {
    code: 'unauthorized',
    message: `Key not found: ${CLE} ; destinataire compta@client-demo.fr`,
  };
  for (const statut of [400, 401, 402, 403, 429, 500, 503]) {
    await avecFetch(
      () => Response.json(corpsDeBrevo, { status: statut }),
      async () => {
        const erreur = await assertRejects(() => brevo(CLE).envoyer(message), ErreurBrevo);
        assertInstanceOf(erreur, ErreurBrevo);
        assertEquals(erreur.statut, statut);
        // Tout ce que `traiter` pourrait journaliser de l'exception : nom, message, pile, propriétés.
        const visible = JSON.stringify({
          nom: erreur.name,
          message: erreur.message,
          pile: erreur.stack,
          proprietes: Object.fromEntries(Object.entries(erreur)),
        });
        assert(!visible.includes(CLE), 'la clé');
        assert(!visible.includes('Key not found'), 'le corps de la réponse');
        assert(!visible.includes('client-demo'), 'le destinataire cité par la réponse');
        assert(visible.includes(String(statut)));
      },
    );
  }
});

Deno.test('brevo : une panne du réseau est une erreur de statut 0, qui ne cite pas la clé', async () => {
  await avecFetch(
    () => {
      throw new TypeError(`error sending request: api-key ${CLE}`);
    },
    async () => {
      const erreur = await assertRejects(() => brevo(CLE).envoyer(message), ErreurBrevo);
      assertInstanceOf(erreur, ErreurBrevo);
      assertEquals(erreur.statut, 0);
      assert(!JSON.stringify({ message: erreur.message, pile: erreur.stack }).includes(CLE));
      // La cause n'est pas conservée : elle pourrait citer ce que `fetch` a vu de la requête.
      assertEquals(erreur.cause, undefined);
    },
  );
});

Deno.test('brevo : un succès sans identifiant de message n’est pas pris pour un envoi', async () => {
  for (const corps of [{}, { messageId: 12 }, { messageId: '' }]) {
    await avecFetch(
      () => Response.json(corps, { status: 201 }),
      async () => {
        await assertRejects(() => brevo(CLE).envoyer(message), Error, 'identifiant');
      },
    );
  }
});

Deno.test('simule : un identifiant simule-<uuid>, comme Brevo en rendrait un', async () => {
  const { messageId } = await simule().envoyer(message);
  assert(/^simule-[0-9a-f-]{36}$/.test(messageId), messageId);
  assert((await simule().envoyer(message)).messageId !== messageId);
});

Deno.test('simule : refuse ce que Brevo refuserait (message mal formé, domaine refus.test)', async () => {
  const mauvais: Record<string, MessageBrevo> = {
    'sans destinataire': { ...message, to: [] },
    'deux destinataires': { ...message, to: [{ email: 'a@b.fr' }, { email: 'c@d.fr' }] },
    'sans réponse': { ...message, replyTo: { email: '' } },
    'sans expéditeur': { ...message, sender: { name: 'x', email: '' } },
    'sans objet': { ...message, subject: '' },
    'objet sur deux lignes': { ...message, subject: 'a\r\nBcc: c@d.fr' },
    'sans pièce jointe': { ...message, attachment: [] },
    'pièce jointe qui n’est pas un PDF': {
      ...message,
      attachment: [{ name: 'f.pdf', content: btoa('MZ binaire') }],
    },
    'pièce jointe sans nom en .pdf': {
      ...message,
      attachment: [{ name: 'f.exe', content: btoa('%PDF-1.7\n') }],
    },
    'domaine refus.test': { ...message, to: [{ email: 'client@refus.test' }] },
  };
  for (const [cas, m] of Object.entries(mauvais)) {
    const erreur = await assertRejects(() => simule().envoyer(m), ErreurBrevo, undefined, cas);
    assertEquals(erreur.statut, 400, cas);
  }
});

const LOCAL = 'http://127.0.0.1:55421';

Deno.test('expediteurConfigure : la clé « simule » choisit le simulateur, une autre le vrai client', async () => {
  await avecEnv({ BREVO_API_KEY: 'simule', SUPABASE_URL: LOCAL }, async () => {
    const { messageId } = await expediteurConfigure().envoyer(message);
    assert(messageId.startsWith('simule-'));
  });
  // La vraie clé, elle, vaut aussi sur un projet hébergé.
  await avecEnv({ BREVO_API_KEY: CLE, SUPABASE_URL: 'https://abcdefgh.supabase.co' }, async () => {
    const appels = await avecFetch(
      () => Response.json({ messageId: 'reel' }, { status: 201 }),
      async () => {
        assertEquals(await expediteurConfigure().envoyer(message), { messageId: 'reel' });
      },
    );
    assertEquals(appels[0].entetes.get('api-key'), CLE);
  });
});

Deno.test('expediteurConfigure : sans clé, la fonction ne part pas en simulation', async () => {
  for (const valeur of [undefined, '', '  ']) {
    await avecEnv({ BREVO_API_KEY: valeur }, () => {
      let erreur: unknown;
      try {
        expediteurConfigure();
      } catch (e) {
        erreur = e;
      }
      assertInstanceOf(erreur, Error);
      assert(erreur.message.includes('BREVO_API_KEY'));
      assert(!(erreur instanceof ErreurBrevo));
    });
  }
});

Deno.test('expediteurConfigure : « simule » est refusé sur un projet hébergé par Supabase', async () => {
  // Une adresse absente ou illisible compte comme hébergée : la garde ferme par défaut.
  for (const url of ['https://abcdefgh.supabase.co', undefined, 'pas une URL']) {
    await avecEnv({ BREVO_API_KEY: 'simule', SUPABASE_URL: url }, () => {
      let erreur: unknown;
      try {
        expediteurConfigure();
      } catch (e) {
        erreur = e;
      }
      assertInstanceOf(erreur, Error);
      assert(erreur.message.includes('simule'));
    });
  }
});
