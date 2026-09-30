/**
 * Le code qui refait la facture du Studio avec le SDK.
 *
 * Le Studio ne fait rien que le SDK ne sache faire : ce module l'écrit noir sur blanc. Le brouillon
 * est rendu en littéral TypeScript, montants enveloppés dans les constructeurs exacts (`cents`,
 * `quantity`, `unitPrice`, `percent`), suivi des appels mêmes que le Studio vient d'exécuter.
 */

import {
  type ComputeTotalsOptions,
  type Invoice,
  type InvoiceDraft,
  rateToString,
} from 'facturx-sdk';
import type { LayoutInvoiceOptions } from 'facturx-sdk/pdf';

/** Champs en centimes, en quantités, en prix unitaires, en taux : le constructeur à employer. */
const CENTS = new Set([
  'netAmount',
  'amount',
  'baseAmount',
  'recoveryIndemnity',
  'prepaidAmount',
  'roundingAmount',
]);
const QUANTITIES = new Set(['quantity', 'baseQuantity']);
const PRICES = new Set(['unitPrice', 'grossUnitPrice', 'priceDiscount']);
const RATES = new Set(['rate', 'percentage', 'latePenaltyRate']);

const quote = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const key = (name: string): string => (IDENTIFIER.test(name) ? name : quote(name));

interface Emitter {
  used: Set<string>;
  attachments: string[];
}

function literal(value: unknown, name: string, indent: string, out: Emitter): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (CENTS.has(name)) {
      out.used.add('cents');
      return `cents(${value})`;
    }
    if (QUANTITIES.has(name)) {
      out.used.add('quantity');
      return `quantity(${value})`;
    }
    if (PRICES.has(name)) {
      out.used.add('unitPrice');
      return `unitPrice(${value})`;
    }
    if (RATES.has(name)) {
      out.used.add('percent');
      return `percent('${rateToString(value as never).replace(/\.?0+$/, '')}')`;
    }
    return String(value);
  }
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Uint8Array) {
    const id = `attachment${out.attachments.length + 1}`;
    out.attachments.push(id);
    return id;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${inner}${literal(item, name, inner, out)},`);
    return `[\n${items.join('\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const fields = entries.map(([k, v]) => `${inner}${key(k)}: ${literal(v, k, inner, out)},`);
    return `{\n${fields.join('\n')}\n${indent}}`;
  }
  return 'null';
}

/** Brouillon sans ce que `computeTotals` calcule. */
function draftOf(invoice: Invoice): InvoiceDraft {
  const { totals: _totals, taxBreakdown: _breakdown, ...draft } = invoice;
  return draft;
}

export interface CodegenInput {
  invoice: Invoice;
  totalsOptions: ComputeTotalsOptions;
  render: LayoutInvoiceOptions;
  fontFiles: { regular: string; bold: string };
  logoFile?: string;
  /** Langue du document et libellés renommés : la table complète contient des fonctions. */
  labels: { language: 'fr' | 'en'; renamed: Record<string, string> };
}

/** Programme TypeScript complet, exécutable en Node (ESM, `await` de premier niveau). */
export function generateCode(input: CodegenInput): string {
  const out: Emitter = { used: new Set(), attachments: [] };
  const draft = literal(draftOf(input.invoice), '', '', out);
  const hasTotalsOptions = Object.keys(input.totalsOptions).length > 0;
  const totals = hasTotalsOptions ? `, ${literal(input.totalsOptions, '', '', out)}` : '';

  const { fonts: _fonts, logo, labels: _labels, ...rest } = input.render;
  const render = literal(rest, '', '  ', out)
    .replace(/^\{\n/, '')
    .replace(/\n {2}\}$/, '');
  const renamed = Object.entries(input.labels.renamed).filter(([, v]) => v.trim() !== '');
  const labels = renamed.length
    ? `  labels: { ...RENDER_LABELS.${input.labels.language}, ${renamed.map(([k, v]) => `${key(k)}: ${quote(v)}`).join(', ')} },`
    : `  labels: '${input.labels.language}',`;

  const sdkImports = ['assertValidInvoice', 'computeTotals', 'type InvoiceDraft', ...out.used].sort(
    (a, b) => a.replace('type ', '').localeCompare(b.replace('type ', '')),
  );
  const lines: string[] = [
    "import { readFile } from 'node:fs/promises';",
    `import { ${sdkImports.join(', ')} } from 'facturx-sdk';`,
    `import { embedFacturX, ${renamed.length ? 'RENDER_LABELS, ' : ''}renderInvoicePdf } from 'facturx-sdk/pdf';`,
    '',
  ];
  if (out.attachments.length) {
    lines.push('// Pièces jointes : leurs octets, lus depuis vos fichiers.');
    out.attachments.forEach((id, i) => {
      const file =
        input.invoice.attachments?.filter((a) => a.file)[i]?.file?.filename ?? `${id}.pdf`;
      lines.push(`const ${id} = new Uint8Array(await readFile(${quote(file)}));`);
    });
    lines.push('');
  }
  lines.push(
    `const draft: InvoiceDraft = ${draft};`,
    '',
    '// Totaux et ventilation de TVA calculés explicitement, puis tout est vérifié :',
    '// une anomalie lève FacturXValidationError avec son code de règle et son chemin.',
    `const invoice = assertValidInvoice({ ...draft, ...computeTotals(draft${totals}) });`,
    '',
    '// La page lisible. La police doit être statique : elle est embarquée (PDF/A).',
    'const page = await renderInvoicePdf(invoice, {',
    '  fonts: {',
    `    regular: new Uint8Array(await readFile(${quote(input.fontFiles.regular)})),`,
    `    bold: new Uint8Array(await readFile(${quote(input.fontFiles.bold)})),`,
    '  },',
  );
  if (logo) {
    lines.push(
      `  logo: { bytes: new Uint8Array(await readFile(${quote(input.logoFile ?? `logo.${logo.type === 'png' ? 'png' : 'jpg'}`)})), type: '${logo.type}' },`,
    );
  }
  lines.push(labels);
  if (render.trim()) lines.push(render);
  lines.push(
    '});',
    '',
    '// PDF/A-3 Factur-X : le XML CII embarqué, et une intention de sortie sRGB.',
    'const facturX = await embedFacturX(page, { invoice }, {',
    "  outputIntent: { iccProfile: new Uint8Array(await readFile('sRGB.icc')) },",
    '});',
    '',
  );
  return lines.join('\n');
}
