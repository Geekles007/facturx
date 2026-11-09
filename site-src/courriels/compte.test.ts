import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { MODELES, type Modele, modelesDuCompte } from './compte.js';

/** Un fichier du dépôt, lu à partir de sa racine. */
const lire = (chemin: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf8');

const modeles = modelesDuCompte();

const COMPARAISON = 'eq (printf "%v" .Data.langue) "en"';
/** Les seules actions Go qu'un modèle ou un objet du compte peut porter. */
const ADMISES = [
  `$en := ${COMPARAISON}`,
  'if $en',
  `if ${COMPARAISON}`,
  'else',
  'end',
  '.ConfirmationURL',
  '.Email',
  '.NewEmail',
  '.Token',
];

const ACTION = /\{\{ (.+?) \}\}/g;
const actions = (texte: string): string[] => [...texte.matchAll(ACTION)].map((m) => m[1] as string);

/** Le texte lisible d'un document : sans action Go, sans balise, sans feuille de style. */
const visible = (html: string): string =>
  html
    .replace(ACTION, '')
    .replace(/<style>.*?<\/style>/gs, '')
    .replace(/<[^>]*>/g, '');

const DEBUT = `{{ $en := ${COMPARAISON} }}{{ if $en }}`;
const FIN = '{{ end }}';

/** Les deux documents d'un modèle : l'anglais, puis le français. */
function parties(html: string): { en: string; fr: string } {
  const forme = '`{{ $en := … }}{{ if $en }}<anglais>{{ else }}<français>{{ end }}`';
  if (!html.startsWith(DEBUT) || !html.endsWith(FIN)) throw new Error(`un modèle est ${forme}`);
  const documents = html.slice(DEBUT.length, -FIN.length).split('{{ else }}');
  const [en, fr] = documents;
  if (
    documents.length !== 2 ||
    !en?.startsWith('<!doctype html>') ||
    !fr?.startsWith('<!doctype html>')
  ) {
    throw new Error(`un modèle est ${forme}`);
  }
  return { en, fr };
}

type Texte = {
  objet: string;
  preheader: string;
  texte: string;
  bouton?: string;
  mention: string;
};

const INTRO = {
  fr: 'Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :',
  en: 'Button not working? Copy this link into your browser:',
};

/** Les textes du plan, tels qu'on les lira : ce test fige la copie. */
const TEXTES: Record<Modele, { fr: Texte; en: Texte }> = {
  confirmation: {
    fr: {
      objet: 'Confirmez votre adresse e-mail',
      preheader: 'Un clic pour activer votre compte facturx.',
      texte:
        'Vous venez de créer un compte facturx avec l’adresse {{ .Email }}. Confirmez-la pour conserver vos factures et relancer vos clients.',
      bouton: 'Confirmer mon adresse',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail : le compte ne sera pas activé.',
    },
    en: {
      objet: 'Confirm your email address',
      preheader: 'One click to activate your facturx account.',
      texte:
        'You just created a facturx account with the address {{ .Email }}. Confirm it to keep your invoices and send payment reminders.',
      bouton: 'Confirm my address',
      mention: 'Didn’t ask for this? Ignore this email: the account won’t be activated.',
    },
  },
  recovery: {
    fr: {
      objet: 'Réinitialisez votre mot de passe',
      preheader: 'Choisissez un nouveau mot de passe pour votre compte facturx.',
      texte: 'Un nouveau mot de passe a été demandé pour le compte facturx {{ .Email }}.',
      bouton: 'Choisir un nouveau mot de passe',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail : votre mot de passe ne change pas.',
    },
    en: {
      objet: 'Reset your password',
      preheader: 'Choose a new password for your facturx account.',
      texte: 'A new password was requested for the facturx account {{ .Email }}.',
      bouton: 'Choose a new password',
      mention: 'Didn’t ask for this? Ignore this email: your password stays the same.',
    },
  },
  email_change: {
    fr: {
      objet: 'Confirmez le changement d’adresse',
      preheader: 'Le changement se fait quand les deux adresses l’ont confirmé.',
      texte:
        'Une demande remplace l’adresse du compte facturx, {{ .Email }}, par {{ .NewEmail }}. Le changement se fait quand les deux adresses l’ont confirmé.',
      bouton: 'Confirmer le changement',
      mention:
        'Vous n’avez rien demandé ? Ne cliquez pas : l’adresse ne change pas sans cette confirmation.',
    },
    en: {
      objet: 'Confirm your email change',
      preheader: 'The change happens once both addresses have confirmed it.',
      texte:
        'A request replaces the facturx account address, {{ .Email }}, with {{ .NewEmail }}. The change happens once both addresses have confirmed it.',
      bouton: 'Confirm the change',
      mention:
        'Didn’t ask for this? Don’t click: the address won’t change without this confirmation.',
    },
  },
  magic_link: {
    fr: {
      objet: 'Votre lien de connexion',
      preheader: 'Connectez-vous à facturx en un clic.',
      texte: 'Un lien de connexion a été demandé pour le compte facturx {{ .Email }}.',
      bouton: 'Me connecter',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail.',
    },
    en: {
      objet: 'Your sign-in link',
      preheader: 'Sign in to facturx in one click.',
      texte: 'A sign-in link was requested for the facturx account {{ .Email }}.',
      bouton: 'Sign in',
      mention: 'Didn’t ask for this? Ignore this email.',
    },
  },
  reauthentication: {
    fr: {
      objet: 'Votre code de vérification',
      preheader: 'Le code pour confirmer une opération sur votre compte facturx.',
      texte: 'Voici le code demandé pour confirmer une opération sur votre compte facturx :',
      mention:
        'Vous n’avez rien demandé ? Quelqu’un utilise peut-être votre session : changez votre mot de passe.',
    },
    en: {
      objet: 'Your verification code',
      preheader: 'The code to confirm an operation on your facturx account.',
      texte: 'Here is the code requested to confirm an operation on your facturx account:',
      mention: 'Didn’t ask for this? Someone may be using your session: change your password.',
    },
  },
};

describe('les modèles d’e-mail du compte', () => {
  test('les cinq modèles de Supabase Auth', () => {
    expect([...MODELES]).toEqual([
      'confirmation',
      'recovery',
      'email_change',
      'magic_link',
      'reauthentication',
    ]);
    expect(Object.keys(modeles)).toEqual([...MODELES]);
  });

  describe.each(MODELES)('%s', (modele) => {
    const { objet, html } = modeles[modele];

    test('n’emploie que les actions Go admises', () => {
      for (const action of [...actions(html), ...actions(objet)]) {
        expect(ADMISES, `{{ ${action} }}`).toContain(action);
      }
      // Aucune action mal formée (ni ouverte sans espace, ni jamais fermée).
      expect(html.replace(ACTION, '')).not.toContain('{{');
      expect(objet.replace(ACTION, '')).not.toContain('{{');
    });

    test('ne lit `.Data` que pour comparer la langue', () => {
      const lectures = [...actions(html), ...actions(objet)].filter((a) => a.includes('.Data'));
      expect(lectures.length).toBeGreaterThan(0);
      for (const lecture of lectures) expect(lecture).toContain(COMPARAISON);
      expect(html).not.toMatch(/\{\{ \.Data/);
      expect(objet).not.toMatch(/\{\{ \.Data/);
    });

    test('est un document anglais puis un document français, choisis par la langue', () => {
      const { en, fr } = parties(html);
      expect(en.match(/lang="en"/g)).toHaveLength(1);
      expect(en).not.toContain('lang="fr"');
      expect(fr.match(/lang="fr"/g)).toHaveLength(1);
      expect(fr).not.toContain('lang="en"');
      // Chaque moitié est un document seul : les actions de choix l'entourent, rien d'autre.
      expect(actions(en).filter((a) => ['if $en', 'else', 'end'].includes(a))).toEqual([]);
      expect(actions(fr).filter((a) => ['if $en', 'else', 'end'].includes(a))).toEqual([]);
      expect(en.endsWith('</html>')).toBe(true);
      expect(fr.endsWith('</html>')).toBe(true);
    });

    test('a pour objet ses deux textes, anglais puis français', () => {
      expect(objet).toBe(
        `{{ if ${COMPARAISON} }}${TEXTES[modele].en.objet}{{ else }}${TEXTES[modele].fr.objet}{{ end }}`,
      );
    });

    test('pèse moins de 30 Kio', () => {
      expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
    });

    test('ne charge aucune ressource distante', () => {
      expect(html).not.toMatch(/<(img|link|script|iframe)\b|url\(|@import|src=/i);
    });

    test('porte les variables de son modèle, et elles seules', () => {
      expect(html.includes('{{ .NewEmail }}')).toBe(modele === 'email_change');
      expect(html.includes('{{ .Token }}')).toBe(modele === 'reauthentication');
      expect(html.includes('{{ .ConfirmationURL }}')).toBe(modele !== 'reauthentication');
      for (const variable of ['{{ .NewEmail }}', '{{ .Token }}', '{{ .ConfirmationURL }}']) {
        expect(objet).not.toContain(variable);
      }
    });

    test.each(['fr', 'en'] as const)('%s : dit ce que dit le plan', (lang) => {
      const t = TEXTES[modele][lang];
      const partie = parties(html)[lang];
      expect(partie).toContain(`<h1 `);
      expect(partie).toContain(`>${t.objet}</h1>`);
      expect(partie).toContain(`>${t.preheader}</div>`);
      expect(partie).toContain(`>${t.texte}</p>`);
      expect(partie).toContain(`>${t.mention}</p>`);
      expect(partie).toContain('>facturx</td>');
      expect(partie).toContain('>facturx · facturx.ibird.dev</td>');
      if (t.bouton === undefined) {
        // Pas de lien : un code à recopier.
        expect(partie).toContain('>{{ .Token }}</p>');
        expect(partie).not.toContain('<a ');
        expect(partie).not.toContain(INTRO[lang]);
      } else {
        expect(partie).toContain(`>${t.bouton}</a>`);
        expect(partie).toContain('<a class="bouton-texte" href="{{ .ConfirmationURL }}"');
        expect(partie).toContain(
          `${INTRO[lang]}<br><a class="secondaire" href="{{ .ConfirmationURL }}"`,
        );
        expect(partie).toContain('>{{ .ConfirmationURL }}</a>');
      }
    });

    test('français : aucune espace ordinaire devant ? : ; !', () => {
      const fr = visible(parties(html).fr);
      expect(fr).toContain(TEXTES[modele].fr.mention);
      expect(fr).not.toMatch(/ [?:;!]/);
    });

    test('aucune apostrophe droite dans le texte visible', () => {
      for (const partie of Object.values(parties(html))) {
        expect(visible(partie)).not.toMatch(/'|&#39;/);
      }
      expect(objet.replace(ACTION, '')).not.toContain("'");
    });
  });
});

describe('les fichiers générés', () => {
  const consigne = 'lancer `pnpm emails:construire`';

  /** Un fichier de supabase/templates/ ; absent, l'échec dit comment l'écrire. */
  function genere(nom: string): string {
    try {
      return lire(`supabase/templates/${nom}`);
    } catch {
      throw new Error(`supabase/templates/${nom} manque : ${consigne}.`);
    }
  }

  test.each(MODELES)('supabase/templates/%s.html est à jour', (modele) => {
    expect(genere(`${modele}.html`), `à jour ? ${consigne}`).toBe(modeles[modele].html);
  });

  test('supabase/templates/objets.json est à jour', () => {
    const objets = Object.fromEntries(MODELES.map((modele) => [modele, modeles[modele].objet]));
    expect(genere('objets.json'), `à jour ? ${consigne}`).toBe(
      `${JSON.stringify(objets, null, 2)}\n`,
    );
  });
});

describe('la pile locale', () => {
  const config = lire('supabase/config.toml');
  const objets = JSON.parse(lire('supabase/templates/objets.json')) as Record<Modele, string>;

  test.each(MODELES)(
    '[auth.email.template.%s] emploie l’objet et le fichier du dépôt',
    (modele) => {
      // Le corps de la section (les lignes jusqu'à la section suivante) ; une section commentée ne compte pas.
      const section = new RegExp(
        `^\\[auth\\.email\\.template\\.${modele}\\]\\n([^\\[]*)`,
        'm',
      ).exec(config);
      expect(
        section,
        `config.toml n’a pas de section [auth.email.template.${modele}]`,
      ).not.toBeNull();
      const corps = section?.[1] ?? '';
      // L'objet est une chaîne littérale TOML : il contient des guillemets, pas d'apostrophe droite.
      expect(/^subject = '([^']*)'$/m.exec(corps)?.[1]).toBe(objets[modele]);
      expect(/^content_path = "([^"]*)"$/m.exec(corps)?.[1]).toBe(
        `./supabase/templates/${modele}.html`,
      );
    },
  );

  test('ne personnalise que les cinq modèles du compte', () => {
    const sections = [...config.matchAll(/^\[auth\.email\.template\.([\w]+)\]$/gm)].map(
      (m) => m[1],
    );
    expect(sections.sort()).toEqual([...MODELES].sort());
  });
});
