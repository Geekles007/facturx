import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Conformité au XSD officiel Factur-X EN 16931, via `xmllint --schema`.
 * Ignoré proprement si les XSD ne sont pas déposés dans test/schemas/ (voir son README) ou si xmllint manque.
 */
const schemasDir = new URL('./schemas/', import.meta.url).pathname;
const goldenDir = new URL('./golden/', import.meta.url).pathname;

function findRootXsd(): string | undefined {
  if (!existsSync(schemasDir)) return undefined;
  for (const file of readdirSync(schemasDir)) {
    if (!file.endsWith('.xsd')) continue;
    const path = join(schemasDir, file);
    if (readFileSync(path, 'utf8').includes('name="CrossIndustryInvoice"')) return path;
  }
  return undefined;
}

function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const xsd = findRootXsd();
const available = xsd !== undefined && hasXmllint();

describe.skipIf(!available)('conformité XSD Factur-X EN 16931 (xmllint)', () => {
  const goldens = readdirSync(goldenDir).filter((f) => f.endsWith('.xml'));

  it.each(goldens)('%s valide le XSD', (file) => {
    // xmllint écrit « … validates » sur stderr et sort en erreur (≠ 0) en cas de non-conformité
    expect(() =>
      execFileSync('xmllint', ['--noout', '--schema', xsd as string, join(goldenDir, file)], {
        stdio: ['ignore', 'ignore', 'pipe'],
      }),
    ).not.toThrow();
  });
});
