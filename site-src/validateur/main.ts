/**
 * Validateur Factur-X en ligne — interface.
 *
 * Tout se passe dans le navigateur : aucun octet du fichier déposé ne quitte la machine. Seul un
 * signal sans contenu part à chaque contrôle, pour le décompte (compteur.ts).
 * Le moteur PDF n'est chargé que si l'on dépose un PDF.
 */
import {
  type AnalysisReport,
  analyze,
  type Finding,
  type JudgeReport,
  type Severity,
} from './analyze.js';
import { assetUrl } from './base.js';
import { CHEMIN_COMPTEUR, compterControle } from './compteur.js';
import { strings } from './i18n.js';
import { runSchematron } from './schematron.js';

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`élément introuvable : ${selector}`);
  return el;
};

const dropzone = $<HTMLDivElement>('#dropzone');
const input = $<HTMLInputElement>('#file');
const status = $<HTMLParagraphElement>('#status');
const output = $<HTMLDivElement>('#rapport');

const t = strings();
const SEVERITY_LABEL: Record<Severity, string> = t.severity;
const STATUS_LABEL: Record<JudgeReport['status'], string> = t.status;

const PROFILES: Record<string, string> = {
  'urn:cen.eu:en16931:2017': 'EN 16931',
  'urn:factur-x.eu:1p0:minimum': 'Minimum',
  'urn:factur-x.eu:1p0:basicwl': 'Basic WL',
  'urn:factur-x.eu:1p0:basic': 'Basic',
  'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended': 'Extended',
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} ${t.units.kb}`
    : `${(bytes / (1024 * 1024)).toFixed(1)} ${t.units.mb}`;

let busy = false;
let lastReport: AnalysisReport | undefined;

function setStatus(text: string, kind: 'idle' | 'busy' | 'error' = 'idle'): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

/** Le moteur PDF (pdf-lib) n'est téléchargé qu'au premier PDF déposé. */
async function extractPdf(bytes: Uint8Array) {
  const { extractFacturX } = await import('facturx-sdk/pdf');
  const extracted = await extractFacturX(bytes);
  if (!extracted) return undefined;
  return {
    xml: extracted.xml,
    filename: extracted.filename,
    ...(extracted.conformanceLevel === undefined
      ? {}
      : { conformanceLevel: extracted.conformanceLevel }),
  };
}

function renderFinding(finding: Finding): HTMLLIElement {
  const item = el('li', `finding ${finding.severity}`);
  const head = el('div', 'finding-head');
  head.append(
    el('code', 'code', finding.code),
    el('span', 'sev', SEVERITY_LABEL[finding.severity]),
  );
  item.append(head, el('p', 'msg', finding.message));
  if (finding.path) item.append(el('code', 'path', finding.path));
  // Le motif est repris par code : traduire le texte français par correspondance serait fragile.
  const reason = finding.reason && (t.tolerated[finding.code] ?? finding.reason);
  if (reason) item.append(el('p', 'reason', t.toleratedPrefix(reason)));
  return item;
}

function renderJudge(judge: JudgeReport): HTMLElement {
  const card = el('article', 'judge');
  card.dataset.status = judge.status;
  const head = el('div', 'judge-head');
  head.append(el('h3', undefined, judge.name), el('span', 'badge', STATUS_LABEL[judge.status]));
  // Le descriptif vient de la table par identifiant ; le nom du juge, lui, est un nom propre.
  card.append(head, el('p', 'judge-detail', t.judgeDetail[judge.id] ?? judge.detail));
  if (judge.note) card.append(el('p', 'note', judge.note));
  if (judge.findings.length === 0 && judge.status === 'ok') {
    card.append(el('p', 'none', t.noFindings));
  } else if (judge.findings.length > 0) {
    const list = el('ul', 'findings');
    for (const finding of judge.findings) list.append(renderFinding(finding));
    card.append(list);
  }
  return card;
}

function describe(report: AnalysisReport): string {
  const parts = [
    report.source.filename,
    formatBytes(report.source.bytes),
    report.source.kind === 'pdf' ? 'PDF' : 'XML',
  ];
  const { guidelineId, businessProcessId, attachmentName } = report.document;
  if (guidelineId) parts.push(t.profile(PROFILES[guidelineId] ?? guidelineId));
  if (businessProcessId) parts.push(t.framework(businessProcessId));
  if (attachmentName) parts.push(attachmentName);
  return parts.join(' · ');
}

function renderReport(report: AnalysisReport): void {
  output.replaceChildren();
  lastReport = report;

  const verdict = el('section', 'verdict');
  const heading = el('h2', undefined);
  heading.tabIndex = -1;
  if (report.error) {
    verdict.dataset.state = 'error';
    heading.textContent = t.unreadable;
    verdict.append(heading, el('p', 'summary', describe(report)));
    const box = el('div', 'error-box');
    box.append(el('code', 'code', report.error.code), el('p', 'msg', report.error.message));
    if (report.error.path) box.append(el('code', 'path', report.error.path));
    verdict.append(box);
    output.append(verdict);
    heading.focus();
    return;
  }

  const failed = report.judges.filter((j) => j.status === 'failed').length;
  const skipped = report.judges.filter((j) => j.status === 'skipped').length;
  if (failed > 0) {
    verdict.dataset.state = 'ko';
    heading.textContent = t.nonConformant(failed);
  } else if (skipped > 0) {
    verdict.dataset.state = 'warn';
    heading.textContent = t.incomplete(skipped);
  } else {
    verdict.dataset.state = 'ok';
    heading.textContent = t.conformant;
  }
  verdict.append(heading, el('p', 'summary', describe(report)));

  const actions = el('div', 'verdict-actions');
  const download = el('button', 'btn small', t.download);
  download.type = 'button';
  download.addEventListener('click', downloadReport);
  actions.append(download);
  verdict.append(actions);

  const judges = el('div', 'judges');
  for (const judge of report.judges) judges.append(renderJudge(judge));
  output.append(verdict, judges);
  heading.focus();
}

function downloadReport(): void {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = t.reportFilename(lastReport.source.filename.replace(/\.[^.]+$/, ''));
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleFile(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  output.replaceChildren();
  setStatus(t.analysing(file.name), 'busy');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = await analyze(
      { filename: file.name, bytes },
      {
        extractPdf,
        runSchematron,
        steps: t.steps,
        onProgress: (step) => setStatus(`${step}…`, 'busy'),
      },
    );
    setStatus(
      report.error ? t.interrupted : t.done(report.judges.length),
      report.error ? 'error' : 'idle',
    );
    renderReport(report);
  } catch (error) {
    setStatus(t.unexpected((error as Error).message), 'error');
  } finally {
    busy = false;
    // Un contrôle de plus — verdict rendu ou fichier illisible, c'est le seul fait qui parte.
    compterControle(assetUrl(CHEMIN_COMPTEUR));
  }
}

async function loadExample(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    setStatus(t.exampleUnavailable, 'error');
    return;
  }
  await handleFile(new File([await response.blob()], filename));
}

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) void handleFile(file);
  input.value = '';
});

for (const event of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(event, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  });
}
for (const event of ['dragleave', 'drop'] as const) {
  dropzone.addEventListener(event, () => dropzone.classList.remove('over'));
}
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]')) {
  button.addEventListener('click', () => {
    const name = button.dataset.example as string;
    void loadExample(assetUrl(`exemples/${name}`), name);
  });
}

setStatus(t.idle);
