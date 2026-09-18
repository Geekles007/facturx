import { describe, expect, it, vi } from 'vitest';
import { CHEMIN_COMPTEUR, compterControle } from './compteur.js';

/**
 * Le validateur promet que le fichier ne bouge pas. Ce que le compteur envoie est donc à vérifier
 * comme une promesse : l'URL, rien de plus qu'elle, et jamais d'incident visible par le visiteur.
 */
describe('décompte des contrôles', () => {
  const url = `https://exemple.test/validateur/${CHEMIN_COMPTEUR}`;

  it("n'envoie que l'URL, sans corps ni en-tête ajouté", () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    compterControle(url, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [cible, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(cible).toBe(url);
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.headers).toBeUndefined();
    // Un compteur servi depuis le cache ne repasserait pas par le journal : il ne compterait rien.
    expect(options.cache).toBe('no-store');
  });

  it('compte une fois par appel, et une seule', () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    compterControle(url, fetcher as unknown as typeof fetch);
    compterControle(url, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('avale un refus du réseau sans rejet non rattrapé', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('réseau coupé'));
    expect(() => compterControle(url, fetcher as unknown as typeof fetch)).not.toThrow();
    // Le rejet est rattrapé dans la fonction : un tour de boucle suffit à le prouver.
    await Promise.resolve();
  });

  it('avale un fetch entravé qui échoue sur-le-champ', () => {
    const fetcher = vi.fn().mockImplementation(() => {
      throw new Error('fetch indisponible');
    });
    expect(() => compterControle(url, fetcher as unknown as typeof fetch)).not.toThrow();
  });
});
