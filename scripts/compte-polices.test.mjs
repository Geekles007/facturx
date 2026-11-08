import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deposerPolices } from './compte-polices.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'compte-polices.mjs');
const URL_LOCALE = 'http://127.0.0.1:55421';
const CLE = 'cle-de-service-qui-ne-doit-jamais-sortir';

/** Un client Supabase factice : note chaque appel `storage.from(bucket).upload(chemin, corps, options)`. */
function clientFactice({ erreurPour, message = 'Bucket not found' } = {}) {
  const envois = [];
  const client = {
    storage: {
      from: (bucket) => ({
        upload: async (chemin, corps, options) => {
          envois.push({ bucket, chemin, corps, options });
          if (chemin === erreurPour) return { data: null, error: { message } };
          return { data: { path: chemin }, error: null };
        },
      }),
    },
  };
  return { client, envois };
}

/**
 * `pnpm compte:polices` dépose les polices du Studio (site/studio/polices/, construites par
 * `pnpm site:build`) dans le bucket public `polices`, que les Edge Functions lisent pour produire les
 * PDF. Sans elles, aucune facture ne s'émet : le script refuse plutôt que de ne rien envoyer.
 */
describe('dépôt des polices du Studio', () => {
  let dossier;
  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'polices-'));
  });
  afterEach(() => {
    rmSync(dossier, { recursive: true, force: true });
  });

  const poser = (nom, octets = 'ttf') => writeFileSync(join(dossier, nom), octets);

  it('envoie chaque TTF dans le bucket polices, sous son nom, en écrasant', async () => {
    // Posées dans le désordre : l'ordre d'envoi ne dépend pas de celui du système de fichiers.
    poser('inter-regular.ttf');
    poser('geist-semibold.ttf', 'octets-semibold');
    poser('geist-regular.ttf', 'octets-regular');
    const { client, envois } = clientFactice();

    const envoyees = await deposerPolices({ url: URL_LOCALE, cle: CLE, dossier, client });

    expect(envoyees).toBe(3);
    expect(envois.map((e) => [e.bucket, e.chemin])).toEqual([
      ['polices', 'geist-regular.ttf'],
      ['polices', 'geist-semibold.ttf'],
      ['polices', 'inter-regular.ttf'],
    ]);
    for (const envoi of envois) {
      expect(envoi.options).toMatchObject({ upsert: true, contentType: 'font/ttf' });
    }
    expect(Buffer.from(envois[0].corps).toString()).toBe('octets-regular');
    expect(Buffer.from(envois[1].corps).toString()).toBe('octets-semibold');
  });

  it('ne prend que les TTF : les licences et les sous-dossiers restent', async () => {
    poser('plex-regular.ttf');
    poser('LICENCES.txt', 'SIL OFL');
    poser('notes.woff2');
    mkdirSync(join(dossier, 'dossier.ttf'));
    const { client, envois } = clientFactice();

    expect(await deposerPolices({ url: URL_LOCALE, cle: CLE, dossier, client })).toBe(1);
    expect(envois.map((e) => e.chemin)).toEqual(['plex-regular.ttf']);
  });

  it('refuse sans adresse du projet, sans envoyer', async () => {
    poser('geist-regular.ttf');
    const { client, envois } = clientFactice();

    await expect(deposerPolices({ url: '', cle: CLE, dossier, client })).rejects.toThrow(
      /SUPABASE_URL/,
    );
    await expect(deposerPolices({ cle: CLE, dossier, client })).rejects.toThrow(/SUPABASE_URL/);
    expect(envois).toEqual([]);
  });

  it('refuse sans clé de service, sans envoyer', async () => {
    poser('geist-regular.ttf');
    const { client, envois } = clientFactice();

    await expect(deposerPolices({ url: URL_LOCALE, cle: '', dossier, client })).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    await expect(deposerPolices({ url: URL_LOCALE, dossier, client })).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(envois).toEqual([]);
  });

  it('refuse un dossier vide, ou sans TTF, ou absent', async () => {
    const { client, envois } = clientFactice();
    const demande = (d) => deposerPolices({ url: URL_LOCALE, cle: CLE, dossier: d, client });

    await expect(demande(dossier)).rejects.toThrow(/pnpm site:build/);
    poser('LICENCES.txt', 'SIL OFL');
    await expect(demande(dossier)).rejects.toThrow(/pnpm site:build/);
    await expect(demande(join(dossier, 'absent'))).rejects.toThrow(/pnpm site:build/);
    expect(envois).toEqual([]);
  });

  it('dit quelle police a échoué, sans la clé, même si l’API la cite', async () => {
    poser('geist-regular.ttf');
    poser('inter-regular.ttf');
    const { client } = clientFactice({
      erreurPour: 'inter-regular.ttf',
      message: `Invalid JWT ${CLE}`,
    });

    const erreur = await deposerPolices({ url: URL_LOCALE, cle: CLE, dossier, client }).catch(
      (e) => e,
    );
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur.message).toContain('inter-regular.ttf');
    expect(erreur.message).toContain('Invalid JWT');
    expect(erreur.message).not.toContain(CLE);
  });

  describe('en ligne de commande', () => {
    /** Lance le script avec un environnement réduit : ni `SUPABASE_*` du poste, ni `.env`. */
    const lancer = (env, ...args) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...env },
      });

    it('refuse sans SUPABASE_URL ni SUPABASE_SERVICE_ROLE_KEY, et sort en erreur', () => {
      poser('geist-regular.ttf');
      const resultat = lancer({}, dossier);
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toMatch(/SUPABASE_URL/);
      expect(resultat.stdout).toBe('');
    });

    it('refuse un dossier vide', () => {
      const resultat = lancer(
        { SUPABASE_URL: URL_LOCALE, SUPABASE_SERVICE_ROLE_KEY: CLE },
        dossier,
      );
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toMatch(/pnpm site:build/);
    });

    it('n’affiche jamais la clé, même quand le dépôt échoue', () => {
      poser('geist-regular.ttf');
      // Le port 9 (discard) n'écoute pas : la connexion est refusée.
      const resultat = lancer(
        { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: CLE },
        dossier,
      );
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toMatch(/geist-regular\.ttf/);
      expect(resultat.stdout + resultat.stderr).not.toContain(CLE);
    });
  });
});
