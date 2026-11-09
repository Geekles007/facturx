import { describe, expect, test } from 'vitest';
import {
  bouton,
  COULEURS,
  COUPLES,
  cadre,
  code,
  date,
  echapper,
  encadre,
  lienEnClair,
  mention,
  montant,
  paragraphes,
  titre,
} from './courriel.js';

/** La luminance relative d'une couleur `#rrggbb` (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Le rapport de contraste entre deux couleurs `#rrggbb`, de 1 à 21. */
function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (clair + 0.05) / (sombre + 0.05);
}

/** Un e-mail qui emploie chaque fonction du module, pour regarder ce qui sort. */
const complet = (lang: 'fr' | 'en' = 'fr') =>
  cadre({
    lang,
    preheader: 'Confirmez votre adresse',
    entete: 'facturx',
    contenu: [
      titre('Bienvenue'),
      paragraphes('Bonjour,\nvoici.\n\nÀ bientôt.'),
      encadre([
        ['Facture', 'F-2026-0042'],
        ['Reste dû', '1 250,00 €'],
      ]),
      bouton('Confirmer', '{{ .ConfirmationURL }}'),
      lienEnClair('Ou copiez ce lien :', '{{ .ConfirmationURL }}'),
      code('123456'),
      mention('Vous n’avez rien demandé ? Ignorez cet e-mail.'),
    ].join(''),
    pied: 'facturx · facturx.ibird.dev',
  });

describe('echapper', () => {
  test('les cinq caractères, & d’abord', () => {
    expect(echapper(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test('une entité déjà écrite est échappée à son tour, pas laissée', () => {
    expect(echapper('&lt;')).toBe('&amp;lt;');
  });

  test('une action Go sans guillemets traverse intacte', () => {
    expect(echapper('{{ .ConfirmationURL }}')).toBe('{{ .ConfirmationURL }}');
  });
});

describe('montant et date', () => {
  test('montant : les deux décimales, dans la langue et la devise', () => {
    expect(montant(125000, 'EUR', 'fr')).toBe('1 250,00 €');
    expect(montant(125000, 'USD', 'en')).toBe('US$1,250.00');
  });

  test('date : jour/mois/année, dans la langue', () => {
    expect(date('2026-11-08', 'fr')).toBe('08/11/2026');
    expect(date('2026-11-08', 'en')).toBe('08/11/2026');
    expect(date('2026-03-04', 'fr')).toBe('04/03/2026');
  });

  test('date : une date illisible reste telle quelle', () => {
    expect(date('bientôt', 'fr')).toBe('bientôt');
    expect(date('2026-11-8', 'en')).toBe('2026-11-8');
  });
});

describe('paragraphes', () => {
  test('une ligne vide sépare les paragraphes, un retour simple devient <br>, le texte est échappé', () => {
    const html = paragraphes('a\nb\n\n<c>');
    expect(html.match(/<p[ >]/g)).toHaveLength(2);
    expect(html.match(/<br>/g)).toHaveLength(1);
    expect(html).toContain('a<br>b');
    expect(html).toContain('&lt;c&gt;');
    expect(html).not.toContain('<c>');
  });

  test('fins de ligne Windows et paragraphes vides', () => {
    expect(paragraphes('a\r\n\r\nb').match(/<p[ >]/g)).toHaveLength(2);
    expect(paragraphes('  \n\n \r\n')).toBe('');
  });
});

describe('les éléments', () => {
  test('chacun échappe ses arguments', () => {
    expect(titre('<i>x</i>')).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(mention('a & b')).toContain('a &amp; b');
    expect(code('1<2')).toContain('1&lt;2');
    expect(lienEnClair('<intro>', 'https://x.test/?a=1&b="2"')).toContain('&lt;intro&gt;');
    expect(lienEnClair('i', 'https://x.test/?a=1&b="2"')).toContain(
      'href="https://x.test/?a=1&amp;b=&quot;2&quot;"',
    );
    const e = encadre([['<k>', '&']]);
    expect(e).toContain('&lt;k&gt;');
    expect(e).toContain('&amp;');
    expect(e).not.toContain('<k>');
    const b = bouton('<Go>', 'x"y');
    expect(b).toContain('&lt;Go&gt;');
    expect(b).toContain('href="x&quot;y"');
  });

  test('une action Go sans guillemets traverse l’échappement dans le lien du bouton', () => {
    expect(bouton('Go', '{{ .ConfirmationURL }}')).toContain('href="{{ .ConfirmationURL }}"');
  });

  test('l’encadré garde l’ordre de ses lignes', () => {
    const e = encadre([
      ['Facture', 'F-1'],
      ['Reste dû', '10,00 €'],
    ]);
    expect(e.indexOf('Facture')).toBeLessThan(e.indexOf('F-1'));
    expect(e.indexOf('F-1')).toBeLessThan(e.indexOf('Reste dû'));
    expect(e.indexOf('Reste dû')).toBeLessThan(e.indexOf('10,00 €'));
  });
});

describe('cadre', () => {
  test('un document complet, en français par défaut dans l’appel, en anglais sur demande', () => {
    const html = complet();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(complet('en')).toContain('<html lang="en"');
    expect(complet('en')).not.toContain('lang="fr"');
  });

  test('mode sombre : la méta color-scheme et la règle prefers-color-scheme', () => {
    const html = complet();
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)/);
    // Les classes surchargent les styles en ligne : sans !important, elles perdraient.
    expect(html.match(/@media[^<]*<\/style>/)?.[0]).toContain('!important');
  });

  test('le préheader est du texte, échappé, dans un élément caché', () => {
    const html = cadre({ lang: 'fr', preheader: 'A & <B>', contenu: '', pied: '' });
    expect(html).toMatch(/<div style="display:none[^"]*">A &amp; &lt;B&gt;<\/div>/);
    expect(html).not.toContain('<B>');
  });

  test('l’en-tête et le pied sont du texte, échappés ; sans en-tête, pas de ligne en tête', () => {
    const html = cadre({
      lang: 'fr',
      preheader: 'p',
      entete: '<b>A & B</b>',
      contenu: '',
      pied: '"x"',
    });
    expect(html).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
    expect(html).toContain('&quot;x&quot;');
    expect(html).not.toContain('<b>');

    const sans = cadre({ lang: 'fr', preheader: 'p', contenu: '', pied: 'pied' });
    const lignes = (h: string) => h.match(/<tr>/g)?.length ?? 0;
    expect(lignes(sans)).toBe(lignes(html) - 1);
  });

  test('le contenu est du HTML, repris tel quel', () => {
    expect(cadre({ lang: 'fr', preheader: 'p', contenu: '<p>ok</p>', pied: '' })).toContain(
      '<p>ok</p>',
    );
  });

  test('aucune ressource distante, aucune mise en page que Gmail ou Outlook ignorent', () => {
    const html = complet();
    for (const interdit of [
      'src=',
      'url(',
      '@import',
      '<link',
      '<img',
      '<script',
      'display:flex',
      'display:grid',
      'http://',
      'https://',
    ])
      expect(html, interdit).not.toContain(interdit);
  });

  test('des tableaux de présentation, 560 px au plus', () => {
    const html = complet();
    const tableaux = html.match(/<table/g)?.length ?? 0;
    expect(tableaux).toBeGreaterThan(0);
    expect(html.match(/<table[^>]*role="presentation"/g)).toHaveLength(tableaux);
    expect(html).toContain('max-width:560px');
    expect(html).toContain('width="560"');
  });

  test('léger : bien sous les 30 Kio', () => {
    expect(new TextEncoder().encode(complet()).length).toBeLessThan(10 * 1024);
  });

  test('chaque couleur du document est une couleur déclarée par le module', () => {
    const declarees = new Set<string>(
      [...Object.values(COULEURS.clair), ...Object.values(COULEURS.sombre)].map((c) =>
        c.toLowerCase(),
      ),
    );
    const employees = complet().match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(employees.length).toBeGreaterThan(0);
    for (const c of employees) expect(declarees, c).toContain(c.toLowerCase());
  });
});

describe('contraste', () => {
  test('les couples déclarés couvrent le clair et le sombre', () => {
    expect(COUPLES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(COUPLES.map((c) => c.theme))).toEqual(new Set(['clair', 'sombre']));
  });

  test('aucun texte du cadre sous 4,5:1 sur son fond', () => {
    for (const { theme, nom, texte, fond } of COUPLES)
      expect(contraste(texte, fond), `${theme} · ${nom}`).toBeGreaterThanOrEqual(4.5);
  });

  test('le calcul de contraste lui-même (noir/blanc 21:1, gris moyen 4,5:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(contraste('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});
