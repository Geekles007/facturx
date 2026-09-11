import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blockingFailures,
  describeFailures,
  RULESETS,
  runSchematron,
  schemasDir,
  schematronsAvailable,
} from './helpers/schematron.js';

/**
 * Validation par les schematrons officiels, exécutés avec Saxon-JS (pas de Java) :
 *   - EN 16931 CII (CEN) — les règles BR-*, BR-CO-*, BR-CL-*, BR-S/E/AE/… que le SDK implémente lui-même ;
 *   - profil Factur-X EN 16931 (FNFE / ZUGFeRD) ;
 *   - BR-FR Flux 2 V1.3.0 (AFNOR XP Z12-012), les règles françaises appliquées par les plateformes agréées.
 * Les XSLT sont récupérées par `pnpm schemas:fetch` (git-ignorées) ; le test est ignoré si elles manquent.
 */
const goldenDir = new URL('./golden/', import.meta.url).pathname;

describe.skipIf(!schematronsAvailable())('schematrons officiels (Saxon-JS)', () => {
  const goldens = readdirSync(goldenDir).filter((f) => f.endsWith('.xml'));

  for (const ruleset of RULESETS) {
    it.each(goldens)(
      `${ruleset.name} — %s`,
      (file) => {
        const failures = blockingFailures(
          runSchematron(join(schemasDir, ruleset.sef), readFileSync(join(goldenDir, file), 'utf8')),
        );
        expect(
          failures,
          `${ruleset.name} : ${failures.length} règle(s) violée(s) dans ${file}\n${describeFailures(failures)}`,
        ).toEqual([]);
      },
      60_000,
    );
  }

  it('le harnais détecte une violation (contrôle négatif)', () => {
    const xml = readFileSync(join(goldenDir, 'simple.xml'), 'utf8').replace(
      '<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>240.01</ram:GrandTotalAmount>',
    );
    const failures = runSchematron(join(schemasDir, 'EN16931-CII-validation.sef.json'), xml);
    expect(failures.map((f) => f.id)).toContain('BR-CO-15');
  }, 60_000);
});
