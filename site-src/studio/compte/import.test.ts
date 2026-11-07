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
  type ProductRecord,
  type SavedInvoice,
} from '../library.js';
import { blankParty, buildInvoice, type InvoiceForm } from '../model.js';
import { ErreurConservation, type Persistence } from '../persistence.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { enregistrerMaintenant, startPersistence, store } from '../store.js';
import { finDAttente } from './erreurs.js';
import {
  type IssueDImport,
  importerCeNavigateur,
  importerLocal,
  importerSurServeur,
  numerotationReprise,
} from './import.js';
import { importAProposer, inventaireLocal, lireMarqueImport, retenirImport } from './index.js';
import { supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest, refusDeFonction } from './test-aide.js';

/**
 * Importer les données locales (spec § 10) : sans pile, `importerLocal` sur une conservation en
 * mémoire avec un `importer` simulé (ordre, doublons, refus, limite de débit et reprise,
 * numérotation), la lecture des réponses d'`importer`, et la proposition faite à la première
 * connexion ; contre la pile, avec `importer` servie (`FACTURX_EMETTRE=1`), une sauvegarde de trois
 * factures dont un avoir, et l'import de ce navigateur jusqu'au brouillon.
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
/** Un logo : la signature PNG suffit au dépôt. */
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

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
      total: 12000,
      due: 12000,
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

// ---------- une conservation en mémoire ----------

/**
 * Ce que le serveur du compte garde, en mémoire, et le journal des écritures. Comme le déclencheur
 * de la base, la numérotation refuse de reculer.
 */
function enMemoire(numerotation: Numbering = { ...defaultNumbering(), year: 2026 }) {
  const kv = new Map<string, unknown>([['numbering', numerotation]]);
  const listes = {
    invoices: new Map<string, unknown>(),
    clients: new Map<string, unknown>(),
    products: new Map<string, unknown>(),
  };
  const fichiers = new Map<string, Uint8Array>();
  const journal: string[] = [];
  const p: Persistence = {
    available: async () => true,
    get: async <T>(cle: string) => structuredClone(kv.get(cle)) as T | undefined,
    async set(cle, valeur) {
      if (cle === 'numbering') {
        const avant = kv.get('numbering') as Numbering;
        if ((valeur as Numbering).next < avant.next) {
          throw new ErreurConservation('REFUS', 'NUMEROTATION_RECUL');
        }
      }
      journal.push(`set ${cle}`);
      kv.set(cle, structuredClone(valeur));
      return cle;
    },
    list: async <T>(magasin: 'invoices' | 'clients' | 'products') =>
      [...listes[magasin].values()] as T[],
    async put(magasin, valeur) {
      if (magasin === 'invoices') throw new ErreurConservation('EMISSION_SERVEUR');
      journal.push(`put ${magasin} ${valeur.uid}`);
      listes[magasin].set(valeur.uid, structuredClone(valeur));
      return valeur.uid;
    },
    async remove(magasin, cle) {
      journal.push(`remove ${magasin} ${cle}`);
      return undefined;
    },
    getFile: async (cle) => fichiers.get(cle),
    async setFile(cle, octets) {
      if (cle.startsWith('pdf-')) throw new ErreurConservation('EMISSION_SERVEUR');
      journal.push(`setFile ${cle}`);
      fichiers.set(cle, octets);
      return cle;
    },
    dump: async () => ({}),
  };
  return { p, kv, listes, fichiers, journal };
}

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
    const { importer } = fauxImporter(cible.journal, {
      'F-2026-0002': [{ kind: 'doublon' }],
    });
    const rapport = await importerLocal(sauvegarde(TROIS), cible.p, importer);
    expect(rapport).toMatchObject({ factures: 2, doublons: ['F-2026-0002'] });
    expect(rapport.refusees).toEqual([]);
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

  test('la numérotation passe au plus haut rang connu, après les factures', async () => {
    const cible = enMemoire({ pattern: 'X-{NNN}', next: 1, yearly: false, year: 2026 });
    const { importer } = fauxImporter(cible.journal);
    await importerLocal(
      sauvegarde(TROIS, {
        numbering: { pattern: 'F-{AAAA}-{NNNN}', next: 12, yearly: true, year: 2026 },
      }),
      cible.p,
      importer,
    );
    // Le gabarit et la remise à zéro du Studio sont repris ; l'année reste celle du serveur.
    expect(cible.kv.get('numbering')).toEqual({
      pattern: 'F-{AAAA}-{NNNN}',
      next: 12,
      yearly: true,
      year: 2026,
    });
    // Levée une fois toutes les factures passées, jamais avant.
    const ecriture = cible.journal.indexOf('set numbering');
    expect(ecriture).toBeGreaterThan(cible.journal.lastIndexOf('importer F-2026-0003'));
  });

  test('numerotationReprise : rang local, rangs des factures, année, jamais plus bas', () => {
    const serveur: Numbering = { pattern: 'F-{AAAA}-{NNNN}', next: 3, yearly: true, year: 2026 };
    const locale: Numbering = { pattern: 'F-{AAAA}-{NNNN}', next: 12, yearly: true, year: 2026 };
    expect(numerotationReprise(serveur, locale, []).next).toBe(12);
    // Une facture d'un rang plus haut que la numérotation locale (rang baissé à la main).
    expect(numerotationReprise(serveur, locale, [facture('F-2026-0015', '2026-05-01')]).next).toBe(
      16,
    );
    // Un rang de l'an passé, en remise à zéro annuelle, ne compte pas pour l'année du serveur.
    const anneePassee: Numbering = { ...locale, next: 30, year: 2025 };
    expect(
      numerotationReprise(serveur, anneePassee, [facture('F-2025-0029', '2025-12-30')]).next,
    ).toBe(3);
    // Sans remise à zéro, tout rang compte.
    expect(
      numerotationReprise(serveur, { ...anneePassee, yearly: false }, [
        facture('F-2025-0029', '2025-12-30'),
      ]).next,
    ).toBe(30);
    // Jamais plus bas que le serveur ; l'année ne change pas.
    const haut = { ...serveur, next: 40 };
    expect(numerotationReprise(haut, locale, [])).toEqual({ ...locale, next: 40, year: 2026 });
    // Un numéro hors du gabarit ne dit rien du rang.
    expect(numerotationReprise(serveur, locale, [facture('MANUEL-99', '2026-05-01')]).next).toBe(
      12,
    );
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

  test('sans entreprise renseignée en local, celle du compte n’est pas remplacée', async () => {
    const dump = sauvegarde(TROIS);
    (dump.kv as Record<string, unknown>).company = defaultCompany();
    const cible = enMemoire();
    await importerLocal(dump, cible.p, fauxImporter(cible.journal).importer);
    expect(cible.journal).not.toContain('set company');
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

  /** Ce qu'un Studio sans compte laisse dans IndexedDB. */
  async function remplirLocal(): Promise<void> {
    const dump = sauvegarde(TROIS);
    const kv = dump.kv as Record<string, unknown>;
    for (const cle of ['company', 'numbering', 'draft'])
      await indexedDbPersistence.set(cle, kv[cle]);
    for (const f of TROIS) await indexedDbPersistence.put('invoices', f);
    for (const c of dump.clients as ClientRecord[]) await indexedDbPersistence.put('clients', c);
    for (const p of dump.products as ProductRecord[]) await indexedDbPersistence.put('products', p);
  }

  test('rien dans ce navigateur : rien n’est proposé', async () => {
    expect(await inventaireLocal()).toMatchObject({ factures: 0, clients: 0, produits: 0 });
    expect(await importAProposer()).toBeUndefined();
  });

  test('l’exemple seul, ou une entreprise vide, ne sont pas des données', async () => {
    await indexedDbPersistence.set('draft', {
      form: sampleForm(),
      appearance: defaultAppearance(),
      sample: true,
    });
    await indexedDbPersistence.set('company', defaultCompany());
    await indexedDbPersistence.set('numbering', defaultNumbering());
    expect(await importAProposer()).toBeUndefined();
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

  test('fait : plus proposé ; inachevé : proposé de nouveau, comme une reprise', async () => {
    await remplirLocal();
    await retenirImport('fait', 'empreinte-1');
    expect(await importAProposer()).toBeUndefined();
    await retenirImport('partiel');
    expect(await importAProposer()).toMatchObject({ reprise: true });
    // L'empreinte du brouillon déjà repris est gardée.
    expect(await lireMarqueImport()).toMatchObject({ etat: 'partiel', brouillon: 'empreinte-1' });
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
});

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

      // Un second import : rien de nouveau, trois doublons.
      const second = await importerLocal(dump, p, importerSurServeur);
      expect(second).toMatchObject({ factures: 0 });
      expect([...second.doublons].sort()).toEqual(['A-2026-0001', 'F-2026-0001', 'F-2026-0002']);
      expect(await facturesDe(entrepriseId)).toHaveLength(3);
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
