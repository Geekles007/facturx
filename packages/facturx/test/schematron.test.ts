import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import SaxonJS from 'saxon-js';
import { describe, expect, it } from 'vitest';

/**
 * Validation par les schematrons officiels, exécutés avec Saxon-JS (pas de Java) :
 *   - EN 16931 CII (CEN) — les règles BR-*, BR-CO-*, BR-CL-*, BR-S/E/AE/… que le SDK implémente lui-même ;
 *   - profil Factur-X EN 16931 (FNFE / ZUGFeRD) ;
 *   - BR-FR Flux 2 V1.3.0 (AFNOR XP Z12-012), les règles françaises appliquées par les plateformes agréées.
 * Les XSLT sont récupérées par `pnpm schemas:fetch` (git-ignorées) ; le test est ignoré si elles manquent.
 */
const schemasDir = new URL('./schemas/', import.meta.url).pathname;
const goldenDir = new URL('./golden/', import.meta.url).pathname;

const RULESETS = [
  { name: 'EN 16931 (CEN)', sef: 'EN16931-CII-validation.sef.json' },
  { name: 'Factur-X EN 16931', sef: 'FACTUR-X_EN16931.sef.json' },
  { name: 'BR-FR (XP Z12-012)', sef: 'BR-FR-Flux2-CII.sef.json' },
] as const;

interface FailedAssert {
  id: string | undefined;
  flag: string | undefined;
  test: string | undefined;
  text: string;
}

/** Exécute un schematron compilé (SEF) et renvoie les `svrl:failed-assert` du rapport. */
export function runSchematron(sef: string, xml: string): FailedAssert[] {
  const svrl = SaxonJS.transform(
    { stylesheetFileName: sef, sourceText: xml, destination: 'serialized' },
    'sync',
  ).principalResult as string;
  return [...svrl.matchAll(/<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g)].map(
    (m) => {
      const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1] as string)?.[1];
      const text = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(m[2] as string)?.[1] ?? '';
      return {
        id: attr('id'),
        flag: attr('flag'),
        test: attr('test'),
        text: text.replace(/\s+/g, ' ').trim(),
      };
    },
  );
}

/**
 * Avertissements des schematrons volontairement tolérés (jamais des `fatal`) :
 * - PEPPOL-EN16931-R008 « pas d'élément vide » : `ram:ApplicableHeaderTradeDelivery` est obligatoire dans le XSD
 *   Factur-X même sans information de livraison — règle PEPPOL, « still status warning » ;
 * - CII-SR-450 « un seul identifiant acheteur (ID ou GlobalID) » : la norme française porte le SIRET en
 *   `GlobalID 0009` et le code de routage en `ID 0224` (BR-FR-09/24) — les deux coexistent ;
 * - CII-SR-475 « une seule description BT-123 pour les pièces 916 » : BR-FR-17 qualifie chaque pièce jointe
 *   par sa description (`RIB`, `BON_COMMANDE`…), ce qui suppose une description par pièce.
 */
const TOLERATED = new Set(['PEPPOL-EN16931-R008', 'CII-SR-450', 'CII-SR-475']);

const available = RULESETS.every((r) => existsSync(join(schemasDir, r.sef)));

describe.skipIf(!available)('schematrons officiels (Saxon-JS)', () => {
  const goldens = readdirSync(goldenDir).filter((f) => f.endsWith('.xml'));

  for (const ruleset of RULESETS) {
    it.each(goldens)(
      `${ruleset.name} — %s`,
      (file) => {
        const failures = runSchematron(
          join(schemasDir, ruleset.sef),
          readFileSync(join(goldenDir, file), 'utf8'),
        ).filter((f) => !(f.flag !== 'fatal' && TOLERATED.has(f.id ?? '')));
        const detail = failures
          .map((f) => `  - ${f.id ?? f.test ?? '?'} [${f.flag ?? '-'}] ${f.text}`)
          .join('\n');
        expect(
          failures,
          `${ruleset.name} : ${failures.length} règle(s) violée(s) dans ${file}\n${detail}`,
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
