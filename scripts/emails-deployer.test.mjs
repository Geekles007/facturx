import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clesQuiDifferent, corpsDesModeles, deployer } from './emails-deployer.mjs';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossierDesModeles = join(racine, 'supabase/templates');
const script = join(racine, 'scripts/emails-deployer.mjs');

const MODELES = ['confirmation', 'recovery', 'email_change', 'magic_link', 'reauthentication'];
const DIX_CLES = MODELES.flatMap((m) => [`mailer_subjects_${m}`, `mailer_templates_${m}_content`]);

const REF = 'abcdefghijklmnopqrst';
const JETON = 'sbp_jeton-de-test';
const URL_CONFIG = `https://api.supabase.com/v1/projects/${REF}/config/auth`;

// Ce que l'API de gestion rend en plus des modèles : la configuration entière, secrets compris.
const SECRETS = { smtp_pass: 'secret-de-test', external_google_secret: 'autre-secret' };

/** Une réponse JSON de l'API de gestion. */
const reponseJson = (corps, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });

/**
 * Un `fetch` doublure : note chaque appel et répond `patch` puis `get` (des fonctions de la réponse
 * attendue, qui reçoivent le corps envoyé). Toute réponse porte des secrets, comme la vraie.
 */
function doublure({ patch, get } = {}) {
  const appels = [];
  let envoye = {};
  const fetch = async (url, options) => {
    appels.push({ url, ...options });
    if (options.method === 'PATCH') {
      envoye = JSON.parse(options.body);
      return patch ? patch(envoye) : reponseJson({ ...envoye, ...SECRETS });
    }
    return get
      ? get(envoye)
      : reponseJson({ ...envoye, ...SECRETS, site_url: 'https://facturx.dev' });
  };
  return { fetch, appels };
}

/** Appelle `deployer` avec la doublure ; rend le journal, les appels et l'erreur levée (ou `null`). */
async function lancer(options = {}) {
  const { fetch, appels } = doublure(options);
  const journal = [];
  let erreur = null;
  try {
    await deployer({
      ref: REF,
      jeton: JETON,
      dossier: dossierDesModeles,
      fetch,
      journal: (ligne) => journal.push(ligne),
    });
  } catch (e) {
    erreur = e;
  }
  return { journal, appels, erreur };
}

/**
 * `pnpm emails:deployer` envoie à la production les objets et les modèles du compte
 * (supabase/templates/) par l'API de gestion de Supabase, et ne montre rien de ses réponses : elles
 * contiennent toute la configuration d'authentification, mot de passe SMTP compris.
 */
describe('corpsDesModeles', () => {
  it('rend exactement les dix clés mailer_* des cinq modèles, avec le contenu des fichiers', () => {
    const corps = corpsDesModeles(dossierDesModeles);
    expect(Object.keys(corps).sort()).toEqual([...DIX_CLES].sort());

    const objets = JSON.parse(readFileSync(join(dossierDesModeles, 'objets.json'), 'utf8'));
    for (const modele of MODELES) {
      expect(corps[`mailer_subjects_${modele}`]).toBe(objets[modele]);
      expect(corps[`mailer_templates_${modele}_content`]).toBe(
        readFileSync(join(dossierDesModeles, `${modele}.html`), 'utf8'),
      );
    }
    expect(corps.mailer_templates_confirmation_content).toContain('</html>');
  });

  describe('dossier incomplet', () => {
    let dossier;
    beforeEach(() => {
      dossier = mkdtempSync(join(tmpdir(), 'modeles-'));
    });
    afterEach(() => {
      rmSync(dossier, { recursive: true, force: true });
    });

    it('lève si un modèle manque', () => {
      writeFileSync(join(dossier, 'objets.json'), JSON.stringify({ confirmation: 'Objet' }));
      expect(() => corpsDesModeles(dossier)).toThrow(/confirmation\.html/);
    });

    it('lève si objets.json manque', () => {
      expect(() => corpsDesModeles(dossier)).toThrow(/objets\.json/);
    });

    it('lève plutôt que d’envoyer un modèle ou un objet vide', () => {
      writeFileSync(join(dossier, 'objets.json'), JSON.stringify({ confirmation: 'Objet' }));
      writeFileSync(join(dossier, 'confirmation.html'), '  \n');
      expect(() => corpsDesModeles(dossier)).toThrow(/confirmation/);

      writeFileSync(join(dossier, 'objets.json'), JSON.stringify({ confirmation: '' }));
      writeFileSync(join(dossier, 'confirmation.html'), '<html></html>');
      expect(() => corpsDesModeles(dossier)).toThrow(/confirmation/);
    });
  });
});

describe('clesQuiDifferent', () => {
  it('ne rend rien quand tout est égal, quoi que la configuration lue contienne en plus', () => {
    const envoye = { a: '1', b: '2' };
    expect(clesQuiDifferent(envoye, { ...envoye, ...SECRETS })).toEqual([]);
  });

  it('rend, triées, les clés dont la valeur lue diffère ou manque', () => {
    const envoye = { z: '1', b: '2', m: '3' };
    expect(clesQuiDifferent(envoye, { z: 'autre', m: '3' })).toEqual(['b', 'z']);
  });
});

describe('deployer', () => {
  it('envoie un PATCH aux seules dix clés, avec le jeton, puis relit la configuration', async () => {
    const { journal, appels, erreur } = await lancer();
    expect(erreur).toBeNull();

    expect(appels.map((a) => [a.method, a.url])).toEqual([
      ['PATCH', URL_CONFIG],
      ['GET', URL_CONFIG],
    ]);
    const [patch, get] = appels;
    expect(patch.headers.Authorization).toBe(`Bearer ${JETON}`);
    expect(patch.headers['Content-Type']).toBe('application/json');
    expect(get.headers.Authorization).toBe(`Bearer ${JETON}`);
    expect(Object.keys(JSON.parse(patch.body)).sort()).toEqual([...DIX_CLES].sort());
    expect(JSON.parse(patch.body)).toEqual(corpsDesModeles(dossierDesModeles));

    expect(journal).toEqual([
      'PATCH config/auth : 200',
      'GET config/auth : 200',
      'modèles identiques',
    ]);
  });

  it('n’écrit rien d’une réponse, secrets compris', async () => {
    const { journal, erreur } = await lancer();
    expect(erreur).toBeNull();
    for (const ligne of journal) {
      expect(ligne).not.toContain('secret');
      expect(ligne).not.toContain(JETON);
    }
  });

  it('lève, sans valeur, quand la configuration relue diffère sur une clé', async () => {
    const { journal, erreur } = await lancer({
      get: (envoye) =>
        reponseJson({ ...envoye, ...SECRETS, mailer_subjects_recovery: 'Un autre objet' }),
    });
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.message).toContain('mailer_subjects_recovery');
    expect(erreur.message).not.toContain('mailer_subjects_confirmation');
    expect(erreur.message).not.toContain('Un autre objet');
    expect(erreur.message).not.toContain('secret');
    for (const ligne of journal) expect(ligne).not.toContain('secret');
    expect(journal).not.toContain('modèles identiques');
  });

  it('lève avec le code, sans le corps, quand le PATCH est refusé, et ne relit rien', async () => {
    const { journal, appels, erreur } = await lancer({
      patch: () => reponseJson({ message: 'Unauthorized', ...SECRETS }, 401),
    });
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.message).toContain('401');
    expect(erreur.message).not.toContain('Unauthorized');
    expect(erreur.message).not.toContain('secret');
    expect(erreur.message).not.toContain(JETON);
    expect(appels.map((a) => a.method)).toEqual(['PATCH']);
    expect(journal).toEqual(['PATCH config/auth : 401']);
  });

  it('lève avec le code, sans le corps, quand le GET est refusé', async () => {
    const { journal, erreur } = await lancer({
      get: () => reponseJson({ message: 'Server Error', ...SECRETS }, 500),
    });
    expect(erreur.message).toContain('500');
    expect(erreur.message).not.toContain('Server Error');
    expect(erreur.message).not.toContain('secret');
    expect(journal).toEqual(['PATCH config/auth : 200', 'GET config/auth : 500']);
  });

  it('ne cite rien du corps quand la réponse du GET n’est pas du JSON', async () => {
    const { erreur } = await lancer({
      get: () => new Response('secret-de-test: smtp_pass', { status: 200 }),
    });
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.message).not.toContain('secret');
    expect(erreur.message).not.toContain('smtp_pass');
  });

  it('ne cite rien d’une requête qui échoue en route', async () => {
    const journal = [];
    const erreur = await deployer({
      ref: REF,
      jeton: JETON,
      dossier: dossierDesModeles,
      fetch: async () => {
        throw new TypeError(`fetch failed : Bearer ${JETON}`);
      },
      journal: (ligne) => journal.push(ligne),
    }).catch((e) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.message).not.toContain(JETON);
    expect(erreur.cause).toBeUndefined();
    expect(journal).toEqual([]);
  });
});

describe('pnpm emails:deployer', () => {
  // Jamais de réseau : sans l'une des deux variables, le script refuse avant tout appel.
  const lancerSans = (variables) => {
    const env = { ...process.env };
    delete env.SUPABASE_ACCESS_TOKEN;
    delete env.SUPABASE_PROJECT_REF;
    return spawnSync(process.execPath, [script], {
      env: { ...env, ...variables },
      encoding: 'utf8',
    });
  };

  it('refuse, en nommant les variables sans valeur, quand elles manquent', () => {
    const sansRien = lancerSans({});
    expect(sansRien.status).toBe(1);
    expect(sansRien.stderr).toContain('SUPABASE_ACCESS_TOKEN');
    expect(sansRien.stderr).toContain('SUPABASE_PROJECT_REF');

    const sansJeton = lancerSans({ SUPABASE_PROJECT_REF: REF });
    expect(sansJeton.status).toBe(1);
    expect(sansJeton.stderr).toContain('SUPABASE_ACCESS_TOKEN');
    expect(sansJeton.stderr).not.toContain(REF);

    const sansProjet = lancerSans({ SUPABASE_ACCESS_TOKEN: JETON });
    expect(sansProjet.status).toBe(1);
    expect(sansProjet.stderr).toContain('SUPABASE_PROJECT_REF');
    expect(sansProjet.stderr).not.toContain(JETON);
  });
});
