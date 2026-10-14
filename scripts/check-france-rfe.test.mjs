import { describe, expect, it } from 'vitest';
import { parseCenVersion, summarize } from './check-france-rfe.mjs';

/**
 * La veille ne doit ni se taire quand France_RFE bouge, ni crier pour un README : le titre de
 * l'issue dit d'emblée ce qui a changé, et la clé (le commit de tête) évite de signaler deux fois
 * le même état du dépôt.
 */
describe('veille France_RFE', () => {
  const commit = (sha, message, date = '2026-11-03T10:00:00Z') => ({
    sha,
    commit: { message, committer: { date } },
  });
  const base = {
    base: '97ba0f3d4ef2abed5780e9490d5c3a2be832ab1d',
    baseLabel: 'v1.4.0.04',
    compare: {
      ahead_by: 2,
      html_url: 'https://github.com/fnfempe/France_RFE/compare/97ba0f3...main',
      commits: [
        commit('aaaaaaa1111111111111111111111111111111111', 'Update README'),
        commit('bbbbbbb2222222222222222222222222222222222', 'Add examples\n\nDétails'),
      ],
      files: [{ filename: 'README.md' }, { filename: 'FNFE_RFE_INVOICE/CII/exemple.xml' }],
    },
    tags: [{ name: 'v1.4.0.04', commit: { sha: '97ba0f3d4ef2abed5780e9490d5c3a2be832ab1d' } }],
    cen: { pinned: '1.3.16', head: '1.3.16' },
  };

  it('lit la version du CEN dans l’en-tête du schematron', () => {
    expect(parseCenVersion('<!--Schematron version 1.3.17 - Last update: 2026-10-09-->')).toBe(
      '1.3.17',
    );
    expect(parseCenVersion('<xsl:stylesheet>')).toBeUndefined();
  });

  it('se tait quand la branche principale n’a pas bougé', () => {
    expect(summarize({ ...base, compare: { ...base.compare, ahead_by: 0 } })).toBeNull();
  });

  it('signale des commits, avec le commit de tête pour clé', () => {
    const report = summarize(base);
    expect(report.key).toBe('bbbbbbb');
    expect(report.title).toBe('France_RFE : 2 commits depuis v1.4.0.04 (bbbbbbb)');
    expect(report.body).toContain('aucun verdict ne devrait bouger');
  });

  it('met un nouveau tag dans le titre', () => {
    const tags = [
      ...base.tags,
      { name: 'v1.4.0.05', commit: { sha: 'bbbbbbb2222222222222222222222222222222222' } },
    ];
    expect(summarize({ ...base, tags }).title).toBe('France_RFE : nouveau tag v1.4.0.05 (bbbbbbb)');
  });

  it('fait passer un changement de CEN avant tout le reste, avec le renvoi à D70', () => {
    const tags = [
      ...base.tags,
      { name: 'v1.4.0.05', commit: { sha: 'bbbbbbb2222222222222222222222222222222222' } },
    ];
    const report = summarize({ ...base, tags, cen: { pinned: '1.3.16', head: '1.3.17' } });
    expect(report.title).toBe('France_RFE embarque le CEN 1.3.17 (bbbbbbb)');
    expect(report.body).toContain('D70');
  });

  it('dit quand le schematron CEN est introuvable à la tête', () => {
    const report = summarize({ ...base, cen: { pinned: '1.3.16', head: undefined } });
    expect(report.title).toBe('France_RFE : schematron CEN introuvable (bbbbbbb)');
  });

  it('distingue les fichiers de règles du reste', () => {
    const files = [
      { filename: 'README.md' },
      { filename: 'FNFE_RFE_INVOICE/CII/EN16931/2xslt/EN16931-CII-validation.xslt' },
      { filename: 'FNFE_RFE_INVOICE/Factur-X/EN16931/schematron/FACTUR-X_EN16931_codedb.xml' },
    ];
    const { body } = summarize({ ...base, compare: { ...base.compare, files } });
    expect(body).toContain('**Fichiers de règles modifiés** (2)');
    expect(body).toContain('`FNFE_RFE_INVOICE/CII/EN16931/2xslt/EN16931-CII-validation.xslt`');
    expect(body).not.toContain('`README.md`');
  });

  it('cite les messages de commit sans mention ni code actif', () => {
    const compare = {
      ...base.compare,
      ahead_by: 1,
      commits: [commit('ccccccc3333333333333333333333333333333333', 'Merci @quelqu’un pour `fix`')],
    };
    const { body } = summarize({ ...base, compare });
    expect(body).toContain("`Merci @quelqu’un pour 'fix'`");
  });
});
