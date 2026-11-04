/**
 * Les fichiers TTF de chaque famille du Studio, par `id` de `FONT_FAMILIES` : le Studio les sert
 * sous `polices/`, les Edge Functions les lisent pour rendre le même PDF que l'aperçu.
 *
 * Le module n'importe rien : Deno ne résout pas un `./x.js` vers `./x.ts`.
 */
export const FICHIERS_POLICES: Record<string, { regular: string; bold: string }> = {
  geist: { regular: 'geist-regular.ttf', bold: 'geist-semibold.ttf' },
  inter: { regular: 'inter-regular.ttf', bold: 'inter-semibold.ttf' },
  plex: { regular: 'plex-regular.ttf', bold: 'plex-semibold.ttf' },
  'dm-sans': { regular: 'dmsans-regular.ttf', bold: 'dmsans-semibold.ttf' },
  'source-serif': { regular: 'sourceserif-regular.ttf', bold: 'sourceserif-semibold.ttf' },
  baskerville: { regular: 'baskerville-regular.ttf', bold: 'baskerville-bold.ttf' },
  'geist-mono': { regular: 'geistmono-regular.ttf', bold: 'geistmono-semibold.ttf' },
};
