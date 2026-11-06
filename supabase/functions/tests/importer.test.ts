/**
 * L'Edge Function `importer` contre la pile locale (plan, tâche 10 ; spec § 6, § 11 et § 13) : une
 * facture émise en local entre dans le compte, lue dans son PDF Factur-X. Chaque test crée ses
 * comptes ; les PDF sont une page blanche qui porte le XML d'une facture, ce que l'import lit seul.
 */
import { assert, assertEquals, assertExists } from '@std/assert';
import { type Invoice, type InvoiceTypeCode, type IsoDate, toCiiXml } from 'facturx-sdk';
import { embedFacturX, extractInvoice } from 'facturx-sdk/pdf';
import { PDFDocument } from 'pdf-lib';
import type postgres from 'postgres';
import { toPortableJson } from '../_vendor/shared/portable.ts';
import {
  admin,
  apparenceDeTest,
  appeler,
  appelerTexte,
  base,
  creerCompte,
  factureDeTest,
  urlFonction,
} from './aide.ts';

type Compte = Awaited<ReturnType<typeof creerCompte>>;
// biome-ignore lint/suspicious/noExplicitAny: corps de réponse JSON, lu champ par champ par les assertions
type Corps = Record<string, any>;

/** Une facture émise en local : un numéro de la numérotation du Studio, une date passée. */
function factureLocale(numero: string, issueDate = '2025-03-14', lignes = 1): Invoice {
  return {
    ...factureDeTest(lignes, issueDate),
    id: numero,
    remittanceInformation: numero,
  };
}

/** Une page blanche : l'import ne lit que le XML embarqué. */
async function pageBlanche(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage();
  return await document.save();
}

/** Le PDF de `facture`, avec son XML Factur-X embarqué. */
async function pdfDe(facture: Invoice): Promise<Uint8Array> {
  return await embedFacturX(await pageBlanche(), { invoice: facture });
}

/** Le PDF d'un XML quelconque, tel que le SDK l'embarque (il refuse ce qui n'est pas du XML). */
async function pdfDuXml(xml: string): Promise<Uint8Array> {
  return await embedFacturX(await pageBlanche(), { xml });
}

/**
 * Le formulaire du Studio : l'import le stocke sans le lire. Il contredit exprès la facture du PDF,
 * la seule source du numéro, de la date et des montants.
 */
const FORM = { id: 'FORM-NON-LU', buyer: { name: 'Autre client' }, totals: { ttc: 1 } };

/** Importe `pdf` dans le compte, avec le formulaire et l'apparence du Studio. */
async function importer(
  compte: Compte,
  pdf: Uint8Array,
  options: { form?: unknown; appearance?: unknown } = {},
): Promise<{ status: number; corps: Corps }> {
  const reponse = await appeler('importer', compte.jwt, {
    form: options.form ?? FORM,
    appearance: options.appearance ?? apparenceDeTest(),
    pdf,
  });
  return { status: reponse.status, corps: await reponse.json() };
}

/** Importe la facture `facture` (son PDF Factur-X). */
async function importerFacture(
  compte: Compte,
  facture: Invoice,
): Promise<{ status: number; corps: Corps }> {
  return await importer(compte, await pdfDe(facture));
}

function numerotation(
  entrepriseId: string,
): Promise<{ gabarit: string; prochain: number; annuelle: boolean; annee: number }> {
  return base(async (sql) => {
    const [n] = await sql<
      { gabarit: string; prochain: number; annuelle: boolean; annee: number }[]
    >`
      select gabarit, prochain, annuelle, annee from numerotation where entreprise_id = ${entrepriseId}`;
    return n;
  });
}

function nombreDeFactures(entrepriseId: string): Promise<number> {
  return base(async (sql) => {
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from factures where entreprise_id = ${entrepriseId}`;
    return n.n;
  });
}

/** Les noms des PDF déposés dans le dossier de l'entreprise du bucket `factures`. */
async function pdfDeposes(entrepriseId: string): Promise<string[]> {
  const { data, error } = await admin().storage.from('factures').list(entrepriseId);
  if (error) throw new Error(`factures/${entrepriseId} : ${error.message}`);
  return data.map((objet) => objet.name);
}

async function telecharger(chemin: string): Promise<Uint8Array> {
  const { data, error } = await admin().storage.from('factures').download(chemin);
  if (error) throw new Error(`factures/${chemin} : ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Des factures du compte écrites directement en base sous ces numéros (sans PDF déposé) : de quoi
 * occuper un numéro ou remplir l'heure. `origine` : `emise` par défaut ; `ilYA` : leur âge (un
 * intervalle SQL), nul par défaut. `q` est `sql` ou une transaction ouverte.
 */
async function ecrireFactures(
  q: postgres.ISql,
  compte: Compte,
  numeros: string[],
  options: { origine?: 'emise' | 'importee'; ilYA?: string } = {},
): Promise<void> {
  await q`
    insert into factures (entreprise_id, numero, type_code, date_emission, client_nom, devise, ht,
                          ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                          origine, emise_le, emise_par)
    select ${compte.entrepriseId}, n, '380', '2025-03-01', 'Client', 'EUR', 100, 120, 120,
           '{}', '{}', '{}', ${compte.entrepriseId}::text || '/ecrite-' || n || '.pdf', '0',
           ${options.origine ?? 'emise'}, now() - ${options.ilYA ?? '0 seconds'}::interval,
           ${compte.userId}
      from jsonb_array_elements_text(${JSON.stringify(numeros)}::text::jsonb) n`;
}

/** Les numéros `L-1` à `L-<nombre>`, de quoi remplir une heure d'imports. */
const numerosDeRemplissage = (nombre: number): string[] =>
  Array.from({ length: nombre }, (_, i) => `L-${i + 1}`);

/**
 * Attend que l'import soit en attente d'un verrou que tient la transaction du test (le processus
 * `pid`, celui de `pg_backend_pid()` dans cette transaction) ; échoue au bout de trente secondes. Une
 * attente sur la numérotation d'un autre compte ne compte pas : seul `pg_blocking_pids` compte.
 */
async function attendreLeVerrou(pid: number): Promise<void> {
  for (let essai = 0; essai < 300; essai++) {
    const [{ attente }] = await base(
      (sql) => sql<{ attente: number }[]>`
      select count(*)::int as attente from pg_stat_activity
       where wait_event_type = 'Lock' and pg_blocking_pids(pid) @> array[${pid}]::int[]`,
    );
    if (attente > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `l’import n’attend pas, après 30 s, le verrou de la numérotation que tient la transaction ${pid}`,
  );
}

Deno.test('nominal : 201, facture lue dans le PDF, origine importee, numérotation intouchée', async () => {
  const compte = await creerCompte();
  const facture = factureLocale('F-2025-0042', '2025-03-14', 3);
  facture.buyer = { ...facture.buyer, contact: { email: 'compta@client-demo.fr' } };
  const pdf = await pdfDe(facture);
  const avant = await numerotation(compte.entrepriseId);

  const { status, corps } = await importer(compte, pdf);
  assertEquals(status, 201);
  assertEquals(corps.numero, 'F-2025-0042');
  assertExists(corps.id);
  assertEquals(Object.keys(corps).sort(), ['id', 'numero']);

  const [ligne] = await base(
    (sql) => sql`
    select entreprise_id, numero, type_code, date_emission::text, date_echeance::text, client_id,
           client_nom, client_email, devise, ht::text, ttc::text, net_a_payer::text, pdf_chemin,
           sdk_version, brouillon_id, origine, emise_par, facture_origine_id,
           invoice ->> 'id' as invoice_id, form, emise_le > now() - interval '1 minute' as recente
      from factures where id = ${corps.id}`,
  );
  assertEquals(ligne, {
    entreprise_id: compte.entrepriseId,
    numero: 'F-2025-0042',
    type_code: '380',
    // La date de la facture lue, et non celle du jour : l'import n'a aucune borne de date.
    date_emission: '2025-03-14',
    date_echeance: facture.paymentTerms.dueDate,
    client_id: null,
    client_nom: 'Client Démo SARL',
    client_email: 'compta@client-demo.fr',
    devise: 'EUR',
    // Les montants du PDF : le formulaire en annonçait d'autres.
    ht: String(facture.totals.taxExclusiveAmount),
    ttc: String(facture.totals.taxInclusiveAmount),
    net_a_payer: String(facture.totals.amountDueForPayment),
    pdf_chemin: `${compte.entrepriseId}/${corps.id}.pdf`,
    sdk_version: ligne.sdk_version,
    brouillon_id: null,
    origine: 'importee',
    emise_par: compte.userId,
    facture_origine_id: null,
    invoice_id: 'F-2025-0042',
    form: FORM,
    recente: true,
  });
  assert(/^\d+\.\d+\.\d+/.test(ligne.sdk_version));
  assert(facture.totals.taxInclusiveAmount !== FORM.totals.ttc);

  // L'import ne touche pas à la numérotation (la reprise du Studio la règle, tâche 20).
  assertEquals(await numerotation(compte.entrepriseId), avant);

  // Le PDF déposé est celui qu'on a envoyé, octet pour octet, et il redonne la facture.
  const depose = await telecharger(ligne.pdf_chemin);
  assertEquals(depose, pdf);
  const relue = (await extractInvoice(depose))?.invoice;
  assertEquals(relue?.id, 'F-2025-0042');
  assertEquals(relue?.totals.taxInclusiveAmount, facture.totals.taxInclusiveAmount);
});

Deno.test('form, appearance et facture sont stockés en objets jsonb, sans être lus', async () => {
  const compte = await creerCompte();
  // Une apparence qui renvoie à un logo et à une police que le serveur n'a pas : `emettre` la
  // refuserait, l'import la garde telle quelle.
  const appearance = {
    ...apparenceDeTest(),
    font: 'custom',
    logo: { key: 'logo-local', type: 'png', position: 'left', height: 44, name: 'logo.png' },
    customFont: { regularKey: 'font-locale', name: 'Locale' },
  };
  const { status, corps } = await importer(compte, await pdfDe(factureLocale('F-2025-0001')), {
    appearance,
  });
  assertEquals(status, 201);

  const [ligne] = await base(
    (sql) => sql`
    select jsonb_typeof(form) as form_type, jsonb_typeof(appearance) as appearance_type,
           jsonb_typeof(invoice) as invoice_type, form, appearance
      from factures where id = ${corps.id}`,
  );
  assertEquals(ligne.form_type, 'object');
  assertEquals(ligne.appearance_type, 'object');
  assertEquals(ligne.invoice_type, 'object');
  assertEquals(ligne.form, FORM);
  assertEquals(ligne.appearance, appearance);
});

Deno.test('numéro déjà importé : 409 DOUBLON, une seule ligne, un seul PDF', async () => {
  const compte = await creerCompte();
  const pdf = await pdfDe(factureLocale('F-2025-0042'));
  const premier = await importer(compte, pdf);
  assertEquals(premier.status, 201);

  const second = await importer(compte, pdf);
  assertEquals(second.status, 409);
  assertEquals(second.corps.code, 'DOUBLON');
  assertEquals(second.corps.details, { numero: 'F-2025-0042' });
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
  // Le refus survient avant le dépôt : aucun PDF orphelin.
  assertEquals(await pdfDeposes(compte.entrepriseId), [`${premier.corps.id}.pdf`]);
});

Deno.test('numéro déjà pris par une facture émise : 409 DOUBLON aussi', async () => {
  const compte = await creerCompte();
  await base((sql) => ecrireFactures(sql, compte, ['F-2025-0042']));

  const { status, corps } = await importerFacture(compte, factureLocale('F-2025-0042'));
  assertEquals(status, 409);
  assertEquals(corps.code, 'DOUBLON');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
});

Deno.test('l’import attend le verrou de la numérotation, puis voit le numéro validé entre-temps : 409', async () => {
  const compte = await creerCompte();
  const pdf = await pdfDe(factureLocale('F-2025-0042'));
  let enCours: Promise<{ status: number; corps: Corps }> | undefined;
  try {
    await base((sql) =>
      sql.begin(async (tx) => {
        // Une émission, ou un autre import, tient le verrou de l'entreprise : l'import doit patienter,
        // et non contrôler le numéro sur ce que la base montre déjà.
        await tx`select 1 from numerotation where entreprise_id = ${compte.entrepriseId} for update`;
        const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
        enCours = importer(compte, pdf);
        await attendreLeVerrou(pid);
        // Elle valide la facture de ce numéro, puis rend le verrou.
        await ecrireFactures(tx, compte, ['F-2025-0042']);
      }),
    );
  } finally {
    await enCours;
  }

  // Sans le verrou, l'import aurait contrôlé trop tôt, déposé son PDF, et buté sur la contrainte
  // d'unicité (500).
  const { status, corps } = (await enCours) ?? { status: 0, corps: {} };
  assertEquals(status, 409);
  assertEquals(corps.code, 'DOUBLON');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('imports simultanés du même numéro : un 201, un 409, une seule ligne', async () => {
  const compte = await creerCompte();
  const pdf = await pdfDe(factureLocale('F-2025-0042'));
  const [a, b] = await Promise.all([importer(compte, pdf), importer(compte, pdf)]);
  // Le même appel en double, tel qu'un double clic ou un réseau qui coupe le fait. Que les deux
  // requêtes se croisent dépend du hasard ; le test précédent fixe le croisement, et prouve le verrou.
  assertEquals([a.status, b.status].sort(), [201, 409]);
  assertEquals([a.corps, b.corps].find((c) => c.code)?.code, 'DOUBLON');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
});

Deno.test('imports simultanés de numéros distincts : tous acceptés', async () => {
  const compte = await creerCompte();
  const numeros = ['F-2025-0001', 'F-2025-0002', 'F-2025-0003'];
  const reponses = await Promise.all(
    numeros.map(async (numero) => importerFacture(compte, factureLocale(numero))),
  );
  assertEquals(
    reponses.map((r) => r.status),
    [201, 201, 201],
  );
  assertEquals(reponses.map((r) => r.corps.numero).sort(), numeros);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 3);
});

Deno.test('le même numéro dans une autre entreprise ne gêne pas et ne se voit pas : 201', async () => {
  const autre = await creerCompte();
  const compte = await creerCompte();
  const pdf = await pdfDe(factureLocale('F-2025-0042'));

  const chezAutre = await importer(autre, pdf);
  assertEquals(chezAutre.status, 201);
  // La recherche du numéro est celle de l'entreprise du compte : même numéro, même réponse qu'un
  // numéro libre, et chacun garde sa facture et son PDF.
  const chezSoi = await importer(compte, pdf);
  assertEquals(chezSoi.status, 201);
  assertEquals(chezSoi.corps.numero, 'F-2025-0042');
  assert(chezSoi.corps.id !== chezAutre.corps.id);
  assertEquals(await nombreDeFactures(autre.entrepriseId), 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
  assertEquals(await pdfDeposes(compte.entrepriseId), [`${chezSoi.corps.id}.pdf`]);
});

Deno.test('PDF sans Factur-X, qui n’en est pas un, ou au XML illisible : 422 ANOMALIES', async () => {
  const compte = await creerCompte();
  const cas: [string, Uint8Array][] = [
    ['page sans pièce Factur-X', await pageBlanche()],
    ['octets qui ne sont pas un PDF', new TextEncoder().encode('pas un PDF')],
    ['pièce qui n’est pas une facture CII', await pdfDuXml('<a><b/></a>')],
    ['pièce dont le XML est mal formé', await pdfDuXml('<a><b></a>')],
  ];
  for (const [nom, pdf] of cas) {
    const { status, corps } = await importer(compte, pdf);
    assertEquals(status, 422, nom);
    assertEquals(corps.code, 'ANOMALIES', nom);
    assertEquals(corps.details.length, 1, nom);
    assertEquals(corps.details[0].code, 'FACTURX', nom);
    assertEquals(corps.details[0].path, 'pdf', nom);
    assertEquals(typeof corps.details[0].message, 'string', nom);
  }
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('facture lue sans de quoi la ranger (numéro, type, devise, dates, textes) : 422, et non une erreur du serveur', async () => {
  const compte = await creerCompte();
  const xml = toCiiXml(factureLocale('F-2025-0042', '2025-03-14'));
  const numero = '<ram:ID>F-2025-0042</ram:ID><ram:TypeCode>';
  const emission = '<udt:DateTimeString format="102">20250314<';
  const echeance = '<udt:DateTimeString format="102">20250413<';
  const acheteur = '<ram:Name>Client Démo SARL</ram:Name>';
  // Le SDK lit sans valider : ces valeurs iraient jusqu'à la base, qui les refuserait (500).
  const cas = [
    { nom: 'sans numéro', de: numero, vers: '<ram:ID></ram:ID><ram:TypeCode>', champ: 'id' },
    {
      nom: 'numéro de plus de 35 caractères',
      de: numero,
      vers: `<ram:ID>${'F'.repeat(36)}</ram:ID><ram:TypeCode>`,
      champ: 'id',
    },
    {
      nom: 'devise en minuscules',
      de: '<ram:InvoiceCurrencyCode>EUR<',
      vers: '<ram:InvoiceCurrencyCode>eur<',
      champ: 'currency',
    },
    {
      nom: 'type qui n’est pas de trois chiffres',
      de: '<ram:TypeCode>380<',
      vers: '<ram:TypeCode>abc<',
      champ: 'typeCode',
    },
    {
      // Le lecteur rend alors une date vide.
      nom: 'sans date d’émission',
      de: `<ram:IssueDateTime>${emission.slice(0, -1)}</udt:DateTimeString></ram:IssueDateTime>`,
      vers: '',
      champ: 'issueDate',
    },
    // Le lecteur et `isValidIsoDate` lisent l'an 0 comme 1900 ; Postgres refuse `0000-01-01`.
    {
      nom: 'date d’émission de l’an 0',
      de: emission,
      vers: emission.replace('20250314', '00000101'),
      champ: 'issueDate',
    },
    {
      nom: 'échéance de l’an 0',
      de: echeance,
      vers: echeance.replace('20250413', '00000101'),
      champ: 'paymentTerms.dueDate',
    },
    // `&#0;` et `&#xD800;` : le XML les rend, ni `jsonb` ni `text` ne les admettent.
    {
      nom: 'nom de l’acheteur avec un caractère nul',
      de: acheteur,
      vers: '<ram:Name>Client &#0; SARL</ram:Name>',
      champ: 'buyer.name',
    },
    {
      nom: 'nom de l’acheteur avec un demi-substitut isolé',
      de: acheteur,
      vers: '<ram:Name>Client &#xD800; SARL</ram:Name>',
      champ: 'buyer.name',
    },
  ];
  for (const { nom, de, vers, champ } of cas) {
    assert(xml.includes(de), `${nom} : le XML de test n’a pas la forme attendue`);
    const { status, corps } = await importer(compte, await pdfDuXml(xml.replace(de, vers)));
    assertEquals(status, 422, nom);
    assertEquals(corps.code, 'ANOMALIES', nom);
    assertEquals(corps.details[0].code, 'FACTURX', nom);
    assertEquals(corps.details[0].path, `invoice.${champ}`, nom);
  }
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('form avec des caractères hors du plan de base (paire de substituts valide) : accepté tel quel', async () => {
  const compte = await creerCompte();
  const form = { note: 'Merci 🙂 — é', 'clé 🙂': ['😀'] };
  const { status, corps } = await importer(compte, await pdfDe(factureLocale('F-2025-0001')), {
    form,
  });
  assertEquals(status, 201);
  const [ligne] = await base((sql) => sql`select form from factures where id = ${corps.id}`);
  assertEquals(ligne.form, form);
});

Deno.test('plafond : la 501e importation de l’heure rend 429 LIMITE, un doublon rend toujours 409', async () => {
  const compte = await creerCompte();
  // 500 imports dans l'heure, écrits directement : bien plus rapide que 500 appels.
  await base((sql) =>
    ecrireFactures(sql, compte, numerosDeRemplissage(500), { origine: 'importee' }),
  );
  const pdf = await pdfDe(factureLocale('F-2025-0042'));

  const { status, corps } = await importer(compte, pdf);
  assertEquals(status, 429);
  assertEquals(corps.code, 'LIMITE');
  const reessayer = Date.parse(corps.details.reessayerApres);
  assert(reessayer > Date.now() && reessayer <= Date.now() + 3_600_000);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 500);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);

  // Le doublon passe avant le plafond : reprendre un import interrompu ne compte pas ce qui est là.
  const doublon = await importerFacture(compte, factureLocale('L-1'));
  assertEquals(doublon.status, 409);
  assertEquals(doublon.corps.code, 'DOUBLON');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 500);
});

Deno.test('plafond : ni les factures émises, ni les imports plus anciens qu’une heure ne comptent', async () => {
  const compte = await creerCompte();
  await base(async (sql) => {
    // 500 émises dans l'heure : le plafond de l'émission est le leur.
    await ecrireFactures(sql, compte, numerosDeRemplissage(500), { origine: 'emise' });
    // 500 importées il y a deux heures.
    await ecrireFactures(
      sql,
      compte,
      numerosDeRemplissage(500).map((n) => `A-${n}`),
      { origine: 'importee', ilYA: '2 hours' },
    );
  });

  const { status } = await importerFacture(compte, factureLocale('F-2025-0042'));
  assertEquals(status, 201);
});

Deno.test('avoir importé : rattaché à la facture de l’entreprise qui porte le numéro cité, sinon null', async () => {
  const autre = await creerCompte();
  const compte = await creerCompte();
  const avoirDe = (numero: string, citee: string, type: InvoiceTypeCode = '381'): Invoice => ({
    ...factureLocale(numero, '2025-04-02'),
    typeCode: type,
    references: { precedingInvoices: [{ id: citee, issueDate: '2025-03-14' as IsoDate }] },
  });
  const origineDe = (id: string) =>
    base(
      async (sql) =>
        (
          await sql<{ type_code: string; facture_origine_id: string | null }[]>`
          select type_code, facture_origine_id from factures where id = ${id}`
        )[0],
    );

  // La facture citée n'est importée nulle part : l'avoir s'importe, sans origine, sans erreur.
  const sansOrigine = await importerFacture(compte, avoirDe('A-2025-0001', 'F-2025-0042'));
  assertEquals(sansOrigine.status, 201);
  assertEquals(await origineDe(sansOrigine.corps.id), {
    type_code: '381',
    facture_origine_id: null,
  });

  // Elle existe, mais dans une autre entreprise : même résultat, rien n'en transparaît.
  assertEquals((await importerFacture(autre, factureLocale('F-2025-0042'))).status, 201);
  const etrangere = await importerFacture(compte, avoirDe('A-2025-0002', 'F-2025-0042'));
  assertEquals(etrangere.status, 201);
  assertEquals((await origineDe(etrangere.corps.id)).facture_origine_id, null);

  // Elle est de l'entreprise : l'avoir (381 puis 396) la cite pour origine.
  const propre = await importerFacture(compte, factureLocale('F-2025-0042'));
  assertEquals(propre.status, 201);
  const rattache = await importerFacture(compte, avoirDe('A-2025-0003', 'F-2025-0042'));
  assertEquals(rattache.status, 201);
  assertEquals(await origineDe(rattache.corps.id), {
    type_code: '381',
    facture_origine_id: propre.corps.id,
  });
  const autreType = await importerFacture(compte, avoirDe('A-2025-0004', 'F-2025-0042', '396'));
  assertEquals(autreType.status, 201);
  assertEquals(await origineDe(autreType.corps.id), {
    type_code: '396',
    facture_origine_id: propre.corps.id,
  });
});

Deno.test('une facture qui n’est pas un avoir ne prend pas d’origine, même si elle en cite une', async () => {
  const compte = await creerCompte();
  assertEquals((await importerFacture(compte, factureLocale('F-2025-0042'))).status, 201);
  // Une facture rectificative (384) cite la facture qu'elle corrige : ce n'est pas un avoir.
  const rectificative: Invoice = {
    ...factureLocale('F-2025-0043', '2025-04-02'),
    typeCode: '384',
    references: { precedingInvoices: [{ id: 'F-2025-0042', issueDate: '2025-03-14' as IsoDate }] },
  };

  const { status, corps } = await importerFacture(compte, rectificative);
  assertEquals(status, 201);
  const [ligne] = await base(
    (sql) => sql`select type_code, facture_origine_id from factures where id = ${corps.id}`,
  );
  assertEquals(ligne, { type_code: '384', facture_origine_id: null });
});

Deno.test('adresse non confirmée : 403 NON_CONFIRME, rien d’importé', async () => {
  const compte = await creerCompte();
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = null where id = ${compte.userId}`,
  );

  const { status, corps } = await importerFacture(compte, factureLocale('F-2025-0042'));
  assertEquals(status, 403);
  assertEquals(corps.code, 'NON_CONFIRME');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('sans jeton, ou avec un jeton refusé : 401 SESSION', async () => {
  const compte = await creerCompte();
  const corps = {
    form: FORM,
    appearance: apparenceDeTest(),
    pdf: await pdfDe(factureLocale('F-2025-0042')),
  };
  const anonyme = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // Sans en-tête, avec la clé publique (ce que supabase-js envoie hors session), avec un jeton altéré.
  for (const jwt of ['', anonyme, `${compte.jwt.slice(0, -4)}AAAA`]) {
    const reponse = await appeler('importer', jwt, corps);
    assertEquals(reponse.status, 401);
    const erreur = await reponse.json();
    assertEquals(erreur.code, 'SESSION');
    assertEquals(typeof erreur.message, 'string');
  }
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
});

Deno.test('jeton valide d’un compte qui n’est membre d’aucune entreprise : 403 DROITS', async () => {
  const compte = await creerCompte();
  await base((sql) => sql`delete from membres where user_id = ${compte.userId}`);

  const { status, corps } = await importerFacture(compte, factureLocale('F-2025-0042'));
  assertEquals(status, 403);
  assertEquals(corps.code, 'DROITS');
});

Deno.test('corps illisible : 422 ANOMALIES, Issue CORPS, rien d’importé', async () => {
  const compte = await creerCompte();
  const pdf = await pdfDe(factureLocale('F-2025-0042'));

  // Un corps qui n'est pas du JSON.
  const brut = await fetch(urlFonction('importer'), {
    method: 'POST',
    headers: { authorization: `Bearer ${compte.jwt}`, 'content-type': 'application/json' },
    body: 'pas du JSON',
  });
  assertEquals(brut.status, 422);
  assertEquals((await brut.json()).details[0].code, 'CORPS');

  // Un corps JSON dont un champ n'a pas la forme attendue.
  const cas: [string, Record<string, unknown>, string][] = [
    ['pdf absent', { form: FORM, appearance: apparenceDeTest() }, 'pdf'],
    ['pdf en texte', { form: FORM, appearance: apparenceDeTest(), pdf: 'JVBERi0=' }, 'pdf'],
    ['form absent', { appearance: apparenceDeTest(), pdf }, 'form'],
    ['form en liste', { form: [FORM], appearance: apparenceDeTest(), pdf }, 'form'],
    ['appearance absente', { form: FORM, pdf }, 'appearance'],
    ['appearance en texte', { form: FORM, appearance: 'classic', pdf }, 'appearance'],
    // Ce que `jsonb` refuserait (500) : un caractère nul, un demi-substitut isolé, à toute profondeur.
    [
      'form avec un caractère nul',
      { form: { note: 'a\u0000b' }, appearance: apparenceDeTest(), pdf },
      'form.note',
    ],
    [
      'form avec un caractère nul, dans des listes imbriquées',
      { form: { lignes: [{ a: 1 }, { b: ['x', '\u0000'] }] }, appearance: apparenceDeTest(), pdf },
      'form.lignes[1].b[1]',
    ],
    [
      'form avec une clé nulle',
      { form: { 'k\u0000': 1 }, appearance: apparenceDeTest(), pdf },
      'form',
    ],
    [
      'appearance avec un demi-substitut isolé',
      { form: FORM, appearance: { ...apparenceDeTest(), footer: 'a\ud800' }, pdf },
      'appearance.footer',
    ],
  ];
  for (const [nom, corps, champ] of cas) {
    const reponse = await appeler('importer', compte.jwt, corps);
    assertEquals(reponse.status, 422, nom);
    const erreur = await reponse.json();
    assertEquals(erreur.code, 'ANOMALIES', nom);
    assertEquals(erreur.details[0].code, 'CORPS', nom);
    assertEquals(erreur.details[0].path, champ, nom);
  }
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('form ou appearance imbriqués sur 3 000 niveaux : 422 CORPS, rien de déposé', async () => {
  const compte = await creerCompte();
  const pdf = toPortableJson(await pdfDe(factureLocale('F-2025-0042')));
  // La profondeur est plafonnée à 64 niveaux avant le décodage (`lireObjetPortable`) : 422 au chemin
  // vide, quel que soit le runtime. Avant ce plafond, 3 000 niveaux se lisaient, puis `toPortableJson`
  // levait en les écrivant en base, après le dépôt du PDF.
  const profond = `${'['.repeat(3000)}${']'.repeat(3000)}`;
  for (const champ of ['form', 'appearance']) {
    const form = champ === 'form' ? profond : toPortableJson(FORM);
    const appearance = champ === 'appearance' ? profond : toPortableJson(apparenceDeTest());
    const reponse = await appelerTexte(
      'importer',
      compte.jwt,
      `{"form":${form},"appearance":${appearance},"pdf":${pdf}}`,
    );
    assertEquals(reponse.status, 422, champ);
    const erreur = await reponse.json();
    assertEquals(erreur.code, 'ANOMALIES', champ);
    assertEquals(erreur.details[0].code, 'CORPS', champ);
    assertEquals(erreur.details[0].path, '', champ);
  }
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await pdfDeposes(compte.entrepriseId), []);
});

Deno.test('corps de plus de 10 Mio : 413 ANOMALIES, Issue CORPS', async () => {
  const compte = await creerCompte();
  const reponse = await fetch(urlFonction('importer'), {
    method: 'POST',
    headers: { authorization: `Bearer ${compte.jwt}`, 'content-type': 'application/json' },
    body: 'x'.repeat(10 * 1024 * 1024 + 1),
  });
  assertEquals(reponse.status, 413);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'CORPS');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
});
