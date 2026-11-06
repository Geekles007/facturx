/**
 * Les Edge Functions `supprimer-compte` et `purger` contre la pile locale (plan, tâche 12 ; spec § 7,
 * § 11, § 12 et § 14) : la demande de suppression avec ses 30 jours de grâce, le refus d'émettre,
 * d'importer et de relancer pendant le délai, la purge de nuit (Storage, Auth, base) et le ménage des
 * PDF orphelins. Chaque test crée ses comptes.
 *
 * `purger` efface pour de bon, et la pile peut contenir autre chose que ce que ces tests y ont mis :
 * avant chaque passe, `purger()` vérifie qu'aucune entreprise échue n'est étrangère au test, et
 * refuse sinon de la lancer. Un test qui demande la suppression d'une entreprise la remet en règle à sa
 * sortie (`essai`), purgée ou non, pour ne pas laisser à un autre passage une suppression échue.
 *
 * Les PDF orphelins se comptent de façon relative : la pile garde ses traces d'autres essais, que la
 * passe efface avec les nôtres.
 */
import { assert, assertEquals, assertExists, assertMatch, assertRejects } from '@std/assert';
import { AuthApiError, AuthRetryableFetchError, createClient } from '@supabase/supabase-js';
import type { Invoice } from 'facturx-sdk';
import { aujourdhuiParis } from '../_shared/dates.ts';
import { type ClientAuth, supprimerUtilisateur } from '../purger/auth.ts';
import {
  LONGUEUR_MINIMALE,
  SECRET_D_EXEMPLE,
  secretConfigure,
  secretValide,
} from '../purger/secret.ts';
import {
  admin,
  apparenceDeTest,
  appeler,
  appelerTexte,
  avecEnv,
  base,
  brouillonDeTest,
  creerCompte,
  decaler,
  factureDeTest,
  pdfFactureX,
  urlFonction,
} from './aide.ts';

type Compte = Awaited<ReturnType<typeof creerCompte>>;
// biome-ignore lint/suspicious/noExplicitAny: corps de réponse JSON, lu champ par champ par les assertions
type Corps = Record<string, any>;

/** L'oid du type `uuid[]` de Postgres, que postgres.js ne devine pas pour un paramètre. */
const UUID_ARRAY = 2951;

const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const aujourdhui = (): string => aujourdhuiParis(new Date());

// ---------------------------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------------------------

function secretDePurge(): string {
  const secret = Deno.env.get('PURGE_SECRET');
  if (!secret) throw new Error('PURGE_SECRET : à définir (pnpm compte:test le tire de .env).');
  return secret;
}

/** Les entreprises dont le test a demandé la suppression : l'enveloppe `essai` les remet en règle. */
const demandees = new Set<string>();

/**
 * Un test de la pile : à sa sortie, réussi ou non, les entreprises dont il a demandé la suppression
 * (`supprimerCompte`) ou antidaté la demande sont remises en règle, purgées ou non. Une demande qui
 * resterait finirait échue, trente jours plus tard, et un autre passage de `purger` l'effacerait.
 */
function essai(nom: string, f: () => Promise<void>): void {
  Deno.test(nom, async () => {
    try {
      await f();
    } finally {
      const ids = [...demandees];
      demandees.clear();
      await base(
        (sql) => sql`
          update entreprises set suppression_demandee_le = null
           where id = any(${sql.array(ids, UUID_ARRAY)}::uuid[])`,
      );
    }
  });
}

/** Appelle `supprimer-compte` comme le Studio. */
async function supprimerCompte(
  compte: Compte,
  action: unknown,
  supplement: Record<string, unknown> = {},
): Promise<{ status: number; corps: Corps }> {
  if (action === 'demander') demandees.add(compte.entrepriseId);
  const reponse = await appeler('supprimer-compte', compte.jwt, { action, ...supplement });
  return { status: reponse.status, corps: await reponse.json() };
}

/** `suppression_demandee_le` de l'entreprise (`undefined` : l'entreprise n'existe plus). */
function dateDeSuppression(entrepriseId: string): Promise<Date | null | undefined> {
  return base(async (sql) => {
    const [ligne] = await sql<{ d: Date | null }[]>`
      select suppression_demandee_le as d from entreprises where id = ${entrepriseId}`;
    return ligne?.d;
  });
}

/** Antidate la demande de suppression de l'entreprise de `jours` jours. */
async function antidater(entrepriseId: string, jours: number): Promise<void> {
  demandees.add(entrepriseId);
  await base(
    (sql) => sql`
      update entreprises set suppression_demandee_le = now() - make_interval(days => ${jours})
       where id = ${entrepriseId}`,
  );
}

/** Les tables de `public` qui portent une `entreprise_id` : celles qu'une purge doit vider. */
function tablesDEntreprise(): Promise<string[]> {
  return base(async (sql) => {
    const lignes = await sql<{ table_name: string }[]>`
      select c.table_name from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'entreprise_id'
         and t.table_type = 'BASE TABLE'
       order by 1`;
    return lignes.map((ligne) => ligne.table_name);
  });
}

interface Etat {
  /** Nombre de lignes de l'entreprise, table par table (`entreprises` comprise). */
  lignes: Record<string, number>;
  /** Objets du dossier de l'entreprise dans les buckets `factures` et `fichiers`. */
  objets: { factures: number; fichiers: number };
}

/** Ce qu'il reste de l'entreprise : ses lignes et ses objets, lus dans la base. */
async function etat(entrepriseId: string): Promise<Etat> {
  const tables = await tablesDEntreprise();
  return await base(async (sql) => {
    const lignes: Record<string, number> = {};
    for (const table of tables) {
      const [{ n }] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.${table} where entreprise_id = $1`,
        [entrepriseId],
      );
      lignes[table] = n;
    }
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from entreprises where id = ${entrepriseId}`;
    lignes.entreprises = n;
    const objets = await sql<{ bucket_id: string; n: number }[]>`
      select bucket_id, count(*)::int as n from storage.objects
       where bucket_id in ('factures', 'fichiers') and starts_with(name, ${`${entrepriseId}/`})
       group by bucket_id`;
    const compter = (bucket: string) => objets.find((o) => o.bucket_id === bucket)?.n ?? 0;
    return { lignes, objets: { factures: compter('factures'), fichiers: compter('fichiers') } };
  });
}

/** L'état d'une entreprise sans plus rien : aucune ligne, aucun objet. */
async function etatVide(): Promise<Etat> {
  const lignes: Record<string, number> = { entreprises: 0 };
  for (const table of await tablesDEntreprise()) lignes[table] = 0;
  return { lignes, objets: { factures: 0, fichiers: 0 } };
}

/** L'utilisateur existe-t-il encore dans Auth ? */
async function utilisateurExiste(userId: string): Promise<boolean> {
  const { data, error } = await admin().auth.admin.getUserById(userId);
  if (error) {
    assertEquals(error.status, 404, error.message);
    return false;
  }
  return data.user !== null;
}

/** Le compte peut-il encore se connecter avec son mot de passe ? */
async function seConnecte(compte: Compte): Promise<boolean> {
  const anonyme = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await anonyme.auth.signInWithPassword({
    email: compte.email,
    password: compte.password,
  });
  return !error && data.session !== null;
}

/** Le fichier existe-t-il dans le Storage (l'API le lit, pas seulement la base) ? */
async function fichierExiste(bucket: string, chemin: string): Promise<boolean> {
  const { error } = await admin().storage.from(bucket).download(chemin);
  return error === null;
}

/** Une entreprise avec de quoi remplir chaque table, chaque bucket et le délai d'une relance. */
interface Garnie extends Compte {
  factureId: string;
  /** Le PDF de la facture (bucket `factures`), le logo et un fichier d'un sous-dossier (`fichiers`). */
  pdf: string;
  logo: string;
  fichierProfond: string;
}

/**
 * Un compte confirmé, dont l'entreprise a un SIREN et un nom (de quoi relancer), un client, un
 * produit, un brouillon, une facture en retard avec son PDF, un avoir qui la cite, un paiement, une
 * relance d'il y a dix jours, un logo et un fichier de sous-dossier : une ligne dans chaque table
 * (`etat` le vérifie) et des objets dans les deux buckets.
 */
async function entrepriseGarnie(): Promise<Garnie> {
  const compte = await creerCompte();
  const e = compte.entrepriseId;
  const factureId = crypto.randomUUID();
  const avoirId = crypto.randomUUID();
  const pdf = `${e}/${factureId}.pdf`;
  const logo = `${e}/logo-essai`;
  const fichierProfond = `${e}/dossier/profond.png`;
  const jour = aujourdhui();
  await base(async (sql) => {
    await sql`
      update entreprises
         set profil = jsonb_set(
               jsonb_set(profil, '{seller,siren}', to_jsonb(${'443061841'}::text)),
               '{seller,name}', to_jsonb(${'Atelier Exemple SAS'}::text))
       where id = ${e}`;
    await sql`insert into clients (id, entreprise_id, party, nom) values ('c1', ${e}, '{}', 'Client')`;
    await sql`insert into produits (id, entreprise_id, fiche, nom) values ('p1', ${e}, '{}', 'Produit')`;
    await sql`
      insert into factures (id, entreprise_id, numero, type_code, date_emission, date_echeance,
                            client_nom, devise, ht, ttc, net_a_payer, invoice, form, appearance,
                            pdf_chemin, sdk_version, facture_origine_id, origine, emise_par)
      values (${factureId}, ${e}, ${`F-${factureId.slice(0, 8)}`}, '380', ${decaler(jour, -60)}::date,
              ${decaler(jour, -10)}::date, 'Client Démo SARL', 'EUR', 100000, 120000, 120000,
              '{}', '{}', '{}', ${pdf}, '0', null, 'emise', ${compte.userId}),
             (${avoirId}, ${e}, ${`A-${avoirId.slice(0, 8)}`}, '381', ${decaler(jour, -30)}::date,
              null, 'Client Démo SARL', 'EUR', 4000, 5000, 5000,
              '{}', '{}', '{}', ${`${e}/${avoirId}.pdf`}, '0', ${factureId}, 'emise', ${compte.userId})`;
    await sql`
      insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par)
      values (${e}, ${factureId}, ${jour}::date, 1000, 'virement', ${compte.userId})`;
    await sql`
      insert into relances (entreprise_id, facture_id, niveau, envoyee_le, destinataire, objet, corps,
                            message_id, etat)
      values (${e}, ${factureId}, 1, now() - interval '10 days', 'compta@client-demo.fr', 'o', 'c',
              'consigne', 'envoyee')`;
  });
  await brouillonDeTest(e);

  const factures = admin().storage.from('factures');
  const fichiers = admin().storage.from('fichiers');
  const depots = [
    await factures.upload(pdf, PDF, { contentType: 'application/pdf' }),
    await fichiers.upload(logo, PNG, { contentType: 'image/png' }),
    await fichiers.upload(fichierProfond, PNG, { contentType: 'image/png' }),
  ];
  for (const depot of depots) {
    if (depot.error) throw new Error(`objet de test : ${depot.error.message}`);
  }
  const garnie = { ...compte, factureId, pdf, logo, fichierProfond };
  // Le garnissage couvre chaque table et chaque bucket : « plus rien » vaut quelque chose.
  const avant = await etat(e);
  for (const [table, n] of Object.entries(avant.lignes)) assert(n > 0, `${table} : ${n} ligne`);
  assertEquals(avant.objets, { factures: 1, fichiers: 2 });
  return garnie;
}

/** Appelle `purger` : méthode et en-têtes au choix, le secret de la pile par défaut. */
function appelerPurge(
  options: { methode?: string; secret?: string | null } = {},
): Promise<Response> {
  const secret = options.secret === undefined ? secretDePurge() : options.secret;
  return fetch(urlFonction('purger'), {
    method: options.methode ?? 'POST',
    headers: {
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      ...(secret === null ? {} : { 'x-purge-secret': secret }),
    },
    body: options.methode === 'GET' ? undefined : '{}',
  });
}

/**
 * Lance une passe de `purger`. Refuse de la lancer si une entreprise échue n'est pas l'une des
 * `miennes` : elle serait purgée avec elles.
 */
async function purger(...miennes: Pick<Compte, 'entrepriseId'>[]): Promise<{
  status: number;
  corps: Corps;
}> {
  const ids = miennes.map((e) => e.entrepriseId);
  const etrangeres = await base(
    (sql) => sql<{ id: string }[]>`
      select id from entreprises
       where suppression_demandee_le < now() - interval '30 days'
         and id <> all(${sql.array(ids, UUID_ARRAY)}::uuid[])`,
  );
  if (etrangeres.length > 0) {
    throw new Error(
      `entreprises échues étrangères au test, ${etrangeres.map((l) => l.id).join(', ')} : ` +
        'purger les effacerait ; remettre leur suppression en règle avant de relancer.',
    );
  }
  const reponse = await appelerPurge();
  return { status: reponse.status, corps: await reponse.json() };
}

/**
 * Exécute `f` pendant qu'un déclencheur, propre au test, fait échouer toute suppression des lignes de
 * `table` qui satisfont `quand` (une condition sur `old`, écrite avec des identifiants du test).
 */
async function avecRefus<T>(
  table: 'auth.users' | 'storage.objects' | 'public.entreprises',
  quand: string,
  f: () => Promise<T>,
): Promise<T> {
  const nom = `essai_refus_purge_${crypto.randomUUID().replaceAll('-', '')}`;
  await base(async (sql) => {
    await sql.unsafe(`
      create or replace function public.essai_refus_purge() returns trigger language plpgsql as $f$
      begin raise exception 'essai: la base refuse cette suppression'; end $f$`);
    await sql.unsafe(`
      create trigger ${nom} before delete on ${table}
      for each row when (${quand}) execute function public.essai_refus_purge()`);
  });
  try {
    return await f();
  } finally {
    await base(async (sql) => {
      await sql.unsafe(`drop trigger if exists ${nom} on ${table}`);
      await sql.unsafe('drop function if exists public.essai_refus_purge()');
    });
  }
}

/**
 * Exécute `f` pendant qu'une transaction du test tient la ligne de l'utilisateur dans `auth.users` :
 * le serveur d'auth, qui le supprime, attend. `f` reçoit le processus de la transaction du test et rend
 * un objet (et non une promesse) pour que la transaction se termine avant qu'on en attende le résultat.
 */
async function avecUtilisateurTenu<T extends object>(
  userId: string,
  f: (pid: number) => Promise<T>,
): Promise<T> {
  let resultat: T | undefined;
  await base((sql) =>
    sql.begin(async (tx) => {
      await tx`select 1 from auth.users where id = ${userId} for update`;
      const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      resultat = await f(pid);
    }),
  );
  return resultat as T;
}

/** Attend qu'un processus de la base patiente derrière la transaction du test, de processus `pid`. */
async function attendreLeBlocage(pid: number): Promise<void> {
  const limite = Date.now() + 20_000;
  for (;;) {
    const [{ n }] = await base(
      (sql) => sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity a
         where ${pid}::int = any(pg_blocking_pids(a.pid))`,
    );
    if (n > 0) return;
    if (Date.now() > limite) throw new Error('aucun processus n’attend la transaction du test');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ---------------------------------------------------------------------------------------------
// Le secret
// ---------------------------------------------------------------------------------------------

const LOCAL = 'http://127.0.0.1:55421';
const HEBERGE = 'https://abcdefgh.supabase.co';

Deno.test('secret : fermé par défaut, comparé en entier', async () => {
  await avecEnv({ PURGE_SECRET: 'un-secret-de-test', SUPABASE_URL: LOCAL }, async () => {
    assert(await secretValide('un-secret-de-test'));
    assert(secretConfigure());
    for (const recu of [
      null,
      '',
      'un-secret-de-tes',
      'un-secret-de-test ',
      'un-secret-de-testX',
      'Un-secret-de-test',
      'un-secret-de',
    ]) {
      assertEquals(await secretValide(recu), false, JSON.stringify(recu));
    }
  });
  // Un secret absent ou vide refuse tout, y compris un en-tête absent ou vide (deux vides ne
  // s'égalent pas), en local comme sur un projet hébergé.
  for (const url of [LOCAL, HEBERGE]) {
    for (const attendu of [undefined, '']) {
      await avecEnv({ PURGE_SECRET: attendu, SUPABASE_URL: url }, async () => {
        assertEquals(secretConfigure(), false);
        for (const recu of [null, '', 'un-secret-de-test', 'undefined']) {
          assertEquals(await secretValide(recu), false, JSON.stringify([url, attendu, recu]));
        }
      });
    }
  }
});

Deno.test('secret : sur un projet hébergé, ni celui d’exemple ni un secret de moins de 32 caractères', async () => {
  // Le secret d'exemple est celui de `.env.example`, que la CI et les essais locaux emploient.
  const exemple = (await Deno.readTextFile(new URL('../.env.example', import.meta.url)))
    .split('\n')
    .find((ligne) => ligne.startsWith('PURGE_SECRET='))
    ?.slice('PURGE_SECRET='.length);
  assertEquals(exemple, SECRET_D_EXEMPLE);

  const court = 'a'.repeat(LONGUEUR_MINIMALE - 1);
  const long = 'a'.repeat(LONGUEUR_MINIMALE);
  // En local, tout secret non vide sert, celui d'exemple compris.
  for (const secret of [SECRET_D_EXEMPLE, court, long]) {
    await avecEnv({ PURGE_SECRET: secret, SUPABASE_URL: LOCAL }, async () => {
      assertEquals(await secretValide(secret), true, secret);
    });
  }
  // Hébergé : seul un secret d'au moins 32 caractères, et qui n'est pas celui d'exemple.
  for (const [secret, admis] of [
    [SECRET_D_EXEMPLE, false],
    [court, false],
    [long, true],
    [crypto.randomUUID() + crypto.randomUUID(), true],
  ] as const) {
    await avecEnv({ PURGE_SECRET: secret, SUPABASE_URL: HEBERGE }, async () => {
      assertEquals(await secretValide(secret), admis, secret);
      assertEquals(secretConfigure(), admis, secret);
    });
  }
  // Une adresse absente ou illisible compte comme hébergée : la garde ferme par défaut.
  for (const url of [undefined, 'pas une URL']) {
    await avecEnv({ PURGE_SECRET: SECRET_D_EXEMPLE, SUPABASE_URL: url }, async () => {
      assertEquals(await secretValide(SECRET_D_EXEMPLE), false);
    });
  }
});

Deno.test('supprimerUtilisateur : un utilisateur déjà supprimé n’est pas une erreur, toute autre erreur est levée', async () => {
  const client = (error: Error | null) =>
    ({
      auth: { admin: { deleteUser: () => Promise.resolve({ data: { user: null }, error }) } },
    }) as unknown as ClientAuth;
  // Supprimé, ou déjà supprimé (404, avec ou sans code) : la purge se rejoue.
  await supprimerUtilisateur('un-id', client(null));
  await supprimerUtilisateur(
    'un-id',
    client(new AuthApiError('User not found', 404, 'user_not_found')),
  );
  await supprimerUtilisateur('un-id', client(new AuthApiError('Not found', 404, undefined)));
  await supprimerUtilisateur('un-id', client(new AuthApiError('Gone', 400, 'user_not_found')));
  // Une panne, un refus, un réseau qui coupe : l'entreprise est reprise à la passe suivante.
  for (const erreur of [
    new AuthApiError('Database error deleting user', 500, 'unexpected_failure'),
    new AuthApiError('Forbidden', 403, 'not_admin'),
    new AuthRetryableFetchError('Database error deleting user', 500),
    new Error('réseau'),
  ]) {
    await assertRejects(() => supprimerUtilisateur('un-id', client(erreur)), Error, erreur.message);
  }
});

essai('purger : sans le secret, ou avec un autre, 401 et rien n’est purgé', async () => {
  const compte = await entrepriseGarnie();
  await supprimerCompte(compte, 'demander');
  await antidater(compte.entrepriseId, 31);
  const avant = await etat(compte.entrepriseId);

  const secret = secretDePurge();
  const faux = [null, '', 'autre', secret.slice(0, -1), `${secret}x`, secret.toUpperCase()];
  for (const recu of faux.filter((r) => r !== secret)) {
    const reponse = await appelerPurge({ secret: recu });
    assertEquals(reponse.status, 401, JSON.stringify(recu));
    const corps = await reponse.json();
    assertEquals(corps.code, 'SESSION');
    // La réponse ne dit ni si le secret manque côté serveur, ni lequel est attendu.
    assert(!JSON.stringify(corps).includes(secret));
  }
  assertEquals(await etat(compte.entrepriseId), avant);
  assertEquals(await utilisateurExiste(compte.userId), true);
});

essai(
  'purger : seul POST est admis (405), même avec le bon secret, et rien n’est purgé',
  async () => {
    const compte = await entrepriseGarnie();
    await supprimerCompte(compte, 'demander');
    await antidater(compte.entrepriseId, 31);
    const avant = await etat(compte.entrepriseId);
    for (const methode of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const reponse = await appelerPurge({ methode });
      assertEquals(reponse.status, 405, methode);
      assertEquals(reponse.headers.get('allow'), 'POST');
      const corps: Corps = await reponse.json();
      assertEquals(Object.keys(corps).sort(), ['code', 'message']);
      assertEquals(corps.code, 'METHODE');
    }
    assertEquals(await etat(compte.entrepriseId), avant);
  },
);

// ---------------------------------------------------------------------------------------------
// supprimer-compte
// ---------------------------------------------------------------------------------------------

essai(
  'supprimer-compte : demander pose la date, une seconde demande ne la repousse pas, annuler l’efface',
  async () => {
    const compte = await creerCompte();
    const voisin = await creerCompte();
    assertEquals(await dateDeSuppression(compte.entrepriseId), null);

    const premiere = await supprimerCompte(compte, 'demander');
    assertEquals(premiere.status, 200, JSON.stringify(premiere.corps));
    assertEquals(Object.keys(premiere.corps), ['suppressionDemandeeLe']);
    const posee = await dateDeSuppression(compte.entrepriseId);
    assertExists(posee);
    assertEquals(new Date(premiere.corps.suppressionDemandeeLe).getTime(), posee.getTime());
    assert(Date.now() - posee.getTime() < 60_000 && posee.getTime() <= Date.now() + 1_000);

    // Antidatée de cinq jours, la demande reste à sa date : le délai ne se repousse pas.
    await antidater(compte.entrepriseId, 5);
    const ancienne = await dateDeSuppression(compte.entrepriseId);
    assertExists(ancienne);
    const encore = await supprimerCompte(compte, 'demander');
    assertEquals(encore.status, 200);
    assertEquals(new Date(encore.corps.suppressionDemandeeLe).getTime(), ancienne.getTime());
    assertEquals((await dateDeSuppression(compte.entrepriseId))?.getTime(), ancienne.getTime());

    // Annuler remet la date à nul, et se répète sans erreur.
    for (let i = 0; i < 2; i++) {
      const annulee = await supprimerCompte(compte, 'annuler');
      assertEquals(annulee.status, 200);
      assertEquals(annulee.corps, { suppressionDemandeeLe: null });
      assertEquals(await dateDeSuppression(compte.entrepriseId), null);
    }
    // L'entreprise voisine n'a jamais été touchée.
    assertEquals(await dateDeSuppression(voisin.entrepriseId), null);
  },
);

essai(
  'supprimer-compte : la demande vaut pour l’entreprise du jeton, pas pour une autre',
  async () => {
    const compte = await creerCompte();
    const voisin = await creerCompte();
    // Une entreprise lue dans le corps ne compte pas : seule celle du compte est visée.
    const reponse = await supprimerCompte(compte, 'demander', {
      entrepriseId: voisin.entrepriseId,
    });
    assertEquals(reponse.status, 200);
    assertExists(await dateDeSuppression(compte.entrepriseId));
    assertEquals(await dateDeSuppression(voisin.entrepriseId), null);
  },
);

essai(
  'supprimer-compte : corps invalide 422 ANOMALIES, sans jeton 401 SESSION, rien n’est changé',
  async () => {
    const compte = await creerCompte();
    for (const corps of [{}, { action: 'supprimer' }, { action: 1 }, { action: null }, []]) {
      const reponse = await appeler('supprimer-compte', compte.jwt, corps);
      const lu: Corps = await reponse.json();
      assertEquals(reponse.status, 422, JSON.stringify(corps));
      assertEquals(lu.code, 'ANOMALIES');
      assertEquals(lu.details[0].code, 'CORPS');
    }
    const pasDuJson = await appelerTexte('supprimer-compte', compte.jwt, 'pas du json');
    assertEquals(pasDuJson.status, 422);
    await pasDuJson.body?.cancel();
    assertEquals(await dateDeSuppression(compte.entrepriseId), null);

    for (const jwt of ['', `${compte.jwt.slice(0, -4)}AAAA`]) {
      const reponse = await appeler('supprimer-compte', jwt, { action: 'demander' });
      assertEquals(reponse.status, 401);
      assertEquals((await reponse.json()).code, 'SESSION');
    }
    assertEquals(await dateDeSuppression(compte.entrepriseId), null);
  },
);

// ---------------------------------------------------------------------------------------------
// Le refus pendant le délai : emettre, importer, relancer
// ---------------------------------------------------------------------------------------------

/** Le refus 403 `SUPPRESSION`, ou échoue. */
function estRefuse(status: number, corps: Corps): void {
  assertEquals(status, 403, JSON.stringify(corps));
  assertEquals(corps.code, 'SUPPRESSION');
  assertMatch(corps.message, /suppression du compte/);
}

essai(
  'emettre : refusé pendant le délai (403 SUPPRESSION), rien n’est consommé ; après annuler, il émet',
  async () => {
    const compte = await creerCompte();
    const brouillon = await brouillonDeTest(compte.entrepriseId);
    const emettre = async () => {
      const reponse = await appeler('emettre', compte.jwt, {
        brouillonId: brouillon.id,
        version: brouillon.version,
        invoice: factureDeTest(),
        appearance: apparenceDeTest(),
      });
      return { status: reponse.status, corps: (await reponse.json()) as Corps };
    };
    const prochain = () =>
      base(async (sql) => {
        const [n] = await sql<{ prochain: number }[]>`
        select prochain from numerotation where entreprise_id = ${compte.entrepriseId}`;
        return n.prochain;
      });

    assertEquals((await supprimerCompte(compte, 'demander')).status, 200);
    const { status, corps } = await emettre();
    estRefuse(status, corps);
    // Aucun numéro consommé, ni facture, ni PDF ; le brouillon est intact.
    assertEquals(await prochain(), 1);
    assertEquals((await etat(compte.entrepriseId)).lignes.factures, 0);
    assertEquals((await etat(compte.entrepriseId)).objets.factures, 0);
    assertEquals((await etat(compte.entrepriseId)).lignes.brouillons, 1);

    assertEquals((await supprimerCompte(compte, 'annuler')).status, 200);
    const apres = await emettre();
    assertEquals(apres.status, 201, JSON.stringify(apres.corps));
    assertEquals(await prochain(), 2);
  },
);

essai(
  'importer : refusé pendant le délai (403 SUPPRESSION), rien n’est importé ; après annuler, il importe',
  async () => {
    const compte = await creerCompte();
    const numero = `LOCAL-${crypto.randomUUID().slice(0, 8)}`;
    const facture: Invoice = {
      ...factureDeTest(1, '2025-03-14'),
      id: numero,
      remittanceInformation: numero,
    };
    const pdf = await pdfFactureX(facture);
    const importer = async () => {
      const reponse = await appeler('importer', compte.jwt, {
        form: { id: numero },
        appearance: apparenceDeTest(),
        pdf,
      });
      return { status: reponse.status, corps: (await reponse.json()) as Corps };
    };

    assertEquals((await supprimerCompte(compte, 'demander')).status, 200);
    const { status, corps } = await importer();
    estRefuse(status, corps);
    assertEquals((await etat(compte.entrepriseId)).lignes.factures, 0);
    assertEquals((await etat(compte.entrepriseId)).objets.factures, 0);

    assertEquals((await supprimerCompte(compte, 'annuler')).status, 200);
    const apres = await importer();
    assertEquals(apres.status, 201, JSON.stringify(apres.corps));
    assertEquals(apres.corps.numero, numero);
  },
);

essai(
  'relancer : refusé pendant le délai (403 SUPPRESSION), rien ne part ; après annuler, il relance',
  async () => {
    const compte = await entrepriseGarnie();
    const relancer = async () => {
      const reponse = await appeler('relancer', compte.jwt, {
        factureId: compte.factureId,
        destinataire: 'compta@client-demo.fr',
        objet: 'Relance',
        corps: 'Bonjour, la facture est en retard.',
      });
      return { status: reponse.status, corps: (await reponse.json()) as Corps };
    };

    assertEquals((await supprimerCompte(compte, 'demander')).status, 200);
    const { status, corps } = await relancer();
    estRefuse(status, corps);
    // Pas de nouvelle ligne : la relance d'il y a dix jours est la seule.
    assertEquals((await etat(compte.entrepriseId)).lignes.relances, 1);

    assertEquals((await supprimerCompte(compte, 'annuler')).status, 200);
    const apres = await relancer();
    assertEquals(apres.status, 201, JSON.stringify(apres.corps));
    assertEquals(apres.corps.niveau, 2);
    assertEquals((await etat(compte.entrepriseId)).lignes.relances, 2);
  },
);

// ---------------------------------------------------------------------------------------------
// La purge d'une entreprise
// ---------------------------------------------------------------------------------------------

essai(
  'purger : 31 jours, tout s’efface (base, Storage, Auth) ; 29 jours et l’entreprise voisine restent intactes',
  async () => {
    const echue = await entrepriseGarnie();
    const recente = await entrepriseGarnie();
    const voisine = await entrepriseGarnie();
    assertEquals((await supprimerCompte(echue, 'demander')).status, 200);
    assertEquals((await supprimerCompte(recente, 'demander')).status, 200);
    await antidater(echue.entrepriseId, 31);
    await antidater(recente.entrepriseId, 29);
    const avantRecente = await etat(recente.entrepriseId);
    const avantVoisine = await etat(voisine.entrepriseId);

    const { status, corps } = await purger(echue, recente);
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(Object.keys(corps).sort(), ['comptes', 'orphelins']);
    assertEquals(corps.comptes, 1);
    assert(Number.isInteger(corps.orphelins) && corps.orphelins >= 0);

    // L'échue : plus une ligne, plus un objet (ni dans la base, ni dans le Storage), plus d'utilisateur.
    assertEquals(await etat(echue.entrepriseId), await etatVide());
    for (const [bucket, chemin] of [
      ['factures', echue.pdf],
      ['fichiers', echue.logo],
      ['fichiers', echue.fichierProfond],
    ]) {
      assertEquals(await fichierExiste(bucket, chemin), false, `${bucket}/${chemin}`);
    }
    assertEquals(await utilisateurExiste(echue.userId), false);
    assertEquals(await seConnecte(echue), false);
    // Sa session ne vaut plus rien : le serveur d'auth refuse le jeton.
    const ancienJeton = await appeler('supprimer-compte', echue.jwt, { action: 'annuler' });
    assertEquals(ancienJeton.status, 401);
    await ancienJeton.body?.cancel();

    // La demande de 29 jours et l'entreprise sans demande n'ont rien perdu.
    for (const [compte, avant] of [
      [recente, avantRecente],
      [voisine, avantVoisine],
    ] as const) {
      assertEquals(await etat(compte.entrepriseId), avant);
      assertEquals(await utilisateurExiste(compte.userId), true);
      assertEquals(await seConnecte(compte), true);
      assertEquals(await fichierExiste('factures', compte.pdf), true);
      assertEquals(await fichierExiste('fichiers', compte.logo), true);
      assertEquals(await fichierExiste('fichiers', compte.fichierProfond), true);
    }
    assertExists(await dateDeSuppression(recente.entrepriseId));
    assertEquals(await dateDeSuppression(voisine.entrepriseId), null);
  },
);

essai(
  'purger : repassée aussitôt, elle ne trouve plus rien ({ orphelins: 0, comptes: 0 })',
  async () => {
    const echue = await entrepriseGarnie();
    await supprimerCompte(echue, 'demander');
    await antidater(echue.entrepriseId, 40);
    const premiere = await purger(echue);
    assertEquals(premiere.status, 200, JSON.stringify(premiere.corps));
    assertEquals(premiere.corps.comptes, 1);

    const seconde = await purger();
    assertEquals(seconde.status, 200, JSON.stringify(seconde.corps));
    assertEquals(seconde.corps, { orphelins: 0, comptes: 0 });
  },
);

essai(
  'purger : un utilisateur qui est aussi membre d’une autre entreprise reste, avec cette entreprise',
  async () => {
    const echue = await entrepriseGarnie();
    const vivante = await entrepriseGarnie();
    // Le titulaire de l'entreprise échue est aussi membre de l'entreprise vivante.
    await base(
      (sql) => sql`
      insert into membres (entreprise_id, user_id, cgu_version)
      values (${vivante.entrepriseId}, ${echue.userId}, '2026-11')`,
    );
    const avantVivante = await etat(vivante.entrepriseId);
    assertEquals(avantVivante.lignes.membres, 2);
    await supprimerCompte(echue, 'demander');
    await antidater(echue.entrepriseId, 31);

    const { status, corps } = await purger(echue);
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(corps.comptes, 1);
    assertEquals(await etat(echue.entrepriseId), await etatVide());
    // Supprimer l'utilisateur aurait emporté son appartenance à l'entreprise vivante.
    assertEquals(await utilisateurExiste(echue.userId), true);
    assertEquals(await seConnecte(echue), true);
    assertEquals(await etat(vivante.entrepriseId), avantVivante);
    assertEquals(await utilisateurExiste(vivante.userId), true);
  },
);

// ---------------------------------------------------------------------------------------------
// Une passe qui échoue reprend à la suivante
// ---------------------------------------------------------------------------------------------

essai(
  'purger : échec à l’étape Auth, l’entreprise garde sa date (Storage déjà vidé), une autre entreprise échue n’est pas bloquée, la passe suivante reprend',
  async () => {
    const bloquee = await entrepriseGarnie();
    const saine = await entrepriseGarnie();
    for (const compte of [bloquee, saine]) {
      await supprimerCompte(compte, 'demander');
      await antidater(compte.entrepriseId, 31);
    }
    const avant = await etat(bloquee.entrepriseId);
    const date = await dateDeSuppression(bloquee.entrepriseId);

    await avecRefus('auth.users', `old.id = '${bloquee.userId}'`, async () => {
      const { status, corps } = await purger(bloquee, saine);
      assertEquals(status, 500, JSON.stringify(corps));
      assertEquals(corps.code, 'INTERNE');
      assertEquals(corps.details.comptes, 1);
      assertEquals(corps.details.echecs, 1);
      assert(Number.isInteger(corps.details.orphelins));

      // L'étape 1 est faite, la 2 a échoué : l'entreprise et son utilisateur sont encore là, avec la
      // date, que la passe suivante retrouvera. Dans l'ordre de la spec (base avant Auth), l'entreprise
      // serait partie et l'utilisateur resterait sans entreprise.
      assertEquals(await etat(bloquee.entrepriseId), {
        lignes: avant.lignes,
        objets: { factures: 0, fichiers: 0 },
      });
      assertEquals((await dateDeSuppression(bloquee.entrepriseId))?.getTime(), date?.getTime());
      assertEquals(await utilisateurExiste(bloquee.userId), true);
      // L'autre entreprise a été purgée jusqu'au bout.
      assertEquals(await etat(saine.entrepriseId), await etatVide());
      assertEquals(await utilisateurExiste(saine.userId), false);
    });

    const suite = await purger(bloquee);
    assertEquals(suite.status, 200, JSON.stringify(suite.corps));
    assertEquals(suite.corps.comptes, 1);
    assertEquals(await etat(bloquee.entrepriseId), await etatVide());
    assertEquals(await utilisateurExiste(bloquee.userId), false);
  },
);

essai(
  'purger : échec à l’étape Storage, rien d’autre n’est touché, la passe suivante reprend',
  async () => {
    const compte = await entrepriseGarnie();
    await supprimerCompte(compte, 'demander');
    await antidater(compte.entrepriseId, 31);
    const avant = await etat(compte.entrepriseId);

    await avecRefus(
      'storage.objects',
      `starts_with(old.name, '${compte.entrepriseId}/')`,
      async () => {
        const { status, corps } = await purger(compte);
        assertEquals(status, 500, JSON.stringify(corps));
        assertEquals(corps.details.comptes, 0);
        assertEquals(corps.details.echecs, 1);
        // L'utilisateur n'est supprimé qu'une fois le Storage vide ; l'entreprise, qu'après l'utilisateur.
        assertEquals(await utilisateurExiste(compte.userId), true);
        assertEquals((await etat(compte.entrepriseId)).lignes, avant.lignes);
      },
    );

    const suite = await purger(compte);
    assertEquals(suite.status, 200, JSON.stringify(suite.corps));
    assertEquals(suite.corps.comptes, 1);
    assertEquals(await etat(compte.entrepriseId), await etatVide());
    assertEquals(await utilisateurExiste(compte.userId), false);
  },
);

essai(
  'purger : échec à la suppression en base, utilisateurs et objets déjà partis, la passe suivante achève',
  async () => {
    const compte = await entrepriseGarnie();
    await supprimerCompte(compte, 'demander');
    await antidater(compte.entrepriseId, 31);
    const avant = await etat(compte.entrepriseId);

    await avecRefus('public.entreprises', `old.id = '${compte.entrepriseId}'`, async () => {
      const { status, corps } = await purger(compte);
      assertEquals(status, 500, JSON.stringify(corps));
      assertEquals(corps.details.comptes, 0);
      assertEquals(corps.details.echecs, 1);
      // Ni le refus ni la transaction ne laissent d'état à demi : l'entreprise est entière, sans ses
      // objets ni son utilisateur (l'appartenance part avec lui).
      assertEquals(await utilisateurExiste(compte.userId), false);
      assertEquals(await etat(compte.entrepriseId), {
        lignes: { ...avant.lignes, membres: 0 },
        objets: { factures: 0, fichiers: 0 },
      });
    });

    // Plus d'utilisateur à retrouver (`membres` est vide) : la passe suivante supprime l'entreprise.
    const suite = await purger(compte);
    assertEquals(suite.status, 200, JSON.stringify(suite.corps));
    assertEquals(suite.corps.comptes, 1);
    assertEquals(await etat(compte.entrepriseId), await etatVide());
  },
);

essai(
  'purger : une ligne tenue par une transaction fait attendre la suppression quelques secondes, pas davantage',
  async () => {
    const tenue = await entrepriseGarnie();
    const libre = await entrepriseGarnie();
    for (const compte of [tenue, libre]) {
      await supprimerCompte(compte, 'demander');
      await antidater(compte.entrepriseId, 31);
    }
    const attente: { debut: number; fin: number; reponse?: { status: number; corps: Corps } } = {
      debut: 0,
      fin: 0,
    };
    // Le test tient l'entreprise comme le fait une relance en cours d'envoi (clé étrangère).
    await base((sql) =>
      sql.begin(async (tx) => {
        await tx`select 1 from public.entreprises where id = ${tenue.entrepriseId} for key share`;
        attente.debut = Date.now();
        // Sans délai du verrou, la passe attendrait ce test, qui l'attend : le garde-fou l'en sort.
        let minuteur: ReturnType<typeof setTimeout> | undefined;
        const garde = new Promise<never>((_, rejet) => {
          minuteur = setTimeout(
            () => rejet(new Error('la purge attend le verrou sans limite')),
            45_000,
          );
        });
        try {
          attente.reponse = await Promise.race([purger(tenue, libre), garde]);
        } finally {
          clearTimeout(minuteur);
        }
        attente.fin = Date.now();
      }),
    );
    const { status, corps } = attente.reponse ?? { status: 0, corps: {} };
    assertEquals(status, 500, JSON.stringify(corps));
    // L'entreprise libre est purgée ; l'autre est reprise la nuit suivante.
    assertEquals(corps.details.comptes, 1);
    assertEquals(corps.details.echecs, 1);
    const duree = attente.fin - attente.debut;
    assert(duree >= 4_000 && duree < 30_000, `${duree} ms`);
    assertEquals((await etat(tenue.entrepriseId)).lignes.entreprises, 1);
    assertEquals(await etat(libre.entrepriseId), await etatVide());

    // La ligne rendue, la passe suivante achève.
    const suite = await purger(tenue);
    assertEquals(suite.status, 200, JSON.stringify(suite.corps));
    assertEquals(suite.corps.comptes, 1);
    assertEquals(await etat(tenue.entrepriseId), await etatVide());
  },
);

essai(
  'supprimer-compte : annuler après 30 jours est refusé (409 SUPPRESSION) et la passe purge tout ; à 29 jours il est accepté et la passe ne touche rien',
  async () => {
    const tardive = await entrepriseGarnie();
    const dans_les_temps = await entrepriseGarnie();
    await supprimerCompte(tardive, 'demander');
    await supprimerCompte(dans_les_temps, 'demander');
    await antidater(tardive.entrepriseId, 31);
    await antidater(dans_les_temps.entrepriseId, 29);
    const avantTardive = await etat(tardive.entrepriseId);
    const avantDansLesTemps = await etat(dans_les_temps.entrepriseId);
    const dateTardive = await dateDeSuppression(tardive.entrepriseId);

    // Passé le délai : refusé, avec la date de la demande ; rien ne change.
    const refus = await supprimerCompte(tardive, 'annuler');
    assertEquals(refus.status, 409, JSON.stringify(refus.corps));
    assertEquals(refus.corps.code, 'SUPPRESSION');
    assertMatch(refus.corps.message, /30 jours/);
    assertEquals(
      new Date(refus.corps.details.suppressionDemandeeLe).getTime(),
      dateTardive?.getTime(),
    );
    assertEquals(
      (await dateDeSuppression(tardive.entrepriseId))?.getTime(),
      dateTardive?.getTime(),
    );
    assertEquals(await etat(tardive.entrepriseId), avantTardive);

    // Dans le délai : accepté, la demande disparaît.
    const accepte = await supprimerCompte(dans_les_temps, 'annuler');
    assertEquals(accepte.status, 200, JSON.stringify(accepte.corps));
    assertEquals(accepte.corps, { suppressionDemandeeLe: null });
    assertEquals(await dateDeSuppression(dans_les_temps.entrepriseId), null);

    // La passe purge la demande refusée, et ne touche pas à celle qui a été annulée.
    const { status, corps } = await purger(tardive, dans_les_temps);
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(corps.comptes, 1);
    assertEquals(await etat(tardive.entrepriseId), await etatVide());
    assertEquals(await utilisateurExiste(tardive.userId), false);
    assertEquals(await etat(dans_les_temps.entrepriseId), avantDansLesTemps);
    assertEquals(await utilisateurExiste(dans_les_temps.userId), true);
  },
);

essai(
  'supprimer-compte : annuler refuse la limite des 30 jours, ni avant ni après, et sans demande il répond null',
  async () => {
    const compte = await creerCompte();
    // Sans demande : rien à annuler, la réponse est la même.
    const sansDemande = await supprimerCompte(compte, 'annuler');
    assertEquals(sansDemande.status, 200);
    assertEquals(sansDemande.corps, { suppressionDemandeeLe: null });

    await supprimerCompte(compte, 'demander');
    // Une heure avant la limite : annulable. Une heure après : non.
    await base(
      (sql) => sql`
        update entreprises set suppression_demandee_le = now() - interval '30 days' + interval '1 hour'
         where id = ${compte.entrepriseId}`,
    );
    const avant = await supprimerCompte(compte, 'annuler');
    assertEquals(avant.status, 200, JSON.stringify(avant.corps));
    await supprimerCompte(compte, 'demander');
    await base(
      (sql) => sql`
        update entreprises set suppression_demandee_le = now() - interval '30 days' - interval '1 hour'
         where id = ${compte.entrepriseId}`,
    );
    const apres = await supprimerCompte(compte, 'annuler');
    assertEquals(apres.status, 409, JSON.stringify(apres.corps));
    assertEquals(apres.corps.code, 'SUPPRESSION');
    assertExists(await dateDeSuppression(compte.entrepriseId));
  },
);

essai(
  'purger : une demande retirée à la main avant les effacements n’est pas purgée, celle qui attendait l’est',
  async () => {
    // `ancienne` passe la première (la plus ancienne) et attend Auth, tenu par le test ; pendant ce
    // temps la demande de `retiree`, déjà dans la liste lue au début de la passe, est retirée par SQL
    // (`annuler` ne le permet plus passé 30 jours : c'est la relecture qui la protège).
    const ancienne = await entrepriseGarnie();
    const retiree = await entrepriseGarnie();
    for (const [compte, jours] of [
      [ancienne, 40],
      [retiree, 35],
    ] as const) {
      await supprimerCompte(compte, 'demander');
      await antidater(compte.entrepriseId, jours);
    }
    const avant = await etat(retiree.entrepriseId);

    const { passe } = await avecUtilisateurTenu(ancienne.userId, async (pid) => {
      const passe = purger(ancienne, retiree);
      passe.catch(() => {});
      await attendreLeBlocage(pid);
      await base(
        (sql) => sql`
          update entreprises set suppression_demandee_le = null where id = ${retiree.entrepriseId}`,
      );
      return { passe };
    });

    const { status, corps } = await passe;
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(corps.comptes, 1);
    assertEquals(await etat(ancienne.entrepriseId), await etatVide());
    // L'autre n'a rien perdu : ni ses lignes, ni ses objets, ni son utilisateur.
    assertEquals(await etat(retiree.entrepriseId), avant);
    assertEquals(await utilisateurExiste(retiree.userId), true);
  },
);

essai(
  'purger : une fois l’effacement commencé, l’entreprise est supprimée jusqu’au bout, même si sa demande disparaît',
  async () => {
    const compte = await entrepriseGarnie();
    await supprimerCompte(compte, 'demander');
    await antidater(compte.entrepriseId, 31);

    // Le Storage est vidé ; Auth attend l'utilisateur tenu ; la demande est retirée (par SQL : `annuler`
    // ne le permet plus) avant la suppression de l'entreprise. Si celle-ci redemandait l'échéance, les
    // lignes resteraient sans membre ni date, hors de portée de toute passe.
    const { passe } = await avecUtilisateurTenu(compte.userId, async (pid) => {
      const passe = purger(compte);
      passe.catch(() => {});
      await attendreLeBlocage(pid);
      await base(
        (sql) => sql`
          update entreprises set suppression_demandee_le = null where id = ${compte.entrepriseId}`,
      );
      return { passe };
    });

    const { status, corps } = await passe;
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(corps.comptes, 1);
    assertEquals(await etat(compte.entrepriseId), await etatVide());
    assertEquals(await utilisateurExiste(compte.userId), false);
  },
);

essai(
  'relancer : l’entreprise reste verrouillée pendant l’envoi (une purge ne peut pas la supprimer sous la relance), la facture non (un paiement passe)',
  async () => {
    const compte = await entrepriseGarnie();
    /** La ligne est-elle tenue (clé étrangère) par une autre transaction ? Un essai `nowait` le dit. */
    const tenue = (table: 'entreprises' | 'factures', id: string) =>
      base(async (sql) => {
        try {
          await sql.begin(async (tx) => {
            await tx.unsafe(`select 1 from public.${table} where id = $1 for update nowait`, [id]);
          });
          return false;
        } catch (echec) {
          // 55P03 : la ligne est verrouillée.
          if ((echec as { code?: unknown }).code !== '55P03') throw echec;
          return true;
        }
      });

    // L'envoi est lent (3 s, `lent.test`) : la base dit si la transaction de la relance tient les lignes.
    const relance = appeler('relancer', compte.jwt, {
      factureId: compte.factureId,
      destinataire: 'client@lent.test',
      objet: 'Relance',
      corps: 'Bonjour, la facture est en retard.',
    });
    const limite = Date.now() + 15_000;
    while (!(await tenue('entreprises', compte.entrepriseId))) {
      if (Date.now() > limite)
        throw new Error('l’entreprise n’est pas verrouillée pendant l’envoi');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // La facture, elle, est libre : le contrôle d'un paiement la verrouille (`for update`) et ne doit pas
    // attendre la fin de l'envoi (le rôle des comptes a un délai de 8 secondes). Un vrai paiement, sans
    // attente permise.
    assertEquals(await tenue('factures', compte.factureId), false);
    await base((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('lock_timeout', '500ms', true)`;
        await tx`
          insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par)
          values (${compte.entrepriseId}, ${compte.factureId}, ${aujourdhui()}::date, 1000, 'virement',
                  ${compte.userId})`;
      }),
    );
    // L'envoi n'était pas fini : l'entreprise est toujours tenue.
    assertEquals(await tenue('entreprises', compte.entrepriseId), true);

    const reponse = await relance;
    assertEquals(reponse.status, 201, JSON.stringify(await reponse.json()));
    // Validée : l'entreprise est rendue.
    assertEquals(await tenue('entreprises', compte.entrepriseId), false);
  },
);

Deno.test('migrations : aucune ne sème de secret dans le Vault, ni n’écrit l’adresse ou la valeur de PURGE_SECRET', async () => {
  const dossier = new URL('../../migrations/', import.meta.url);
  const exemple = SECRET_D_EXEMPLE;
  let lues = 0;
  for await (const fichier of Deno.readDir(dossier)) {
    if (!fichier.name.endsWith('.sql')) continue;
    lues++;
    const sql = await Deno.readTextFile(new URL(fichier.name, dossier));
    // Le Vault se lit (`vault.decrypted_secrets`) ; il ne s'écrit pas.
    assert(!/create_secret|update_secret|insert\s+into\s+vault\./i.test(sql), fichier.name);
    assert(!sql.includes(exemple), fichier.name);
    // La tâche de nuit ne porte aucune adresse en clair.
    if (fichier.name.endsWith('_purge.sql')) {
      const code = sql.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--'));
      assert(!/https?:\/\//i.test(code.join('\n')), fichier.name);
      assert(code.join('\n').includes('vault.decrypted_secrets'), fichier.name);
    }
  }
  assert(lues >= 6, `${lues} migrations lues`);
});

// ---------------------------------------------------------------------------------------------
// Les PDF orphelins
// ---------------------------------------------------------------------------------------------

essai(
  'purger : un PDF sans facture de plus d’un jour est effacé ; rattaché, récent ou hors de factures, il reste',
  async () => {
    const compte = await entrepriseGarnie();
    const dossier = `${compte.entrepriseId}`;
    const stockage = admin().storage.from('factures');
    const dater = (bucket: string, chemin: string, heures: number) =>
      base(
        (sql) => sql`
        update storage.objects set created_at = now() - make_interval(hours => ${heures})
         where bucket_id = ${bucket} and name = ${chemin}`,
      );
    /** Dépose un objet de `factures`, daté d'il y a `heures` heures. */
    const deposer = async (chemin: string, heures: number) => {
      const depot = await stockage.upload(chemin, PDF, { contentType: 'application/pdf' });
      if (depot.error) throw new Error(`${chemin} : ${depot.error.message}`);
      await dater('factures', chemin, heures);
    };

    const avantHier = `${dossier}/orphelin-avant-hier.pdf`;
    const vingtCinqHeures = `${dossier}/orphelin-25-heures.pdf`;
    const vingtTroisHeures = `${dossier}/orphelin-23-heures.pdf`;
    const recent = `${dossier}/orphelin-recent.pdf`;
    await deposer(avantHier, 48);
    await deposer(vingtCinqHeures, 25);
    await deposer(vingtTroisHeures, 23);
    await deposer(recent, 0);
    // Le PDF d'une facture reste, même très vieux ; un fichier de l'utilisateur aussi (autre bucket).
    await dater('factures', compte.pdf, 24 * 400);
    await dater('fichiers', compte.logo, 24 * 400);

    const { status, corps } = await purger();
    assertEquals(status, 200, JSON.stringify(corps));
    assertEquals(corps.comptes, 0);
    // Au moins les deux nôtres : la pile peut garder d'autres orphelins, qu'elle efface aussi.
    assert(corps.orphelins >= 2, JSON.stringify(corps));

    assertEquals(await fichierExiste('factures', avantHier), false);
    assertEquals(await fichierExiste('factures', vingtCinqHeures), false);
    assertEquals(await fichierExiste('factures', vingtTroisHeures), true);
    assertEquals(await fichierExiste('factures', recent), true);
    assertEquals(await fichierExiste('factures', compte.pdf), true);
    assertEquals(await fichierExiste('fichiers', compte.logo), true);
    assertEquals((await etat(compte.entrepriseId)).objets, { factures: 3, fichiers: 2 });

    // Les orphelins de la passe sont partis : la suivante n'en trouve plus.
    const suite = await purger();
    assertEquals(suite.corps, { orphelins: 0, comptes: 0 });
  },
);

essai('purger : plus d’une centaine d’orphelins sont tous effacés, par lots', async () => {
  const compte = await creerCompte();
  const dossier = `${compte.entrepriseId}/lot`;
  const noms = Array.from({ length: 120 }, (_, i) => `${dossier}/orphelin-${i}.pdf`);
  // Déposés par le Storage, vingt à la fois, puis datés d'un coup.
  for (let i = 0; i < noms.length; i += 20) {
    const depots = await Promise.all(
      noms
        .slice(i, i + 20)
        .map((nom) =>
          admin().storage.from('factures').upload(nom, PDF, { contentType: 'application/pdf' }),
        ),
    );
    for (const depot of depots) assertEquals(depot.error, null);
  }
  await base(
    (sql) => sql`
      update storage.objects set created_at = now() - interval '3 days'
       where bucket_id = 'factures' and starts_with(name, ${`${dossier}/`})`,
  );

  const { status, corps } = await purger();
  assertEquals(status, 200, JSON.stringify(corps));
  assert(corps.orphelins >= noms.length, JSON.stringify(corps));
  assertEquals((await etat(compte.entrepriseId)).objets.factures, 0);
});
