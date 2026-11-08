// La conservation du compte garde son miroir dans IndexedDB : le faux doit exister avant storage.ts.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fromPortableJson } from '../../shared/portable.js';
import {
  type ClientRecord,
  defaultAppearance,
  defaultCompany,
  FORMAT_SAUVEGARDE,
  lireSauvegarde,
  type Numbering,
  type ProductRecord,
  restaurerSauvegarde,
  type SavedInvoice,
} from '../library.js';
import { blankParty } from '../model.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { ErreurExport, exporterArchive, nomsDesPdf, nouvelleArchive } from './export.js';
import { supabasePersistence } from './persistence.js';
import { aujourdhuiParis } from './suivi.js';
import {
  adminDeTest,
  compteDeTest,
  conservationEnMemoire,
  imageDeTest,
  insererFacture,
} from './test-aide.js';

/**
 * L'export du compte (spec § 10 et § 12, Ruling 56) : une archive zip, `donnees.json` — une
 * sauvegarde du Studio (`facturx-studio-backup`), que « Restaurer une sauvegarde » reprend telle
 * quelle, PDF compris, avec ce que le compte a de plus — et un PDF par facture sous
 * `factures/<numéro>.pdf`. Sans pile, les noms des PDF et les limites du zip ; contre la pile,
 * l'archive relue et restaurée : tout le compte, les paiements annulés compris, un PDF absent ou
 * illisible dit manquant, deux numéros au même nom de fichier sans rien écraser.
 */

/** Le client que `exporterArchive` emploie par `client()` : celui de l'essai en cours. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

afterEach(() => {
  utiliser(indexedDbPersistence);
  session.sb = undefined;
});

describe('les noms des PDF dans l’archive', () => {
  test('tirés du numéro ; deux numéros au même nom : suffixe stable, rien d’écrasé', () => {
    const noms = nomsDesPdf([
      { id: '11111111-aaaa', numero: 'F-2026/0001' },
      { id: '22222222-bbbb', numero: 'F-2026-0001' },
      // Un système de fichiers sans casse confondrait les deux.
      { id: '33333333-cccc', numero: 'f-2026-0001' },
      // Un numéro qui ressemble au nom suffixé d'un autre.
      { id: '44444444-dddd', numero: 'F-2026-0001-22222222' },
      { id: '55555555-eeee', numero: 'F-2026-0002' },
    ]);
    expect([...noms]).toEqual([
      ['11111111-aaaa', 'factures/F-2026-0001.pdf'],
      ['22222222-bbbb', 'factures/F-2026-0001-22222222.pdf'],
      ['33333333-cccc', 'factures/f-2026-0001-33333333.pdf'],
      ['44444444-dddd', 'factures/F-2026-0001-22222222-44444444.pdf'],
      ['55555555-eeee', 'factures/F-2026-0002.pdf'],
    ]);
    expect(new Set([...noms.values()].map((n) => n.toLowerCase())).size).toBe(5);
  });
});

describe('les limites du zip (sans Zip64)', () => {
  const octets = (n: number) => new Uint8Array(n);

  test('au-delà du nombre d’entrées : une erreur claire, avant d’écrire', () => {
    const zip = nouvelleArchive({ entrees: 2, octets: 1_000_000 });
    zip.ajouter('a', octets(10), false);
    zip.ajouter('b', octets(10), false);
    expect(() => zip.ajouter('c', octets(10), false)).toThrow(ErreurExport);
  });

  test('au-delà de la taille : une erreur claire, avant d’écrire', () => {
    const zip = nouvelleArchive({ entrees: 100, octets: 1_000 });
    zip.ajouter('a', octets(400), false);
    expect(() => zip.ajouter('b', octets(700), false)).toThrow(ErreurExport);
  });

  test('dans les limites : l’archive se relit', async () => {
    const zip = nouvelleArchive();
    zip.ajouter('a.txt', new TextEncoder().encode('bonjour'), true);
    zip.ajouter('b.bin', octets(3), false);
    const relue = unzipSync(new Uint8Array(await zip.fermer().arrayBuffer()));
    expect(strFromU8(relue['a.txt'] ?? new Uint8Array())).toBe('bonjour');
    expect(relue['b.bin']).toEqual(octets(3));
  });
});

// ---------- contre la pile ----------

/** Un logo : la signature PNG et un en-tête lisible (64 × 32) suffisent au dépôt. */
const LOGO = imageDeTest('png', 64, 32);

type Ligne = Record<string, unknown>;

/** Ce que `donnees.json` contient, tel que le test le lit. */
interface Donnees {
  format: string;
  version: number;
  data: {
    kv: { company: { seller: { name: string } }; numbering: Numbering } & Record<string, unknown>;
    files: Record<string, Uint8Array>;
    invoices: SavedInvoice[];
    clients: ClientRecord[];
    products: ProductRecord[];
  };
  compte: {
    exporteLe: string;
    email: string;
    membres: Ligne[];
    entreprise: Ligne & { id: string };
    numerotation: Ligne;
    brouillons: Ligne[];
    factures: (Ligne & { id: string; numero: string; pdf: string | null })[];
    paiements: Ligne[];
    relances: Ligne[];
    pdfManquants: { factureId: string; numero: string; raison: string }[];
  };
}

async function lireArchive(archive: Blob) {
  const zip = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const json = zip['donnees.json'];
  if (!json) throw new Error('donnees.json absent');
  const texte = strFromU8(json);
  return { zip, texte, donnees: fromPortableJson<Donnees>(texte) };
}

/** Un compte neuf, connecté au Studio (`storage` et `client()`). */
async function compteConnecte() {
  const { sb, entrepriseId } = await compteDeTest();
  session.sb = sb as SupabaseClient;
  const p = supabasePersistence(sb, entrepriseId);
  utiliser(p);
  return { sb, entrepriseId, p };
}

const deposerPdf = (chemin: string, texte: string) =>
  adminDeTest().storage.from('factures').upload(chemin, new TextEncoder().encode(texte), {
    contentType: 'application/pdf',
    upsert: true,
  });

describe.skipIf(!process.env.SUPABASE_URL)('exporter l’archive du compte, contre la pile', () => {
  test('une sauvegarde du Studio, complète, que « Restaurer une sauvegarde » reprend avec les PDF', async () => {
    const { sb, entrepriseId, p } = await compteConnecte();
    const company = defaultCompany();
    company.seller.name = 'Atelier Export';
    await p.set('company', company);
    await p.set('appearance-default', { ...defaultAppearance(), accent: '#123456' });
    await p.set('numbering', { pattern: 'F-{AAAA}-{NNNN}', next: 7, yearly: true, year: 2026 });
    await p.put('clients', {
      uid: 'c-1',
      party: { ...blankParty(), name: 'Client Export' },
      updatedAt: '2026-03-01T10:00:00.000Z',
    });
    await p.put('products', {
      uid: 'p-1',
      name: 'Conseil',
      description: '',
      unitCode: 'C62',
      unitPrice: '100',
      vat: 'S:20',
      sellerItemId: '',
      updatedAt: '2026-03-01T10:00:00.000Z',
    });
    await p.set('draft', { form: sampleForm('2026-03-10'), appearance: defaultAppearance() });
    await p.setFile('logo-1', LOGO);
    const facture = await insererFacture(entrepriseId, {
      prefixe: 'EXP',
      numero: 'F-2026-0001',
      form: { id: 'F-2026-0001', note: 'formulaire' },
      pdf: true,
    });
    const avoir = await insererFacture(entrepriseId, {
      prefixe: 'EXP',
      numero: 'A-2026-0001',
      typeCode: '381',
      ttc: 2000,
      origine: facture,
      pdf: true,
    });
    // Un paiement actif, un paiement annulé.
    const jour = aujourdhuiParis();
    const paiement = (montant: number) =>
      sb
        .from('paiements')
        .insert({
          entreprise_id: entrepriseId,
          facture_id: facture,
          date: jour,
          montant,
          moyen: 'virement',
        })
        .select('id')
        .single<{ id: string }>();
    const actif = await paiement(3000);
    const annule = await paiement(2000);
    if (actif.error || annule.error) throw actif.error ?? annule.error;
    const annulation = await sb
      .from('paiements')
      .update({ annule_le: new Date().toISOString() })
      .eq('id', annule.data.id);
    if (annulation.error) throw annulation.error;
    const relance = await adminDeTest().from('relances').insert({
      entreprise_id: entrepriseId,
      facture_id: facture,
      niveau: 1,
      destinataire: 'compta@client.test',
      objet: 'Rappel',
      corps: 'Bonjour',
      message_id: 'm-1',
      etat: 'envoyee',
    });
    if (relance.error) throw relance.error;

    const { zip, texte, donnees } = await lireArchive(await exporterArchive());

    expect(Object.keys(zip).sort()).toEqual([
      'donnees.json',
      'factures/A-2026-0001.pdf',
      'factures/F-2026-0001.pdf',
    ]);
    for (const [nom, octets] of Object.entries(zip)) {
      if (nom.endsWith('.pdf')) expect(strFromU8(octets.subarray(0, 5))).toBe('%PDF-');
    }

    // Une sauvegarde du Studio : le format que « Restaurer une sauvegarde » contrôle.
    expect(donnees).toMatchObject({ format: FORMAT_SAUVEGARDE, version: 1 });
    expect(donnees.data.kv.company.seller.name).toBe('Atelier Export');
    expect(donnees.data.kv['appearance-default']).toMatchObject({ accent: '#123456' });
    // La numérotation à jour : revenu au Studio sans compte, on ne réutilise aucun numéro émis.
    expect(donnees.data.kv.numbering).toMatchObject({ pattern: 'F-{AAAA}-{NNNN}', next: 7 });
    expect(donnees.data.invoices.map((f) => f.summary.id).sort()).toEqual([
      'A-2026-0001',
      'F-2026-0001',
    ]);
    expect(donnees.data.clients.map((c) => c.party.name)).toEqual(['Client Export']);
    expect(donnees.data.products.map((c) => c.name)).toEqual(['Conseil']);
    // Les PDF sous la clé où le Studio sans compte les cherche (`pdf-<uid>`), et le logo.
    expect(Object.keys(donnees.data.files).sort()).toEqual(
      ['logo-1', `pdf-${avoir}`, `pdf-${facture}`].sort(),
    );
    expect(donnees.data.files[`pdf-${facture}`]).toEqual(zip['factures/F-2026-0001.pdf']);

    // Ce que la sauvegarde ne porte pas : les lignes du compte.
    const { compte } = donnees;
    expect(Date.parse(compte.exporteLe)).not.toBeNaN();
    expect(compte.email).toMatch(/^essai-.*@facturx\.test$/);
    expect(compte.membres).toHaveLength(1);
    expect(compte.membres[0]).toMatchObject({
      entreprise_id: entrepriseId,
      cgu_version: '2026-11',
    });
    expect(compte.membres[0]?.cgu_acceptees_le).toBeTruthy();
    expect(compte.entreprise.id).toBe(entrepriseId);
    expect(compte.numerotation).toMatchObject({ gabarit: 'F-{AAAA}-{NNNN}', prochain: 7 });
    expect(compte.brouillons).toHaveLength(1);
    const parNumero = new Map(compte.factures.map((f) => [f.numero, f]));
    expect(parNumero.get('F-2026-0001')).toMatchObject({
      id: facture,
      pdf: 'factures/F-2026-0001.pdf',
      form: { id: 'F-2026-0001', note: 'formulaire' },
      origine: 'emise',
    });
    expect(parNumero.get('A-2026-0001')).toMatchObject({
      facture_origine_id: facture,
      pdf: 'factures/A-2026-0001.pdf',
    });
    expect(compte.paiements.map((l) => [l.montant, l.annule_le === null]).sort()).toEqual([
      [2000, false],
      [3000, true],
    ]);
    expect(compte.relances.map((l) => [l.niveau, l.destinataire])).toEqual([
      [1, 'compta@client.test'],
    ]);
    expect(compte.pdfManquants).toEqual([]);

    // La restauration du Studio sans compte, par ses propres fonctions, dans une conservation
    // locale en mémoire : factures, PDF, clients, catalogue, entreprise, numérotation.
    const local = conservationEnMemoire({ mode: 'local' });
    await restaurerSauvegarde(lireSauvegarde(texte), local.p);
    expect([...local.listes.invoices.keys()].sort()).toEqual([avoir, facture].sort());
    expect([...local.listes.clients.keys()]).toEqual(['c-1']);
    expect([...local.listes.products.keys()]).toEqual(['p-1']);
    expect((local.kv.get('company') as { seller: { name: string } }).seller.name).toBe(
      'Atelier Export',
    );
    expect((local.kv.get('numbering') as Numbering).next).toBe(7);
    expect(local.fichiers.get(`pdf-${facture}`)).toEqual(zip['factures/F-2026-0001.pdf']);
    expect(local.fichiers.get('logo-1')).toEqual(LOGO);
  }, 30_000);

  test('un PDF absent ou illisible ne fait pas échouer l’export : il est dit manquant', async () => {
    const { entrepriseId } = await compteConnecte();
    await insererFacture(entrepriseId, { prefixe: 'EXP', numero: 'F-1', pdf: true });
    const absent = await insererFacture(entrepriseId, { prefixe: 'EXP', numero: 'F-2' });
    const illisible = await insererFacture(entrepriseId, { prefixe: 'EXP', numero: 'F-3' });
    const depot = await deposerPdf(`${entrepriseId}/${illisible}.pdf`, '<html>pas un PDF</html>');
    if (depot.error) throw depot.error;

    const { zip, donnees } = await lireArchive(await exporterArchive());

    expect(Object.keys(zip).sort()).toEqual(['donnees.json', 'factures/F-1.pdf']);
    expect(donnees.compte.pdfManquants).toEqual([
      { factureId: absent, numero: 'F-2', raison: 'absent' },
      { factureId: illisible, numero: 'F-3', raison: 'illisible' },
    ]);
    expect(donnees.compte.factures.map((f) => [f.numero, f.pdf])).toEqual([
      ['F-1', 'factures/F-1.pdf'],
      ['F-2', null],
      ['F-3', null],
    ]);
    // La sauvegarde n'a que le PDF lisible.
    expect(Object.keys(donnees.data.files).filter((c) => c.startsWith('pdf-'))).toHaveLength(1);
  }, 30_000);

  test('deux numéros au même nom de fichier : deux PDF, rien d’écrasé', async () => {
    const { entrepriseId } = await compteConnecte();
    const a = await insererFacture(entrepriseId, { prefixe: 'EXP', numero: 'F/2026/1' });
    const b = await insererFacture(entrepriseId, { prefixe: 'EXP', numero: 'F-2026-1' });
    for (const [id, texte] of [
      [a, '%PDF-1.7\n% facture a\n'],
      [b, '%PDF-1.7\n% facture b\n'],
    ] as const) {
      const depot = await deposerPdf(`${entrepriseId}/${id}.pdf`, texte);
      if (depot.error) throw depot.error;
    }

    const { zip, donnees } = await lireArchive(await exporterArchive());

    const nomB = `factures/F-2026-1-${b.slice(0, 8)}.pdf`;
    expect(Object.keys(zip).sort()).toEqual(['donnees.json', 'factures/F-2026-1.pdf', nomB].sort());
    expect(strFromU8(zip['factures/F-2026-1.pdf'] ?? new Uint8Array())).toContain('facture a');
    expect(strFromU8(zip[nomB] ?? new Uint8Array())).toContain('facture b');
    expect(donnees.compte.factures.map((f) => [f.numero, f.pdf])).toEqual([
      ['F/2026/1', 'factures/F-2026-1.pdf'],
      ['F-2026-1', nomB],
    ]);
  }, 30_000);
});
