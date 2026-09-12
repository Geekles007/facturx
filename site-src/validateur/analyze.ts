/**
 * Orchestration du validateur en ligne : un fichier en entrée, un rapport par juge en sortie.
 *
 * Aucune dépendance au DOM ni au réseau : l'extraction PDF et l'exécution des schematrons sont
 * injectées, ce qui rend cette logique testable en Node et remplaçable côté serveur.
 */
import {
  FacturXParseError,
  fromCiiXml,
  type Issue,
  readCiiGuideline,
  validateInvoice,
} from 'facturx-sdk';

/** Identifiants des jeux de règles, dans l'ordre d'affichage. */
export const JUDGES = [
  { id: 'sdk', name: 'facturx-sdk', detail: 'modèle EN 16931 et règles françaises' },
  { id: 'cen', name: 'EN 16931 (CEN)', detail: 'schematron officiel CII' },
  { id: 'facturx', name: 'Factur-X EN 16931', detail: 'schematron du profil 1.09' },
  { id: 'brfr', name: 'BR-FR (XP Z12-012)', detail: 'schematron Flux 2 V1.3.0' },
] as const;

export type JudgeId = (typeof JUDGES)[number]['id'];
export type SchematronId = Exclude<JudgeId, 'sdk'>;

/**
 * Avertissements tolérés, avec la raison : identiques à ceux de la CI du SDK
 * (voir packages/facturx/test/helpers/schematron.ts). Jamais appliqué à un `fatal`.
 */
export const TOLERATED: Record<string, string> = {
  'PEPPOL-EN16931-R008':
    'règle PEPPOL : ram:ApplicableHeaderTradeDelivery est obligatoire dans le XSD Factur-X même sans information de livraison',
  'CII-SR-450':
    'la norme française porte le SIRET en GlobalID 0009 et le code de routage en ID 0224 : les deux coexistent (BR-FR-09/24)',
  'CII-SR-475':
    'BR-FR-17 qualifie chaque pièce jointe par sa description, ce qui suppose une description par pièce',
};

export type Severity = 'fatal' | 'warning' | 'tolerated';

export interface Finding {
  code: string;
  message: string;
  /** Chemin du champ (`totals.taxInclusiveAmount`) ou expression du schematron. */
  path?: string | undefined;
  severity: Severity;
  /** Raison de la tolérance, quand la sévérité vaut `tolerated`. */
  reason?: string | undefined;
}

export interface JudgeReport {
  id: JudgeId;
  name: string;
  detail: string;
  status: 'ok' | 'failed' | 'skipped';
  /** Pourquoi ce juge n'a pas pu se prononcer. */
  note?: string | undefined;
  findings: Finding[];
}

export interface DocumentInfo {
  /** BT-24 — identifiant de guideline lu dans le XML. */
  guidelineId?: string | undefined;
  /** BT-23 — cadre de facturation, s'il est présent. */
  businessProcessId?: string | undefined;
  /** Nom de la pièce jointe XML dans le PDF. */
  attachmentName?: string | undefined;
  /** `fx:ConformanceLevel` lu dans le XMP du PDF. */
  conformanceLevel?: string | undefined;
}

export interface AnalysisReport {
  source: { kind: 'pdf' | 'xml'; filename: string; bytes: number };
  document: DocumentInfo;
  judges: JudgeReport[];
  /** Vrai seulement si les quatre juges se sont prononcés sans relever d'anomalie bloquante. */
  ok: boolean;
  /** Échec avant toute analyse (PDF illisible, XML absent ou hors CII). */
  error?: { code: string; message: string; path?: string | undefined };
}

/** Assertion en échec renvoyée par un schematron (rapport SVRL). */
export interface FailedAssert {
  id?: string | undefined;
  flag?: string | undefined;
  test?: string | undefined;
  location?: string | undefined;
  text: string;
}

export interface AnalyzeDeps {
  /** Extrait le XML Factur-X d'un PDF ; `undefined` si le PDF n'en contient pas. */
  extractPdf: (
    bytes: Uint8Array,
  ) => Promise<{ xml: string; filename: string; conformanceLevel?: string } | undefined>;
  /** Exécute un schematron compilé sur le XML et renvoie les assertions en échec. */
  runSchematron: (id: SchematronId, xml: string) => Promise<FailedAssert[]>;
  /** Appelé entre chaque étape pour informer l'interface. */
  onProgress?: (step: string) => void;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export function looksLikePdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

function judgeMeta(id: JudgeId) {
  const meta = JUDGES.find((j) => j.id === id);
  if (!meta) throw new Error(`juge inconnu : ${id}`);
  return meta;
}

function issueToFinding(issue: Issue): Finding {
  return { code: issue.code, message: issue.message, path: issue.path, severity: 'fatal' };
}

/** Sévérité d'une assertion : une tolérance ne s'applique jamais à un `fatal`. */
export function severityOf(failure: FailedAssert): Severity {
  const reason = failure.id ? TOLERATED[failure.id] : undefined;
  if (reason && failure.flag !== 'fatal') return 'tolerated';
  return failure.flag === 'fatal' ? 'fatal' : 'warning';
}

function failureToFinding(failure: FailedAssert): Finding {
  const severity = severityOf(failure);
  return {
    code: failure.id ?? '(sans identifiant)',
    message: failure.text,
    path: failure.location ? simplifyLocation(failure.location) : failure.test,
    severity,
    reason: severity === 'tolerated' ? TOLERATED[failure.id as string] : undefined,
  };
}

/**
 * Les schematrons localisent l'erreur par un XPath verbeux, chaque étape portant son espace de noms.
 * On le réduit à sa forme lisible : `/CrossIndustryInvoice/SupplyChainTradeTransaction/…`.
 */
export function simplifyLocation(location: string): string {
  return location.replace(/\*:([\w.-]+)\[namespace-uri\(\)='[^']*'\]/g, '$1');
}

const blocking = (findings: Finding[]) => findings.some((f) => f.severity !== 'tolerated');

/** Analyse un fichier Factur-X (PDF ou XML) et renvoie le verdict de chaque juge. */
export async function analyze(
  file: { filename: string; bytes: Uint8Array },
  deps: AnalyzeDeps,
): Promise<AnalysisReport> {
  const kind = looksLikePdf(file.bytes) ? 'pdf' : 'xml';
  const report: AnalysisReport = {
    source: { kind, filename: file.filename, bytes: file.bytes.length },
    document: {},
    judges: [],
    ok: false,
  };
  const fail = (code: string, message: string, path?: string): AnalysisReport => {
    report.error = { code, message, path };
    return report;
  };

  let xml: string;
  if (kind === 'pdf') {
    deps.onProgress?.('Lecture du PDF');
    let extracted: Awaited<ReturnType<AnalyzeDeps['extractPdf']>>;
    try {
      extracted = await deps.extractPdf(file.bytes);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'INVALID_PDF';
      return fail(code, (error as Error).message);
    }
    if (!extracted) {
      return fail(
        'NO_FACTURX',
        "Ce PDF ne contient aucune pièce jointe Factur-X : c'est un PDF ordinaire, pas une facture électronique.",
      );
    }
    xml = extracted.xml;
    report.document.attachmentName = extracted.filename;
    report.document.conformanceLevel = extracted.conformanceLevel;
  } else {
    xml = new TextDecoder('utf-8').decode(file.bytes).replace(/^﻿/, '');
  }

  try {
    const { guidelineId, businessProcessId } = readCiiGuideline(xml);
    report.document.guidelineId = guidelineId;
    report.document.businessProcessId = businessProcessId;
  } catch (error) {
    if (error instanceof FacturXParseError) return fail(error.code, error.message, error.path);
    throw error;
  }

  // Juge 1 — le SDK : lecture en objet typé puis validation complète.
  deps.onProgress?.('Lecture et validation par le SDK');
  const sdk: JudgeReport = { ...judgeMeta('sdk'), status: 'ok', findings: [] };
  try {
    const invoice = fromCiiXml(xml, { validate: false });
    const result = validateInvoice(invoice);
    sdk.findings = result.issues.map(issueToFinding);
    sdk.status = result.ok ? 'ok' : 'failed';
  } catch (error) {
    if (!(error instanceof FacturXParseError)) throw error;
    sdk.status = 'failed';
    sdk.note = "Le SDK n'a pas pu construire une facture typée à partir de ce document.";
    sdk.findings = [
      { code: error.code, message: error.message, path: error.path, severity: 'fatal' },
    ];
  }
  report.judges.push(sdk);

  // Juges 2 à 4 — les schematrons officiels, sur le XML tel quel, même si le SDK a échoué.
  for (const id of ['cen', 'facturx', 'brfr'] as const) {
    const judge: JudgeReport = { ...judgeMeta(id), status: 'ok', findings: [] };
    deps.onProgress?.(`Schematron ${judge.name}`);
    try {
      const failures = await deps.runSchematron(id, xml);
      judge.findings = failures.map(failureToFinding);
      judge.status = blocking(judge.findings) ? 'failed' : 'ok';
    } catch (error) {
      judge.status = 'skipped';
      judge.note = (error as Error).message;
    }
    report.judges.push(judge);
  }

  // Un juge qui n'a pas pu s'exécuter n'est pas un juge satisfait : le verdict reste incomplet.
  report.ok = report.judges.every((j) => j.status === 'ok');
  return report;
}
