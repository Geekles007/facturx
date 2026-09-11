import { existsSync } from 'node:fs';
import { join } from 'node:path';
import SaxonJS from 'saxon-js';

/** Dossier des schémas et schematrons récupérés par `pnpm schemas:fetch`. */
export const schemasDir = new URL('../schemas/', import.meta.url).pathname;

export const RULESETS = [
  { name: 'EN 16931 (CEN)', sef: 'EN16931-CII-validation.sef.json' },
  { name: 'Factur-X EN 16931', sef: 'FACTUR-X_EN16931.sef.json' },
  { name: 'BR-FR (XP Z12-012)', sef: 'BR-FR-Flux2-CII.sef.json' },
] as const;

/**
 * Avertissements des schematrons volontairement tolérés (jamais des `fatal`) :
 * - PEPPOL-EN16931-R008 « pas d'élément vide » : `ram:ApplicableHeaderTradeDelivery` est obligatoire dans le XSD
 *   Factur-X même sans information de livraison — règle PEPPOL, « still status warning » ;
 * - CII-SR-450 « un seul identifiant acheteur (ID ou GlobalID) » : la norme française porte le SIRET en
 *   `GlobalID 0009` et le code de routage en `ID 0224` (BR-FR-09/24) — les deux coexistent ;
 * - CII-SR-475 « une seule description BT-123 pour les pièces 916 » : BR-FR-17 qualifie chaque pièce jointe
 *   par sa description (`RIB`, `BON_COMMANDE`…), ce qui suppose une description par pièce.
 */
export const TOLERATED = new Set(['PEPPOL-EN16931-R008', 'CII-SR-450', 'CII-SR-475']);

export interface FailedAssert {
  id: string | undefined;
  flag: string | undefined;
  test: string | undefined;
  text: string;
}

export const schematronsAvailable = (): boolean =>
  RULESETS.every((r) => existsSync(join(schemasDir, r.sef)));

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

/** Assertions en échec non tolérées, formatées pour un message d'erreur. */
export function blockingFailures(failures: FailedAssert[]): FailedAssert[] {
  return failures.filter((f) => !(f.flag !== 'fatal' && TOLERATED.has(f.id ?? '')));
}

export function describeFailures(failures: FailedAssert[]): string {
  return failures
    .map((f) => `  - ${f.id ?? f.test ?? '?'} [${f.flag ?? '-'}] ${f.text}`)
    .join('\n');
}
