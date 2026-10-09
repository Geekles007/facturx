import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from '../site-src/validateur/schematron.ts';
import { FNFE_TAG, fetchWithRetry } from './fetch-schemas.mjs';

/**
 * Une cinquantaine de fichiers sont téléchargés à chaque construction de l'image du site : un 503
 * passager de raw.githubusercontent.com ne doit pas faire échouer un déploiement. Une erreur
 * définitive (404 : chemin faux), elle, doit échouer tout de suite.
 */
describe('téléchargement avec reprise', () => {
  /** Un `fetch` qui rend les réponses dans l'ordre et note chaque appel. */
  const scripted = (...steps) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const step = steps[calls.length - 1];
      if (step instanceof Error) throw step;
      return new Response(step === 200 ? 'contenu' : null, { status: step });
    };
    return { fetchImpl, calls };
  };
  const noWait = { delayMs: 0 };

  it('reprend après un 503 et rend la réponse suivante', async () => {
    const { fetchImpl, calls } = scripted(503, 200);
    const res = await fetchWithRetry('https://exemple/f.xsd', { ...noWait, fetchImpl });
    expect(await res.text()).toBe('contenu');
    expect(calls).toHaveLength(2);
  });

  it('reprend après une coupure réseau', async () => {
    const { fetchImpl, calls } = scripted(new TypeError('fetch failed'), 200);
    const res = await fetchWithRetry('https://exemple/f.xsd', { ...noWait, fetchImpl });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('abandonne après trois essais, en nommant le statut et l’adresse', async () => {
    const { fetchImpl, calls } = scripted(503, 502, 500, 200);
    await expect(fetchWithRetry('https://exemple/f.xsd', { ...noWait, fetchImpl })).rejects.toThrow(
      '500 https://exemple/f.xsd',
    );
    expect(calls).toHaveLength(3);
  });

  it('ne reprend pas un 404 : le chemin est faux, réessayer n’y changera rien', async () => {
    const { fetchImpl, calls } = scripted(404, 200);
    await expect(fetchWithRetry('https://exemple/f.xsd', { ...noWait, fetchImpl })).rejects.toThrow(
      '404 https://exemple/f.xsd',
    );
    expect(calls).toHaveLength(1);
  });
});

/**
 * `pnpm validator:fetch` publie les jeux de règles sous `schemas/<FNFE_TAG>/`, et le validateur les
 * demande sous `schemas/<RULES_VERSION>/`. Changer de version d'un côté seulement ferait demander au
 * site un dossier qui n'existe pas : chaque schematron finirait « non exécuté », en production.
 */
describe('version des jeux de règles publiés', () => {
  it('le validateur demande ceux que la récupération dépose', () => {
    expect(FNFE_TAG).toMatch(/^v\d+(\.\d+)+$/);
    expect(RULES_VERSION).toBe(FNFE_TAG);
  });
});
