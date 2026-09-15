/**
 * `facturx` — vérifier une facture depuis un terminal.
 *
 * Pensé pour l'usage qui manque le plus : on reçoit un fichier, on veut savoir s'il passe, et
 * pourquoi il ne passe pas. Une commande, un verdict, un code de sortie exploitable par un script.
 *
 * Aucune dépendance nouvelle : `node:fs` et ce que le SDK embarque déjà. Le moteur PDF n'est chargé
 * que si l'on soumet un PDF, et jamais pour un XML.
 *
 * Ce que ce CLI ne fait pas, et le dit : exécuter les schematrons officiels. Ils réclament
 * Saxon-JS, soit deux mégaoctets de dépendance pour un paquet qui en annonce une seule. Ils
 * s'exécutent dans le validateur en ligne et à chaque commit du dépôt.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS } from './limits.js';
import { centsToString } from './money.js';
import type { Invoice } from './types/invoice.js';
import { validateInvoice } from './validate/index.js';
import type { Issue } from './validate/issues.js';
import { FacturXParseError, parseCiiDocument } from './xml/cii-read.js';
import { parseUblDocument } from './xml/ubl-read.js';

const NAME = 'facturx';

/** Codes de sortie : un script doit pouvoir distinguer « non conforme » de « illisible ». */
const EXIT = { ok: 0, findings: 1, error: 2, usage: 64 } as const;

// ---------- présentation ----------

const useColor =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = (code: string, text: string): string => (useColor ? `[${code}m${text}[0m` : text);
const bold = (t: string) => paint('1', t);
const dim = (t: string) => paint('2', t);
const red = (t: string) => paint('31', t);
const green = (t: string) => paint('32', t);

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

const HELP = `${bold(NAME)} — vérifier une facture Factur-X, CII ou UBL depuis le terminal

${bold('Usage')}
  ${NAME} validate <fichier...>   contrôle une facture, liste les anomalies
  ${NAME} extract  <pdf>          écrit le XML embarqué sur la sortie standard
  ${NAME} info     <fichier...>   profil, cadre, parties, totaux

${bold('Options')}
  --json            sortie lisible par une machine
  -o, --out <fic.>  écrit dans un fichier plutôt que sur la sortie standard (extract)
  -q, --quiet       n'affiche que les anomalies bloquantes
  -h, --help        cette aide
  -v, --version     version du SDK

${bold('Codes de sortie')}
  0  conforme            1  anomalies relevées
  2  fichier illisible   64 usage incorrect

${dim(`Les schematrons officiels ne sont pas exécutés ici : ils réclament Saxon-JS.
Pour un verdict complet : https://facturx.ibird.dev/validateur/`)}`;

// ---------- lecture ----------

type Source =
  | { kind: 'cii'; invoice: Invoice; guidelineId: string; businessProcessId?: string }
  | { kind: 'ubl'; invoice: Invoice; guidelineId: string; businessProcessId?: string };

const looksLikePdf = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/** Racine du document, sans le parser entièrement : suffit à choisir le bon lecteur. */
function rootElement(xml: string): string {
  const match = /<\s*(?:[\w.-]+:)?([\w.-]+)[\s>/]/.exec(
    xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ''),
  );
  return match?.[1] ?? '';
}

/** Extrait le XML d'un PDF Factur-X. Le moteur PDF n'est importé qu'ici. */
async function xmlFromPdf(bytes: Uint8Array, file: string): Promise<string> {
  const { extractFacturX } = await import('./pdf/index.js');
  const found = await extractFacturX(bytes);
  if (!found) {
    throw new Error(`${file} est un PDF, mais il ne contient aucune facture Factur-X.`);
  }
  return found.xml;
}

async function read(file: string): Promise<Source> {
  const bytes = new Uint8Array(readFileSync(file));
  const xml = looksLikePdf(bytes) ? await xmlFromPdf(bytes, file) : new TextDecoder().decode(bytes);
  const root = rootElement(xml);

  if (root === 'Invoice' || root === 'CreditNote') {
    const { invoice, guidelineId, businessProcessId } = parseUblDocument(xml, {
      limits: DEFAULT_LIMITS,
    });
    return { kind: 'ubl', invoice, guidelineId, ...(businessProcessId && { businessProcessId }) };
  }
  if (root === 'CrossIndustryInvoice') {
    const { invoice, guidelineId, businessProcessId } = parseCiiDocument(xml);
    return { kind: 'cii', invoice, guidelineId, ...(businessProcessId && { businessProcessId }) };
  }
  throw new Error(
    `Racine « ${root || '?'} » non reconnue dans ${file} : attendu CrossIndustryInvoice (CII) ou Invoice/CreditNote (UBL).`,
  );
}

// ---------- commandes ----------

function describe(source: Source): string {
  const { invoice } = source;
  const parts = [
    source.kind.toUpperCase(),
    invoice.id,
    invoice.issueDate,
    `${centsToString(invoice.totals.taxInclusiveAmount)} ${invoice.currency} TTC`,
  ];
  if (source.businessProcessId) parts.push(`cadre ${source.businessProcessId}`);
  return parts.join(dim(' · '));
}

function printIssue(issue: Issue): void {
  out(`  ${red(issue.code)} ${dim(issue.path)}`);
  out(`    ${issue.message}`);
  if (issue.expected !== undefined || issue.actual !== undefined) {
    out(dim(`    attendu ${String(issue.expected)} · reçu ${String(issue.actual)}`));
  }
}

interface Options {
  json: boolean;
  quiet: boolean;
  out?: string;
}

async function validate(files: string[], options: Options): Promise<number> {
  const results: {
    file: string;
    syntax: string;
    ok: boolean;
    issues: Issue[];
    error?: { code: string; path?: string; message: string };
  }[] = [];

  for (const file of files) {
    try {
      const source = await read(file);
      const result = validateInvoice(source.invoice);
      results.push({
        file,
        syntax: source.kind,
        ok: result.ok,
        issues: result.ok ? [] : [...result.issues],
      });
      if (!options.json) {
        out(`${bold(basename(file))}  ${dim(describe(source))}`);
        if (result.ok) {
          out(`  ${green('✓')} conforme au modèle EN 16931 et aux règles françaises`);
        } else {
          out(`  ${red(`✗ ${result.issues.length} anomalie(s)`)}`);
          for (const issue of result.issues) printIssue(issue);
        }
        out();
      }
    } catch (error) {
      const parse = error instanceof FacturXParseError ? error : undefined;
      // Un fichier absent est une erreur d'usage courante : le message de Node la noie dans son
      // jargon (« ENOENT: no such file or directory, open … »).
      const enoent = (error as NodeJS.ErrnoException).code === 'ENOENT';
      const message = enoent ? `Fichier introuvable : ${file}` : (error as Error).message;
      results.push({
        file,
        syntax: '?',
        ok: false,
        issues: [],
        error: {
          code: parse?.code ?? (enoent ? 'ENOENT' : 'UNREADABLE'),
          ...(parse?.path ? { path: parse.path } : {}),
          message,
        },
      });
      if (!options.json) {
        out(`${bold(basename(file))}`);
        out(
          `  ${red(parse?.code ?? (enoent ? 'introuvable' : 'illisible'))} ${dim(parse?.path ?? '')}`,
        );
        out(`    ${message}`);
        out();
      }
    }
  }

  if (options.json) out(JSON.stringify({ results }, null, 2));

  if (results.some((r) => r.error)) return EXIT.error;
  return results.every((r) => r.ok) ? EXIT.ok : EXIT.findings;
}

async function extract(files: string[], options: Options): Promise<number> {
  if (files.length !== 1) {
    err(`${NAME} extract attend exactement un PDF.`);
    return EXIT.usage;
  }
  const file = files[0] as string;
  const bytes = new Uint8Array(readFileSync(file));
  if (!looksLikePdf(bytes)) {
    err(`${file} n'est pas un PDF.`);
    return EXIT.error;
  }
  const xml = await xmlFromPdf(bytes, file);
  if (options.out) {
    writeFileSync(options.out, xml);
    if (!options.quiet) err(`${xml.length} octets écrits dans ${options.out}`);
  } else {
    process.stdout.write(xml);
  }
  return EXIT.ok;
}

async function info(files: string[], options: Options): Promise<number> {
  const infos = [];
  for (const file of files) {
    const source = await read(file);
    const { invoice } = source;
    const entry = {
      file,
      syntax: source.kind,
      guidelineId: source.guidelineId,
      businessProcessId: source.businessProcessId,
      id: invoice.id,
      issueDate: invoice.issueDate,
      typeCode: invoice.typeCode,
      currency: invoice.currency,
      seller: { name: invoice.seller.name, siren: invoice.seller.siren },
      buyer: { name: invoice.buyer.name, siren: invoice.buyer.siren },
      lines: invoice.lines.length,
      taxExclusiveAmount: centsToString(invoice.totals.taxExclusiveAmount),
      taxInclusiveAmount: centsToString(invoice.totals.taxInclusiveAmount),
    };
    infos.push(entry);
    if (!options.json) {
      out(bold(basename(file)));
      out(`  syntaxe        ${entry.syntax.toUpperCase()}`);
      out(`  profil         ${entry.guidelineId}`);
      if (entry.businessProcessId) out(`  cadre          ${entry.businessProcessId}`);
      out(`  facture        ${entry.id} ${dim(`(${entry.typeCode})`)} · ${entry.issueDate}`);
      out(`  vendeur        ${entry.seller.name} ${dim(entry.seller.siren ?? '')}`);
      out(`  acheteur       ${entry.buyer.name} ${dim(entry.buyer.siren ?? '')}`);
      out(`  lignes         ${entry.lines}`);
      out(
        `  HT / TTC       ${entry.taxExclusiveAmount} / ${entry.taxInclusiveAmount} ${entry.currency}`,
      );
      out();
    }
  }
  if (options.json) out(JSON.stringify({ files: infos }, null, 2));
  return EXIT.ok;
}

// ---------- entrée ----------

export async function main(argv: readonly string[]): Promise<number> {
  const args = [...argv];
  const options: Options = { json: false, quiet: false };
  const files: string[] = [];
  let command: string | undefined;

  while (args.length > 0) {
    const arg = args.shift() as string;
    if (arg === '--help' || arg === '-h') {
      out(HELP);
      return EXIT.ok;
    } else if (arg === '--version' || arg === '-v') {
      out(VERSION);
      return EXIT.ok;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--out' || arg === '-o') {
      const cible = args.shift();
      if (cible === undefined) {
        err(`${arg} attend un nom de fichier.`);
        return EXIT.usage;
      }
      options.out = cible;
    } else if (arg.startsWith('-')) {
      err(`Option inconnue : ${arg}`);
      return EXIT.usage;
    } else if (command === undefined) command = arg;
    else files.push(arg);
  }

  if (command === undefined) {
    out(HELP);
    return EXIT.usage;
  }
  if (files.length === 0) {
    err(`${NAME} ${command} attend au moins un fichier.`);
    return EXIT.usage;
  }

  try {
    if (command === 'validate') return await validate(files, options);
    if (command === 'extract') return await extract(files, options);
    if (command === 'info') return await info(files, options);
    err(`Commande inconnue : ${command}. Voir ${NAME} --help.`);
    return EXIT.usage;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    err(red(e.code === 'ENOENT' ? `Fichier introuvable : ${e.path}` : e.message));
    return EXIT.error;
  }
}

/** Remplacé à la construction par la version du paquet. */
declare const VERSION: string;

// Exécuté directement : on agit. Importé (tests) : on n'expose que `main`.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      err(red((error as Error).message));
      process.exitCode = EXIT.error;
    },
  );
}
