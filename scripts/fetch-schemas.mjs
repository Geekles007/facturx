/**
 * Récupère les schémas et schematrons officiels (non versionnés, voir packages/facturx/test/schemas/README.md)
 * à des commits épinglés, et compile les XSLT en SEF pour Saxon-JS :
 *   - les XSD Factur-X et UBL depuis mustangproject (Apache 2.0) ;
 *   - les schematrons, leurs bases de codes, le schéma CDAR et les exemples officiels depuis France_RFE
 *     (FNFE-MPE, Apache 2.0), les artefacts de validation de la réforme.
 *
 *   pnpm schemas:fetch            # ne retélécharge que ce qui manque ou si la liste épinglée a changé
 *   pnpm schemas:fetch --force    # retélécharge tout
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Commit de ZUGFeRD/mustangproject dont proviennent les XSD. */
export const MUSTANG_COMMIT = 'abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3';
const BASE = `https://raw.githubusercontent.com/ZUGFeRD/mustangproject/${MUSTANG_COMMIT}/validator/src/main/resources`;

const FILES = [
  // XSD Factur-X EN 16931 (test/xsd.test.ts, xmllint)
  'schema/ZF_250/EN16931/FACTUR-X_EN16931.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
  'schema/ZF_250/EN16931/FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
  // XSD UBL 2.1 : l'autre syntaxe du socle (test/ubl-read.test.ts, xmllint).
  // maindoc/ puis common/ — le schéma racine importe les composants communs par chemin relatif,
  // donc les noms de fichiers sont conservés tels quels dans test/schemas/ubl/.
  'schema/UBL_21/maindoc/UBL-Invoice-2.1.xsd',
  'schema/UBL_21/maindoc/UBL-CreditNote-2.1.xsd',
  'schema/UBL_21/common/CCTS_CCT_SchemaModule-2.1.xsd',
  'schema/UBL_21/common/UBL-CommonAggregateComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-CommonBasicComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-CommonExtensionComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-CommonSignatureComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-CoreComponentParameters-2.1.xsd',
  'schema/UBL_21/common/UBL-ExtensionContentDataType-2.1.xsd',
  'schema/UBL_21/common/UBL-QualifiedDataTypes-2.1.xsd',
  'schema/UBL_21/common/UBL-SignatureAggregateComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-SignatureBasicComponents-2.1.xsd',
  'schema/UBL_21/common/UBL-UnqualifiedDataTypes-2.1.xsd',
  'schema/UBL_21/common/UBL-XAdESv132-2.1.xsd',
  'schema/UBL_21/common/UBL-XAdESv141-2.1.xsd',
  'schema/UBL_21/common/UBL-xmldsig-core-schema-2.1.xsd',
];

/**
 * Commit de fnfempe/France_RFE (Apache 2.0) : le tag v1.4.0.04, conforme à la V1.4.0 de la norme
 * XP Z12-012. Le FNFE-MPE y publie les artefacts de validation de la réforme, profil par profil.
 *
 * Le message de cycle de vie (flux 6) repose sur le CDAR d'UN/CEFACT — Cross Domain Acknowledgement
 * and Response, D22B — et non sur un schéma français : le paquet DGFiP ne le contient donc pas.
 * L'UNECE refusant tout téléchargement automatisé (403), on passe par le miroir du FNFE-MPE.
 */
export const FNFE_COMMIT = '97ba0f3d4ef2abed5780e9490d5c3a2be832ab1d';
/** Le tag de ce commit : il nomme le dossier des jeux de règles publiés par le validateur en ligne. */
export const FNFE_TAG = 'v1.4.0.04';
const FNFE_BASE = `https://raw.githubusercontent.com/fnfempe/France_RFE/${FNFE_COMMIT}/FNFE_RFE_INVOICE`;
const CDAR_BASE = `${FNFE_BASE}/CDAR/1xsd-CDAR_D22B_uncoupled`;

/**
 * Schematrons compilés en XSLT et bases de codes qu'ils chargent par `document()` (test/schematron.test.ts,
 * validateur en ligne). Le schematron BR-FR est le même dans chaque dossier de profil : on n'en prend
 * qu'un. Sa variante `_WARNING`, qui rétrograde la plupart des règles en avertissements, n'est pas
 * retenue : le verdict n'en dépendrait pas, seul le libellé de gravité changerait.
 */
const RULE_FILES = [
  'CII/EN16931/2xslt/EN16931-CII-validation.xslt',
  'UBL/EN16931/2xslt/EN16931-UBL-validation.xslt',
  'CII/EN16931/2xslt/BR-FR-Flux2-Schematron-CII.xslt',
  'CII/EXTENDED-CTC-FR/2xslt/EXTENDED-CTC-FR-CII.xslt',
  'Factur-X/EN16931/2xslt/FACTUR-X_EN16931.xslt',
  'Factur-X/EN16931/schematron/FACTUR-X_EN16931_codedb.xml',
  'Factur-X/BASICWL/2xslt/FACTUR-X_BASIC-WL.xslt',
  'Factur-X/BASICWL/schematron/FACTUR-X_BASIC-WL_codedb.xml',
  'Factur-X/EXTENDED/2xslt/FACTUR-X_EXTENDED.xslt',
  'Factur-X/EXTENDED/schematron/FACTUR-X_EXTENDED_codedb.xml',
];

/**
 * Exemples officiels, rangés par profil (validateur en ligne : site-src/validateur/official.test.ts).
 * Les exemples Factur-X EN 16931 sont les mêmes octets que leurs jumeaux CII : on ne les reprend pas.
 * Copiés sous test/schemas/exemples/, en gardant le chemin qui suit `Z.example/TEST/`.
 */
const EXAMPLE_FILES = [
  ...[
    'UC1_F202500003_00-INV_20250701',
    'UC2_F202500004_00-INV_20250701',
    'UC3_F202500005_00-INV_20250701',
    'UC4_F202500006_00-INV_20250701',
    'UC4b_F202500010_00-INVCORR_20250702',
    'UC5_F202500007_00-INV_20250702',
    'UC13_AUTOF202600028',
    'UC13_F202600037',
  ].map((n) => `CII/EN16931/${n}_EN16931_FX_CII_Commentee.xml`),
  ...[
    'UC10_F202600004_MULTI-VENDEUR',
    'UC11_F202600022_MULTI-VENDEUR',
    'UC12_F202600025_SOUS-LIGNE',
    'UC13_AUTOF202600035_BIDIRECTIONNELLE',
    'UC13_F202600037',
  ].map((n) => `CII/EXTENDED-CTC-FR/${n}_EXTENDED-CTC-FR_CII_Commentee.xml`),
  ...['F20260023', 'F20260024'].map(
    (n) => `FX/BASICWL/Facture_${n}-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX_CII_Commentee.xml`,
  ),
  ...[
    'UC10_F202600004_MULTI-VENDEUR',
    'UC11_F202600022_MULTI-VENDEUR',
    'UC12_F202600025_SOUS-LIGNE',
    'UC13_AUTOF202600035_BIDIRECTIONNELLE',
    'UC13_F202600037',
  ].map((n) => `FX/EXTENDED/${n}_EXTENDED_FX_CII_Commentee.xml`),
];

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

/** XSLT à compiler en SEF, avec le nom du jeu de règles et la base de codes qu'il charge. */
export const SCHEMATRONS = [
  {
    name: 'EN 16931 (CEN)',
    xslt: 'EN16931-CII-validation.xslt',
    sef: 'EN16931-CII-validation.sef.json',
  },
  {
    name: 'EN 16931 UBL (CEN)',
    xslt: 'EN16931-UBL-validation.xslt',
    sef: 'EN16931-UBL-validation.sef.json',
  },
  {
    name: 'Factur-X EN 16931',
    xslt: 'FACTUR-X_EN16931.xslt',
    sef: 'FACTUR-X_EN16931.sef.json',
    codedb: 'FACTUR-X_EN16931_codedb.xml',
  },
  {
    name: 'Factur-X BASIC WL',
    xslt: 'FACTUR-X_BASIC-WL.xslt',
    sef: 'FACTUR-X_BASIC-WL.sef.json',
    codedb: 'FACTUR-X_BASIC-WL_codedb.xml',
  },
  {
    name: 'Factur-X EXTENDED',
    xslt: 'FACTUR-X_EXTENDED.xslt',
    sef: 'FACTUR-X_EXTENDED.sef.json',
    codedb: 'FACTUR-X_EXTENDED_codedb.xml',
  },
  {
    name: 'EXTENDED-CTC-FR',
    xslt: 'EXTENDED-CTC-FR-CII.xslt',
    sef: 'EXTENDED-CTC-FR-CII.sef.json',
  },
  {
    name: 'BR-FR (XP Z12-012)',
    xslt: 'BR-FR-Flux2-Schematron-CII.xslt',
    sef: 'BR-FR-Flux2-CII.sef.json',
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const schemasDir = join(root, 'packages', 'facturx', 'test', 'schemas');
const marker = join(schemasDir, '.empreinte');
const force = process.argv.includes('--force');

/**
 * Empreinte de ce que le dossier doit contenir : un commit ou une liste qui change invalide tout,
 * y compris un fichier de même nom venu d'une autre source ou un SEF compilé d'une ancienne version.
 */
const fingerprint = createHash('sha256')
  .update(
    JSON.stringify([
      MUSTANG_COMMIT,
      FNFE_COMMIT,
      FILES,
      CDAR_FILES,
      RULE_FILES,
      EXAMPLE_FILES,
      SCHEMATRONS,
    ]),
  )
  .digest('hex')
  .slice(0, 16);

/**
 * `fetch` qui reprend une erreur passagère — coupure réseau ou statut 5xx, que raw.githubusercontent.com
 * renvoie parfois — jusqu'à trois essais, avec une attente croissante. Un autre statut d'échec (404 :
 * chemin faux) est définitif et lève tout de suite.
 */
export async function fetchWithRetry(
  url,
  { attempts = 3, delayMs = 1000, fetchImpl = fetch } = {},
) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    const res = await fetchImpl(url).catch((error) => {
      failure = error; // coupure réseau : passagère
      return undefined;
    });
    if (res?.ok) return res;
    if (res) {
      failure = new Error(`${res.status} ${url}`);
      if (res.status < 500) throw failure;
    }
    if (attempt >= attempts) throw failure;
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
}

/** Télécharge `url` vers `target`, sauf si le fichier est déjà là et à jour. */
async function download(url, target, stale, label) {
  if (!stale && existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  const res = await fetchWithRetry(url);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`↓ ${label}`);
}

async function main() {
  mkdirSync(schemasDir, { recursive: true });
  const stale = force || !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== fingerprint;
  for (const path of FILES) {
    // Les fichiers UBL conservent leur sous-dossier (maindoc/ ou common/) : le schéma racine
    // importe ses voisins par « ../common/… », aplatir casserait la résolution.
    const ubl = path.match(/\/UBL_21\/(maindoc|common)\//);
    const name = path.split('/').pop();
    const target = ubl ? join(schemasDir, 'ubl', ubl[1], name) : join(schemasDir, name);
    await download(`${BASE}/${path}`, target, stale, name);
  }
  for (const name of CDAR_FILES) {
    await download(`${CDAR_BASE}/${name}`, join(schemasDir, name), stale, `${name.slice(0, 60)}…`);
  }
  for (const path of RULE_FILES) {
    const name = path.split('/').pop();
    await download(`${FNFE_BASE}/${path}`, join(schemasDir, name), stale, name);
  }
  for (const path of EXAMPLE_FILES) {
    const target = join(schemasDir, 'exemples', path);
    await download(`${FNFE_BASE}/Z.example/TEST/${path}`, target, stale, `exemples/${path}`);
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
  writeFileSync(marker, `${fingerprint}\n`);
  console.log(
    `✓ schémas et schematrons prêts (mustangproject@${MUSTANG_COMMIT.slice(0, 7)}, France_RFE@${FNFE_COMMIT.slice(0, 7)})`,
  );
}

// Exécuté directement : on télécharge. Importé (fetch-validator-assets.mjs) : on n'expose que les métadonnées.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
