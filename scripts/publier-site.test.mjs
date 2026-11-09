import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compteOffert,
  liensVersLeCompte,
  PAGES_DU_COMPTE,
  pagePubliee,
  publier,
} from './publier-site.mjs';

/**
 * Ruling 66 : les pages publiques ne parlent du compte que sur un site construit avec un projet
 * Supabase. Les pages de `site/` sont écrites pour un site avec compte, et marquées (`data-compte`,
 * `data-sans-compte`) ; la publication garde la variante qui convient. Sans compte, ni texte du
 * compte, ni CGU, ni accord de sous-traitance, ni lien vers eux ; avec, tout est là.
 */

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(racine, 'site');

/** Les pages HTML d'un dossier, en chemins relatifs. */
const pagesDe = (dossier) =>
  readdirSync(dossier, { recursive: true }).filter((chemin) => chemin.endsWith('.html'));

/** Ce qui ne se dit que d'un site avec compte, en français et en anglais. */
const TEXTES_DU_COMPTE = [
  /supabase/i,
  /brevo/i,
  /avec ou sans compte/i,
  /avec un compte/i,
  /créer un compte/i,
  /sans compte/i,
  /with or without an account/i,
  /with an account/i,
  /without an account/i,
  /account-less/i,
  /create a free account/i,
  /sous-traitant/i,
  /\bprocessor\b/i,
  /data-(sans-)?compte/,
];

describe('pagePubliee', () => {
  const page = [
    '<head>',
    '<meta data-compte name="description" content="Avec ou sans compte.">',
    '<meta data-sans-compte name="description" content="Gratuit.">',
    '</head>',
    '<p class="label">Studio · gratuit<span data-compte>, avec ou sans compte</span></p>',
    '<div data-compte class="bloc"><div>dedans</div><p>encore</p></div>',
    '<ul>',
    '  <li><a data-compte href="cgu/">CGU</a></li>',
    '  <li><a href="confidentialite/">Confidentialité</a></li>',
    '</ul>',
    '<h2 data-sans-compte>2. Sans compte</h2>',
  ].join('\n');

  it('sans compte : les éléments marqués data-compte partent, avec leur contenu ; la variante reste', () => {
    expect(pagePubliee(page, false)).toBe(
      [
        '<head>',
        '<meta name="description" content="Gratuit.">',
        '</head>',
        '<p class="label">Studio · gratuit</p>',
        '<ul>',
        '  <li></li>',
        '  <li><a href="confidentialite/">Confidentialité</a></li>',
        '</ul>',
        '<h2>2. Sans compte</h2>',
      ].join('\n'),
    );
  });

  it('avec un compte : la variante sans compte part, les marques s’effacent', () => {
    expect(pagePubliee(page, true)).toBe(
      [
        '<head>',
        '<meta name="description" content="Avec ou sans compte.">',
        '</head>',
        '<p class="label">Studio · gratuit<span>, avec ou sans compte</span></p>',
        '<div class="bloc"><div>dedans</div><p>encore</p></div>',
        '<ul>',
        '  <li><a href="cgu/">CGU</a></li>',
        '  <li><a href="confidentialite/">Confidentialité</a></li>',
        '</ul>',
      ].join('\n'),
    );
  });

  it('un élément marqué sans fermeture arrête la publication', () => {
    expect(() => pagePubliee('<div data-compte><p>x</p>', false)).toThrow('<div>');
  });

  it('les liens vers les pages du compte, relatifs ou absolus, sont reconnus', () => {
    const html =
      '<a href="cgu/">a</a><a href="../sous-traitance/#x">b</a><a href="/en/cgu">c</a>' +
      '<a href="../confidentialite/#conservation">d</a><a href="https://exemple.test/cgu/">e</a>';
    expect(liensVersLeCompte(html)).toEqual(['cgu/', '../sous-traitance/#x', '/en/cgu']);
  });

  it('le compte est offert avec l’URL et la clé, comme dans le Studio', () => {
    expect(compteOffert({})).toBe(false);
    expect(compteOffert({ FACTURX_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
    expect(compteOffert({ FACTURX_SUPABASE_URL: ' ', FACTURX_SUPABASE_KEY: 'cle' })).toBe(false);
    expect(
      compteOffert({ FACTURX_SUPABASE_URL: 'https://x.supabase.co', FACTURX_SUPABASE_KEY: 'cle' }),
    ).toBe(true);
  });
});

describe('les pages du site, publiées', () => {
  let dossier;
  let sans;
  let avec;
  const avant = Object.fromEntries(
    pagesDe(site).map((page) => [page, readFileSync(join(site, page), 'utf8')]),
  );

  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'publier-site-'));
    sans = join(dossier, 'sans');
    avec = join(dossier, 'avec');
    publier(site, sans, false);
    publier(site, avec, true);
  });

  afterAll(() => {
    rmSync(dossier, { recursive: true, force: true });
  });

  it('sans compte : ni CGU, ni sous-traitance, ni README', () => {
    for (const page of PAGES_DU_COMPTE) expect(existsSync(join(sans, page))).toBe(false);
    expect(existsSync(join(sans, 'README.md'))).toBe(false);
    expect(existsSync(join(sans, 'confidentialite/index.html'))).toBe(true);
    expect(existsSync(join(sans, 'en/confidentialite/index.html'))).toBe(true);
  });

  it('sans compte : aucune page ne parle du compte, ni ne mène à une page retirée', () => {
    const pages = pagesDe(sans);
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const page of pages) {
      const html = readFileSync(join(sans, page), 'utf8');
      for (const texte of TEXTES_DU_COMPTE) expect(html, `${page} : ${texte}`).not.toMatch(texte);
      expect(liensVersLeCompte(html), page).toEqual([]);
    }
    // Ce qui reste se lit : les sections renumérotées, le décompte et ses journaux.
    const confidentialite = readFileSync(join(sans, 'confidentialite/index.html'), 'utf8');
    expect(confidentialite).toContain("<h2>7. Traceurs et mesure d'audience</h2>");
    expect(confidentialite).toContain("journal d'exploitation");
    expect(readFileSync(join(sans, 'index.html'), 'utf8')).toContain(
      'Rien de ce que vous saisissez ne quitte votre navigateur.',
    );
  });

  it('avec un compte : tout est là, sans les variantes', () => {
    for (const page of PAGES_DU_COMPTE) {
      expect(existsSync(join(avec, page, 'index.html')), page).toBe(true);
    }
    const accueil = readFileSync(join(avec, 'index.html'), 'utf8');
    expect(accueil).toContain('href="studio/?compte=creer">Créer un compte gratuit</a>');
    expect(accueil).toContain('Studio · gratuit<span>, avec ou sans compte</span>');
    expect(readFileSync(join(avec, 'en/index.html'), 'utf8')).toContain('Create a free account');
    const confidentialite = readFileSync(join(avec, 'confidentialite/index.html'), 'utf8');
    expect(confidentialite).toContain("<b>Des transferts hors de l'Union européenne.</b>");
    expect(confidentialite).toContain("<h2>8. Traceurs et mesure d'audience</h2>");
    for (const page of pagesDe(avec)) {
      expect(readFileSync(join(avec, page), 'utf8'), page).not.toMatch(/data-(sans-)?compte/);
    }
  });

  it('les pages de site/ ne changent pas', () => {
    for (const [page, html] of Object.entries(avant)) {
      expect(readFileSync(join(site, page), 'utf8'), page).toBe(html);
    }
    expect(() => publier(site, join(site, 'publie'), false)).toThrow('hors de site/');
  });
});
