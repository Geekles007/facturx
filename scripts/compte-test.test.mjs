import { describe, expect, it } from 'vitest';
import { testsExecutes } from './compte-test.mjs';

/**
 * `pnpm compte:test` échoue quand une étape n'a exécuté aucun test : un dossier mal nommé, un filtre
 * trop large ou des tests tous sautés passeraient sinon en vert, en CI comme ici. Le nombre se lit
 * dans le bilan que chaque outil imprime ; un bilan introuvable compte pour aucun test.
 */
describe('testsExecutes : le nombre de tests exécutés, lu dans le bilan de chaque outil', () => {
  it('pgTAP (pg_prove, par supabase test db)', () => {
    const sortie = [
      '…/07-avoir-devise.test.sql .. ok',
      'All tests successful.',
      'Files=7, Tests=390,  5 wallclock secs ( 0.07 usr  0.02 sys +  0.13 cusr  0.06 csys =  0.28 CPU)',
      'Result: PASS',
    ].join('\n');
    expect(testsExecutes('pgtap', sortie)).toBe(390);
    expect(testsExecutes('pgtap', 'Files=0, Tests=0,  0 wallclock secs\nResult: NOTESTS')).toBe(0);
    expect(testsExecutes('pgtap', 'aucune ligne de bilan')).toBe(0);
  });

  it('deno test : réussis et échoués comptent, les étapes et les filtrés non ; couleurs ôtées', () => {
    expect(testsExecutes('deno', '\u001b[32mok\u001b[0m | 25 passed | 0 failed (31s)')).toBe(25);
    expect(testsExecutes('deno', 'ok | 180 passed (12 steps) | 0 failed (2m4s)')).toBe(180);
    expect(testsExecutes('deno', 'FAILED | 3 passed | 2 failed | 38 filtered out (7s)')).toBe(5);
    expect(testsExecutes('deno', 'ok | 0 passed | 0 failed (0ms)')).toBe(0);
    expect(testsExecutes('deno', 'error: No test modules found')).toBe(0);
  });

  it('Vitest : réussis et échoués comptent, les sautés non', () => {
    expect(
      testsExecutes('vitest', ' Test Files  6 passed (6)\n      Tests  146 passed (146)'),
    ).toBe(146);
    expect(testsExecutes('vitest', '      Tests  1 failed | 45 passed | 3 skipped (49)')).toBe(46);
    expect(
      testsExecutes('vitest', ' Test Files  6 skipped (6)\n      Tests  52 skipped (52)'),
    ).toBe(0);
    expect(testsExecutes('vitest', 'No test files found, exiting with code 1')).toBe(0);
  });
});
