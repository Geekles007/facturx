import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toPortableJson } from '../../shared/portable.js';
import { t } from '../i18n.js';
import { defaultAppearance } from '../library.js';
import { buildInvoice, type InvoiceForm } from '../model.js';
import { sampleForm } from '../sample.js';
import { store } from '../store.js';
import { resteDeLigne } from './factures.js';
import { lecteurPdfIntegre } from './fiche.js';
import {
  annulerPaiement,
  aujourdhuiParis,
  DUREE_URL_PDF_S,
  enregistrerPaiement,
  filtrer,
  type LigneSuivi,
  ligneSuivi,
  lireMontant,
  listerSuivi,
  marquerPayee,
  messageDErreur,
  messageDe,
  montantSaisi,
  ordonnerPaiements,
  type Paiement,
  paiementsDe,
  pdfDe,
  relancesDe,
  urlPdf,
} from './suivi.js';
import { adminDeTest, compteDeTest } from './test-aide.js';

/**
 * Le suivi des factures : sans pile, les phrases des refus, la lecture des montants et les filtres ;
 * contre la pile, avec `emettre` servie (`FACTURX_EMETTRE=1`), des factures vraiment émises, leurs
 * paiements, leurs statuts relus dans la vue, et leur PDF.
 */

/** Le client que `suivi.ts` emploie par `client()` : celui de l'essai en cours. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

const phrases = t.compte.suivi;

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;

afterEach(() => {
  store.set({ ui: uiAvant });
  session.sb = undefined;
});

/** Connecte le suivi au client `sb`, pour l'entreprise `entrepriseId`. */
function connecter(sb: unknown, entrepriseId: string): void {
  session.sb = sb;
  store.set((s) => ({ ui: { ...s.ui, compte: compteUi(entrepriseId), connexion: undefined } }));
}

// ---------- sans pile ----------

type Reponse = { data?: unknown; error?: unknown; status?: number };

/**
 * Un faux client PostgREST : chaque appel est noté, et chaque requête attendue rend la réponse
 * suivante de `reponses` (à défaut, une liste vide).
 */
function fauxClient(reponses: Reponse[] = []) {
  const appels: unknown[][] = [];
  const requete = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of [
      'select',
      'eq',
      'gte',
      'lte',
      'is',
      'order',
      'range',
      'insert',
      'update',
      'maybeSingle',
    ]) {
      q[m] = (...a: unknown[]) => {
        appels.push([m, ...a]);
        return q;
      };
    }
    // biome-ignore lint/suspicious/noThenProperty: une requête de PostgREST s'attend comme une promesse.
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, status: 200, ...reponses.shift() }).then(ok, ko);
    return q;
  };
  const client = {
    from: (table: string) => {
      appels.push(['from', table]);
      return requete();
    },
  };
  return { client, appels };
}

/** Un client qui échoue au moindre appel : rien ne doit partir. */
const aucunAppel = {
  from: () => {
    throw new Error('aucun appel attendu');
  },
};

describe('les refus, en phrases de l’interface (sans pile)', () => {
  test('chaque refus des paiements a sa phrase', () => {
    const refus = (message: string) => messageDErreur({ code: 'P0001', message }, 400);
    expect(refus('PAIEMENT_EXCESSIF')).toBe(phrases.erreurs.excessif);
    expect(refus('PAIEMENT_DATE')).toBe(phrases.erreurs.date);
    expect(refus('PAIEMENT_AVOIR')).toBe(phrases.erreurs.avoir);
    expect(refus('PAIEMENT_ANNULATION')).toBe(phrases.erreurs.annulation);
    // Les quatre phrases sont distinctes, et ne reprennent jamais le code du serveur.
    const toutes = ['EXCESSIF', 'DATE', 'AVOIR', 'ANNULATION'].map((c) => refus(`PAIEMENT_${c}`));
    expect(new Set(toutes).size).toBe(4);
    for (const phrase of toutes) expect(phrase).not.toMatch(/PAIEMENT_/);
  });

  test('droits, session, réseau, serveur, valeur illisible, inconnu', () => {
    const rls = 'new row violates row-level security policy for table "paiements"';
    expect(messageDErreur({ code: '42501', message: rls }, 403)).toBe(phrases.erreurs.droits);
    expect(messageDErreur({ code: 'PGRST301', message: 'JWT expired' }, 401)).toBe(
      phrases.erreurs.session,
    );
    expect(messageDErreur({ code: '', message: 'TypeError: fetch failed' }, 0)).toBe(
      phrases.erreurs.reseau,
    );
    expect(messageDErreur({ message: 'Bad gateway' }, 502)).toBe(phrases.erreurs.serveur);
    expect(messageDErreur({ code: '22P02', message: 'invalid input syntax' }, 400)).toBe(
      phrases.erreurs.invalide,
    );
    expect(messageDErreur({ code: '23514', message: 'check' }, 400)).toBe(phrases.erreurs.invalide);
    expect(messageDErreur({ code: 'XX000', message: 'quelque chose' }, 400)).toBe(
      phrases.erreurs.autre,
    );
    expect(messageDErreur(null, 400)).toBe(phrases.erreurs.autre);
  });

  test('une session refusée à l’écriture : la connexion s’ouvre, rien n’est levé', async () => {
    const { client } = fauxClient([
      { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    ]);
    connecter(client, 'e-1');
    expect(await annulerPaiement('p-1')).toEqual({ ok: false, message: phrases.erreurs.session });
    expect(store.get().ui.compte?.session).toBe('expiree');
    expect(store.get().ui.connexion).toBe('connexion');
  });

  test('le réseau coupé : la phrase du réseau, jamais une exception', async () => {
    const { client } = fauxClient([
      { data: null, error: { code: '', message: 'TypeError: fetch failed' }, status: 0 },
    ]);
    connecter(client, 'e-1');
    const p = { factureId: 'f-1', date: '2026-11-04', montant: 100, moyen: 'virement' as const };
    expect(await enregistrerPaiement(p)).toEqual({ ok: false, message: phrases.erreurs.reseau });
    // `fetch` qui lève (Chrome, Firefox, Safari, Node) : c'est encore le réseau.
    for (const texte of ['Failed to fetch', 'NetworkError when attempting', 'Load failed']) {
      const leve = {
        from: () => {
          throw new TypeError(texte);
        },
      };
      connecter(leve, 'e-1');
      expect(await enregistrerPaiement(p)).toEqual({ ok: false, message: phrases.erreurs.reseau });
    }
  });

  test('une exception qui n’est pas le réseau : un message honnête, le détail en console', async () => {
    const console = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined);
    try {
      connecter(aucunAppel, 'e-1');
      const p = { factureId: 'f-1', date: '2026-11-04', montant: 100, moyen: 'virement' as const };
      const inattendue = { ok: false, message: phrases.erreurs.inattendue };
      expect(await enregistrerPaiement(p)).toEqual(inattendue);
      expect(await annulerPaiement('p-1')).toEqual(inattendue);
      expect(await marquerPayee('f-1', '2026-11-04', 100)).toEqual(inattendue);
      expect(console).toHaveBeenCalledTimes(3);
      expect(messageDe(new TypeError('x is not a function'))).toBe(phrases.erreurs.inattendue);
      expect(phrases.erreurs.inattendue).not.toBe(phrases.erreurs.reseau);
      // La liste l'affiche aussi : la phrase ne renvoie pas à la seule fiche.
      expect(phrases.erreurs.inattendue).not.toMatch(/fiche/);
    } finally {
      console.mockRestore();
    }
  });

  test('« Marquer comme payée » : le montant confirmé, ou rien si le reste dû a changé', async () => {
    const ligne = (resteDu: number) => ({
      data: { facture_id: 'f-1', entreprise_id: 'e-1', reste_du: resteDu, statut: 'a_payer' },
    });
    // Un autre onglet a payé 1 000 depuis l'affichage : rien ne part.
    const change = fauxClient([ligne(5000)]);
    connecter(change.client, 'e-1');
    expect(await marquerPayee('f-1', '2026-11-04', 6000)).toEqual({
      ok: false,
      message: phrases.erreurs.resteChange,
    });
    expect(change.appels.filter((a) => a[0] === 'insert')).toEqual([]);
    // Le même reste : le paiement est celui qui a été confirmé.
    const meme = fauxClient([ligne(6000), { data: null, error: null, status: 201 }]);
    connecter(meme.client, 'e-1');
    expect(await marquerPayee('f-1', '2026-11-04', 6000)).toEqual({ ok: true });
    expect(meme.appels.filter((a) => a[0] === 'insert')).toEqual([
      [
        'insert',
        {
          entreprise_id: 'e-1',
          facture_id: 'f-1',
          date: '2026-11-04',
          montant: 6000,
          moyen: 'autre',
          note: null,
        },
      ],
    ]);
  });

  test('sans compte chargé : rien ne part, et le Studio le dit', async () => {
    session.sb = aucunAppel;
    store.set((s) => ({ ui: { ...s.ui, compte: undefined } }));
    await expect(listerSuivi({})).rejects.toThrow(phrases.erreurs.sansCompte);
    expect(
      await enregistrerPaiement({ factureId: 'f', date: '2026-11-04', montant: 1, moyen: 'autre' }),
    ).toEqual({ ok: false, message: phrases.erreurs.sansCompte });
  });

  test('annuler un paiement déjà annulé : aucune ligne touchée, un message', async () => {
    const { client, appels } = fauxClient([{ data: [], error: null, status: 200 }]);
    connecter(client, 'e-1');
    expect(await annulerPaiement('p-9')).toEqual({
      ok: false,
      message: phrases.erreurs.dejaAnnule,
    });
    // Un seul paiement visé, par son identifiant, et seulement s'il est encore actif.
    expect(appels).toContainEqual(['eq', 'id', 'p-9']);
    expect(appels).toContainEqual(['eq', 'entreprise_id', 'e-1']);
    expect(appels).toContainEqual(['is', 'annule_le', null]);
    expect(appels.filter((a) => a[0] === 'update')).toHaveLength(1);
  });
});

describe('le montant saisi (sans pile)', () => {
  test('lu comme dans l’éditeur, en centimes', () => {
    expect(lireMontant('1 234,56')).toEqual({ ok: true, montant: 123456 });
    expect(lireMontant('1234.5')).toEqual({ ok: true, montant: 123450 });
    expect(lireMontant('12')).toEqual({ ok: true, montant: 1200 });
  });

  test('vide, illisible, nul, négatif ou trop précis : refusé, avec sa phrase', () => {
    expect(lireMontant('')).toEqual({ ok: false, message: phrases.montant.vide });
    expect(lireMontant('  ')).toEqual({ ok: false, message: phrases.montant.vide });
    expect(lireMontant('douze')).toEqual({ ok: false, message: phrases.montant.illisible });
    expect(lireMontant('0')).toEqual({ ok: false, message: phrases.montant.positif });
    expect(lireMontant('0,00')).toEqual({ ok: false, message: phrases.montant.positif });
    expect(lireMontant('-5')).toEqual({ ok: false, message: phrases.montant.positif });
    expect(lireMontant('12,345')).toEqual({ ok: false, message: phrases.montant.decimales });
  });

  test('un montant nul, négatif ou fractionnaire n’appelle pas le serveur', async () => {
    connecter(aucunAppel, 'e-1');
    for (const montant of [0, -100, 12.5, Number.NaN]) {
      expect(
        await enregistrerPaiement({ factureId: 'f', date: '2026-11-04', montant, moyen: 'autre' }),
      ).toEqual({ ok: false, message: phrases.montant.positif });
    }
  });

  test('le reste dû proposé à la saisie se relit au centime près', () => {
    for (const c of [1, 99, 100, 123456, 370363]) {
      expect(lireMontant(montantSaisi(c))).toEqual({ ok: true, montant: c });
    }
  });
});

describe('les filtres et l’ordre (sans pile)', () => {
  test('seuls les filtres renseignés s’appliquent', () => {
    const { client, appels } = fauxClient();
    const q = client.from('suivi_factures');
    filtrer(q, {});
    expect(appels).toEqual([['from', 'suivi_factures']]);
    filtrer(q, { statut: 'en_retard', clientId: 'c-1', debut: '2026-01-01', fin: '2026-12-31' });
    expect(appels.slice(1)).toEqual([
      ['eq', 'statut', 'en_retard'],
      ['eq', 'client_id', 'c-1'],
      ['gte', 'date_emission', '2026-01-01'],
      ['lte', 'date_emission', '2026-12-31'],
    ]);
  });

  test('la liste : la vue de l’entreprise, filtrée, en camelCase, page par page', async () => {
    const ligne = {
      facture_id: 'f-1',
      entreprise_id: 'e-1',
      numero: 'F-2026-0001',
      type_code: '380',
      date_emission: '2026-11-04',
      date_echeance: '2026-10-01',
      client_id: 'c-1',
      client_nom: 'Client',
      client_email: null,
      devise: 'EUR',
      ht: 1000,
      ttc: '1200',
      net_a_payer: 1200,
      encaisse: 200,
      avoirs: 0,
      reste_du: 1000,
      statut: 'en_retard',
      jours_retard: 34,
    };
    const { client, appels } = fauxClient([
      { data: Array.from({ length: 1000 }, () => ligne) },
      { data: [ligne] },
    ]);
    connecter(client, 'e-1');
    const lignes = await listerSuivi({ statut: 'en_retard' });
    expect(lignes).toHaveLength(1001);
    expect(lignes[0]).toEqual({
      factureId: 'f-1',
      entrepriseId: 'e-1',
      numero: 'F-2026-0001',
      typeCode: '380',
      dateEmission: '2026-11-04',
      dateEcheance: '2026-10-01',
      clientId: 'c-1',
      clientNom: 'Client',
      clientEmail: null,
      devise: 'EUR',
      ht: 1000,
      ttc: 1200,
      netAPayer: 1200,
      encaisse: 200,
      avoirs: 0,
      resteDu: 1000,
      statut: 'en_retard',
      joursRetard: 34,
    });
    expect(appels.filter((a) => a[0] === 'from')).toEqual([
      ['from', 'suivi_factures'],
      ['from', 'suivi_factures'],
    ]);
    expect(appels).toContainEqual(['eq', 'entreprise_id', 'e-1']);
    expect(appels).toContainEqual(['eq', 'statut', 'en_retard']);
    expect(appels.filter((a) => a[0] === 'range')).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });

  test('les paiements actifs d’abord, puis les annulés, chacun dans l’ordre des dates', () => {
    const p = (id: string, date: string, annuleLe: string | null): Paiement => ({
      id,
      factureId: 'f',
      date,
      montant: 1,
      moyen: 'autre',
      note: null,
      creeLe: `${date}T10:00:00Z`,
      annuleLe,
    });
    const ordre = ordonnerPaiements([
      p('a', '2026-11-03', '2026-11-04T09:00:00Z'),
      p('b', '2026-11-02', null),
      p('c', '2026-11-01', '2026-11-04T09:00:00Z'),
      p('d', '2026-11-01', null),
    ]).map((x) => x.id);
    expect(ordre).toEqual(['d', 'b', 'c', 'a']);
  });

  test('aujourd’hui à Paris, quand UTC est encore la veille', () => {
    expect(aujourdhuiParis(new Date('2026-11-06T23:30:00Z'))).toBe('2026-11-07');
    expect(aujourdhuiParis(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
    expect(aujourdhuiParis(new Date('2026-11-07T10:00:00Z'))).toBe('2026-11-07');
  });
});

describe('l’affichage (sans pile)', () => {
  const ligne = (statut: LigneSuivi['statut'], netAPayer: number, resteDu: number): LigneSuivi => ({
    factureId: 'f',
    entrepriseId: 'e',
    numero: 'F-1',
    typeCode: '380',
    dateEmission: '2026-11-04',
    dateEcheance: null,
    clientId: null,
    clientNom: 'Client',
    clientEmail: null,
    devise: 'EUR',
    ht: netAPayer,
    ttc: netAPayer,
    netAPayer,
    encaisse: netAPayer - resteDu,
    avoirs: 0,
    resteDu,
    statut,
    joursRetard: null,
  });

  test('une facture à rembourser le dit, au montant à rendre, sans signe', () => {
    expect(resteDeLigne(ligne('a_rembourser', 12000, -1000))).toBe(
      phrases.liste.aRembourser('10,00 €'),
    );
    expect(resteDeLigne(ligne('payee_en_partie', 12000, 2000))).toBe(
      phrases.liste.reste('20,00 €'),
    );
    // Rien à ajouter quand le reste est le net à payer, ou qu'il est nul.
    expect(resteDeLigne(ligne('a_payer', 12000, 12000))).toBe('');
    expect(resteDeLigne(ligne('payee', 12000, 0))).toBe('');
  });

  test('le lecteur PDF du navigateur : absent seulement quand il le dit', () => {
    expect(lecteurPdfIntegre({ pdfViewerEnabled: false })).toBe(false);
    expect(lecteurPdfIntegre({ pdfViewerEnabled: true })).toBe(true);
    // Un navigateur qui ne connaît pas la propriété garde l'aperçu (comportement d'avant).
    expect(lecteurPdfIntegre({})).toBe(true);
    expect(lecteurPdfIntegre(undefined)).toBe(true);
  });
});

// ---------- contre la pile ----------

/**
 * Émet `form` par `emettre`, comme le Studio : un brouillon du compte, puis l'appel avec sa version.
 * Rend l'identifiant et le numéro attribué.
 */
async function emettre(
  sb: SupabaseClient,
  entrepriseId: string,
  form: InvoiceForm,
  clientId?: string,
): Promise<{ id: string; numero: string }> {
  const appearance = defaultAppearance();
  const b = await sb
    .from('brouillons')
    .insert({
      entreprise_id: entrepriseId,
      form: JSON.parse(toPortableJson(form, { compact: true })),
      appearance: JSON.parse(toPortableJson(appearance, { compact: true })),
    })
    .select('id, version')
    .single<{ id: string; version: number }>();
  if (b.error) throw new Error(`brouillon : ${b.error.message}`);
  const corps = toPortableJson(
    {
      brouillonId: b.data.id,
      version: b.data.version,
      invoice: buildInvoice(form).invoice,
      appearance,
      ...(clientId ? { clientId } : {}),
    },
    { compact: true },
  );
  const { data, error } = await sb.functions.invoke('emettre', {
    body: new Blob([corps], { type: 'application/json' }),
  });
  if (error) {
    const detail = await (error.context as Response | undefined)?.text?.().catch(() => '');
    throw new Error(`emettre : ${error.message} ${detail ?? ''}`);
  }
  return data as { id: string; numero: string };
}

/** Un compte neuf, connecté au suivi, et une facture émise (l'exemple du Studio, daté du jour). */
async function factureEmise(modifier?: (f: InvoiceForm) => void) {
  const { sb, entrepriseId } = await compteDeTest();
  connecter(sb, entrepriseId);
  const form = sampleForm(aujourdhuiParis());
  modifier?.(form);
  const facture = await emettre(sb as SupabaseClient, entrepriseId, form);
  const ligne = await ligneSuivi(facture.id);
  if (!ligne) throw new Error('ligne de suivi absente');
  return { sb: sb as SupabaseClient, entrepriseId, facture, ligne, form };
}

/**
 * Une facture insérée comme `emettre` l'enregistre (sans PDF : ces essais n'en lisent pas), par la
 * clé de service. Rend son identifiant.
 *
 * Son numéro est unique sur toute la pile : ces lignes y restent (une facture ne se supprime pas), et
 * les jeux de données des tests de la base (supabase/tests/) retrouvent leurs factures par leur seul
 * numéro (`F-1`, `A-1`…), toutes entreprises confondues.
 */
async function insererFacture(
  entrepriseId: string,
  options: {
    prefixe: string;
    typeCode?: string;
    ttc?: number;
    origine?: string;
    pdfChemin?: (id: string) => string;
  },
): Promise<string> {
  const admin = adminDeTest();
  const membre = await admin.from('membres').select('user_id').eq('entreprise_id', entrepriseId);
  const id = crypto.randomUUID();
  const ttc = options.ttc ?? 12000;
  const { error } = await admin.from('factures').insert({
    id,
    entreprise_id: entrepriseId,
    numero: `${options.prefixe}-SUIVI-${id.slice(0, 8)}`,
    type_code: options.typeCode ?? '380',
    date_emission: aujourdhuiParis(),
    client_nom: 'Client',
    devise: 'EUR',
    ht: 10000,
    ttc,
    net_a_payer: ttc,
    invoice: {},
    form: {},
    appearance: defaultAppearance(),
    pdf_chemin: options.pdfChemin?.(id) ?? `${entrepriseId}/${id}.pdf`,
    sdk_version: 'essai',
    origine: 'emise',
    facture_origine_id: options.origine ?? null,
    emise_par: membre.data?.[0]?.user_id,
  });
  if (error) throw new Error(`facture : ${error.message}`);
  return id;
}

describe.skipIf(!process.env.SUPABASE_URL)('le suivi contre la pile, factures insérées', () => {
  test('un avoir ne se paie pas (`PAIEMENT_AVOIR`) ; son TTC réduit le reste dû', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    connecter(sb, entrepriseId);
    const facture = await insererFacture(entrepriseId, { prefixe: 'F', ttc: 12000 });
    const avoir = await insererFacture(entrepriseId, {
      prefixe: 'AV',
      typeCode: '381',
      ttc: 2000,
      origine: facture,
    });
    // L'avoir n'a pas de ligne de suivi : il ne se paie pas.
    expect(await ligneSuivi(avoir)).toBeUndefined();
    expect(
      await enregistrerPaiement({
        factureId: avoir,
        date: aujourdhuiParis(),
        montant: 1,
        moyen: 'autre',
      }),
    ).toEqual({ ok: false, message: phrases.erreurs.avoir });
    // La vue déduit l'avoir ; le reste dû qu'elle donne borne le paiement suivant.
    expect(await ligneSuivi(facture)).toMatchObject({
      avoirs: 2000,
      resteDu: 10000,
      statut: 'a_payer',
    });
    expect(
      await enregistrerPaiement({
        factureId: facture,
        date: aujourdhuiParis(),
        montant: 10001,
        moyen: 'virement',
      }),
    ).toEqual({ ok: false, message: phrases.erreurs.excessif });
    expect(await marquerPayee(facture, aujourdhuiParis(), 10000)).toEqual({ ok: true });
    expect(await ligneSuivi(facture)).toMatchObject({
      encaisse: 10000,
      resteDu: 0,
      statut: 'payee',
    });
  }, 60_000);

  test('la facture d’une autre entreprise : refusée sans rien en dire, rien d’écrit', async () => {
    const a = await compteDeTest();
    const facture = await insererFacture(a.entrepriseId, { prefixe: 'F' });
    const autre = await compteDeTest();
    connecter(autre.sb, autre.entrepriseId);
    expect(
      await enregistrerPaiement({
        factureId: facture,
        date: aujourdhuiParis(),
        montant: 1,
        moyen: 'autre',
      }),
    ).toEqual({ ok: false, message: phrases.erreurs.droits });
    expect(await ligneSuivi(facture)).toBeUndefined();
    expect(await paiementsDe(facture)).toEqual([]);
    expect(await listerSuivi({})).toEqual([]);
    const { data } = await adminDeTest().from('paiements').select('id').eq('facture_id', facture);
    expect(data).toEqual([]);
  }, 60_000);

  test('« Marquer comme payée » après un paiement fait ailleurs : refusé, puis au nouveau reste', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    connecter(sb, entrepriseId);
    const facture = await insererFacture(entrepriseId, { prefixe: 'F', ttc: 12000 });
    const jour = aujourdhuiParis();
    // La fiche affichait 12 000 ; un autre onglet enregistre 2 000 entre-temps.
    expect(
      await enregistrerPaiement({ factureId: facture, date: jour, montant: 2000, moyen: 'cheque' }),
    ).toEqual({ ok: true });
    expect(await marquerPayee(facture, jour, 12000)).toEqual({
      ok: false,
      message: phrases.erreurs.resteChange,
    });
    expect((await paiementsDe(facture)).map((p) => p.montant)).toEqual([2000]);
    expect(await marquerPayee(facture, jour, 10000)).toEqual({ ok: true });
    expect((await paiementsDe(facture)).map((p) => p.montant)).toEqual([2000, 10000]);
    expect(await ligneSuivi(facture)).toMatchObject({ statut: 'payee', resteDu: 0 });
  }, 60_000);

  test('le PDF : lu au chemin enregistré avec la facture ; absent, « PDF indisponible »', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    connecter(sb, entrepriseId);
    // Un chemin qui n'est pas `<entreprise>/<facture>.pdf` : c'est celui de la facture qui compte.
    const chemin = (id: string) => `${entrepriseId}/ailleurs-${id}.pdf`;
    const facture = await insererFacture(entrepriseId, { prefixe: 'F', pdfChemin: chemin });
    const octets = new TextEncoder().encode('%PDF-1.7\n% essai du chemin\n%%EOF\n');
    const depot = await adminDeTest()
      .storage.from('factures')
      .upload(chemin(facture), octets, { contentType: 'application/pdf' });
    if (depot.error) throw new Error(depot.error.message);
    const pdf = await pdfDe(facture);
    expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()))).toContain(
      'essai du chemin',
    );
    // Sans fichier déposé : la phrase dit ce qui manque, pas le réseau.
    const sansPdf = await insererFacture(entrepriseId, { prefixe: 'F' });
    // Le code de l'erreur dit à la fiche qu'un nouvel essai ne servirait à rien.
    await expect(pdfDe(sansPdf)).rejects.toMatchObject({
      message: phrases.erreurs.pdfIndisponible,
      code: 'PDF_INDISPONIBLE',
    });
    // La facture d'une autre entreprise : rien à signer.
    const autre = await compteDeTest();
    connecter(autre.sb, autre.entrepriseId);
    await expect(urlPdf(facture)).rejects.toThrow(phrases.erreurs.introuvable);
  }, 60_000);

  test('les relances de la facture, la plus récente d’abord, envoyées ou refusées', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    connecter(sb, entrepriseId);
    const facture = await insererFacture(entrepriseId, { prefixe: 'F' });
    const relance = (niveau: number, envoyeeLe: string, etat: string) => ({
      entreprise_id: entrepriseId,
      facture_id: facture,
      niveau,
      envoyee_le: envoyeeLe,
      destinataire: 'compta@client-demo.fr',
      objet: `Relance ${niveau}`,
      corps: 'Bonjour',
      message_id: etat === 'envoyee' ? `<m-${niveau}@essai>` : null,
      etat,
    });
    const { error } = await adminDeTest()
      .from('relances')
      .insert([
        relance(1, '2026-11-01T09:00:00Z', 'envoyee'),
        relance(2, '2026-11-04T09:00:00Z', 'refusee'),
      ]);
    if (error) throw new Error(error.message);
    expect((await relancesDe(facture)).map((r) => [r.niveau, r.etat, r.objet])).toEqual([
      [2, 'refusee', 'Relance 2'],
      [1, 'envoyee', 'Relance 1'],
    ]);
  }, 60_000);
});

const pile = !process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1';

describe.skipIf(pile)('le suivi contre la pile, factures émises par `emettre`', () => {
  beforeEach(() => {
    store.set((s) => ({ ui: { ...s.ui, toast: undefined } }));
  });

  test('un paiement partiel donne `payee_en_partie`, et `marquerPayee` donne `payee`', async () => {
    const { facture, ligne } = await factureEmise();
    expect(ligne.statut).toBe('a_payer');
    expect(ligne.netAPayer).toBeGreaterThan(1000);
    expect(ligne.resteDu).toBe(ligne.netAPayer);
    const jour = aujourdhuiParis();

    expect(
      await enregistrerPaiement({
        factureId: facture.id,
        date: jour,
        montant: 1000,
        moyen: 'virement',
        note: '  Virement reçu  ',
      }),
    ).toEqual({ ok: true });
    const partielle = await ligneSuivi(facture.id);
    expect(partielle).toMatchObject({
      statut: 'payee_en_partie',
      encaisse: 1000,
      resteDu: ligne.netAPayer - 1000,
    });

    expect(await marquerPayee(facture.id, jour, ligne.netAPayer - 1000)).toEqual({ ok: true });
    expect(await ligneSuivi(facture.id)).toMatchObject({
      statut: 'payee',
      encaisse: ligne.netAPayer,
      resteDu: 0,
    });
    const paiements = await paiementsDe(facture.id);
    expect(paiements.map((p) => [p.montant, p.moyen, p.note, p.annuleLe])).toEqual([
      [1000, 'virement', 'Virement reçu', null],
      [ligne.netAPayer - 1000, 'autre', null, null],
    ]);
    // Plus rien à payer : « Marquer comme payée » ne part pas.
    expect(await marquerPayee(facture.id, jour, 0)).toEqual({
      ok: false,
      message: phrases.erreurs.rienAPayer,
    });
  }, 60_000);

  test('un paiement au-delà du reste dû est refusé, avec la phrase de `PAIEMENT_EXCESSIF`', async () => {
    const { facture, ligne } = await factureEmise();
    const jour = aujourdhuiParis();
    expect(
      await enregistrerPaiement({
        factureId: facture.id,
        date: jour,
        montant: ligne.netAPayer + 1,
        moyen: 'cheque',
      }),
    ).toEqual({ ok: false, message: phrases.erreurs.excessif });
    expect(await paiementsDe(facture.id)).toEqual([]);
    // Une date future : la phrase de `PAIEMENT_DATE`, rien d'enregistré non plus.
    const demain = aujourdhuiParis(new Date(Date.now() + 36 * 3600 * 1000));
    expect(
      await enregistrerPaiement({
        factureId: facture.id,
        date: demain,
        montant: 1,
        moyen: 'carte',
      }),
    ).toEqual({ ok: false, message: phrases.erreurs.date });
    expect(await ligneSuivi(facture.id)).toMatchObject({ statut: 'a_payer', encaisse: 0 });
  }, 60_000);

  test('`annulerPaiement` fait revenir le statut à son état précédent, sur ce paiement seul', async () => {
    const { facture, ligne } = await factureEmise();
    const jour = aujourdhuiParis();
    const payer = (montant: number) =>
      enregistrerPaiement({ factureId: facture.id, date: jour, montant, moyen: 'especes' });
    expect(await payer(500)).toEqual({ ok: true });
    expect(await payer(ligne.netAPayer - 500)).toEqual({ ok: true });
    expect((await ligneSuivi(facture.id))?.statut).toBe('payee');

    const [premier, second] = await paiementsDe(facture.id);
    if (!premier || !second) throw new Error('deux paiements attendus');
    expect(await annulerPaiement(second.id)).toEqual({ ok: true });
    expect(await ligneSuivi(facture.id)).toMatchObject({
      statut: 'payee_en_partie',
      encaisse: 500,
      resteDu: ligne.netAPayer - 500,
    });
    // L'annulé reste, après l'actif ; seul celui-là est annulé.
    const apres = await paiementsDe(facture.id);
    expect(apres.map((p) => [p.id, p.annuleLe !== null])).toEqual([
      [premier.id, false],
      [second.id, true],
    ]);
    // Déjà annulé : un message, et rien ne change.
    expect(await annulerPaiement(second.id)).toEqual({
      ok: false,
      message: phrases.erreurs.dejaAnnule,
    });
    expect((await paiementsDe(facture.id)).find((p) => p.id === second.id)?.annuleLe).toBe(
      apres[1]?.annuleLe,
    );
    expect(await annulerPaiement(premier.id)).toEqual({ ok: true });
    expect(await ligneSuivi(facture.id)).toMatchObject({ statut: 'a_payer', encaisse: 0 });
  }, 60_000);

  test('le filtre par statut ne renvoie que ce statut ; client et période aussi', async () => {
    const { sb, entrepriseId, facture: payee, ligne } = await factureEmise();
    const client = await sb.from('clients').insert({
      entreprise_id: entrepriseId,
      id: 'client-filtre',
      party: {},
      nom: 'Client filtré',
    });
    if (client.error) throw new Error(client.error.message);
    const form = sampleForm(aujourdhuiParis());
    const aPayer = await emettre(sb, entrepriseId, form, 'client-filtre');
    const jour = aujourdhuiParis();
    expect(await marquerPayee(payee.id, jour, ligne.netAPayer)).toEqual({ ok: true });
    expect(
      await enregistrerPaiement({ factureId: aPayer.id, date: jour, montant: 1, moyen: 'carte' }),
    ).toEqual({ ok: true });

    const ids = async (f: Parameters<typeof listerSuivi>[0]) =>
      (await listerSuivi(f)).map((l) => [l.numero, l.statut]);
    expect(await ids({ statut: 'payee' })).toEqual([[payee.numero, 'payee']]);
    expect(await ids({ statut: 'payee_en_partie' })).toEqual([[aPayer.numero, 'payee_en_partie']]);
    expect(await ids({ statut: 'a_payer' })).toEqual([]);
    // Toutes : la plus récente d'abord.
    expect(await ids({})).toEqual([
      [aPayer.numero, 'payee_en_partie'],
      [payee.numero, 'payee'],
    ]);
    expect(await ids({ clientId: 'client-filtre' })).toEqual([[aPayer.numero, 'payee_en_partie']]);
    expect(await ids({ debut: jour, fin: jour })).toHaveLength(2);
    const veille = aujourdhuiParis(new Date(Date.now() - 36 * 3600 * 1000));
    expect(await ids({ fin: veille })).toEqual([]);
    expect(ligne.clientId).toBeNull();
  }, 90_000);

  test('`urlPdf` : une URL de 60 secondes, dont le contenu commence par `%PDF`', async () => {
    const { facture } = await factureEmise();
    const url = await urlPdf(facture.id);
    const jeton = new URL(url).searchParams.get('token') ?? '';
    const charge = JSON.parse(Buffer.from(jeton.split('.')[1] ?? '', 'base64url').toString());
    expect(charge.exp - charge.iat).toBe(DUREE_URL_PDF_S);
    expect(DUREE_URL_PDF_S).toBe(60);
    const octets = new Uint8Array(await (await fetch(url)).arrayBuffer());
    expect(new TextDecoder().decode(octets.subarray(0, 4))).toBe('%PDF');
    const pdf = await pdfDe(facture.id);
    expect(pdf.type).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).subarray(0, 5))).toBe(
      '%PDF-',
    );
  }, 60_000);
});
