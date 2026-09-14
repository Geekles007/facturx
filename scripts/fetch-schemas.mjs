/**
 * Récupère les schémas et schematrons officiels (non versionnés, voir packages/facturx/test/schemas/README.md)
 * depuis le dépôt mustangproject (Apache 2.0) à un commit épinglé, et compile les XSLT en SEF pour Saxon-JS.
 *
 *   pnpm schemas:fetch            # ne retélécharge que ce qui manque ou si le commit épinglé a changé
 *   pnpm schemas:fetch --force    # retélécharge tout
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Commit de ZUGFeRD/mustangproject dont proviennent les fichiers. */
export const MUSTANG_COMMIT = 'abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3';
const BASE = `https://raw.githubusercontent.com/ZUGFeRD/mustangproject/${MUSTANG_COMMIT}/validator/src/main/resources`;

const FILES = [
  // XSD Factur-X EN 16931 (test/xsd.test.ts, xmllint)
  'schema/ZF_250/EN16931/FACTUR-X_EN16931.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
  // Schematrons compilés en XSLT (test/schematron.test.ts, Saxon-JS)
  'xslt/en16931schematron/EN16931-CII-validation.xslt',
  'xslt/ZF_250/FACTUR-X_EN16931.xslt',
  'xslt/ZF_250/FACTUR-X_EN16931_codedb.xml',
  'xslt/XP_Z12_012/20260216_BR-FR-Flux2-Schematron-CII_V1.3.0.xsl',
];

/**
 * Commit de fnfempe/France_RFE (Apache 2.0) dont provient le schéma CDAR.
 *
 * Le message de cycle de vie (flux 6) repose sur le CDAR d'UN/CEFACT — Cross Domain Acknowledgement
 * and Response, D22B — et non sur un schéma français : le paquet DGFiP ne le contient donc pas.
 * L'UNECE refusant tout téléchargement automatisé (403), on passe par le miroir du FNFE-MPE,
 * la même source que les XSD Factur-X.
 */
export const FNFE_COMMIT = '97ba0f3d4ef2abed5780e9490d5c3a2be832ab1d';
const CDAR_BASE = `https://raw.githubusercontent.com/fnfempe/France_RFE/${FNFE_COMMIT}/FNFE_RFE_INVOICE/CDAR/1xsd-CDAR_D22B_uncoupled`;

/** Schéma CDAR D22B « uncoupled » : la racine et tout ce qu'elle importe (test/cdar.test.ts, xmllint). */
const CDAR_FILES = [
  'CrossDomainAcknowledgementAndResponse_100pD22B.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_ContactFunctionCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_DocumentNameCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_DocumentStatusCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_MessageFunctionCode_Acknowledgement_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_PartyRoleCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_ReferenceTypeCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_StatusCode_D22A.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_codelist_standard_UNECE_TimePointFormatCode_D21B.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
];

/** XSLT à compiler en SEF, avec le nom du jeu de règles. */
export const SCHEMATRONS = [
  {
    name: 'EN 16931 (CEN)',
    xslt: 'EN16931-CII-validation.xslt',
    sef: 'EN16931-CII-validation.sef.json',
  },
  { name: 'Factur-X EN 16931', xslt: 'FACTUR-X_EN16931.xslt', sef: 'FACTUR-X_EN16931.sef.json' },
  {
    name: 'BR-FR (XP Z12-012)',
    xslt: '20260216_BR-FR-Flux2-Schematron-CII_V1.3.0.xsl',
    sef: 'BR-FR-Flux2-CII.sef.json',
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const schemasDir = join(root, 'packages', 'facturx', 'test', 'schemas');
const marker = join(schemasDir, '.mustang-commit');
const force = process.argv.includes('--force');

async function main() {
  mkdirSync(schemasDir, { recursive: true });
  const stale =
    force ||
    !existsSync(marker) ||
    readFileSync(marker, 'utf8').trim() !== `${MUSTANG_COMMIT} ${FNFE_COMMIT}`;
  for (const path of FILES) {
    const target = join(schemasDir, path.split('/').pop());
    if (!stale && existsSync(target)) continue;
    const res = await fetch(`${BASE}/${path}`);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`↓ ${path.split('/').pop()}`);
  }
  for (const name of CDAR_FILES) {
    const target = join(schemasDir, name);
    if (!stale && existsSync(target)) continue;
    const res = await fetch(`${CDAR_BASE}/${name}`);
    if (!res.ok) throw new Error(`${res.status} ${name}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`↓ ${name.slice(0, 60)}…`);
  }

  const xslt3 = join(root, 'packages', 'facturx', 'node_modules', '.bin', 'xslt3');
  for (const s of SCHEMATRONS) {
    const sef = join(schemasDir, s.sef);
    if (!stale && existsSync(sef)) continue;
    execFileSync(
      xslt3,
      [`-xsl:${join(schemasDir, s.xslt)}`, `-export:${sef}`, '-nogo', '-relocate:on'],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    console.log(`⚙ ${s.sef}`);
  }
  writeFileSync(marker, `${MUSTANG_COMMIT} ${FNFE_COMMIT}\n`);
  console.log(`✓ schémas et schematrons prêts (mustangproject@${MUSTANG_COMMIT.slice(0, 7)})`);
}

// Exécuté directement : on télécharge. Importé (fetch-validator-assets.mjs) : on n'expose que les métadonnées.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
