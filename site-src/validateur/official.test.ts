import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, type ProfileId, type SchematronId } from './analyze.js';
import { parseSvrl, SEF_FILES } from './schematron.js';

/**
 * Les exemples officiels de France_RFE (`pnpm schemas:fetch`, git-ignorés), jugés par le vrai
 * validateur avec les vrais schematrons compilés — ceux que sert le site. Chaque exemple doit être
 * reconnu sous le profil de son dossier et accepté par les jeux de règles de ce profil : c'est ce qui
 * prouve qu'un fichier EXTENDED-CTC-FR conforme n'est plus jugé par les règles EN 16931.
 * Ignoré si les fichiers manquent ; la CI les récupère avant de lancer ces tests.
 */
const schemasDir = new URL('../../packages/facturx/test/schemas/', import.meta.url).pathname;
const examplesDir = join(schemasDir, 'exemples');

interface SaxonNode {
  transform(
    options: { stylesheetFileName: string; sourceText: string; destination: 'serialized' },
    mode: 'sync',
  ): { principalResult: string };
}
const saxon = createRequire(new URL('../../packages/facturx/package.json', import.meta.url))(
  'saxon-js',
) as SaxonNode;

const runSchematron = async (id: SchematronId, xml: string) =>
  parseSvrl(
    saxon.transform(
      {
        stylesheetFileName: join(schemasDir, SEF_FILES[id]),
        sourceText: xml,
        destination: 'serialized',
      },
      'sync',
    ).principalResult,
  );

/** Dossier de France_RFE → profil attendu. */
const FOLDERS: Record<string, ProfileId> = {
  'CII/EN16931': 'en16931',
  'CII/EXTENDED-CTC-FR': 'extended-ctc-fr',
  'FX/BASICWL': 'basicwl',
  'FX/EXTENDED': 'extended',
};

const examples = Object.entries(FOLDERS).flatMap(([folder, profile]) => {
  const dir = join(examplesDir, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.xml'))
    .map((file) => ({ name: `${folder}/${file}`, path: join(dir, file), profile }));
});

const available =
  examples.length > 0 && Object.values(SEF_FILES).every((sef) => existsSync(join(schemasDir, sef)));

describe.skipIf(!available)('exemples officiels de France_RFE', () => {
  it('couvrent les quatre profils', () => {
    expect(new Set(examples.map((e) => e.profile))).toEqual(
      new Set(['en16931', 'extended-ctc-fr', 'basicwl', 'extended']),
    );
  });

  it.each(examples)(
    '$name : accepté par les jeux de règles de son profil',
    async ({ path, profile }) => {
      const bytes = readFileSync(path);
      const report = await analyze(
        { filename: 'exemple.xml', bytes },
        { extractPdf: async () => undefined, runSchematron },
      );
      expect(report.profile?.id).toBe(profile);
      const schematrons = report.judges.filter((j) => j.id !== 'sdk');
      expect(schematrons.length).toBeGreaterThan(0);
      for (const judge of schematrons) {
        const blocking = judge.findings.filter((f) => f.severity !== 'tolerated');
        expect(blocking, `${judge.name} : ${blocking.map((f) => f.code).join(', ')}`).toEqual([]);
      }
    },
    60_000,
  );

  /**
   * Ce que le SDK relève dans les exemples EN 16931, au-delà des schematrons : uniquement leurs
   * données fictives. Une règle du SDK plus stricte que la chaîne officielle apparaîtrait ici —
   * c'est ainsi qu'on a vu BR-FR-14 refuser une adresse de livraison sur une prestation (D66).
   */
  const FICTITIOUS = new Set([
    'FORMAT-BIC', // « BIC_MONCOMPTE »
    'FORMAT-VAT-ID', // « FR37288100000008 » : quatorze chiffres au lieu de onze
  ]);

  it.each(examples.filter((e) => e.profile === 'en16931'))(
    '$name : le SDK n’y relève que des données fictives',
    async ({ path }) => {
      const report = await analyze(
        { filename: 'exemple.xml', bytes: readFileSync(path) },
        { extractPdf: async () => undefined, runSchematron: async () => [] },
      );
      const sdk = report.judges.find((j) => j.id === 'sdk');
      expect(sdk?.findings.map((f) => f.code).filter((code) => !FICTITIOUS.has(code))).toEqual([]);
    },
  );

  it('sous les règles EN 16931, un EXTENDED-CTC-FR conforme récolterait BR-26', async () => {
    const xml = readFileSync(
      join(
        examplesDir,
        'CII/EXTENDED-CTC-FR/UC12_F202600025_SOUS-LIGNE_EXTENDED-CTC-FR_CII_Commentee.xml',
      ),
      'utf8',
    );
    const codes = (await runSchematron('cen', xml)).map((f) => f.id);
    expect(codes).toContain('BR-26');
    expect(await runSchematron('extended-ctc-fr', xml)).toEqual([]);
  }, 60_000);
});
