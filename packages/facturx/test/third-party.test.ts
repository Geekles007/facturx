import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FacturXParseError,
  parseCiiDocument,
  parseXml,
  readCiiGuideline,
  toCiiXml,
  type XmlNode,
} from '../src/index.js';
import { extractFacturX } from '../src/pdf/index.js';
import {
  blockingFailures,
  describeFailures,
  runSchematron,
  schemasDir,
  schematronsAvailable,
} from './helpers/schematron.js';

/**
 * Fichiers produits par d'autres outils (`pnpm samples:fetch`, git-ignorés) :
 *   - lecture : parseCiiDocument / extractFacturX réussissent, la guideline est reconnue ;
 *   - fidélité : identifiant, nombre de lignes et totaux lus dans le XML source = ceux du modèle ;
 *   - ré-émission (EN 16931 seulement) : toCiiXml(invoice) passe le XSD et le schematron CEN ;
 *   - perte : tout chemin d'élément présent dans la source et absent à la ré-émission fait échouer,
 *     sauf s'il figure dans LOST_ALLOWED (éléments hors modèle, motivés).
 */
const samplesDir = new URL('./samples/', import.meta.url).pathname;

/** Éléments EN 16931 / CII que le modèle ne porte pas (volontairement, voir docs/decisions.md D48). */
const LOST_ALLOWED: readonly RegExp[] = [
  /\/SellerTaxRepresentativeTradeParty(\/|$)/, // BG-11 représentant fiscal
  /\/ApplicableTradeSettlementFinancialCard(\/|$)/, // BG-18 carte de paiement
  /\/ApplicableProductCharacteristic(\/|$)/, // BG-32 caractéristiques article
  /\/DesignatedProductClassification(\/|$)/, // BT-158 classification article
  /\/TaxCurrencyCode$/, // BT-6 devise de TVA
  /\/SpecifiedLineTradeSettlement\/AdditionalReferencedDocument(\/|$)/, // BT-128 référence objet de ligne
];

interface Sample {
  file: string;
  xml: string;
}

function collectSamples(): Sample[] {
  if (!existsSync(samplesDir)) return [];
  const out: Sample[] = [];
  for (const source of readdirSync(samplesDir)) {
    const dir = join(samplesDir, source);
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.xml'))
        out.push({ file: `${source}/${file}`, xml: readFileSync(join(dir, file), 'utf8') });
    }
  }
  return out;
}

async function collectPdfSamples(): Promise<Sample[]> {
  if (!existsSync(samplesDir)) return [];
  const out: Sample[] = [];
  for (const source of readdirSync(samplesDir)) {
    const dir = join(samplesDir, source);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.pdf')) continue;
      const found = await extractFacturX(readFileSync(join(dir, file)));
      expect(found, `${source}/${file} : aucun Factur-X extrait`).toBeDefined();
      out.push({ file: `${source}/${file}`, xml: found?.xml ?? '' });
    }
  }
  return out;
}

/** Un élément « signifiant » porte du texte non vide, un attribut, ou un descendant signifiant : les balises vides sont ignorées. */
function meaningful(node: XmlNode): boolean {
  return (
    node.text.trim() !== '' || Object.keys(node.attrs).length > 0 || node.children.some(meaningful)
  );
}

/** Chemins d'éléments signifiants (noms locaux, sans indices) présents dans un arbre. */
function elementPaths(node: XmlNode, prefix = ''): Set<string> {
  const path = `${prefix}/${node.local}`;
  const out = new Set<string>();
  if (meaningful(node)) out.add(path);
  for (const child of node.children) for (const p of elementPaths(child, path)) out.add(p);
  return out;
}

const firstText = (xml: string, tag: string, from = 0): string | undefined =>
  new RegExp(`<ram:${tag}[^>]*>([^<]*)</ram:${tag}>`).exec(xml.slice(from))?.[1]?.trim();

const isEn16931 = (guidelineId: string) =>
  /en16931:2017$/.test(guidelineId) || /en16931:2017#compliant#/.test(guidelineId);

function checkSample({ file, xml }: Sample): void {
  const { guidelineId } = readCiiGuideline(xml);
  expect(guidelineId, file).toBeTruthy();

  if (!isEn16931(guidelineId)) {
    // Profils MINIMUM / BASIC / EXTENDED : lecture seule — le parseur réussit ou signale une erreur typée avec chemin
    try {
      parseCiiDocument(xml);
    } catch (error) {
      expect(error, `${file} : erreur non typée`).toBeInstanceOf(FacturXParseError);
      expect((error as FacturXParseError).path, file).toBeTruthy();
    }
    return;
  }

  const { invoice } = parseCiiDocument(xml);

  // Fidélité : ce que dit la source, tel quel
  const docStart = xml.indexOf('<rsm:ExchangedDocument>');
  expect(invoice.id, `${file} : BT-1`).toBe(firstText(xml, 'ID', docStart));
  expect(invoice.lines.length, `${file} : nombre de lignes`).toBe(
    (xml.match(/<ram:IncludedSupplyChainTradeLineItem>/g) ?? []).length,
  );
  for (const [tag, key] of [
    ['LineTotalAmount', 'lineTotalAmount'],
    ['TaxBasisTotalAmount', 'taxExclusiveAmount'],
    ['TaxTotalAmount', 'taxTotalAmount'],
    ['GrandTotalAmount', 'taxInclusiveAmount'],
    ['DuePayableAmount', 'amountDueForPayment'],
  ] as const) {
    const summation = xml.indexOf('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>');
    const raw = firstText(xml, tag, summation);
    if (raw === undefined) continue;
    expect(Math.round(Number(raw) * 100), `${file} : ${tag}`).toBe(invoice.totals[key]);
  }

  // Ré-émission : XSD, et aucune assertion CEN nouvelle par rapport à la source elle-même
  const emitted = toCiiXml(invoice, { validate: false });
  const dir = mkdtempSync(join(tmpdir(), 'facturx-3p-'));
  const out = join(dir, 'reemitted.xml');
  writeFileSync(out, emitted);
  const xsd = join(schemasDir, 'FACTUR-X_EN16931.xsd');
  if (existsSync(xsd)) {
    expect(
      () =>
        execFileSync('xmllint', ['--noout', '--schema', xsd, out], {
          stdio: ['ignore', 'ignore', 'pipe'],
        }),
      `${file} : XSD`,
    ).not.toThrow();
  }
  if (schematronsAvailable()) {
    const sef = join(schemasDir, 'EN16931-CII-validation.sef.json');
    const baseline = new Set(runSchematron(sef, xml).map((f) => f.id));
    const introduced = blockingFailures(runSchematron(sef, emitted)).filter(
      (f) => !baseline.has(f.id),
    );
    expect(
      introduced,
      `${file} : la ré-émission introduit des violations EN 16931 absentes de la source\n${describeFailures(introduced)}`,
    ).toEqual([]);
  }

  // Perte d'information : éléments signifiants présents dans la source, absents à la ré-émission
  const emittedPaths = elementPaths(parseXml(emitted));
  const lost = [...elementPaths(parseXml(xml))].filter(
    (p) => !emittedPaths.has(p) && !LOST_ALLOWED.some((re) => re.test(p)),
  );
  expect(
    lost,
    `${file} : éléments perdus à la relecture\n${lost.map((p) => `  - ${p}`).join('\n')}`,
  ).toEqual([]);
}

const samples = collectSamples();

describe.skipIf(samples.length === 0)('fichiers tiers', () => {
  it.each(samples.map((s) => [s.file, s] as const))(
    '%s',
    (_name, sample) => checkSample(sample),
    60_000,
  );

  it('PDF Factur-X tiers : extraction puis mêmes contrôles', async () => {
    const pdfs = await collectPdfSamples();
    expect(pdfs.length).toBeGreaterThan(0);
    for (const sample of pdfs) checkSample(sample);
  }, 300_000);
});
