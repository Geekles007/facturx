// Les données locales et le miroir du compte vivent dans IndexedDB : le faux doit exister avant
// l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { FunctionsFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { embedFacturX } from 'facturx-sdk/pdf';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromPortableJson } from '../../shared/portable.js';
import { t } from '../i18n.js';
import {
  type Appearance,
  type ClientRecord,
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  type Numbering,
  newInvoiceForm,
  type ProductRecord,
  type SavedInvoice,
} from '../library.js';
import { blankForm, blankParty, buildInvoice, type InvoiceForm } from '../model.js';
import { ErreurConservation } from '../persistence.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { enregistrerMaintenant, startPersistence, store } from '../store.js';
import { finDAttente } from './erreurs.js';
import {
  delaiDeReprise,
  type IssueDImport,
  importerCeNavigateur,
  importerLocal,
  importerSurServeur,
  messageNumerotation,
  numerotationReprise,
} from './import.js';
import { deconnecter } from './index.js';
import { type PersistenceCompte, supabasePersistence } from './persistence.js';
import {
  entrepriseRenseignee,
  importAProposer,
  inventaireLocal,
  lireMarqueImport,
  retenirImport,
} from './proposition.js';
import {
  adminDeTest,
  compteDeTest,
  conservationEnMemoire,
  imageDeTest,
  refusDeFonction,
} from './test-aide.js';

/**
 * Importer les données locales (spec § 10) : sans pile, `importerLocal` sur une conservation en
 * mémoire avec un `importer` simulé (ordre, doublons et numéros pris, refus, limite de débit et
 * reprise, numérotation, rien d'écrasé dans le compte), la lecture des réponses d'`importer`, et la
 * proposition faite à la première connexion ; contre la pile, avec `importer` servie
 * (`FACTURX_EMETTRE=1`), une sauvegarde de trois factures dont un avoir, un import refait qui
 * n'écrase rien, et l'import de ce navigateur jusqu'au brouillon.
 */

/** Le client de l'essai en cours : `importerSurServeur` l'emploie par `client()`. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

const phrases = t.compte.importation;

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined as string | undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;

afterEach(async () => {
  store.set({ ui: uiAvant, history: [], clients: [], products: [] });
  session.sb = undefined;
  utiliser(indexedDbPersistence);
  await viderLocal();
});

/** Vide la base IndexedDB (fausse) de ce navigateur, magasin par magasin. */
async function viderLocal(): Promise<void> {
  const tout = (await indexedDbPersistence.dump()) as {
    kv: Record<string, unknown>;
    files: Record<string, unknown>;
    invoices: { uid: string }[];
    clients: { uid: string }[];
    products: { uid: string }[];
  };
  for (const cle of Object.keys(tout.kv)) await indexedDbPersistence.remove('kv', cle);
  for (const cle of Object.keys(tout.files)) await indexedDbPersistence.remove('files', cle);
  for (const magasin of ['invoices', 'clients', 'products'] as const) {
    for (const { uid } of tout[magasin]) await indexedDbPersistence.remove(magasin, uid);
  }
}

// ---------- une sauvegarde locale ----------

const pdfDeTest = (numero: string) => new TextEncoder().encode(`%PDF-1.7\n% ${numero}\n%%EOF\n`);
/** Un logo : la signature PNG et un en-tête lisible (64 × 32) suffisent au dépôt. */
const LOGO = imageDeTest('png', 64, 32);

/** Une facture émise sans compte, son résumé tiré de la facture elle-même (comme le Studio). */
function facture(
  numero: string,
  date: string,
  options: { typeCode?: string; cite?: string; uid?: string; devise?: string } = {},
): SavedInvoice {
  const form = sampleForm(date);
  form.id = numero;
  form.remittanceInformation = numero;
  form.typeCode = (options.typeCode ?? '380') as InvoiceForm['typeCode'];
  if (options.devise) form.currency = options.devise;
  if (options.cite) {
    form.references.precedingInvoices = [{ uid: 'r-1', id: options.cite, issueDate: date }];
  }
  const { invoice } = buildInvoice(form);
  return {
    uid: options.uid ?? `u-${numero}`,
    status: 'issued',
    form,
    appearance: defaultAppearance(),
    summary: {
      id: numero,
      typeCode: form.typeCode,
      issueDate: date,
      buyerName: form.buyer.name,
      currency: form.currency,
      total: invoice.totals.taxInclusiveAmount,
      due: invoice.totals.amountDueForPayment,
    },
    issuedAt: `${date}T10:00:00.000Z`,
  };
}

const client = (uid: string, nom: string): ClientRecord => ({
  uid,
  party: { ...blankParty(), name: nom },
  updatedAt: '2026-03-01T10:00:00.000Z',
});

const produit = (uid: string, nom: string): ProductRecord => ({
  uid,
  name: nom,
  description: '',
  unitCode: 'C62',
  unitPrice: '100',
  vat: 'S:20',
  sellerItemId: '',
  updatedAt: '2026-03-01T10:00:00.000Z',
});

const apparence = (): Appearance => ({
  ...defaultAppearance(),
  accent: '#336699',
  logo: { key: 'logo-1', type: 'png', position: 'left', height: 40, name: 'logo.png' },
});

/** Ce que `indexedDbPersistence.dump()` rend d'un Studio utilisé sans compte. */
function sauvegarde(
  factures: SavedInvoice[],
  options: { numbering?: Numbering; pdf?: Record<string, Uint8Array | undefined> } = {},
): Record<string, unknown> {
  const company = defaultCompany();
  company.seller.name = 'Atelier Local';
  const files: Record<string, Uint8Array> = { 'logo-1': LOGO };
  for (const f of factures) {
    const pdf = options.pdf && f.uid in options.pdf ? options.pdf[f.uid] : pdfDeTest(f.summary.id);
    if (pdf) files[`pdf-${f.uid}`] = pdf;
  }
  return {
    kv: {
      company,
      numbering: options.numbering ?? {
        pattern: 'F-{AAAA}-{NNNN}',
        next: 4,
        yearly: true,
        year: 2026,
      },
      'appearance-default': apparence(),
      draft: { form: sampleForm('2026-03-10'), appearance: defaultAppearance() },
      // Ce qu'un compte déjà connecté dans ce navigateur y a laissé : rien de cela ne s'importe.
      'kv-compte-autre': { secret: true },
    },
    files,
    invoices: factures,
    clients: [client('c-1', 'Client A'), client('c-2', 'Client B')],
    products: [produit('p-1', 'Conseil')],
  };
}

const TROIS = [
  facture('F-2026-0001', '2026-03-01'),
  facture('F-2026-0002', '2026-03-02'),
  facture('F-2026-0003', '2026-03-03'),
];

/** La conservation du compte, en mémoire, et sa numérotation (initiale de 2026 par défaut). */
const enMemoire = (numerotation?: Numbering) =>
  conservationEnMemoire(numerotation ? { numerotation } : {});

/**
 * Un `importer` simulé, idempotent par numéro comme le vrai : un numéro déjà importé est un doublon.
 * `issues` impose la réponse des premiers appels d'un numéro.
 */
function fauxImporter(journal: string[], issues: Record<string, IssueDImport[]> = {}) {
  const importes = new Set<string>();
  const appels: string[] = [];
  const pdfs = new Map<string, Uint8Array>();
  const importer = vi.fn(async (s: SavedInvoice, pdf: Uint8Array): Promise<IssueDImport> => {
    const numero = s.summary.id;
    appels.push(numero);
    journal.push(`importer ${numero}`);
    pdfs.set(numero, pdf);
    const imposee = issues[numero]?.shift();
    if (imposee) return imposee;
    if (importes.has(numero)) return { kind: 'doublon' };
    importes.add(numero);
    return { kind: 'importee' };
  });
  return { importer, appels, importes, pdfs };
}

// ---------- sans pile ----------

describe('importerLocal (conservation en mémoire, importer simulé)', () => {
  test('2 clients, 1 produit et 3 factures : { clients: 2, produits: 1, factures: 3 }', async () => {
    const dump = sauvegarde(TROIS);
    const avant = structuredClone(dump);
    const cible = enMemoire();
    const { importer, appels, pdfs } = fauxImporter(cible.journal);

    const rapport = await importerLocal(dump, cible.p, importer);

    expect(rapport).toMatchObject({ clients: 2, produits: 1, factures: 3, doublons: [] });
    // Un compte neuf : tout est repris, rien n'était déjà là.
    expect(rapport).toMatchObject({ clientsDejaLa: 0, produitsDejaLa: 0, conserves: [] });
    expect(rapport.numerosPris).toEqual([]);
    expect(rapport.refusees).toEqual([]);
    expect(rapport.enAttente).toEqual([]);
    expect(rapport.arret).toBeUndefined();
    expect(rapport.echecs).toEqual([]);
    // L'entreprise, l'apparence par défaut et son logo, les clients et le catalogue.
    expect(cible.kv.get('company')).toEqual((dump.kv as Record<string, unknown>).company);
    expect(cible.kv.get('appearance-default')).toEqual(apparence());
    expect(cible.fichiers.get('logo-1')).toEqual(LOGO);
    expect([...cible.listes.clients.keys()]).toEqual(['c-1', 'c-2']);
    expect([...cible.listes.products.keys()]).toEqual(['p-1']);
    // Chaque facture passe par `importer`, avec son PDF ; aucun PDF n'est déposé autrement.
    expect(appels).toEqual(['F-2026-0001', 'F-2026-0002', 'F-2026-0003']);
    expect(pdfs.get('F-2026-0002')).toEqual(pdfDeTest('F-2026-0002'));
    expect(cible.journal.filter((l) => l.startsWith('setFile'))).toEqual(['setFile logo-1']);
    // Rien d'autre de `kv` (le brouillon, ce qu'un compte a laissé) n'est écrit par l'import.
    expect(cible.journal.filter((l) => l.startsWith('set '))).toEqual([
      'set company',
      'set appearance-default',
      'set numbering',
    ]);
    // Les données locales ne sont ni effacées ni modifiées.
    expect(dump).toEqual(avant);
    expect(cible.journal.some((l) => l.startsWith('remove'))).toBe(false);
  });

  test('un doublon est listé dans `doublons`, les autres passent', async () => {
    const cible = enMemoire();
    // La même facture, déjà dans le compte (un import précédent).
    cible.listes.invoices.set('srv-2', { ...TROIS[1], uid: 'srv-2' });
    const { importer } = fauxImporter(cible.journal, {
      'F-2026-0002': [{ kind: 'doublon' }],
    });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(rapport).toMatchObject({ factures: 2, doublons: ['F-2026-0002'], numerosPris: [] });
    expect(rapport.refusees).toEqual([]);
  });

  test('numéro pris par une autre facture du compte : listé à part, pas « déjà dans le compte »', async () => {
    const cible = enMemoire();
    const [, deux, trois] = TROIS as [SavedInvoice, SavedInvoice, SavedInvoice];
    cible.listes.invoices.set('srv-2', { ...deux, uid: 'srv-2' });
    // Même numéro, autre facture : un autre montant, une autre date, une autre devise.
    cible.listes.invoices.set('srv-3', {
      ...trois,
      uid: 'srv-3',
      summary: { ...trois.summary, total: trois.summary.total + 1 },
    });
    const { importer } = fauxImporter(cible.journal, {
      'F-2026-0002': [{ kind: 'doublon' }],
      'F-2026-0003': [{ kind: 'doublon' }],
    });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(rapport).toMatchObject({
      factures: 1,
      doublons: ['F-2026-0002'],
      numerosPris: ['F-2026-0003'],
    });
    // Une date ou une devise différente aussi.
    for (const summary of [
      { ...trois.summary, issueDate: '2026-03-04' },
      { ...trois.summary, currency: 'USD' },
    ]) {
      const autre = enMemoire();
      autre.listes.invoices.set('srv-3', { ...trois, uid: 'srv-3', summary });
      const issues = { 'F-2026-0003': [{ kind: 'doublon' } as IssueDImport] };
      const r = await importerLocal(sauvegarde(TROIS), autre.p, fauxImporter([], issues).importer);
      expect(r.numerosPris).toEqual(['F-2026-0003']);
    }
  });

  test('numérotation locale à 12, serveur à 40 : on garde 40, sans jamais reculer', async () => {
    const cible = enMemoire({ pattern: 'F-{AAAA}-{NNNN}', next: 40, yearly: true, year: 2026 });
    const { importer } = fauxImporter(cible.journal);
    const rapport = await importerLocal(
      sauvegarde(TROIS, {
        numbering: { pattern: 'F-{AAAA}-{NNNN}', next: 12, yearly: true, year: 2026 },
      }),
      cible.p,
      importer,
    );
    expect((cible.kv.get('numbering') as Numbering).next).toBe(40);
    expect(rapport.numerotation?.next).toBe(40);
    expect(rapport.echecs).toEqual([]);
  });

  test('compte neuf : le gabarit et la remise à zéro du Studio, au plus haut rang, après les factures', async () => {
    const cible = enMemoire();
    const { importer } = fauxImporter(cible.journal);
    await importerLocal(
      sauvegarde(TROIS, {
        numbering: { pattern: 'FAC{AA}-{NNN}', next: 12, yearly: false, year: 2026 },
      }),
      cible.p,
      importer,
    );
    // Le gabarit et la remise à zéro du Studio sont repris ; l'année reste celle du serveur.
    expect(cible.kv.get('numbering')).toEqual({
      pattern: 'FAC{AA}-{NNN}',
      next: 12,
      yearly: false,
      year: 2026,
    });
    // Levée une fois toutes les factures passées, jamais avant.
    const ecriture = cible.journal.indexOf('set numbering');
    expect(ecriture).toBeGreaterThan(cible.journal.lastIndexOf('importer F-2026-0003'));
  });

  test('numerotationReprise : rang local, rangs des factures, année, jamais plus bas', () => {
    const serveur: Numbering = { pattern: 'F-{AAAA}-{NNNN}', next: 3, yearly: true, year: 2026 };
    const locale: Numbering = { pattern: 'F-{AAAA}-{NNNN}', next: 12, yearly: true, year: 2026 };
    const rang = (...args: Parameters<typeof numerotationReprise>) =>
      numerotationReprise(...args).numerotation.next;
    expect(rang(serveur, locale, [])).toBe(12);
    // Une facture d'un rang plus haut que la numérotation locale (rang baissé à la main).
    expect(rang(serveur, locale, [facture('F-2026-0015', '2026-05-01')])).toBe(16);
    // Un rang de l'an passé, en remise à zéro annuelle, ne compte pas pour l'année du serveur.
    const anneePassee: Numbering = { ...locale, next: 30, year: 2025 };
    expect(rang(serveur, anneePassee, [facture('F-2025-0029', '2025-12-30')])).toBe(3);
    // Sans remise à zéro, tout rang compte.
    const continue_ = { ...anneePassee, yearly: false };
    expect(rang(serveur, continue_, [facture('F-2025-0029', '2025-12-30')])).toBe(30);
    // Jamais plus bas que le serveur ; l'année ne change pas.
    const haut = { ...serveur, next: 40 };
    expect(numerotationReprise(haut, locale, []).numerotation).toEqual({
      ...locale,
      next: 40,
      year: 2026,
    });
    // Un numéro hors du gabarit ne dit rien du rang.
    expect(rang(serveur, locale, [facture('MANUEL-99', '2026-05-01')])).toBe(12);
  });

  test('numerotationReprise : réglages du compte gardés, seuls les rangs de sa suite comptent', () => {
    const serveur: Numbering = { pattern: 'X-{NNN}', next: 5, yearly: false, year: 2026 };
    const locale: Numbering = { pattern: 'F-{AAAA}-{NNNN}', next: 40, yearly: true, year: 2026 };
    // Une autre suite : ni son rang ni ses numéros ne lèvent celle du compte (pas de trou).
    expect(
      numerotationReprise(serveur, locale, [facture('F-2026-0039', '2026-05-01')], false),
    ).toEqual({ numerotation: serveur, enAvance: false });
    // La même suite : ses numéros comptent.
    expect(
      numerotationReprise(serveur, locale, [facture('X-012', '2026-05-01')], false).numerotation,
    ).toEqual({ ...serveur, next: 13 });
  });

  test('numérotation annuelle du serveur en retard sur les rangs locaux : le premier numéro libre', async () => {
    const cible = enMemoire({ pattern: 'F-{AAAA}-{NNNN}', next: 1, yearly: true, year: 2025 });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
    // Les rangs de 2026 ne valent pas pour 2025 : le rang ne bouge pas, et le bilan ne l'affirme pas.
    expect(rapport.numerotation?.next).toBe(1);
    expect(rapport.numerotationEnAvance).toBe(true);
    expect(messageNumerotation(rapport)).toBe(phrases.bilan.numerotationEnAvance);
    // Dans le cas ordinaire, le rang.
    const ordinaire = await importerLocal(
      sauvegarde(TROIS),
      enMemoire().p,
      fauxImporter([]).importer,
    );
    expect(ordinaire.numerotationEnAvance).toBe(false);
    expect(messageNumerotation(ordinaire)).toBe(phrases.bilan.numerotation(4));
  });

  test('les factures avant les avoirs, et dans l’ordre des dates', async () => {
    const cible = enMemoire();
    const { importer, appels } = fauxImporter(cible.journal);
    await importerLocal(
      sauvegarde([
        facture('A-2026-0001', '2026-01-05', { typeCode: '381', cite: 'F-2026-0001' }),
        facture('F-2026-0002', '2026-02-01'),
        facture('A-2026-0002', '2026-01-20', { typeCode: '261', cite: 'F-2026-0002' }),
        facture('F-2026-0001', '2026-01-10'),
      ]),
      cible.p,
      importer,
    );
    expect(appels).toEqual(['F-2026-0001', 'F-2026-0002', 'A-2026-0001', 'A-2026-0002']);
  });

  test('429 : la passe s’arrête, puis reprend sur ce qui attend, sans rien renvoyer de ce qui est passé', async () => {
    const quatre = [...TROIS, facture('F-2026-0004', '2026-03-04')];
    const dump = sauvegarde(quatre);
    const cible = enMemoire();
    const reessayerApres = '2026-11-07T15:42:00.000Z';
    const { importer, appels, importes } = fauxImporter(cible.journal, {
      'F-2026-0003': [{ kind: 'arret', raison: 'limite', reessayerApres }],
    });

    const premiere = await importerLocal(dump, cible.p, importer);
    expect(appels).toEqual(['F-2026-0001', 'F-2026-0002', 'F-2026-0003']);
    expect(premiere.factures).toBe(2);
    expect(premiere.arret).toEqual({ raison: 'limite', reessayerApres, etape: 'factures' });
    expect(premiere.enAttente).toEqual([
      { uid: 'u-F-2026-0003', numero: 'F-2026-0003' },
      { uid: 'u-F-2026-0004', numero: 'F-2026-0004' },
    ]);
    // La numérotation est reprise quand même : les numéros locaux sont pris.
    expect(cible.journal).toContain('set numbering');

    // La reprise : les factures en attente seules, rien de la bibliothèque.
    cible.journal.length = 0;
    appels.length = 0;
    const reprise = await importerLocal(dump, cible.p, importer, {
      reprise: premiere.enAttente.map((f) => f.uid),
    });
    expect(appels).toEqual(['F-2026-0003', 'F-2026-0004']);
    expect(reprise).toMatchObject({ factures: 2, doublons: [], enAttente: [] });
    expect(reprise.arret).toBeUndefined();
    expect(cible.journal.filter((l) => !l.startsWith('importer') && l !== 'set numbering')).toEqual(
      [],
    );
    expect([...importes].sort()).toEqual(quatre.map((f) => f.summary.id));
  });

  test('delaiDeReprise : l’heure dite et une marge, un plancher qui croît, borné', () => {
    const maintenant = Date.parse('2026-11-07T15:00:00.000Z');
    const dans = (s: number) => new Date(maintenant + s * 1000).toISOString();
    expect(delaiDeReprise(dans(60), maintenant, 0)).toBe(65_000);
    // L'horloge de ce navigateur en avance sur le serveur : l'heure dite est déjà passée.
    expect(delaiDeReprise(dans(-10), maintenant, 0)).toBe(5_000);
    expect(delaiDeReprise(dans(-10), maintenant, 1)).toBe(10_000);
    expect(delaiDeReprise(dans(-10), maintenant, 3)).toBe(40_000);
    expect(delaiDeReprise(dans(-10), maintenant, 30)).toBe(15 * 60_000);
    // Une heure illisible : le plancher.
    expect(delaiDeReprise('pas une date', maintenant, 2)).toBe(20_000);
  });

  test('un PDF absent ou illisible : refusée sans envoi, les autres passent', async () => {
    const cible = enMemoire();
    const { importer, appels } = fauxImporter(cible.journal);
    const rapport = await importerLocal(
      sauvegarde(TROIS, {
        pdf: {
          'u-F-2026-0001': undefined,
          'u-F-2026-0002': new TextEncoder().encode('<html>pas un PDF</html>'),
        },
      }),
      cible.p,
      importer,
    );
    expect(appels).toEqual(['F-2026-0003']);
    expect(rapport.factures).toBe(1);
    expect(rapport.refusees).toEqual([
      { numero: 'F-2026-0001', raison: phrases.raisons.pdfAbsent },
      { numero: 'F-2026-0002', raison: phrases.raisons.pdfIllisible },
    ]);
  });

  test('un refus (422) n’arrête pas les autres', async () => {
    const cible = enMemoire();
    const { importer, appels } = fauxImporter(cible.journal, {
      'F-2026-0001': [{ kind: 'refusee', raison: 'illisible' }],
    });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(appels).toHaveLength(3);
    expect(rapport).toMatchObject({
      factures: 2,
      refusees: [{ numero: 'F-2026-0001', raison: 'illisible' }],
    });
  });

  test('session expirée dès l’entreprise : arrêt, aucune facture envoyée, toutes en attente', async () => {
    const cible = enMemoire();
    cible.p.set = async () => {
      throw new ErreurConservation('SESSION');
    };
    const { importer } = fauxImporter(cible.journal);
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(importer).not.toHaveBeenCalled();
    expect(rapport.arret).toEqual({ raison: phrases.arrets.session, etape: 'bibliotheque' });
    expect(rapport.enAttente.map((f) => f.numero)).toEqual(TROIS.map((f) => f.summary.id));
  });

  test('le compte illisible avant l’import : arrêt, rien d’écrit', async () => {
    const cible = enMemoire();
    cible.p.list = async () => {
      throw new ErreurConservation('RESEAU');
    };
    const { importer } = fauxImporter(cible.journal);
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(importer).not.toHaveBeenCalled();
    expect(cible.journal).toEqual([]);
    expect(rapport.arret).toEqual({ raison: phrases.arrets.reseau, etape: 'bibliotheque' });
  });

  test('numérotation non reprise : la session ou le réseau, pas « refusé par le serveur »', async () => {
    for (const [code, raison] of [
      ['SESSION', phrases.raisons.session],
      ['RESEAU', phrases.raisons.reseau],
      ['REFUS', phrases.raisons.refus],
    ] as const) {
      const cible = enMemoire();
      const set = cible.p.set.bind(cible.p);
      cible.p.set = async (cle, valeur) => {
        if (cle === 'numbering') throw new ErreurConservation(code);
        return set(cle, valeur);
      };
      const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
      expect(rapport.echecs).toEqual([{ element: phrases.elements.numerotation, raison }]);
    }
  });

  test('un client refusé est dit, le reste continue', async () => {
    const cible = enMemoire();
    const put = cible.p.put.bind(cible.p);
    cible.p.put = async (magasin, valeur) => {
      if (valeur.uid === 'c-1') throw new ErreurConservation('REFUS', 'mauvais');
      return put(magasin, valeur);
    };
    const { importer } = fauxImporter(cible.journal);
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(rapport).toMatchObject({ clients: 1, produits: 1, factures: 3 });
    expect(rapport.echecs).toEqual([
      { element: phrases.elements.client('Client A'), raison: phrases.raisons.refus },
    ]);
  });

  test('un logo de ce navigateur au-delà de 2000 × 2000 pixels : dit dans le bilan, le reste passe (Ruling 62)', async () => {
    const cible = enMemoire();
    const dump = sauvegarde(TROIS);
    (dump.files as Record<string, Uint8Array>)['logo-1'] = imageDeTest('png', 4000, 4000, 77_000);
    const { importer } = fauxImporter(cible.journal);
    const rapport = await importerLocal(dump, cible.p, importer);
    expect(rapport).toMatchObject({ clients: 2, produits: 1, factures: 3 });
    expect(rapport.echecs).toEqual([
      {
        element: phrases.elements.fichier('logo-1'),
        raison: t.compte.conservation.fichierDimensions(2000, 2000),
      },
    ]);
    expect(cible.fichiers.has('logo-1')).toBe(false);
  });

  test('sans entreprise renseignée en local, celle du compte n’est pas remplacée', async () => {
    const dump = sauvegarde(TROIS);
    (dump.kv as Record<string, unknown>).company = defaultCompany();
    const cible = enMemoire();
    await importerLocal(dump, cible.p, fauxImporter(cible.journal).importer);
    expect(cible.journal).not.toContain('set company');
  });
});

describe('un import refait n’écrase rien de ce que le compte a déjà (Ruling 57)', () => {
  test('un client modifié dans le compte reste tel quel ; un client absent (supprimé) revient', async () => {
    const cible = enMemoire();
    // c-1 modifié dans le compte après un premier import ; c-2 supprimé depuis.
    cible.listes.clients.set('c-1', client('c-1', 'Client A, modifié dans le compte'));
    cible.listes.products.set('p-1', produit('p-1', 'Conseil, modifié'));
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
    expect(cible.listes.clients.get('c-1')).toEqual(
      client('c-1', 'Client A, modifié dans le compte'),
    );
    expect(cible.listes.clients.get('c-2')).toEqual(client('c-2', 'Client B'));
    expect(cible.listes.products.get('p-1')).toEqual(produit('p-1', 'Conseil, modifié'));
    expect(cible.journal.filter((l) => l.startsWith('put'))).toEqual(['put clients c-2']);
    expect(rapport).toMatchObject({ clients: 1, clientsDejaLa: 1, produits: 0, produitsDejaLa: 1 });
  });

  test('l’entreprise et l’apparence du compte, déjà renseignées, sont gardées, et le bilan le dit', async () => {
    const cible = enMemoire();
    const sienne = defaultCompany();
    sienne.seller.siren = '732829320';
    cible.kv.set('company', sienne);
    cible.kv.set('appearance-default', { ...defaultAppearance(), accent: '#000000' });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
    expect(cible.kv.get('company')).toEqual(sienne);
    expect(cible.kv.get('appearance-default')).toEqual({
      ...defaultAppearance(),
      accent: '#000000',
    });
    expect(cible.journal).not.toContain('set company');
    expect(cible.journal).not.toContain('set appearance-default');
    expect(rapport.conserves).toEqual(['entreprise', 'apparence']);
  });

  test('une entreprise du compte vide (état initial) est remplacée par celle du navigateur', async () => {
    const cible = enMemoire();
    // Le profil que pose l'inscription (migration 000100) : celui du Studio, au moyen de paiement
    // près, dont l'`uid` est `u0`.
    const inscription = defaultCompany();
    inscription.paymentMeans = inscription.paymentMeans.map((m) => ({ ...m, uid: 'u0' }));
    cible.kv.set('company', inscription);
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
    expect((cible.kv.get('company') as { seller: { name: string } }).seller.name).toBe(
      'Atelier Local',
    );
    expect(rapport.conserves).toEqual([]);
  });

  test('une entreprise du compte qui s’écarte en quoi que ce soit de l’inscription est gardée', async () => {
    const changements: [string, (c: ReturnType<typeof defaultCompany>) => void][] = [
      ['nom commercial', (c) => (c.seller.tradingName = 'Enseigne')],
      ['devise par défaut', (c) => (c.defaults.currency = 'USD')],
      ['adresse', (c) => (c.seller.address.city = 'Lyon')],
      ['contact', (c) => (c.seller.contact.email = 'compta@exemple.fr')],
      ['adresse électronique', (c) => (c.seller.electronicAddress.value = '732829320')],
      [
        'note par défaut',
        (c) => c.defaults.notes.push({ uid: 'n-1', subjectCode: 'AAI', text: 'x' }),
      ],
    ];
    for (const [quoi, changer] of changements) {
      const cible = enMemoire();
      const sienne = defaultCompany();
      changer(sienne);
      cible.kv.set('company', sienne);
      const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
      expect(cible.kv.get('company'), quoi).toEqual(sienne);
      expect(rapport.conserves, quoi).toEqual(['entreprise']);
    }
  });

  test('numérotation déjà employée : gabarit et remise à zéro du compte gardés, rang au plus haut', async () => {
    // Le gabarit par défaut, mais une facture déjà dans le compte : ce n'est plus l'état initial.
    const cible = enMemoire({ pattern: 'F-{AAAA}-{NNNN}', next: 2, yearly: true, year: 2026 });
    const emise = facture('F-2026-0001', '2026-03-01', { uid: 'srv-1' });
    cible.listes.invoices.set('srv-1', emise);
    const rapport = await importerLocal(
      sauvegarde([facture('F-2026-0007', '2026-03-07')], {
        numbering: { pattern: 'F-{AAAA}-{NNNN}', next: 8, yearly: false, year: 2026 },
      }),
      cible.p,
      fauxImporter([]).importer,
    );
    expect(cible.kv.get('numbering')).toEqual({
      pattern: 'F-{AAAA}-{NNNN}',
      next: 8,
      yearly: true,
      year: 2026,
    });
    // L'entreprise et l'apparence du compte n'étaient pas renseignées : celles du navigateur passent.
    expect(rapport.conserves).toEqual(['numerotation']);
  });

  test('un gabarit changé dans le compte est gardé ; les numéros d’une autre suite ne le lèvent pas', async () => {
    const cible = enMemoire({ pattern: 'X-{NNN}', next: 5, yearly: false, year: 2026 });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, fauxImporter([]).importer);
    expect(cible.kv.get('numbering')).toEqual({
      pattern: 'X-{NNN}',
      next: 5,
      yearly: false,
      year: 2026,
    });
    expect(cible.journal).not.toContain('set numbering');
    expect(rapport.conserves).toContain('numerotation');
  });
});

describe('importerSurServeur (faux client)', () => {
  const invoke = vi.fn();
  beforeEach(() => {
    invoke.mockReset();
    session.sb = { functions: { invoke } };
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1'), connexion: undefined } }));
  });

  const s = facture('F-2026-0001', '2026-03-01');
  const pdf = pdfDeTest('F-2026-0001');

  test('201 : importée ; le corps porte le formulaire, l’apparence et le PDF, en JSON portable', async () => {
    invoke.mockResolvedValue({ data: { id: 'f-1', numero: 'F-2026-0001' }, error: null });
    expect(await importerSurServeur(s, pdf)).toEqual({ kind: 'importee' });
    const [nom, options] = invoke.mock.calls[0] as [string, { body: Blob }];
    expect(nom).toBe('importer');
    const corps = fromPortableJson<{ form: InvoiceForm; appearance: Appearance; pdf: Uint8Array }>(
      await options.body.text(),
    );
    expect(corps.form.id).toBe('F-2026-0001');
    expect(corps.appearance).toEqual(s.appearance);
    expect(corps.pdf).toEqual(pdf);
  });

  test('409 DOUBLON : doublon', async () => {
    invoke.mockResolvedValue(
      refusDeFonction(409, {
        code: 'DOUBLON',
        message: 'existe',
        details: { numero: 'F-2026-0001' },
      }),
    );
    expect(await importerSurServeur(s, pdf)).toEqual({ kind: 'doublon' });
  });

  test('422 FACTURX : refusée, avec ce que le serveur a relevé', async () => {
    invoke.mockResolvedValue(
      refusDeFonction(422, {
        code: 'ANOMALIES',
        message: 'illisible',
        details: [{ code: 'FACTURX', path: 'pdf', message: 'Pas de pièce Factur-X.' }],
      }),
    );
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'refusee',
      raison: phrases.raisons.facturx('Pas de pièce Factur-X.'),
    });
  });

  test('413 : refusée, trop lourde ; un corps de plus de 10 Mio ne part pas', async () => {
    invoke.mockResolvedValue(refusDeFonction(413, { code: 'ANOMALIES', message: 'gros' }));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'refusee',
      raison: phrases.raisons.tropLourde,
    });
    invoke.mockClear();
    const enorme = new Uint8Array(8 * 1024 * 1024);
    enorme.set(pdfDeTest('x'));
    expect(await importerSurServeur(s, enorme)).toEqual({
      kind: 'refusee',
      raison: phrases.raisons.tropLourde,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('429 LIMITE : arrêt, avec l’heure de reprise', async () => {
    const reessayerApres = new Date(Date.now() + 30 * 60_000).toISOString();
    invoke.mockResolvedValue(
      refusDeFonction(429, { code: 'LIMITE', message: 'trop', details: { reessayerApres } }),
    );
    const issue = await importerSurServeur(s, pdf);
    expect(issue).toMatchObject({ kind: 'arret', reessayerApres });
    // L'heure, et la date si ce n'est pas aujourd'hui, comme pour toute limite du compte.
    const moment = finDAttente({ reessayerApres });
    expect(moment).toBeDefined();
    expect(issue.kind === 'arret' && issue.raison).toBe(phrases.arrets.limite(moment));
    // Sans heure lisible : la limite, sans heure, et rien à attendre de précis.
    invoke.mockResolvedValue(refusDeFonction(429, { code: 'LIMITE', message: 'trop' }));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: phrases.arrets.limite(undefined),
    });
  });

  test('401 : arrêt, et la connexion s’ouvre', async () => {
    invoke.mockResolvedValue(refusDeFonction(401, { code: 'SESSION', message: 'jeton' }));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: phrases.arrets.session,
    });
    expect(store.get().ui.compte?.session).toBe('expiree');
    expect(store.get().ui.connexion).toBe('connexion');
  });

  test('403 NON_CONFIRME : arrêt, avec la phrase de l’interface', async () => {
    invoke.mockResolvedValue(refusDeFonction(403, { code: 'NON_CONFIRME', message: 'confirmez' }));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: t.compte.erreurs.nonConfirme,
    });
  });

  test('pas de réponse, ou une panne hors de la fonction : arrêt (l’import a pu passer)', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('réseau') });
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: phrases.arrets.reseau,
    });
    invoke.mockRejectedValue(new Error('coupé'));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: phrases.arrets.reseau,
    });
    invoke.mockResolvedValue(refusDeFonction(502, 'Bad Gateway'));
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'arret',
      raison: phrases.arrets.reseau,
    });
  });

  test('500 INTERNE : refusée, les autres continuent', async () => {
    invoke.mockResolvedValue(
      refusDeFonction(500, { code: 'INTERNE', message: 'panne', details: { requete: 'r-1' } }),
    );
    expect(await importerSurServeur(s, pdf)).toEqual({
      kind: 'refusee',
      raison: t.compte.erreurs.interne('r-1'),
    });
  });
});

describe('la proposition d’import à la première connexion', () => {
  beforeEach(() => {
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1'), storage: 'ok' } }));
  });

  /** Ce qu'un Studio sans compte laisse dans IndexedDB, PDF compris. */
  async function remplirLocal(): Promise<void> {
    const dump = sauvegarde(TROIS);
    const kv = dump.kv as Record<string, unknown>;
    for (const cle of ['company', 'numbering', 'draft'])
      await indexedDbPersistence.set(cle, kv[cle]);
    for (const [cle, octets] of Object.entries(dump.files as Record<string, Uint8Array>))
      await indexedDbPersistence.setFile(cle, octets);
    for (const f of TROIS) await indexedDbPersistence.put('invoices', f);
    for (const c of dump.clients as ClientRecord[]) await indexedDbPersistence.put('clients', c);
    for (const p of dump.products as ProductRecord[]) await indexedDbPersistence.put('products', p);
  }

  test('rien dans ce navigateur : rien n’est proposé', async () => {
    expect(await inventaireLocal()).toMatchObject({ factures: 0, clients: 0, produits: 0 });
    expect(await importAProposer()).toBeUndefined();
  });

  test('l’exemple seul, une entreprise vide ou un brouillon où rien n’est saisi ne sont pas des données', async () => {
    await indexedDbPersistence.set('draft', {
      form: sampleForm(),
      appearance: defaultAppearance(),
      sample: true,
    });
    await indexedDbPersistence.set('company', defaultCompany());
    await indexedDbPersistence.set('numbering', defaultNumbering());
    expect(await importAProposer()).toBeUndefined();
    // Une facture vierge : seulement ce que le Studio pose de lui-même (vendeur, numéro, dates).
    const vendeur = defaultCompany();
    vendeur.seller.name = '';
    for (const form of [blankForm('2026-03-10'), newInvoiceForm(vendeur, defaultNumbering())]) {
      await indexedDbPersistence.set('draft', { form, appearance: defaultAppearance() });
      expect(await inventaireLocal()).toMatchObject({ brouillon: false });
      expect(await importAProposer()).toBeUndefined();
    }
    // Un acheteur saisi : c'est un brouillon en cours.
    const saisi = blankForm('2026-03-10');
    saisi.buyer.name = 'Client en cours';
    await indexedDbPersistence.set('draft', { form: saisi, appearance: defaultAppearance() });
    expect(await importAProposer()).toMatchObject({ brouillon: true });
  });

  test('une entreprise où seuls le SIREN ou l’IBAN sont saisis est une donnée', async () => {
    const siren = defaultCompany();
    siren.seller.siren = '732829320';
    await indexedDbPersistence.set('company', siren);
    expect(await importAProposer()).toMatchObject({ entreprise: true });
    const iban = defaultCompany();
    iban.paymentMeans = iban.paymentMeans.map((m) => ({
      ...m,
      iban: 'FR7630006000011234567890189',
    }));
    await indexedDbPersistence.set('company', iban);
    expect(await importAProposer()).toMatchObject({ entreprise: true });
  });

  test('des données locales : proposé, avec ce qui a été trouvé', async () => {
    await remplirLocal();
    expect(await importAProposer()).toEqual({
      entreprise: true,
      clients: 2,
      produits: 1,
      factures: 3,
      brouillon: true,
      reprise: false,
    });
  });

  test('refusé : plus proposé pour ce compte, toujours pour un autre ; rien d’effacé', async () => {
    await remplirLocal();
    await retenirImport('refuse');
    expect(await importAProposer()).toBeUndefined();
    expect((await lireMarqueImport())?.etat).toBe('refuse');
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-2') } }));
    expect(await importAProposer()).toMatchObject({ factures: 3 });
    expect(await indexedDbPersistence.list('invoices')).toHaveLength(3);
  });

  test('fait : plus proposé ; inachevé : proposé de nouveau, avec les factures qui attendent', async () => {
    await remplirLocal();
    await retenirImport('fait', { brouillon: 'empreinte-1' });
    expect(await importAProposer()).toBeUndefined();
    await retenirImport('partiel', { enAttente: ['u-F-2026-0003'] });
    expect(await importAProposer()).toMatchObject({ reprise: true, enAttente: ['u-F-2026-0003'] });
    // L'empreinte du brouillon déjà repris est gardée.
    expect(await lireMarqueImport()).toMatchObject({
      etat: 'partiel',
      brouillon: 'empreinte-1',
      enAttente: ['u-F-2026-0003'],
    });
  });

  test('ni pendant une suppression demandée, ni session expirée, ni serveur injoignable', async () => {
    await remplirLocal();
    store.set((s) => ({
      ui: { ...s.ui, compte: { ...compteUi('e-1'), suppressionDemandeeLe: '2026-11-01' } },
    }));
    expect(await importAProposer()).toBeUndefined();
    store.set((s) => ({ ui: { ...s.ui, compte: { ...compteUi('e-1'), session: 'expiree' } } }));
    expect(await importAProposer()).toBeUndefined();
    store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1'), storage: 'injoignable' } }));
    expect(await importAProposer()).toBeUndefined();
  });

  test('arrêté par la limite : la marque garde les factures en attente, et seules elles repartent', async () => {
    await remplirLocal();
    // La conservation du compte, en mémoire.
    const memoire = enMemoire();
    const p = {
      ...memoire.p,
      entrepriseId: 'e-1',
      brouillonCourant: () => undefined,
    } as unknown as PersistenceCompte;
    utiliser(p);
    const reessayerApres = new Date(Date.now() + 30 * 60_000).toISOString();
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'f-1', numero: 'F-2026-0001' }, error: null })
      .mockResolvedValueOnce(
        refusDeFonction(429, { code: 'LIMITE', message: 'trop', details: { reessayerApres } }),
      )
      .mockResolvedValue({ data: { id: 'f-x', numero: 'x' }, error: null });
    session.sb = { functions: { invoke } };

    const premiere = await importerCeNavigateur();
    expect(premiere.enAttente.map((f) => f.uid)).toEqual(['u-F-2026-0002', 'u-F-2026-0003']);
    expect(await lireMarqueImport()).toMatchObject({
      etat: 'partiel',
      enAttente: ['u-F-2026-0002', 'u-F-2026-0003'],
    });
    const proposee = await importAProposer();
    expect(proposee).toMatchObject({
      reprise: true,
      enAttente: ['u-F-2026-0002', 'u-F-2026-0003'],
    });

    // La reprise proposée : ces deux factures seules, puis la marque est faite.
    memoire.journal.length = 0;
    const reprise = await importerCeNavigateur({ reprise: proposee?.enAttente });
    expect(reprise).toMatchObject({ factures: 2, enAttente: [] });
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(memoire.journal.filter((l) => l.startsWith('put') || l === 'set company')).toEqual([]);
    expect(await lireMarqueImport()).toMatchObject({ etat: 'fait' });
    expect((await lireMarqueImport())?.enAttente).toBeUndefined();
  });

  /**
   * La conservation du compte en mémoire, avec ce que `startDraft` emploie du brouillon : tant que
   * `accepte.oui` est faux, le brouillon ouvert ne peut pas être quitté (sa saisie n'est pas sur le
   * serveur), et le brouillon local ne peut pas devenir un brouillon du compte.
   */
  function compteQuiRetient(accepte: { oui: boolean }) {
    const memoire = enMemoire();
    const p = {
      ...memoire.p,
      entrepriseId: 'e-1',
      brouillonCourant: () => undefined,
      garderBrouillon: async () => undefined,
      envoisTermines: async () => undefined,
      quitterBrouillon: () => accepte.oui,
    } as unknown as PersistenceCompte;
    utiliser(p);
    return memoire;
  }

  test('brouillon non repris, factures en attente : la reprise reprend les deux, puis la marque est faite', async () => {
    await remplirLocal();
    const accepte = { oui: false };
    compteQuiRetient(accepte);
    const reessayerApres = new Date(Date.now() + 30 * 60_000).toISOString();
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'f-1', numero: 'F-2026-0001' }, error: null })
      .mockResolvedValueOnce(
        refusDeFonction(429, { code: 'LIMITE', message: 'trop', details: { reessayerApres } }),
      )
      .mockResolvedValue({ data: { id: 'f-x', numero: 'x' }, error: null });
    session.sb = { functions: { invoke } };

    const premiere = await importerCeNavigateur();
    expect(premiere.brouillon).toBe('nonRepris');
    expect(await lireMarqueImport()).toMatchObject({ etat: 'partiel', brouillonEnAttente: true });
    expect(await importAProposer()).toMatchObject({ reprise: true, brouillonEnAttente: true });

    // La reprise : les factures en attente et le brouillon, une seule fois.
    accepte.oui = true;
    const proposee = await importAProposer();
    const reprise = await importerCeNavigateur({ reprise: proposee?.enAttente ?? [] });
    expect(reprise).toMatchObject({ factures: 2, brouillon: 'repris' });
    expect(store.get().form.buyer.name).toBe(sampleForm('2026-03-10').buyer.name);
    const marque = await lireMarqueImport();
    expect(marque).toMatchObject({ etat: 'fait' });
    expect(marque?.brouillonEnAttente).toBeUndefined();
    expect(marque?.brouillon).toMatch(/^[0-9a-f]{64}$/);
    // Demandé encore : le brouillon est déjà repris.
    expect(await importerCeNavigateur()).toMatchObject({ brouillon: 'dejaRepris' });
  });

  test('brouillon seul non repris (toutes les factures passées) : inachevé, et la reprise le reprend', async () => {
    await remplirLocal();
    const accepte = { oui: false };
    const memoire = compteQuiRetient(accepte);
    session.sb = {
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { id: 'f', numero: 'x' }, error: null }),
      },
    };

    const premiere = await importerCeNavigateur();
    expect(premiere).toMatchObject({ factures: 3, enAttente: [], brouillon: 'nonRepris' });
    expect(premiere.arret).toBeUndefined();
    // Pas « fait » : le brouillon reste à reprendre.
    expect(await lireMarqueImport()).toMatchObject({ etat: 'partiel', brouillonEnAttente: true });
    const proposee = await importAProposer();
    expect(proposee).toMatchObject({ reprise: true, brouillonEnAttente: true });
    expect(proposee?.enAttente).toBeUndefined();

    // La reprise, sans facture à envoyer : le brouillon seul, rien de la bibliothèque.
    accepte.oui = true;
    memoire.journal.length = 0;
    const reprise = await importerCeNavigateur({ reprise: proposee?.enAttente ?? [] });
    expect(reprise).toMatchObject({ factures: 0, brouillon: 'repris' });
    expect(memoire.journal.filter((l) => l.startsWith('put') || l === 'set company')).toEqual([]);
    expect(await lireMarqueImport()).toMatchObject({ etat: 'fait' });
  });

  test('se déconnecter puis se reconnecter : ni reproposé (fait, refusé), ni second brouillon (Ruling 61)', async () => {
    await remplirLocal();
    compteQuiRetient({ oui: true });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    session.sb = {
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { id: 'f', numero: 'x' }, error: null }),
      },
      auth: { signOut },
    };
    vi.stubGlobal('location', { reload: vi.fn() });
    const reconnecter = () =>
      store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1'), storage: 'ok' } }));
    try {
      expect((await importerCeNavigateur()).brouillon).toBe('repris');
      const marque = await lireMarqueImport();
      expect(marque).toMatchObject({
        etat: 'fait',
        brouillon: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      await deconnecter();
      expect(signOut).toHaveBeenCalledOnce();
      reconnecter();
      expect(await lireMarqueImport()).toEqual(marque);
      expect(await importAProposer()).toBeUndefined();
      // Redemandé depuis « Mon compte » : le brouillon local est déjà un brouillon du compte.
      expect(await importerCeNavigateur()).toMatchObject({ brouillon: 'dejaRepris' });

      await retenirImport('refuse');
      await deconnecter();
      reconnecter();
      expect(await lireMarqueImport()).toMatchObject({ etat: 'refuse' });
      expect(await importAProposer()).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('le brouillon local disparu entre-temps : la reprise marque l’import fait', async () => {
    await remplirLocal();
    const accepte = { oui: false };
    compteQuiRetient(accepte);
    session.sb = {
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { id: 'f', numero: 'x' }, error: null }),
      },
    };
    await importerCeNavigateur();
    expect(await lireMarqueImport()).toMatchObject({ etat: 'partiel', brouillonEnAttente: true });
    // Ce navigateur n'a plus de brouillon saisi (l'exemple à la place).
    await indexedDbPersistence.set('draft', {
      form: sampleForm(),
      appearance: defaultAppearance(),
      sample: true,
    });
    const reprise = await importerCeNavigateur({ reprise: [] });
    expect(reprise.brouillon).toBeUndefined();
    expect(await lireMarqueImport()).toMatchObject({ etat: 'fait' });
  });
});

describe.skipIf(!process.env.SUPABASE_URL)(
  'l’entreprise que pose l’inscription, contre la pile',
  () => {
    test('le profil d’un compte neuf est « jamais renseigné » ; un nom commercial le fait renseigné', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const profil = await p.get<ReturnType<typeof defaultCompany>>('company');
      expect(profil).toBeDefined();
      expect(entrepriseRenseignee(profil)).toBe(false);
      if (!profil) return;
      expect(
        entrepriseRenseignee({ ...profil, seller: { ...profil.seller, tradingName: 'E' } }),
      ).toBe(true);
      expect(
        entrepriseRenseignee({ ...profil, defaults: { ...profil.defaults, currency: 'USD' } }),
      ).toBe(true);
    });
  },
);

// ---------- contre la pile, `importer` servie ----------

/** Une page blanche qui porte le XML Factur-X du formulaire : ce que l'import lit seul. */
async function pdfFacturX(form: InvoiceForm): Promise<Uint8Array> {
  const page = await PDFDocument.create();
  page.addPage();
  return embedFacturX(await page.save(), { invoice: buildInvoice(form).invoice });
}

/** La sauvegarde de trois factures, dont un avoir, avec leurs vrais PDF Factur-X. */
async function sauvegardeReelle(): Promise<Record<string, unknown>> {
  const factures = [
    facture('A-2026-0001', '2026-03-05', { typeCode: '381', cite: 'F-2026-0001' }),
    facture('F-2026-0001', '2026-03-01'),
    facture('F-2026-0002', '2026-03-02'),
  ];
  const pdf: Record<string, Uint8Array> = {};
  for (const f of factures) pdf[f.uid] = await pdfFacturX(f.form);
  return sauvegarde(factures, {
    numbering: { pattern: 'F-{AAAA}-{NNNN}', next: 3, yearly: true, year: 2026 },
    pdf,
  });
}

async function facturesDe(entrepriseId: string) {
  const { data, error } = await adminDeTest()
    .from('factures')
    .select('id, numero, type_code, origine, facture_origine_id')
    .eq('entreprise_id', entrepriseId)
    .order('numero');
  if (error) throw error;
  return data as {
    id: string;
    numero: string;
    type_code: string;
    origine: string;
    facture_origine_id: string | null;
  }[];
}

async function numerotationDe(entrepriseId: string) {
  const { data, error } = await adminDeTest()
    .from('numerotation')
    .select('gabarit, prochain, annuelle, annee')
    .eq('entreprise_id', entrepriseId)
    .single();
  if (error) throw error;
  return data as { gabarit: string; prochain: number; annuelle: boolean; annee: number };
}

describe.skipIf(!process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1')(
  'importer pour de vrai, `importer` servie',
  () => {
    test('trois factures dont un avoir : importées, l’avoir rattaché, la numérotation reprise', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      session.sb = sb as SupabaseClient;
      store.set((s) => ({ ui: { ...s.ui, compte: compteUi(entrepriseId) } }));
      const p = supabasePersistence(sb, entrepriseId);
      const anneeAvant = (await numerotationDe(entrepriseId)).annee;
      const dump = await sauvegardeReelle();

      const rapport = await importerLocal(dump, p, importerSurServeur);
      expect(rapport).toMatchObject({ clients: 2, produits: 1, factures: 3, doublons: [] });
      expect(rapport.conserves).toEqual([]);
      expect(rapport.refusees).toEqual([]);
      expect(rapport.echecs).toEqual([]);
      const lignes = await facturesDe(entrepriseId);
      expect(lignes.map((l) => [l.numero, l.type_code, l.origine])).toEqual([
        ['A-2026-0001', '381', 'importee'],
        ['F-2026-0001', '380', 'importee'],
        ['F-2026-0002', '380', 'importee'],
      ]);
      // L'avoir, importé après sa facture, la cite.
      const origine = lignes.find((l) => l.numero === 'F-2026-0001')?.id;
      expect(lignes.find((l) => l.numero === 'A-2026-0001')?.facture_origine_id).toBe(origine);
      // Gabarit, remise à zéro et rang du Studio ; l'année n'est pas touchée.
      expect(await numerotationDe(entrepriseId)).toEqual({
        gabarit: 'F-{AAAA}-{NNNN}',
        prochain: 3,
        annuelle: true,
        annee: anneeAvant,
      });
      // L'entreprise, les clients, le catalogue et le logo.
      expect((await p.get<{ seller: { name: string } }>('company'))?.seller.name).toBe(
        'Atelier Local',
      );
      expect((await p.list('clients')).length).toBe(2);
      expect(await p.getFile('logo-1')).toEqual(LOGO);

      // Un second import : rien de nouveau, trois doublons (les mêmes factures, vérifiées).
      const second = await importerLocal(dump, p, importerSurServeur);
      expect(second).toMatchObject({ factures: 0, numerosPris: [] });
      expect([...second.doublons].sort()).toEqual(['A-2026-0001', 'F-2026-0001', 'F-2026-0002']);
      expect(await facturesDe(entrepriseId)).toHaveLength(3);

      // Le compte change ensuite un client et son entreprise : un troisième import n'y touche pas.
      const [c1] = await p.list<ClientRecord>('clients');
      if (!c1) throw new Error('client absent');
      await p.put('clients', { ...c1, party: { ...c1.party, name: 'Renommé dans le compte' } });
      const sienne = await p.get<ReturnType<typeof defaultCompany>>('company');
      if (!sienne) throw new Error('entreprise absente');
      await p.set('company', { ...sienne, seller: { ...sienne.seller, name: 'Renommée' } });
      const troisieme = await importerLocal(dump, p, importerSurServeur);
      expect(troisieme).toMatchObject({ clients: 0, clientsDejaLa: 2, factures: 0 });
      // L'apparence et la numérotation du compte sont celles du navigateur : rien à dire d'elles.
      expect(troisieme.conserves).toEqual(['entreprise']);
      const apres = await p.list<ClientRecord>('clients');
      expect(apres.find((c) => c.uid === c1.uid)?.party.name).toBe('Renommé dans le compte');
      expect((await p.get<{ seller: { name: string } }>('company'))?.seller.name).toBe('Renommée');
    }, 60_000);

    test('ce navigateur : le brouillon local devient un brouillon du compte, sans écraser l’existant', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      session.sb = sb as SupabaseClient;
      // Ce que le Studio sans compte a laissé dans ce navigateur.
      const dump = await sauvegardeReelle();
      const kv = dump.kv as Record<string, unknown>;
      const local = { form: sampleForm('2026-03-10'), appearance: defaultAppearance() };
      local.form.buyer.name = 'Brouillon local';
      for (const cle of ['company', 'numbering', 'appearance-default'])
        await indexedDbPersistence.set(cle, kv[cle]);
      await indexedDbPersistence.set('draft', local);
      for (const [cle, octets] of Object.entries(dump.files as Record<string, Uint8Array>))
        await indexedDbPersistence.setFile(cle, octets);
      for (const f of dump.invoices as SavedInvoice[])
        await indexedDbPersistence.put('invoices', f);
      for (const c of dump.clients as ClientRecord[]) await indexedDbPersistence.put('clients', c);
      for (const pr of dump.products as ProductRecord[])
        await indexedDbPersistence.put('products', pr);
      const avant = await indexedDbPersistence.dump();

      // Le compte a déjà un brouillon, ouvert dans le Studio.
      const p = supabasePersistence(sb, entrepriseId);
      const existant = { form: sampleForm('2026-03-11'), appearance: defaultAppearance() };
      existant.form.buyer.name = 'Brouillon du compte';
      await p.set('draft', existant);
      utiliser(p);
      const fenetre = new EventTarget();
      vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
      vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
      store.set((s) => ({
        form: existant.form,
        appearance: existant.appearance,
        numbering: defaultNumbering(),
        ui: {
          ...s.ui,
          storage: 'ok',
          compte: compteUi(entrepriseId),
          sample: false,
          issued: undefined,
          conflit: false,
          reseau: 'ok',
        },
      }));
      const arreter = startPersistence({ delai: 1000 });
      try {
        const rapport = await importerCeNavigateur();
        expect(rapport).toMatchObject({ factures: 3, brouillon: 'repris' });
        expect(await enregistrerMaintenant()).toBe(true);
        await p.envoisTermines();
        const { data } = await adminDeTest()
          .from('brouillons')
          .select('form')
          .eq('entreprise_id', entrepriseId);
        const noms = (data as { form: InvoiceForm }[]).map((l) => l.form.buyer.name).sort();
        expect(noms).toEqual(['Brouillon du compte', 'Brouillon local']);
        // L'éditeur montre le brouillon repris ; le magasin, ce que le serveur a désormais.
        expect(store.get().form.buyer.name).toBe('Brouillon local');
        expect(store.get().numbering.next).toBe(3);
        expect(store.get().clients).toHaveLength(2);
        expect(store.get().history).toHaveLength(3);
        expect((await lireMarqueImport())?.etat).toBe('fait');

        // Demandé une seconde fois : rien en double, pas même le brouillon.
        const second = await importerCeNavigateur();
        expect(second).toMatchObject({ factures: 0, brouillon: 'dejaRepris' });
        expect(await enregistrerMaintenant()).toBe(true);
        await p.envoisTermines();
        const { data: apres } = await adminDeTest()
          .from('brouillons')
          .select('id')
          .eq('entreprise_id', entrepriseId);
        expect(apres).toHaveLength(2);
        expect(await facturesDe(entrepriseId)).toHaveLength(3);
      } finally {
        arreter();
        vi.unstubAllGlobals();
      }
      // Les données locales restent dans ce navigateur, telles quelles.
      const ensuite = (await indexedDbPersistence.dump()) as typeof avant;
      for (const cle of ['invoices', 'clients', 'products', 'files'] as const)
        expect(ensuite[cle]).toEqual(avant[cle]);
      for (const cle of ['company', 'numbering', 'appearance-default', 'draft'])
        expect((ensuite.kv as Record<string, unknown>)[cle]).toEqual(
          (avant.kv as Record<string, unknown>)[cle],
        );
    }, 90_000);
  },
);
