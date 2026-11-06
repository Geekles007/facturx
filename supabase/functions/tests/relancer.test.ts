/**
 * L'Edge Function `relancer` contre la pile locale (plan, tâche 11 ; spec § 9, § 11 et § 13) : l'e-mail
 * de relance d'une facture en retard, relu par l'utilisateur, envoyé par Brevo (ici le simulateur de
 * `relancer/brevo.ts`, choisi par `BREVO_API_KEY=simule`) et consigné. Chaque test crée ses comptes ;
 * les factures sont écrites en base, avec ou sans PDF dans le Storage selon que la relance doit aller
 * jusqu'à l'envoi (le PDF n'est lu qu'à ce moment).
 *
 * Les limites « exactes sous concurrence » se prouvent par la base : le runtime local met en file les
 * requêtes d'une même fonction, deux appels simultanés ne s'y chevauchent donc pas (mesuré : une
 * requête sans jeton attend la fin d'un envoi lent). Les tests « simultanés » vérifient le résultat de
 * bout en bout ; ceux du verrou le tiennent ou l'observent eux-mêmes (`pg_advisory_xact_lock`,
 * `pg_locks`) pour montrer que la fonction le prend avant de compter et le garde pendant l'envoi.
 */
import { assert, assertEquals, assertExists, assertMatch } from '@std/assert';
import { aujourdhuiParis } from '../_shared/dates.ts';
import { admin, appeler, base, creerCompte, decaler, urlFonction } from './aide.ts';

type Compte = Awaited<ReturnType<typeof creerCompte>>;
// biome-ignore lint/suspicious/noExplicitAny: corps de réponse JSON, lu champ par champ par les assertions
type Corps = Record<string, any>;

const DESTINATAIRE = 'compta@client-demo.fr';
const OBJET = 'Relance de la facture F-2026-0001';
const CORPS = 'Bonjour,\n\nNous n’avons pas reçu le règlement de la facture.\n\nCordialement';

/** `relancer` ne lit pas le PDF : il le joint tel quel (le simulateur vérifie seulement `%PDF`). */
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

const HEURE = 3_600_000;
const ilYA = (ms: number): Date => new Date(Date.now() - ms);

/** Le jour de Paris, comme la fonction le lit sans en-tête. */
const aujourdhui = (): string => aujourdhuiParis(new Date());

/** Un compte confirmé dont l'entreprise a un SIREN et un nom : ce qu'il faut pour relancer. */
async function compteRelanceur(): Promise<Compte> {
  const compte = await creerCompte();
  await base(
    (sql) => sql`
      update entreprises
         set profil = jsonb_set(
               jsonb_set(profil, '{seller,siren}', to_jsonb(${'443061841'}::text)),
               '{seller,name}', to_jsonb(${'Atelier Exemple SAS'}::text))
       where id = ${compte.entrepriseId}`,
  );
  return compte;
}

/** L'oid du type `uuid[]` de Postgres, que postgres.js ne devine pas pour un paramètre. */
const UUID_ARRAY = 2951;

/** Les factures `ids` de l'entreprise, écrites en base : échéance `echeance`, 1 200,00 à payer. */
async function ecrireFactures(
  compte: Compte,
  ids: string[],
  options: { echeance?: string | null; typeCode?: string } = {},
): Promise<void> {
  const echeance = options.echeance === undefined ? decaler(aujourdhui(), -10) : options.echeance;
  await base(
    (sql) => sql`
      insert into factures (id, entreprise_id, numero, type_code, date_emission, date_echeance,
                            client_nom, devise, ht, ttc, net_a_payer, invoice, form, appearance,
                            pdf_chemin, sdk_version, origine, emise_par)
      select t.id, ${compte.entrepriseId}, 'F-' || left(t.id::text, 8), ${options.typeCode ?? '380'},
             ${decaler(aujourdhui(), -60)}::date, ${echeance}::date, 'Client Démo SARL', 'EUR',
             100000, 120000, 120000, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
             ${compte.entrepriseId}::text || '/' || t.id || '.pdf', '0', 'emise', ${compte.userId}
        from unnest(${sql.array(ids, UUID_ARRAY)}) as t(id)`,
  );
}

/** Une facture en retard, avec son PDF dans le Storage ; son identifiant. */
async function creerFacture(
  compte: Compte,
  options: { echeance?: string | null; typeCode?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await ecrireFactures(compte, [id], options);
  const depot = await admin()
    .storage.from('factures')
    .upload(`${compte.entrepriseId}/${id}.pdf`, PDF, { contentType: 'application/pdf' });
  if (depot.error) throw new Error(`PDF de test : ${depot.error.message}`);
  return id;
}

/** `n` factures en retard sans PDF : elles ne servent qu'à porter des relances déjà consignées. */
async function creerFactures(compte: Compte, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  await ecrireFactures(compte, ids);
  return ids;
}

/** Des relances déjà consignées (une par facture de `factureIds`), à l'instant `instant`. */
async function consigner(
  compte: Compte,
  factureIds: string[],
  options: { etat?: 'envoyee' | 'refusee'; instant?: Date; niveau?: number } = {},
): Promise<void> {
  const etat = options.etat ?? 'envoyee';
  const lignes = factureIds.map((factureId) => ({
    entreprise_id: compte.entrepriseId,
    facture_id: factureId,
    niveau: options.niveau ?? 1,
    envoyee_le: options.instant ?? new Date(),
    destinataire: DESTINATAIRE,
    objet: 'o',
    corps: 'c',
    message_id: etat === 'envoyee' ? 'consigne' : null,
    etat,
  }));
  await base(
    (sql) => sql`
      insert into relances ${sql(lignes, 'entreprise_id', 'facture_id', 'niveau', 'envoyee_le', 'destinataire', 'objet', 'corps', 'message_id', 'etat')}`,
  );
}

/** Les relances consignées de la facture, de la plus ancienne à la plus récente (un tableau simple). */
async function relancesDe(factureId: string): Promise<Corps[]> {
  const lignes = await base(
    (sql) => sql`
      select id, entreprise_id, facture_id, niveau, etat, destinataire, objet, corps, message_id,
             envoyee_le, envoyee_le > now() - interval '1 minute' as recente
        from relances where facture_id = ${factureId} order by envoyee_le, id`,
  );
  return [...lignes];
}

function envoyeesDuJour(entrepriseId: string): Promise<number> {
  return base(async (sql) => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from relances
       where entreprise_id = ${entrepriseId} and etat = 'envoyee'
         and envoyee_le >= (now() at time zone 'Europe/Paris')::date::timestamp at time zone 'Europe/Paris'`;
    return n;
  });
}

/** Minuit à Paris, au début du jour suivant `jour` (ISO), calculé par la base. */
function minuitSuivant(jour: string): Promise<string> {
  return base(async (sql) => {
    const [{ t }] = await sql<{ t: Date }[]>`
      select ((${jour}::date + 1)::timestamp at time zone 'Europe/Paris') as t`;
    return t.toISOString();
  });
}

interface Options {
  destinataire?: unknown;
  objet?: unknown;
  corps?: unknown;
  enTetes?: Record<string, string>;
}

/** Appelle `relancer` comme le Studio, avec un message de relance ordinaire. */
async function relancer(
  compte: Compte,
  factureId: unknown,
  options: Options = {},
): Promise<{ status: number; corps: Corps }> {
  const reponse = await appeler(
    'relancer',
    compte.jwt,
    {
      factureId,
      destinataire: 'destinataire' in options ? options.destinataire : DESTINATAIRE,
      objet: 'objet' in options ? options.objet : OBJET,
      corps: 'corps' in options ? options.corps : CORPS,
    },
    options.enTetes,
  );
  return { status: reponse.status, corps: await reponse.json() };
}

/** Une relance refusée par Brevo : le simulateur refuse les adresses de ce domaine. */
const REFUSEE = 'client@refus.test';

/** Les `Issue` d'un 422 `ANOMALIES`, ou échoue. */
function issues(status: number, corps: Corps): Corps[] {
  assertEquals(status, 422, JSON.stringify(corps));
  assertEquals(corps.code, 'ANOMALIES');
  assert(Array.isArray(corps.details) && corps.details.length > 0);
  return corps.details;
}

Deno.test('nominal : 201 { id, niveau }, relance consignée envoyee avec l’identifiant du service', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);

  const { status, corps } = await relancer(compte, factureId, {
    objet: 'Relance\r\nBcc: x@y',
    corps: '<b>Bonjour</b>\n\nMerci.',
  });
  assertEquals(status, 201);
  assertEquals(Object.keys(corps).sort(), ['id', 'niveau']);
  assertEquals(corps.niveau, 1);

  const [ligne, ...autres] = await relancesDe(factureId);
  assertEquals(autres, []);
  assertMatch(ligne.message_id, /^simule-[0-9a-f-]{36}$/);
  assertEquals(
    { ...ligne, message_id: undefined, envoyee_le: undefined },
    {
      id: corps.id,
      entreprise_id: compte.entrepriseId,
      facture_id: factureId,
      niveau: 1,
      etat: 'envoyee',
      destinataire: DESTINATAIRE,
      // L'objet consigné est celui qui est parti : sans retour à la ligne ; le corps, tel que saisi.
      objet: 'Relance Bcc: x@y',
      corps: '<b>Bonjour</b>\n\nMerci.',
      message_id: undefined,
      envoyee_le: undefined,
      recente: true,
    },
  );
});

Deno.test('deuxième relance immédiate : 429 LIMITE, avec l’heure où réessayer, rien de consigné', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  assertEquals((await relancer(compte, factureId)).status, 201);
  const [premiere] = await relancesDe(factureId);

  const { status, corps } = await relancer(compte, factureId);
  assertEquals(status, 429);
  assertEquals(corps.code, 'LIMITE');
  assertEquals(typeof corps.message, 'string');
  assertEquals(Object.keys(corps.details), ['reessayerApres']);
  // 72 heures après la relance partie.
  assertEquals(
    new Date(corps.details.reessayerApres).getTime(),
    premiere.envoyee_le.getTime() + 72 * HEURE,
  );
  assertEquals((await relancesDe(factureId)).length, 1);
});

Deno.test('délai de 72 heures : à 71 h 59 encore 429, à 72 h 01 la relance part', async () => {
  const compte = await compteRelanceur();
  const [avant, apres] = await Promise.all([creerFacture(compte), creerFacture(compte)]);
  const tropTot = ilYA(72 * HEURE - 60_000);
  const assez = ilYA(72 * HEURE + 60_000);
  await consigner(compte, [avant], { instant: tropTot });
  await consigner(compte, [apres], { instant: assez });

  const refus = await relancer(compte, avant);
  assertEquals(refus.status, 429);
  assertEquals(
    refus.corps.details.reessayerApres,
    new Date(tropTot.getTime() + 72 * HEURE).toISOString(),
  );

  const ok = await relancer(compte, apres);
  assertEquals(ok.status, 201);
  assertEquals(ok.corps.niveau, 2);
});

Deno.test('niveau : relances envoyées de la facture plus un, plafonné à 3 ; les refusées ne comptent pas', async () => {
  const quatreJours = ilYA(4 * 24 * HEURE);
  const cas: [number, number, number][] = [
    // [relances envoyées avant, relances refusées avant, niveau attendu]
    [0, 0, 1],
    [1, 0, 2],
    [2, 0, 3],
    [3, 0, 3],
    [5, 0, 3],
    [1, 2, 2],
    [0, 3, 1],
  ];
  const compte = await compteRelanceur();
  for (const [envoyees, refusees, niveau] of cas) {
    const factureId = await creerFacture(compte);
    for (let i = 0; i < envoyees; i++) {
      await consigner(compte, [factureId], {
        instant: new Date(quatreJours.getTime() - i * 24 * HEURE),
        niveau: Math.min(i + 1, 3),
      });
    }
    for (let i = 0; i < refusees; i++) {
      await consigner(compte, [factureId], { etat: 'refusee', instant: quatreJours });
    }
    const { status, corps } = await relancer(compte, factureId);
    assertEquals(status, 201, `${envoyees} envoyées, ${refusees} refusées`);
    assertEquals(corps.niveau, niveau, `${envoyees} envoyées, ${refusees} refusées`);
    const lignes = await relancesDe(factureId);
    assertEquals(lignes.at(-1)?.niveau, niveau);
  }
});

Deno.test('refus de Brevo : la relance est consignée refusee, validée, et la réponse est 502 ENVOI', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);

  const { status, corps } = await relancer(compte, factureId, { destinataire: REFUSEE });
  assertEquals(status, 502);
  assertEquals(corps.code, 'ENVOI');
  assertEquals(Object.keys(corps).sort(), ['code', 'message']);

  // La ligne a survécu à l'erreur : consignée, sans identifiant de message.
  const [refusee, ...autres] = await relancesDe(factureId);
  assertEquals(autres, []);
  assertEquals(
    { ...refusee, id: undefined, envoyee_le: undefined },
    {
      id: undefined,
      entreprise_id: compte.entrepriseId,
      facture_id: factureId,
      niveau: 1,
      etat: 'refusee',
      destinataire: REFUSEE,
      objet: OBJET,
      corps: CORPS,
      message_id: null,
      envoyee_le: undefined,
      recente: true,
    },
  );

  // Rien n'est parti : ni le délai de 72 heures ni le niveau ne s'en ressentent.
  const reprise = await relancer(compte, factureId);
  assertEquals(reprise.status, 201);
  assertEquals(reprise.corps.niveau, 1);
  assertEquals(
    (await relancesDe(factureId)).map((r) => r.etat),
    ['refusee', 'envoyee'],
  );
});

Deno.test('plafond : 20 relances par jour et par entreprise, la 21e donne 429 jusqu’à minuit à Paris', async () => {
  const compte = await compteRelanceur();
  const autre = await compteRelanceur();
  const dejaEnvoyees = await creerFactures(compte, 19);
  await consigner(compte, dejaEnvoyees);
  // Les refusées de la journée ne comptent pas, ni les envoyées d'une autre entreprise.
  await consigner(compte, dejaEnvoyees.slice(0, 5), { etat: 'refusee' });
  await consigner(autre, await creerFactures(autre, 20));
  const [vingtieme, vingtEtUnieme] = await Promise.all([
    creerFacture(compte),
    creerFacture(compte),
  ]);

  const passe = await relancer(compte, vingtieme);
  assertEquals(passe.status, 201);
  assertEquals(await envoyeesDuJour(compte.entrepriseId), 20);

  const { status, corps } = await relancer(compte, vingtEtUnieme);
  assertEquals(status, 429);
  assertEquals(corps.code, 'LIMITE');
  assertEquals(corps.details.reessayerApres, await minuitSuivant(aujourdhui()));
  assertEquals(await relancesDe(vingtEtUnieme), []);
  assertEquals(await envoyeesDuJour(compte.entrepriseId), 20);
});

Deno.test('plafond : « depuis minuit à Paris », en été comme en hiver', async () => {
  // [jour de Paris, instant où les vingt relances ont été envoyées, la relance du jour est-elle admise ?]
  const cas: [string, string, boolean][] = [
    // Été (UTC+2) : le 15 juillet commence le 14 à 22 h UTC.
    ['2026-07-15', '2026-07-14T21:59:59Z', true],
    ['2026-07-15', '2026-07-14T22:00:00Z', false],
    ['2026-07-15', '2026-07-15T21:59:59Z', false],
    ['2026-07-15', '2026-07-15T22:00:00Z', true],
    // Hiver (UTC+1) : le 15 janvier commence le 14 à 23 h UTC.
    ['2026-01-15', '2026-01-14T22:59:59Z', true],
    ['2026-01-15', '2026-01-14T23:00:00Z', false],
    ['2026-01-15', '2026-01-15T22:59:59Z', false],
    ['2026-01-15', '2026-01-15T23:00:00Z', true],
  ];
  for (const [jour, instant, admise] of cas) {
    const compte = await compteRelanceur();
    await consigner(compte, await creerFactures(compte, 20), { instant: new Date(instant) });
    const factureId = await creerFacture(compte, { echeance: decaler(jour, -30) });

    const { status, corps } = await relancer(compte, factureId, {
      enTetes: { 'x-facturx-aujourdhui': jour },
    });
    assertEquals(
      status,
      admise ? 201 : 429,
      `${jour}, vingt relances à ${instant} : ${JSON.stringify(corps)}`,
    );
    if (!admise) {
      assertEquals(corps.details.reessayerApres, await minuitSuivant(jour), `${jour} ${instant}`);
    }
  }
});

Deno.test('échéance : « passée » se juge au jour de Paris que la fonction lit (aujourdhui)', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte, { echeance: '2026-07-10' });

  // Le jour de l'échéance, la facture n'est pas encore en retard ; le lendemain, elle l'est.
  const veille = await relancer(compte, factureId, {
    enTetes: { 'x-facturx-aujourdhui': '2026-07-10' },
  });
  assertEquals(issues(veille.status, veille.corps)[0].code, 'PAS_DE_RETARD');
  assertEquals(await relancesDe(factureId), []);

  const lendemain = await relancer(compte, factureId, {
    enTetes: { 'x-facturx-aujourdhui': '2026-07-11' },
  });
  assertEquals(lendemain.status, 201);
});

Deno.test('pas de retard : échéance à venir, sans échéance, payée, avoir : 422 PAS_DE_RETARD', async () => {
  const compte = await compteRelanceur();
  const demain = await creerFacture(compte, { echeance: decaler(aujourdhui(), 1) });
  const ceJour = await creerFacture(compte, { echeance: aujourdhui() });
  const sansEcheance = await creerFacture(compte, { echeance: null });
  const avoir = await creerFacture(compte, { typeCode: '381' });
  const payee = await creerFacture(compte);
  const soldeeParAvoir = await creerFacture(compte);
  await base(async (sql) => {
    await sql`
      insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par)
      values (${compte.entrepriseId}, ${payee}, ${aujourdhui()}, 120000, 'virement', ${compte.userId})`;
    // Un avoir du montant total, qui cite la facture : il en solde le reste dû.
    await sql`
      insert into factures (entreprise_id, numero, type_code, date_emission, client_nom, devise, ht,
                            ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                            facture_origine_id, origine, emise_par)
      values (${compte.entrepriseId}, 'AV-1', '381', ${aujourdhui()}, 'Client', 'EUR', 100000, 120000,
              120000, '{}', '{}', '{}', 'sans-pdf', '0', ${soldeeParAvoir}, 'emise', ${compte.userId})`;
  });

  for (const [cas, factureId] of Object.entries({
    demain,
    ceJour,
    sansEcheance,
    avoir,
    payee,
    soldeeParAvoir,
  })) {
    const { status, corps } = await relancer(compte, factureId);
    const [anomalie] = issues(status, corps);
    assertEquals(anomalie.code, 'PAS_DE_RETARD', cas);
    assertEquals(await relancesDe(factureId), [], cas);
  }
});

Deno.test('payée en partie : le reste dû est positif, la relance part', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  await base(
    (sql) => sql`
      insert into paiements (entreprise_id, facture_id, date, montant, moyen, cree_par)
      values (${compte.entrepriseId}, ${factureId}, ${aujourdhui()}, 50000, 'virement', ${compte.userId})`,
  );
  assertEquals((await relancer(compte, factureId)).status, 201);
});

Deno.test('destinataire mal formé : 422, path destinataire, rien d’envoyé ni de consigné', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);

  for (const mauvais of [
    // Les deux injections d'une seconde adresse.
    'a@b.fr, c@d.fr',
    'a@b.fr\nBcc: c@d.fr',
    'a@b.fr,c@d.fr',
    'a@b.fr;c@d.fr',
    'a@b.fr c@d.fr',
    'a@b.fr\r\nBcc: c@d.fr',
    ' a@b.fr',
    '',
    'pas une adresse',
    'a@b',
    '@b.fr',
    'Nom <a@b.fr>',
  ]) {
    const { status, corps } = await relancer(compte, factureId, { destinataire: mauvais });
    const [anomalie] = issues(status, corps);
    assertEquals(anomalie.path, 'destinataire', JSON.stringify(mauvais));
    assertEquals(anomalie.code, 'DESTINATAIRE', JSON.stringify(mauvais));
  }
  // Absent, ou d'un autre type que du texte : le corps de la requête est mal formé, au même endroit.
  for (const mauvais of [undefined, null, 12, ['a@b.fr'], { email: 'a@b.fr' }]) {
    const { status, corps } = await relancer(compte, factureId, { destinataire: mauvais });
    assertEquals(issues(status, corps)[0].path, 'destinataire', JSON.stringify(mauvais));
  }
  assertEquals(await relancesDe(factureId), []);

  // L'adresse du client, saisie ou corrigée, est celle qui part.
  assertEquals(
    (await relancer(compte, factureId, { destinataire: 'a.b+c@sous.exemple.fr' })).status,
    201,
  );
  assertEquals((await relancesDe(factureId))[0].destinataire, 'a.b+c@sous.exemple.fr');
});

Deno.test('corps de requête : facture, objet et message vérifiés, 422 sur le champ en cause', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  const cas: [string, Options & { factureId?: unknown }][] = [
    ['factureId', { factureId: 'pas-un-uuid' }],
    ['factureId', { factureId: 12 }],
    ['factureId', { factureId: undefined }],
    ['objet', { objet: undefined }],
    ['objet', { objet: 12 }],
    // Un objet qui n'est que retours à la ligne ne laisse rien à envoyer.
    ['objet', { objet: ' \r\n\t ' }],
    ['corps', { corps: undefined }],
    ['corps', { corps: ['Bonjour'] }],
    ['corps', { corps: '  \n\n ' }],
    // Au-delà de 10 000 caractères, un message n'est plus une relance.
    ['corps', { corps: 'a'.repeat(10_001) }],
  ];
  for (const [champ, options] of cas) {
    const { status, corps } = await relancer(
      compte,
      'factureId' in options ? options.factureId : factureId,
      options,
    );
    assertEquals(issues(status, corps)[0].path, champ, JSON.stringify(options));
  }
  assertEquals(await relancesDe(factureId), []);

  const illisible = await fetch(urlFonction('relancer'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${compte.jwt}`,
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      'content-type': 'application/json',
    },
    body: 'pas du JSON',
  });
  const corpsIllisible = await illisible.json();
  assertEquals(issues(illisible.status, corpsIllisible)[0].code, 'CORPS');

  // La limite est inclusive : 10 000 caractères passent, et un objet long est coupé, pas refusé.
  const long = await relancer(compte, factureId, {
    corps: 'a'.repeat(10_000),
    objet: 'o'.repeat(500),
  });
  assertEquals(long.status, 201);
  assertEquals((await relancesDe(factureId))[0].objet, 'o'.repeat(200));
});

Deno.test('SIREN du vendeur vide : 422 ANOMALIES SIREN, path company.seller.siren', async () => {
  // Le profil d'un compte neuf est vide.
  const compte = await creerCompte();
  const factureId = await creerFacture(compte);
  const { status, corps } = await relancer(compte, factureId);
  const [anomalie, ...autres] = issues(status, corps);
  assertEquals(autres, []);
  assertEquals(anomalie.code, 'SIREN');
  assertEquals(anomalie.path, 'company.seller.siren');
  assertEquals(typeof anomalie.message, 'string');
  assertEquals(await relancesDe(factureId), []);

  // Des espaces ne valent pas un SIREN.
  await base(
    (sql) => sql`
      update entreprises set profil = jsonb_set(profil, '{seller,siren}', '"  "')
       where id = ${compte.entrepriseId}`,
  );
  const espaces = await relancer(compte, factureId);
  assertEquals(issues(espaces.status, espaces.corps)[0].code, 'SIREN');

  // Renseigné, la relance part.
  await base(
    (sql) => sql`
      update entreprises set profil = jsonb_set(profil, '{seller,siren}', '"443061841"')
       where id = ${compte.entrepriseId}`,
  );
  assertEquals((await relancer(compte, factureId)).status, 201);
});

Deno.test('adresse du compte non confirmée : 403 NON_CONFIRME', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = null where id = ${compte.userId}`,
  );

  const { status, corps } = await relancer(compte, factureId);
  assertEquals(status, 403);
  assertEquals(corps.code, 'NON_CONFIRME');
  assertEquals(await relancesDe(factureId), []);
});

Deno.test('la facture d’une autre entreprise, ou inconnue : 403 DROITS, deux réponses identiques', async () => {
  const compte = await compteRelanceur();
  const autre = await compteRelanceur();
  const chezAutre = await creerFacture(autre);

  const etrangere = await relancer(compte, chezAutre);
  const inconnue = await relancer(compte, crypto.randomUUID());
  assertEquals(etrangere.status, 403);
  assertEquals(etrangere.corps.code, 'DROITS');
  // Pas d'oracle : ni le statut, ni le code, ni le message, ni les détails ne distinguent les deux.
  assertEquals(inconnue, etrangere);
  assertEquals(await relancesDe(chezAutre), []);

  // Même réponse quand tout le reste est en défaut aussi : la facture se juge avant le compte.
  const sansSiren = await creerCompte();
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = null where id = ${sansSiren.userId}`,
  );
  assertEquals(await relancer(sansSiren, chezAutre), etrangere);
  assertEquals(await relancer(sansSiren, crypto.randomUUID()), etrangere);
});

Deno.test('ordre des vérifications (§ 9) : facture, retard, adresse, SIREN, délai, plafond', async () => {
  const code = ({ status, corps }: { status: number; corps: Corps }) =>
    status === 422 ? `${status} ${corps.details[0].code}` : `${status} ${corps.code}`;

  // Un compte sans SIREN, adresse non confirmée : seule la première vérification en défaut répond.
  const compte = await creerCompte();
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = null where id = ${compte.userId}`,
  );
  const autre = await compteRelanceur();
  const aVenir = await creerFacture(compte, { echeance: decaler(aujourdhui(), 5) });
  const enRetard = await creerFacture(compte);
  assertEquals(code(await relancer(compte, await creerFacture(autre))), '403 DROITS');
  assertEquals(code(await relancer(compte, aVenir)), '422 PAS_DE_RETARD');
  assertEquals(code(await relancer(compte, enRetard)), '403 NON_CONFIRME');
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = now() where id = ${compte.userId}`,
  );
  // Le SIREN manque aussi, et la facture vient d'être relancée : le SIREN d'abord.
  await consigner(compte, [enRetard], { instant: ilYA(HEURE) });
  assertEquals(code(await relancer(compte, enRetard)), '422 SIREN');
  await base(
    (sql) => sql`
      update entreprises set profil = jsonb_set(profil, '{seller,siren}', '"443061841"')
       where id = ${compte.entrepriseId}`,
  );
  // Le plafond du jour est atteint aussi : le délai et le plafond sont en défaut, la réponse est 429.
  await consigner(compte, await creerFactures(compte, 20));
  assertEquals(code(await relancer(compte, enRetard)), '429 LIMITE');
  // Et une adresse mal formée se refuse avant le délai et le plafond : rien à voir avec l'état.
  const mauvaise = await relancer(compte, enRetard, { destinataire: 'a@b.fr, c@d.fr' });
  assertEquals(code(mauvaise), '422 DESTINATAIRE');
});

Deno.test('délai et plafond en défaut ensemble : réessayer après le plus tardif des deux', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  // Relancée il y a 71 h 30 : le délai se libère dans une demi-heure ; le plafond du jour, à minuit.
  const derniere = ilYA(71.5 * HEURE);
  await consigner(compte, [factureId], { instant: derniere });
  await consigner(compte, await creerFactures(compte, 20));

  const { status, corps } = await relancer(compte, factureId);
  assertEquals(status, 429);
  const delai = derniere.getTime() + 72 * HEURE;
  const minuit = new Date(await minuitSuivant(aujourdhui())).getTime();
  assertEquals(new Date(corps.details.reessayerApres).getTime(), Math.max(delai, minuit));
});

Deno.test('relances simultanées de la même facture : une seule part, les autres donnent 429', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);

  const reponses = await Promise.all(Array.from({ length: 4 }, () => relancer(compte, factureId)));
  assertEquals(reponses.map((r) => r.status).sort(), [201, 429, 429, 429]);
  assertEquals(
    (await relancesDe(factureId)).map((r) => r.etat),
    ['envoyee'],
  );
});

Deno.test('la 20e et la 21e relance du jour lancées ensemble : une part, l’autre donne 429', async () => {
  const compte = await compteRelanceur();
  await consigner(compte, await creerFactures(compte, 19));
  const [une, autre] = await Promise.all([creerFacture(compte), creerFacture(compte)]);

  const reponses = await Promise.all([relancer(compte, une), relancer(compte, autre)]);
  assertEquals(reponses.map((r) => r.status).sort(), [201, 429]);
  assertEquals(await envoyeesDuJour(compte.entrepriseId), 20);
  assertEquals((await relancesDe(une)).length + (await relancesDe(autre)).length, 1);
});

/**
 * Attend qu'une requête patiente derrière un verrou consultatif (la relance qui attend celui que le
 * test tient) ; échoue au bout de dix secondes.
 */
async function attendreLeVerrou(): Promise<void> {
  for (let essai = 0; essai < 100; essai++) {
    const [{ attente }] = await base(
      (sql) => sql<{ attente: number }[]>`
        select count(*)::int as attente from pg_stat_activity
         where wait_event_type = 'Lock' and wait_event = 'advisory'`,
    );
    if (attente > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('la relance n’attend pas le verrou de l’entreprise');
}

Deno.test('verrou : la relance attend celui de l’entreprise, puis compte ce qui a été consigné', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);

  // Le test tient le verrou (la clé est celle de `relancer/index.ts`), lance la relance, attend qu'elle
  // patiente, consigne la relance d'un appel concurrent et valide.
  const envoi: { reponse?: ReturnType<typeof relancer> } = {};
  await base((sql) =>
    sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`relancer:${compte.entrepriseId}`}, 0))`;
      envoi.reponse = relancer(compte, factureId);
      await attendreLeVerrou();
      assertEquals(await relancesDe(factureId), []);
      await tx`
        insert into relances (entreprise_id, facture_id, niveau, destinataire, objet, corps, message_id, etat)
        values (${compte.entrepriseId}, ${factureId}, 1, ${DESTINATAIRE}, 'o', 'c', 'concurrente', 'envoyee')`;
    }),
  );
  assertExists(envoi.reponse);
  const { status, corps } = await envoi.reponse;
  // Elle compte après le verrou : la relance concurrente est vue, le délai s'applique.
  assertEquals(status, 429, JSON.stringify(corps));
  assertEquals(corps.code, 'LIMITE');
  assertEquals((await relancesDe(factureId)).length, 1);
});

/** Attend que le verrou consultatif de l'entreprise soit tenu (par la relance en cours d'envoi). */
async function attendreVerrouTenu(entrepriseId: string): Promise<void> {
  for (let essai = 0; essai < 100; essai++) {
    const [{ tenu }] = await base(
      (sql) => sql<{ tenu: number }[]>`
        select count(*)::int as tenu from pg_locks
         where locktype = 'advisory' and granted
           and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${`relancer:${entrepriseId}`}, 0)`,
    );
    if (tenu > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('la relance ne tient pas le verrou de l’entreprise');
}

Deno.test('envoi sous le verrou : pendant l’envoi, le verrou de l’entreprise est tenu et rien n’est consigné', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  const cle = `relancer:${compte.entrepriseId}`;
  /** Une autre transaction obtiendrait-elle le verrou ? Et que contient `relances` ? */
  const regarder = () =>
    base((sql) =>
      sql.begin(async (tx) => {
        const [{ libre }] = await tx<{ libre: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtextextended(${cle}, 0)) as libre`;
        const [{ n }] = await tx<{ n: number }[]>`
          select count(*)::int as n from relances where facture_id = ${factureId}`;
        return { libre, n };
      }),
    );

  // L'envoi est lent (3 s, `lent.test`) : on regarde la base pendant qu'il dure. Une seconde requête
  // HTTP ne montrerait rien ici, le runtime local mettant en file les requêtes d'une même fonction ;
  // c'est donc la base qui dit si la transaction, ouverte pour l'envoi, tient le verrou.
  const relance = relancer(compte, factureId, { destinataire: 'client@lent.test' });
  await attendreVerrouTenu(compte.entrepriseId);
  assertEquals(await regarder(), { libre: false, n: 0 });

  assertEquals((await relance).status, 201);
  // Validée : la relance est consignée, et le verrou rendu.
  assertEquals(await regarder(), { libre: true, n: 1 });
});

Deno.test('le verrou est celui d’une entreprise : une autre relance, ailleurs, ne l’attend pas', async () => {
  const compte = await compteRelanceur();
  const ailleurs = await compteRelanceur();
  const factureAilleurs = await creerFacture(ailleurs);

  let status = 0;
  await base((sql) =>
    sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`relancer:${compte.entrepriseId}`}, 0))`;
      // Tant que le verrou de `compte` est tenu, `ailleurs` relance sans attendre.
      status = (await relancer(ailleurs, factureAilleurs)).status;
    }),
  );
  assertEquals(status, 201);
});

Deno.test('sans jeton, ou avec un jeton refusé : 401 SESSION', async () => {
  const compte = await compteRelanceur();
  const factureId = await creerFacture(compte);
  const corps = { factureId, destinataire: DESTINATAIRE, objet: OBJET, corps: CORPS };
  const anonyme = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  for (const jwt of ['', anonyme, `${compte.jwt.slice(0, -4)}AAAA`]) {
    const reponse = await appeler('relancer', jwt, corps);
    assertEquals(reponse.status, 401);
    assertEquals((await reponse.json()).code, 'SESSION');
  }
  assertEquals(await relancesDe(factureId), []);
});
