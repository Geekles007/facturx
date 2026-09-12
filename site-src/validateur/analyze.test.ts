import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type AnalyzeDeps,
  analyze,
  type FailedAssert,
  looksLikePdf,
  type SchematronId,
  severityOf,
  simplifyLocation,
} from './analyze.js';

const golden = (name: string) =>
  readFileSync(new URL(`../../packages/facturx/test/golden/${name}.xml`, import.meta.url), 'utf8');

const bytesOf = (text: string) => new TextEncoder().encode(text);

/** Dépendances neutres : aucun PDF, aucun schematron en échec. */
const deps = (overrides: Partial<AnalyzeDeps> = {}): AnalyzeDeps => ({
  extractPdf: async () => undefined,
  runSchematron: async () => [],
  ...overrides,
});

const failures =
  (byJudge: Partial<Record<SchematronId, FailedAssert[]>>) =>
  async (id: SchematronId): Promise<FailedAssert[]> =>
    byJudge[id] ?? [];

describe('détection du type de fichier', () => {
  it('reconnaît un PDF à sa signature, pas à son extension', () => {
    expect(looksLikePdf(bytesOf('%PDF-1.7\n…'))).toBe(true);
    expect(looksLikePdf(bytesOf('<?xml version="1.0"?>'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('analyse d’un XML CII', () => {
  it('rend un verdict conforme quand les quatre juges se taisent', async () => {
    const report = await analyze(
      { filename: 'simple.xml', bytes: bytesOf(golden('simple')) },
      deps(),
    );
    expect(report.error).toBeUndefined();
    expect(report.source).toMatchObject({ kind: 'xml', filename: 'simple.xml' });
    expect(report.document.guidelineId).toBe('urn:cen.eu:en16931:2017');
    expect(report.document.businessProcessId).toBe('S1');
    expect(report.judges.map((j) => j.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(report.ok).toBe(true);
  });

  it('signale les anomalies du SDK avec leur code et le chemin du champ', async () => {
    const broken = golden('simple').replace(
      '<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>242.00</ram:GrandTotalAmount>',
    );
    const report = await analyze({ filename: 'faux.xml', bytes: bytesOf(broken) }, deps());
    const sdk = report.judges[0];
    expect(sdk?.status).toBe('failed');
    expect(sdk?.findings).toContainEqual(
      expect.objectContaining({ code: 'BR-CO-15', path: 'totals.taxInclusiveAmount' }),
    );
    expect(report.ok).toBe(false);
  });

  it('refuse un document qui n’est pas du CII, sans lancer les juges', async () => {
    const report = await analyze(
      { filename: 'autre.xml', bytes: bytesOf('<?xml version="1.0"?><note/>') },
      deps(),
    );
    expect(report.error?.code).toBe('NOT_CII');
    expect(report.judges).toHaveLength(0);
    expect(report.ok).toBe(false);
  });
});

describe('analyse d’un PDF', () => {
  it('lit le XML embarqué et retient le nom de la pièce jointe', async () => {
    const report = await analyze(
      { filename: 'facture.pdf', bytes: bytesOf('%PDF-1.7 …') },
      deps({
        extractPdf: async () => ({
          xml: golden('simple'),
          filename: 'factur-x.xml',
          conformanceLevel: 'EN 16931',
        }),
      }),
    );
    expect(report.source.kind).toBe('pdf');
    expect(report.document.attachmentName).toBe('factur-x.xml');
    expect(report.document.conformanceLevel).toBe('EN 16931');
    expect(report.ok).toBe(true);
  });

  it('explique qu’un PDF ordinaire ne contient pas de facture', async () => {
    const report = await analyze({ filename: 'scan.pdf', bytes: bytesOf('%PDF-1.4 …') }, deps());
    expect(report.error?.code).toBe('NO_FACTURX');
  });

  it('remonte une erreur typée du moteur PDF', async () => {
    const report = await analyze(
      { filename: 'casse.pdf', bytes: bytesOf('%PDF-1.4 …') },
      deps({
        extractPdf: async () => {
          throw Object.assign(new Error('Structure PDF inattendue'), { code: 'INVALID_PDF' });
        },
      }),
    );
    expect(report.error).toMatchObject({ code: 'INVALID_PDF' });
  });
});

describe('sévérité et tolérances', () => {
  const assert450 = (flag: string): FailedAssert => ({
    id: 'CII-SR-450',
    flag,
    text: 'Only one buyer identifier should be present',
  });

  it('tolère les trois avertissements documentés, jamais un fatal', () => {
    expect(severityOf(assert450('warning'))).toBe('tolerated');
    expect(severityOf(assert450('fatal'))).toBe('fatal');
    expect(severityOf({ id: 'BR-CO-15', flag: 'fatal', text: '' })).toBe('fatal');
    expect(severityOf({ id: 'BR-FR-12', flag: 'warning', text: '' })).toBe('warning');
  });

  it('laisse un juge conforme quand il ne reste que des tolérances, avec leur raison', async () => {
    const report = await analyze(
      { filename: 'simple.xml', bytes: bytesOf(golden('simple')) },
      deps({ runSchematron: failures({ cen: [assert450('warning')] }) }),
    );
    const cen = report.judges.find((j) => j.id === 'cen');
    expect(cen?.status).toBe('ok');
    expect(cen?.findings[0]).toMatchObject({ severity: 'tolerated' });
    expect(cen?.findings[0]?.reason).toMatch(/SIRET/);
    expect(report.ok).toBe(true);
  });

  it('bloque sur un avertissement non toléré', async () => {
    const report = await analyze(
      { filename: 'simple.xml', bytes: bytesOf(golden('simple')) },
      deps({
        runSchematron: failures({
          brfr: [{ id: 'BR-FR-12_BT-49', flag: 'warning', text: 'adresse électronique absente' }],
        }),
      }),
    );
    expect(report.judges.find((j) => j.id === 'brfr')?.status).toBe('failed');
    expect(report.ok).toBe(false);
  });
});

describe('juge indisponible', () => {
  it('n’annonce pas la conformité quand un jeu de règles n’a pas pu s’exécuter', async () => {
    const report = await analyze(
      { filename: 'simple.xml', bytes: bytesOf(golden('simple')) },
      deps({
        runSchematron: async (id) => {
          if (id === 'facturx') throw new Error('moteur XSLT introuvable');
          return [];
        },
      }),
    );
    const judge = report.judges.find((j) => j.id === 'facturx');
    expect(judge?.status).toBe('skipped');
    expect(judge?.note).toBe('moteur XSLT introuvable');
    expect(report.ok).toBe(false);
  });
});

describe('simplifyLocation', () => {
  it('réduit le XPath des schematrons à sa forme lisible', () => {
    const raw =
      "/*:CrossIndustryInvoice[namespace-uri()='urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'][1]/*:ExchangedDocument[namespace-uri()='urn:x'][1]";
    expect(simplifyLocation(raw)).toBe('/CrossIndustryInvoice[1]/ExchangedDocument[1]');
  });
});
