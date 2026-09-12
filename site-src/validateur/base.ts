/**
 * Résolution des ressources de la page.
 *
 * Une URL saisie sans barre finale (`/validateur`) ferait remonter d'un cran toutes les adresses
 * relatives : on rétablit la barre avant de résoudre quoi que ce soit.
 */
export function pageBase(): string {
  const url = new URL(document.baseURI);
  const last = url.pathname.split('/').pop() ?? '';
  if (last !== '' && !last.includes('.')) url.pathname += '/';
  return url.href;
}

/** URL absolue d'une ressource servie à côté de la page. */
export const assetUrl = (path: string): string => new URL(path, pageBase()).href;
