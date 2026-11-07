// La conservation du compte garde son miroir dans IndexedDB : le faux doit exister avant storage.ts.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fromPortableJson } from '../../shared/portable.js';
import { defaultAppearance, defaultCompany } from '../library.js';
import { blankParty } from '../model.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { exporterArchive, nomsDesPdf } from './export.js';
import { supabasePersistence } from './persistence.js';
import { aujourdhuiParis } from './suivi.js';
import { adminDeTest, compteDeTest, insererFacture } from './test-aide.js';

/**
 * L'export du compte (spec § 12) : une archive zip, `donnees.json` (JSON portable) et un PDF par
 * facture sous `factures/<numéro>.pdf`. Sans pile, les noms des PDF ; contre la pile, l'archive
 * relue : tout le compte, les paiements annulés compris, un PDF absent ou illisible dit manquant,
 * deux numéros au même nom de fichier sans rien écraser.
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

// ---------- contre la pile ----------

/** Un logo : la signature PNG suffit au dépôt. */
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Ligne = Record<string, unknown>;

/** Ce que `donnees.json` contient, tel que le test le lit. */
interface Donnees {
  format: string;
  version: number;
  exporteLe: string;
  entreprise: { id: string; profil: { seller: { name: string } }; apparence_defaut: Ligne };
  numerotation: Ligne;
  clients: Ligne[];
  produits: Ligne[];
  brouillons: Ligne[];
  factures: (Ligne & { id: string; numero: string; pdf: string | null })[];
  paiements: Ligne[];
  relances: Ligne[];
  fichiers: Record<string, Uint8Array>;
  pdfManquants: { factureId: string; numero: string; raison: string }[];
}

async function lireArchive(archive: Blob) {
  const zip = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const json = zip['donnees.json'];
  if (!json) throw new Error('donnees.json absent');
  return { zip, donnees: fromPortableJson<Donnees>(strFromU8(json)) };
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
  test('l’archive se décompresse : donnees.json complet, chaque PDF commence par %PDF', async () => {
    const { sb, entrepriseId, p } = await compteConnecte();
    const company = defaultCompany();
    company.seller.name = 'Atelier Export';
    await p.set('company', company);
    await p.set('appearance-default', { ...defaultAppearance(), accent: '#123456' });
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
    await insererFacture(entrepriseId, {
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

    const { zip, donnees } = await lireArchive(await exporterArchive());

    expect(Object.keys(zip).sort()).toEqual([
      'donnees.json',
      'factures/A-2026-0001.pdf',
      'factures/F-2026-0001.pdf',
    ]);
    for (const [nom, octets] of Object.entries(zip)) {
      if (nom.endsWith('.pdf')) expect(strFromU8(octets.subarray(0, 5))).toBe('%PDF-');
    }
    expect(donnees).toMatchObject({ format: 'facturx-compte', version: 1 });
    expect(Date.parse(donnees.exporteLe)).not.toBeNaN();
    expect(donnees.entreprise.id).toBe(entrepriseId);
    expect(donnees.entreprise.profil.seller.name).toBe('Atelier Export');
    expect(donnees.entreprise.apparence_defaut).toMatchObject({ accent: '#123456' });
    expect(donnees.numerotation).toMatchObject({ gabarit: 'F-{AAAA}-{NNNN}', prochain: 1 });
    expect(donnees.clients.map((c) => [c.id, c.nom])).toEqual([['c-1', 'Client Export']]);
    expect(donnees.produits.map((c) => [c.id, c.nom])).toEqual([['p-1', 'Conseil']]);
    expect(donnees.brouillons).toHaveLength(1);
    expect(donnees.brouillons[0]).toHaveProperty('form');
    // Les factures, formulaire et apparence compris, chacune avec le chemin de son PDF.
    const parNumero = new Map(donnees.factures.map((f) => [f.numero, f]));
    expect(parNumero.get('F-2026-0001')).toMatchObject({
      id: facture,
      pdf: 'factures/F-2026-0001.pdf',
      form: { id: 'F-2026-0001', note: 'formulaire' },
      origine: 'emise',
    });
    expect(parNumero.get('F-2026-0001')).toHaveProperty('appearance');
    expect(parNumero.get('A-2026-0001')).toMatchObject({
      facture_origine_id: facture,
      pdf: 'factures/A-2026-0001.pdf',
    });
    // Les paiements, annulés compris, et les relances.
    expect(donnees.paiements.map((l) => [l.montant, l.annule_le === null]).sort()).toEqual([
      [2000, false],
      [3000, true],
    ]);
    expect(donnees.relances.map((l) => [l.niveau, l.destinataire])).toEqual([
      [1, 'compta@client.test'],
    ]);
    expect(donnees.fichiers).toEqual({ 'logo-1': LOGO });
    expect(donnees.pdfManquants).toEqual([]);
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
    expect(donnees.pdfManquants).toEqual([
      { factureId: absent, numero: 'F-2', raison: 'absent' },
      { factureId: illisible, numero: 'F-3', raison: 'illisible' },
    ]);
    expect(donnees.factures.map((f) => [f.numero, f.pdf])).toEqual([
      ['F-1', 'factures/F-1.pdf'],
      ['F-2', null],
      ['F-3', null],
    ]);
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
    expect(donnees.factures.map((f) => [f.numero, f.pdf])).toEqual([
      ['F/2026/1', 'factures/F-2026-1.pdf'],
      ['F-2026-1', nomB],
    ]);
  }, 30_000);
});
