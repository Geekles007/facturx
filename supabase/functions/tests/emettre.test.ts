/**
 * L'Edge Function `emettre` contre la pile locale (spec § 7, § 11, § 13 et § 14). Chaque test crée
 * ses comptes ; la date du jour est celle de Paris, comme pour la fonction.
 *
 * Avec `VERAPDF=1`, le PDF du cas nominal passe aussi par veraPDF (`scripts/verapdf`, Docker).
 */
import { assert, assertEquals, assertExists } from '@std/assert';
import type { Invoice, IsoDate } from 'facturx-sdk';
import { extractInvoice } from 'facturx-sdk/pdf';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { toPortableJson } from '../_vendor/shared/portable.ts';
import { aujourdhuiParis } from '../emettre/regles.ts';
import {
  admin,
  apparenceDeTest,
  appeler,
  appelerTexte,
  base,
  brouillonDeTest,
  creerCompte,
  decaler,
  factureDeTest,
  NUMERO_PROPOSE,
  urlFonction,
} from './aide.ts';

type Compte = Awaited<ReturnType<typeof creerCompte>>;
// biome-ignore lint/suspicious/noExplicitAny: corps de réponse JSON, lu champ par champ par les assertions
type Corps = Record<string, any>;

const aujourdhui = () => aujourdhuiParis(new Date());

/**
 * Émet `facture` depuis un brouillon neuf de l'entreprise (ou `options.brouillon`), avec l'apparence
 * par défaut ; rend le statut, le corps de la réponse et le brouillon employé.
 */
async function emettre(
  compte: Compte,
  facture: Invoice = factureDeTest(),
  options: {
    brouillon?: { id: string; version: number };
    appearance?: Record<string, unknown>;
    enTetes?: Record<string, string>;
    clientId?: string;
  } = {},
): Promise<{ status: number; corps: Corps; brouillon: { id: string; version: number } }> {
  const brouillon = options.brouillon ?? (await brouillonDeTest(compte.entrepriseId));
  const reponse = await appeler(
    'emettre',
    compte.jwt,
    {
      brouillonId: brouillon.id,
      version: brouillon.version,
      invoice: facture,
      appearance: options.appearance ?? apparenceDeTest(),
      clientId: options.clientId,
    },
    options.enTetes,
  );
  return { status: reponse.status, corps: await reponse.json(), brouillon };
}

function numerotation(entrepriseId: string): Promise<{ prochain: number; annee: number }> {
  return base(async (sql) => {
    const [n] = await sql<{ prochain: number; annee: number }[]>`
      select prochain, annee from numerotation where entreprise_id = ${entrepriseId}`;
    return { prochain: n.prochain, annee: n.annee };
  });
}

function nombreDeFactures(entrepriseId: string): Promise<number> {
  return base(async (sql) => {
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from factures where entreprise_id = ${entrepriseId}`;
    return n.n;
  });
}

/**
 * Des factures émises aujourd'hui, écrites directement en base sous ces numéros (sans PDF déposé) :
 * de quoi remplir l'heure ou occuper un numéro.
 */
function insererFactures(compte: Compte, numeros: string[]): Promise<unknown> {
  return base(
    (sql) => sql`
      insert into factures (entreprise_id, numero, type_code, date_emission, client_nom, devise, ht,
                            ttc, net_a_payer, invoice, form, appearance, pdf_chemin, sdk_version,
                            origine, emise_par)
      select ${compte.entrepriseId}, n, '380', (now() at time zone 'Europe/Paris')::date, 'Client',
             'EUR', 100, 120, 120, '{}', '{}', '{}',
             ${compte.entrepriseId}::text || '/ecrite-' || n || '.pdf', '0', 'emise', ${compte.userId}
        from jsonb_array_elements_text(${JSON.stringify(numeros)}::text::jsonb) n`,
  );
}

/** Les noms (`BaseFont`) des polices embarquées dans un PDF. */
async function policesDuPdf(pdf: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(pdf);
  const noms: string[] = [];
  for (const [, objet] of document.context.enumerateIndirectObjects()) {
    if (objet instanceof PDFDict && objet.get(PDFName.of('Type')) === PDFName.of('Font')) {
      noms.push(String(objet.get(PDFName.of('BaseFont'))));
    }
  }
  return noms;
}

function brouillonExiste(id: string): Promise<boolean> {
  return base(async (sql) => {
    const lignes = await sql`select 1 from brouillons where id = ${id}`;
    return lignes.length === 1;
  });
}

async function telecharger(bucket: string, chemin: string): Promise<Uint8Array> {
  const { data, error } = await admin().storage.from(bucket).download(chemin);
  if (error) throw new Error(`${bucket}/${chemin} : ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Le PDF passe veraPDF en PDF/A-3b : code de sortie 0 et rapport conforme. */
async function verapdf(pdf: Uint8Array): Promise<void> {
  const dossier = await Deno.makeTempDir({ prefix: 'facturx-verapdf-' });
  try {
    // Lisible par l'utilisateur du conteneur Docker du shim.
    await Deno.chmod(dossier, 0o755);
    const fichier = `${dossier}/facture.pdf`;
    await Deno.writeFile(fichier, pdf);
    await Deno.chmod(fichier, 0o644);
    const shim = decodeURIComponent(new URL('../../../scripts/verapdf', import.meta.url).pathname);
    const sortie = await new Deno.Command(shim, {
      args: ['--flavour', '3b', fichier],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    const rapport = new TextDecoder().decode(sortie.stdout);
    const fin = `${rapport.slice(-3000)}\n${new TextDecoder().decode(sortie.stderr).slice(-1000)}`;
    assertEquals(sortie.code, 0, `veraPDF sort avec le code ${sortie.code} :\n${fin}`);
    assert(rapport.includes('isCompliant="true"'), `veraPDF : non conforme.\n${fin}`);
  } finally {
    await Deno.remove(dossier, { recursive: true });
  }
}

// Un PNG de 1 × 1 pixel, RVBA.
const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

Deno.test('nominal : numéro attribué, facture enregistrée, brouillon supprimé, PDF Factur-X', async () => {
  const compte = await creerCompte();
  const facture = factureDeTest();
  facture.buyer = { ...facture.buyer, contact: { email: 'compta@client-demo.fr' } };

  const { status, corps, brouillon } = await emettre(compte, facture);
  assertEquals(status, 201);
  const numero = `F-${aujourdhui().slice(0, 4)}-0001`;
  assertEquals(corps.numero, numero);
  assertExists(corps.id);

  const [ligne] = await base(
    (sql) => sql`
    select entreprise_id, numero, type_code, date_emission::text, date_echeance::text, client_nom,
           client_email, devise, ht::text, ttc::text, net_a_payer::text, pdf_chemin, sdk_version,
           brouillon_id, origine, emise_par, facture_origine_id, invoice ->> 'id' as invoice_id,
           invoice ->> 'remittanceInformation' as reference, form, appearance ->> 'font' as police
      from factures where id = ${corps.id}`,
  );
  assertEquals(ligne, {
    entreprise_id: compte.entrepriseId,
    numero,
    type_code: '380',
    date_emission: facture.issueDate,
    date_echeance: facture.paymentTerms.dueDate,
    client_nom: 'Client Démo SARL',
    client_email: 'compta@client-demo.fr',
    devise: 'EUR',
    ht: String(facture.totals.taxExclusiveAmount),
    ttc: String(facture.totals.taxInclusiveAmount),
    net_a_payer: String(facture.totals.amountDueForPayment),
    pdf_chemin: `${compte.entrepriseId}/${corps.id}.pdf`,
    sdk_version: ligne.sdk_version,
    brouillon_id: brouillon.id,
    origine: 'emise',
    emise_par: compte.userId,
    facture_origine_id: null,
    invoice_id: numero,
    reference: numero,
    // Le formulaire du brouillon et l'apparence reçue, en objets JSON.
    form: { id: NUMERO_PROPOSE },
    police: 'geist',
  });
  assert(/^\d+\.\d+\.\d+/.test(ligne.sdk_version));
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 2);
  assertEquals(await brouillonExiste(brouillon.id), false);

  const pdf = await telecharger('factures', ligne.pdf_chemin);
  const extrait = await extractInvoice(pdf);
  assertEquals(extrait?.invoice.id, numero);
  assertEquals(extrait?.invoice.remittanceInformation, numero);
  if (Deno.env.get('VERAPDF') === '1') await verapdf(pdf);
});

Deno.test('rejeu : le même brouillon rend la même facture, sans en émettre une seconde', async () => {
  const compte = await creerCompte();
  const facture = factureDeTest();
  const premier = await emettre(compte, facture);
  assertEquals(premier.status, 201);

  const second = await emettre(compte, facture, { brouillon: premier.brouillon });
  assertEquals(second.status, 200);
  assertEquals(second.corps, premier.corps);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 2);
});

Deno.test('double clic : deux appels simultanés du même brouillon, une seule facture', async () => {
  const compte = await creerCompte();
  const facture = factureDeTest();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  const [a, b] = await Promise.all([
    emettre(compte, facture, { brouillon }),
    emettre(compte, facture, { brouillon }),
  ]);
  // Le second a attendu le verrou de la numérotation, puis trouvé la facture du premier.
  assertEquals([a.status, b.status].sort(), [200, 201]);
  assertEquals(a.corps, b.corps);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 1);
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 2);
});

Deno.test('version périmée : 409 BROUILLON_MODIFIE, rien d’émis', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  // Un enregistrement depuis un autre onglet : la version passe à 2.
  const { error } = await admin()
    .from('brouillons')
    .update({ form: { id: 'autre onglet' } })
    .eq('id', brouillon.id);
  assertEquals(error, null);

  const { status, corps } = await emettre(compte, factureDeTest(), { brouillon });
  assertEquals(status, 409);
  assertEquals(corps.code, 'BROUILLON_MODIFIE');
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('le brouillon d’une autre entreprise ne s’émet pas : 409, rien n’est touché', async () => {
  const titulaire = await creerCompte();
  const autre = await creerCompte();
  const brouillon = await brouillonDeTest(titulaire.entrepriseId);

  const { status, corps } = await emettre(autre, factureDeTest(), { brouillon });
  assertEquals(status, 409);
  assertEquals(corps.code, 'BROUILLON_MODIFIE');
  assertEquals(await brouillonExiste(brouillon.id), true);
  assertEquals(await nombreDeFactures(autre.entrepriseId), 0);
  assertEquals((await numerotation(autre.entrepriseId)).prochain, 1);
});

Deno.test('date future : 409 DATE avec la borne admise, aucun numéro consommé', async () => {
  const compte = await creerCompte();
  const demain = decaler(aujourdhui(), 1);
  const { status, corps, brouillon } = await emettre(compte, factureDeTest(1, demain));
  assertEquals(status, 409);
  assertEquals(corps.code, 'DATE');
  // Aucune facture encore : la borne basse est le 1er janvier de la numérotation (annuelle par
  // défaut), l'année d'inscription.
  assertEquals(corps.details, { min: `${aujourdhui().slice(0, 4)}-01-01`, max: aujourdhui() });
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('date antérieure à la dernière facture : 409 DATE avec min et max', async () => {
  const compte = await creerCompte();
  assertEquals((await emettre(compte, factureDeTest())).status, 201);

  const hier = decaler(aujourdhui(), -1);
  const { status, corps } = await emettre(compte, factureDeTest(1, hier));
  assertEquals(status, 409);
  assertEquals(corps.code, 'DATE');
  assertEquals(corps.details, { min: aujourdhui(), max: aujourdhui() });
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 2);
});

Deno.test('anomalies : 422 ANOMALIES avec les Issue du SDK, aucun numéro consommé', async () => {
  const compte = await creerCompte();
  // Ni échéance, ni moyen de paiement, ni conditions : les conditions structurées suffiraient
  // sinon à BR-CO-25, et la facture serait valide.
  const facture = { ...factureDeTest(), paymentTerms: {} } as Invoice;
  delete facture.paymentMeans;

  const { status, corps, brouillon } = await emettre(compte, facture);
  assertEquals(status, 422);
  assertEquals(corps.code, 'ANOMALIES');
  assert(Array.isArray(corps.details) && corps.details.length > 0);
  for (const issue of corps.details) {
    assertEquals(typeof issue.code, 'string');
    assertEquals(typeof issue.path, 'string');
  }
  assert(corps.details.some((i: Corps) => i.code === 'BR-CO-25' && i.path === 'paymentTerms'));
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('émissions simultanées : cinq numéros distincts et consécutifs', async () => {
  const compte = await creerCompte();
  const reponses = await Promise.all(Array.from({ length: 5 }, () => emettre(compte)));
  assertEquals(
    reponses.map((r) => r.status),
    [201, 201, 201, 201, 201],
  );
  const annee = aujourdhui().slice(0, 4);
  assertEquals(
    reponses.map((r) => r.corps.numero).sort(),
    [1, 2, 3, 4, 5].map((n) => `F-${annee}-000${n}`),
  );
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 6);
});

Deno.test('première facture de l’année : F-2027-0001 après F-2026-0137', async () => {
  const compte = await creerCompte();
  // La numérotation reprise à 137 en 2026 (l'année ne change que sous le drapeau de l'émission).
  await base((sql) =>
    sql.begin(async (tx) => {
      await tx`set local facturx.emission = 'on'`;
      await tx`update numerotation set annee = 2026, prochain = 137
                where entreprise_id = ${compte.entrepriseId}`;
    }),
  );

  const decembre = await emettre(compte, factureDeTest(1, '2026-12-31'), {
    enTetes: { 'x-facturx-aujourdhui': '2026-12-31' },
  });
  assertEquals(decembre.status, 201);
  assertEquals(decembre.corps.numero, 'F-2026-0137');
  assertEquals(await numerotation(compte.entrepriseId), { prochain: 138, annee: 2026 });

  // Le 2 janvier est admis après une facture du 31 décembre, et le rang repart à 1.
  const janvier = await emettre(compte, factureDeTest(1, '2027-01-02'), {
    enTetes: { 'x-facturx-aujourdhui': '2027-01-02' },
  });
  assertEquals(janvier.status, 201);
  assertEquals(janvier.corps.numero, 'F-2027-0001');
  assertEquals(await numerotation(compte.entrepriseId), { prochain: 2, annee: 2027 });
});

Deno.test('numérotation annuelle : pas de facture datée avant le 1er janvier de son année', async () => {
  const compte = await creerCompte();
  // Un compte dont la numérotation est déjà en 2027, sans facture encore (Ruling 30). Admise, une
  // facture du 30 décembre prendrait F-2026-0001, et la série 2027 commencerait à 0002.
  await base((sql) =>
    sql.begin(async (tx) => {
      await tx`set local facturx.emission = 'on'`;
      await tx`update numerotation set annee = 2027 where entreprise_id = ${compte.entrepriseId}`;
    }),
  );

  const { status, corps, brouillon } = await emettre(compte, factureDeTest(1, '2026-12-30'), {
    enTetes: { 'x-facturx-aujourdhui': '2027-01-03' },
  });
  assertEquals(status, 409);
  assertEquals(corps.code, 'DATE');
  assertEquals(corps.details, { min: '2027-01-01', max: '2027-01-03' });
  assertEquals(await numerotation(compte.entrepriseId), { prochain: 1, annee: 2027 });
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('avoir : la facture citée doit être de l’entreprise, puis facture_origine_id', async () => {
  const autre = await creerCompte();
  const compte = await creerCompte();
  const etrangere = await emettre(autre, factureDeTest());
  assertEquals(etrangere.status, 201);

  const avoirDe = (numero: string): Invoice => ({
    ...factureDeTest(),
    typeCode: '381',
    references: { precedingInvoices: [{ id: numero, issueDate: aujourdhui() as IsoDate }] },
  });

  // Le numéro existe, mais dans une autre entreprise.
  const refus = await emettre(compte, avoirDe(etrangere.corps.numero));
  assertEquals(refus.status, 422);
  assertEquals(refus.corps.code, 'ANOMALIES');
  assertEquals(refus.corps.details[0].path, 'references.precedingInvoices[0].id');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);

  // La même chaîne de numéro, émise cette fois par l'entreprise elle-même.
  const propre = await emettre(compte, factureDeTest());
  assertEquals(propre.corps.numero, etrangere.corps.numero);
  const avoir = await emettre(compte, avoirDe(propre.corps.numero));
  assertEquals(avoir.status, 201);
  const [ligne] = await base(
    (sql) => sql`
    select type_code, facture_origine_id from factures where id = ${avoir.corps.id}`,
  );
  assertEquals(ligne, { type_code: '381', facture_origine_id: propre.corps.id });
});

Deno.test('adresse non confirmée : 403 NON_CONFIRME', async () => {
  const compte = await creerCompte();
  // La session reste valable ; c'est l'adresse qui ne l'est plus (le serveur d'auth le dit).
  await base(
    (sql) => sql`update auth.users set email_confirmed_at = null where id = ${compte.userId}`,
  );

  const { status, corps } = await emettre(compte);
  assertEquals(status, 403);
  assertEquals(corps.code, 'NON_CONFIRME');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
});

Deno.test('sans jeton, ou avec un jeton refusé : 401 SESSION', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  const corps = {
    brouillonId: brouillon.id,
    version: brouillon.version,
    invoice: factureDeTest(),
    appearance: apparenceDeTest(),
  };
  const anonyme = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // Sans en-tête, avec la clé publique (ce que supabase-js envoie hors session), avec un jeton altéré.
  for (const jwt of ['', anonyme, `${compte.jwt.slice(0, -4)}AAAA`]) {
    const reponse = await appeler('emettre', jwt, corps);
    assertEquals(reponse.status, 401);
    const erreur = await reponse.json();
    assertEquals(erreur.code, 'SESSION');
    assertEquals(typeof erreur.message, 'string');
  }
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('logo invalide : un fichier qui n’est pas un PNG donne 422 FICHIER', async () => {
  const compte = await creerCompte();
  const { error } = await admin()
    .storage.from('fichiers')
    .upload(`${compte.entrepriseId}/logo-faux`, new TextEncoder().encode('pas un PNG'), {
      contentType: 'image/png',
    });
  assertEquals(error, null);
  const appearance = {
    ...apparenceDeTest(),
    logo: { key: 'logo-faux', type: 'png', position: 'left', height: 44, name: 'logo.png' },
  };

  const { status, corps, brouillon } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 422);
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'FICHIER');
  assertEquals(corps.details[0].path, 'appearance.logo');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('logo PNG de l’entreprise : la facture est émise avec lui', async () => {
  const compte = await creerCompte();
  const { error } = await admin()
    .storage.from('fichiers')
    .upload(`${compte.entrepriseId}/logo-vrai`, PNG_1PX, { contentType: 'image/png' });
  assertEquals(error, null);
  const appearance = {
    ...apparenceDeTest(),
    logo: { key: 'logo-vrai', type: 'png', position: 'right', height: 30, name: 'logo.png' },
  };

  const { status, corps } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 201);
  const pdf = await telecharger('factures', `${compte.entrepriseId}/${corps.id}.pdf`);
  assertEquals((await extractInvoice(pdf))?.invoice.id, corps.numero);
});

Deno.test('le logo d’une autre entreprise ne se lit pas par un chemin relatif : 422 FICHIER', async () => {
  const autre = await creerCompte();
  const compte = await creerCompte();
  const { error } = await admin()
    .storage.from('fichiers')
    .upload(`${autre.entrepriseId}/logo-vrai`, PNG_1PX, { contentType: 'image/png' });
  assertEquals(error, null);
  // Le client de service passe outre la RLS : la clé doit rester dans le dossier de l'entreprise.
  const appearance = {
    ...apparenceDeTest(),
    logo: {
      key: `../${autre.entrepriseId}/logo-vrai`,
      type: 'png',
      position: 'left',
      height: 44,
      name: 'logo.png',
    },
  };

  const { status, corps } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 422);
  assertEquals(corps.details[0].code, 'FICHIER');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
});

Deno.test('libellés : seuls ceux que le Studio laisse renommer s’appliquent', async () => {
  const compte = await creerCompte();
  // `page` est une fonction de la pagination, `invoice` la table des titres : une chaîne à leur
  // place casserait le rendu. Le libellé du vendeur, lui, se renomme.
  const appearance = {
    ...apparenceDeTest(),
    labels: { page: 'Page', invoice: 'Titre', seller: 'Prestataire' },
  };
  const { status } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 201);
});

Deno.test('un caractère absent de la police : 422, et non une erreur du serveur', async () => {
  const compte = await creerCompte();
  const facture = factureDeTest();
  facture.lines = [{ ...facture.lines[0], name: 'Licorne 🦄' }];

  const { status, corps, brouillon } = await emettre(compte, facture);
  assertEquals(status, 422);
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'GLYPH_MISSING');
  assertEquals(corps.details[0].path, 'appearance.font');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('limite : la 61e émission de l’heure rend 429 LIMITE sans consommer de numéro', async () => {
  const compte = await creerCompte();
  // 60 émissions dans l'heure, écrites directement : bien plus rapide que 60 appels.
  await insererFactures(
    compte,
    Array.from({ length: 60 }, (_, i) => `L-${i + 1}`),
  );

  const { status, corps, brouillon } = await emettre(compte);
  assertEquals(status, 429);
  assertEquals(corps.code, 'LIMITE');
  const reessayer = Date.parse(corps.details.reessayerApres);
  assert(reessayer > Date.now() && reessayer <= Date.now() + 3_600_000);
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 60);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('client de la facture : retenu s’il est de l’entreprise, null sinon, sans erreur', async () => {
  const autre = await creerCompte();
  const compte = await creerCompte();
  for (const [entrepriseId, id] of [
    [compte.entrepriseId, 'u-client-propre'],
    [autre.entrepriseId, 'u-client-autre'],
  ]) {
    const { error } = await admin()
      .from('clients')
      .insert({ id, entreprise_id: entrepriseId, party: {}, nom: 'Client Démo SARL' });
    assertEquals(error, null);
  }

  // Un client de l'entreprise, un uid inconnu, le client d'une autre entreprise.
  const cas: [string, string | null][] = [
    ['u-client-propre', 'u-client-propre'],
    ['u-inconnu', null],
    ['u-client-autre', null],
  ];
  for (const [clientId, attendu] of cas) {
    const { status, corps } = await emettre(compte, factureDeTest(), { clientId });
    assertEquals(status, 201);
    const [ligne] = await base((sql) => sql`select client_id from factures where id = ${corps.id}`);
    assertEquals(ligne.client_id, attendu);
  }
});

Deno.test('jeton valide d’un compte qui n’est membre d’aucune entreprise : 403 DROITS', async () => {
  const compte = await creerCompte();
  await base((sql) => sql`delete from membres where user_id = ${compte.userId}`);

  const { status, corps } = await emettre(compte);
  assertEquals(status, 403);
  assertEquals(corps.code, 'DROITS');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
});

Deno.test('numéro déjà présent dans l’entreprise : 409 DOUBLON, aucun numéro consommé', async () => {
  const compte = await creerCompte();
  // Le numéro que la numérotation attribuerait, déjà pris (import, gabarit changé).
  const numero = `F-${aujourdhui().slice(0, 4)}-0001`;
  await insererFactures(compte, [numero]);

  const { status, corps, brouillon } = await emettre(compte);
  assertEquals(status, 409);
  assertEquals(corps.code, 'DOUBLON');
  assertEquals(corps.details, { numero });
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('corps qui n’est pas du JSON : 422 ANOMALIES, Issue CORPS', async () => {
  const compte = await creerCompte();
  const reponse = await fetch(urlFonction('emettre'), {
    method: 'POST',
    headers: { authorization: `Bearer ${compte.jwt}`, 'content-type': 'application/json' },
    body: 'pas du JSON',
  });
  assertEquals(reponse.status, 422);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'CORPS');
});

Deno.test('corps de plus de 10 Mio : 413 ANOMALIES, Issue CORPS', async () => {
  const compte = await creerCompte();
  const reponse = await fetch(urlFonction('emettre'), {
    method: 'POST',
    headers: { authorization: `Bearer ${compte.jwt}`, 'content-type': 'application/json' },
    body: 'x'.repeat(10 * 1024 * 1024 + 1),
  });
  assertEquals(reponse.status, 413);
  const corps = await reponse.json();
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'CORPS');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
});

Deno.test('référence de paiement distincte du numéro proposé : laissée telle quelle', async () => {
  const compte = await creerCompte();
  const facture = { ...factureDeTest(), remittanceInformation: 'CLIENT-REF-42' };

  const { status, corps } = await emettre(compte, facture);
  assertEquals(status, 201);
  const [ligne] = await base(
    (sql) => sql`
    select invoice ->> 'id' as numero, invoice ->> 'remittanceInformation' as reference
      from factures where id = ${corps.id}`,
  );
  assertEquals(ligne, { numero: corps.numero, reference: 'CLIENT-REF-42' });
});

Deno.test('police importée : lue dans fichiers et embarquée ; absente, 422 FICHIER', async () => {
  const compte = await creerCompte();
  // Inter, que l'apparence ne désigne pas : la police du PDF ne peut venir que du fichier importé.
  const inter = await telecharger('polices', 'inter-regular.ttf');
  const { error } = await admin()
    .storage.from('fichiers')
    .upload(`${compte.entrepriseId}/font-importee`, inter, { contentType: 'font/ttf' });
  assertEquals(error, null);
  const appearance = {
    ...apparenceDeTest(),
    font: 'custom',
    customFont: { regularKey: 'font-importee', name: 'Inter importée' },
  };

  const { status, corps } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 201);
  const polices = await policesDuPdf(
    await telecharger('factures', `${compte.entrepriseId}/${corps.id}.pdf`),
  );
  assert(polices.length > 0 && polices.every((nom) => nom.includes('Inter')), String(polices));

  const absente = await emettre(compte, factureDeTest(), {
    appearance: { ...appearance, customFont: { regularKey: 'font-absente', name: 'Absente' } },
  });
  assertEquals(absente.status, 422);
  assertEquals(absente.corps.details[0].code, 'FICHIER');
  assertEquals(absente.corps.details[0].path, 'appearance.customFont');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 2);
});

Deno.test('logo de plus de 1 Mo : le bucket l’accepte, l’émission le refuse (422 FICHIER)', async () => {
  const compte = await creerCompte();
  // 1,5 Mio, signature PNG en tête : seul le plafond du logo le refuse (le bucket admet 2 Mio).
  const lourd = new Uint8Array(1.5 * 1024 * 1024);
  lourd.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { error } = await admin()
    .storage.from('fichiers')
    .upload(`${compte.entrepriseId}/logo-lourd`, lourd, { contentType: 'image/png' });
  assertEquals(error, null);
  const appearance = {
    ...apparenceDeTest(),
    logo: { key: 'logo-lourd', type: 'png', position: 'left', height: 44, name: 'logo.png' },
  };

  const { status, corps } = await emettre(compte, factureDeTest(), { appearance });
  assertEquals(status, 422);
  assertEquals(corps.details[0].code, 'FICHIER');
  assertEquals(corps.details[0].path, 'appearance.logo');
  assert(corps.details[0].message.includes('1 Mo'), corps.details[0].message);
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
});

Deno.test('texte que jsonb refuse (caractère nul, demi-substitut isolé) : 422 CORPS, rien d’émis ni déposé', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  const nul = factureDeTest();
  nul.buyer = { ...nul.buyer, name: 'Client \u0000 SARL' };
  const cas: [string, Invoice, Record<string, unknown>, string][] = [
    ['caractère nul dans la facture', nul, apparenceDeTest(), 'buyer.name'],
    [
      'demi-substitut dans l’apparence',
      factureDeTest(),
      { ...apparenceDeTest(), footer: 'a\ud800' },
      'appearance.footer',
    ],
  ];
  for (const [nom, facture, appearance, chemin] of cas) {
    const { status, corps } = await emettre(compte, facture, { brouillon, appearance });
    assertEquals(status, 422, nom);
    assertEquals(corps.code, 'ANOMALIES', nom);
    assertEquals(corps.details[0].code, 'CORPS', nom);
    assertEquals(corps.details[0].path, chemin, nom);
  }
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await brouillonExiste(brouillon.id), true);
  const { data, error } = await admin().storage.from('factures').list(compte.entrepriseId);
  assertEquals(error, null);
  assertEquals(
    data?.map((objet) => objet.name),
    [],
  );
});

Deno.test('date de l’an 0 (émission ou échéance) : 422 FORMAT-DATE, et non une erreur du serveur', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  // `isValidIsoDate` lit l'an 0 comme 1900 ; Postgres refuse `0000-01-01`.
  const echeance = factureDeTest();
  echeance.paymentTerms = { ...echeance.paymentTerms, dueDate: '0000-01-01' as IsoDate };
  const emission = { ...factureDeTest(), issueDate: '0000-01-01' as IsoDate };
  for (const [nom, facture, chemin] of [
    ['échéance', echeance, 'paymentTerms.dueDate'],
    ['émission', emission, 'issueDate'],
  ] as const) {
    const { status, corps } = await emettre(compte, facture, { brouillon });
    assertEquals(status, 422, nom);
    assertEquals(corps.code, 'ANOMALIES', nom);
    assertEquals(corps.details[0].code, 'FORMAT-DATE', nom);
    assertEquals(corps.details[0].path, chemin, nom);
  }
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await brouillonExiste(brouillon.id), true);
});

Deno.test('clientId avec un caractère nul : 422 CORPS, rien d’émis ni déposé', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);

  const { status, corps } = await emettre(compte, factureDeTest(), {
    brouillon,
    clientId: 'u-client\u0000',
  });
  assertEquals(status, 422);
  assertEquals(corps.code, 'ANOMALIES');
  assertEquals(corps.details[0].code, 'CORPS');
  assertEquals(corps.details[0].path, 'clientId');
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await brouillonExiste(brouillon.id), true);
  const { data } = await admin().storage.from('factures').list(compte.entrepriseId);
  assertEquals(data?.length, 0);
});

Deno.test('facture ou apparence imbriquées sur 3 000 niveaux : 422 CORPS, rien d’émis ni déposé', async () => {
  const compte = await creerCompte();
  const brouillon = await brouillonDeTest(compte.entrepriseId);
  // Le SDK laisse passer une propriété inconnue, et la facture enregistrée la porte : `toPortableJson`
  // lèverait en l'écrivant, après le dépôt du PDF (il lève au-delà de 2 700 niveaux environ). Le corps
  // s'écrit à la main : `toPortableJson` ne sait pas l'écrire non plus. La profondeur est plafonnée à
  // 64 niveaux avant le décodage (`lireObjetPortable`) : 422 au chemin vide, quel que soit le runtime.
  const profond = `${'['.repeat(3000)}${']'.repeat(3000)}`;
  const avec = (valeur: unknown) => {
    const texte = toPortableJson(valeur);
    return `${texte.slice(0, texte.lastIndexOf('}'))},"extra":${profond}}`;
  };
  const corps = (invoice: string, appearance: string) =>
    `{"brouillonId":"${brouillon.id}","version":${brouillon.version},"invoice":${invoice},"appearance":${appearance}}`;
  const cas: [string, string][] = [
    ['invoice', corps(avec(factureDeTest()), toPortableJson(apparenceDeTest()))],
    ['appearance', corps(toPortableJson(factureDeTest()), avec(apparenceDeTest()))],
  ];
  for (const [nom, texte] of cas) {
    const reponse = await appelerTexte('emettre', compte.jwt, texte);
    assertEquals(reponse.status, 422, nom);
    const erreur = await reponse.json();
    assertEquals(erreur.code, 'ANOMALIES', nom);
    assertEquals(erreur.details[0].code, 'CORPS', nom);
    assertEquals(erreur.details[0].path, '', nom);
  }
  assertEquals((await numerotation(compte.entrepriseId)).prochain, 1);
  assertEquals(await nombreDeFactures(compte.entrepriseId), 0);
  assertEquals(await brouillonExiste(brouillon.id), true);
  const { data } = await admin().storage.from('factures').list(compte.entrepriseId);
  assertEquals(data?.length, 0);
});
