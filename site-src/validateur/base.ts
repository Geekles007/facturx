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

/**
 * URL absolue d'une ressource du validateur.
 *
 * Par défaut elles sont servies à côté de la page. La version anglaise vit ailleurs dans
 * l'arborescence mais partage ces ressources — schematrons compilés, runtime Saxon, exemples, un
 * demi-mégaoctet au total : elle déclare leur emplacement par `data-assets` sur `<body>` plutôt
 * que d'en faire une copie.
 */
export const assetUrl = (path: string): string => {
  const declared = document.body?.dataset.assets;
  const base = declared ? new URL(declared, pageBase()).href : pageBase();
  return new URL(path, base).href;
};
