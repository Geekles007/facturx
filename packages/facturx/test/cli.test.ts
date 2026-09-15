import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { cents, toCiiXml } from '../src/index.js';
import { embedFacturX } from '../src/pdf/index.js';
import { simpleInvoice } from './fixtures/invoices.js';

const golden = new URL('./golden/', import.meta.url).pathname;

const CII = join(golden, 'simple.xml');
const UBL = join(golden, 'ubl/simple.xml');

/**
 * Les PDF sont fabriqués ici, pas empruntés au site : ses exemples sont git-ignorés et
 * régénérés par la construction, donc absents d'une machine fraîche — ce que la CI a prouvé.
 */
let dossierPdf: string;
let PDF: string;
let PDF_FAUTIF: string;

beforeAll(async () => {
  dossierPdf = mkdtempSync(join(tmpdir(), 'cli-pdf-'));
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Facture', { x: 50, y: 780, size: 18, font });
  const vierge = await doc.save({ updateFieldAppearances: false });

  const bonne = simpleInvoice();
  PDF = join(dossierPdf, 'facture.pdf');
  writeFileSync(PDF, await embedFacturX(vierge, { invoice: bonne }));

  // Un TTC qui ne colle pas : BR-CO-15 tombe, sans toucher à la structure du document.
  const fautive = { ...bonne, totals: { ...bonne.totals, taxInclusiveAmount: cents(99900) } };
  PDF_FAUTIF = join(dossierPdf, 'facture-fautive.pdf');
  writeFileSync(
    PDF_FAUTIF,
    await embedFacturX(vierge, { xml: toCiiXml(fautive, { validate: false }) }),
  );
});

afterEach(() => vi.restoreAllMocks());

let sortie: string[];
let erreur: string[];

beforeEach(() => {
  sortie = [];
  erreur = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    sortie.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    erreur.push(String(chunk));
    return true;
  });
});

const texte = () => sortie.join('');
const texteErreur = () => erreur.join('');

/**
 * Les codes de sortie sont le contrat du CLI : c'est par eux qu'une chaîne d'intégration décide
 * de laisser passer une facture ou de la bloquer. Ils comptent plus que l'affichage.
 */
describe('codes de sortie', () => {
  it('0 quand la facture est conforme, quelle que soit la syntaxe', async () => {
    expect(await main(['validate', CII])).toBe(0);
    expect(await main(['validate', UBL])).toBe(0);
  });

  it('1 quand des anomalies sont relevées, sans interrompre le traitement', async () => {
    expect(await main(['validate', PDF_FAUTIF])).toBe(1);
  });

  it('2 quand un fichier est illisible', async () => {
    expect(await main(['validate', join(golden, 'inexistant.xml')])).toBe(2);
    expect(texte()).toMatch(/Fichier introuvable/);
  });

  it("2 l'emporte sur 1 : un lot dont un fichier est illisible ne vaut pas « anomalies »", async () => {
    expect(await main(['validate', PDF_FAUTIF, join(golden, 'inexistant.xml')])).toBe(2);
  });

  it('64 pour un usage incorrect', async () => {
    expect(await main([])).toBe(64);
    expect(await main(['validate'])).toBe(64);
    expect(await main(['verifie', CII])).toBe(64);
    expect(await main(['validate', '--inconnu', CII])).toBe(64);
  });

  it('0 pour --help et --version, qui ne sont pas des échecs', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(await main(['--version'])).toBe(0);
    expect(texte()).toMatch(/^\d+\.\d+\.\d+$/m);
  });
});

describe('validate', () => {
  it('reconnaît la syntaxe sans qu’on la lui dise', async () => {
    await main(['validate', UBL]);
    expect(texte()).toMatch(/UBL/);
    sortie = [];
    await main(['validate', CII]);
    expect(texte()).toMatch(/CII/);
  });

  it('lit un PDF Factur-X et n’en charge le moteur que pour lui', async () => {
    expect(await main(['validate', PDF])).toBe(0);
    expect(texte()).toMatch(/F-2026-0001/);
  });

  it('nomme chaque anomalie par son code et son chemin', async () => {
    await main(['validate', PDF_FAUTIF]);
    expect(texte()).toMatch(/BR-CO-15/);
    expect(texte()).toMatch(/totals\.taxInclusiveAmount/);
  });

  it('dit clairement qu’un PDF sans Factur-X n’en est pas un', async () => {
    const vide = join(mkdtempSync(join(tmpdir(), 'cli-')), 'vide.pdf');
    writeFileSync(vide, '%PDF-1.4\n%vide\n');
    expect(await main(['validate', vide])).toBe(2);
  });

  it('--json rend un rapport analysable, sans couleur ni décor', async () => {
    expect(await main(['validate', PDF_FAUTIF, '--json'])).toBe(1);
    const rapport = JSON.parse(texte());
    expect(rapport.results).toHaveLength(1);
    expect(rapport.results[0]).toMatchObject({ syntax: 'cii', ok: false });
    expect(rapport.results[0].issues[0]).toMatchObject({
      code: 'BR-CO-15',
      path: 'totals.taxInclusiveAmount',
    });
  });

  it('traite plusieurs fichiers en un seul appel', async () => {
    await main(['validate', CII, UBL, '--json']);
    expect(JSON.parse(texte()).results).toHaveLength(2);
  });
});

describe('info', () => {
  it('résume sans valider — utile sur une facture qu’on sait fautive', async () => {
    expect(await main(['info', PDF_FAUTIF])).toBe(0);
    expect(texte()).toMatch(/urn:cen\.eu:en16931:2017/);
    expect(texte()).toMatch(/Atelier Exemple SAS/);
  });

  it('--json expose les mêmes champs', async () => {
    await main(['info', UBL, '--json']);
    const { files } = JSON.parse(texte());
    expect(files[0]).toMatchObject({ syntax: 'ubl', id: 'F-2026-0001', lines: 1 });
  });
});

describe('extract', () => {
  let dossier: string;
  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cli-extract-'));
  });
  afterEach(() => rmSync(dossier, { recursive: true, force: true }));

  it('écrit le XML embarqué dans un fichier', async () => {
    const cible = join(dossier, 'facture.xml');
    expect(await main(['extract', PDF, '--out', cible])).toBe(0);
    expect(readFileSync(cible, 'utf8')).toMatch(/<rsm:CrossIndustryInvoice/);
  });

  it('refuse un fichier qui n’est pas un PDF', async () => {
    expect(await main(['extract', CII])).toBe(2);
    expect(texteErreur()).toMatch(/n'est pas un PDF/);
  });

  it('refuse plusieurs fichiers : la sortie standard n’en porterait qu’un', async () => {
    expect(await main(['extract', PDF, PDF])).toBe(64);
  });
});
