/**
 * Polices du Studio : un choix de familles libres (licence SIL OFL), servies en TTF **statique**
 * depuis le site, plus celle que l'utilisateur importe.
 *
 * Les mêmes octets servent deux fois : le SDK les mesure et les embarque dans le PDF, le navigateur
 * les charge par `FontFace` pour peindre l'aperçu. C'est ce qui rend l'aperçu fidèle : les
 * largeurs calculées par la mise en page sont celles des glyphes que le navigateur dessine.
 */

import { pageBase } from '../validateur/base.js';

export interface FontFamily {
  id: string;
  name: string;
  kind: 'sans' | 'serif' | 'mono';
  /** Fichiers servis sous `polices/`. */
  regular: string;
  bold: string;
  /** Noms des fichiers d'origine, repris dans le code généré. */
  source: { regular: string; bold: string };
}

export const FONT_FAMILIES: FontFamily[] = [
  {
    id: 'geist',
    name: 'Geist',
    kind: 'sans',
    regular: 'geist-regular.ttf',
    bold: 'geist-semibold.ttf',
    source: { regular: 'Geist-Regular.ttf', bold: 'Geist-SemiBold.ttf' },
  },
  {
    id: 'inter',
    name: 'Inter',
    kind: 'sans',
    regular: 'inter-regular.ttf',
    bold: 'inter-semibold.ttf',
    source: { regular: 'Inter-Regular.ttf', bold: 'Inter-SemiBold.ttf' },
  },
  {
    id: 'plex',
    name: 'IBM Plex Sans',
    kind: 'sans',
    regular: 'plex-regular.ttf',
    bold: 'plex-semibold.ttf',
    source: { regular: 'IBMPlexSans-Regular.ttf', bold: 'IBMPlexSans-SemiBold.ttf' },
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    kind: 'sans',
    regular: 'dmsans-regular.ttf',
    bold: 'dmsans-semibold.ttf',
    source: { regular: 'DMSans-Regular.ttf', bold: 'DMSans-SemiBold.ttf' },
  },
  {
    id: 'source-serif',
    name: 'Source Serif 4',
    kind: 'serif',
    regular: 'sourceserif-regular.ttf',
    bold: 'sourceserif-semibold.ttf',
    source: { regular: 'SourceSerif4-Regular.ttf', bold: 'SourceSerif4-SemiBold.ttf' },
  },
  {
    id: 'baskerville',
    name: 'Libre Baskerville',
    kind: 'serif',
    regular: 'baskerville-regular.ttf',
    bold: 'baskerville-bold.ttf',
    source: { regular: 'LibreBaskerville-Regular.ttf', bold: 'LibreBaskerville-Bold.ttf' },
  },
  {
    id: 'geist-mono',
    name: 'Geist Mono',
    kind: 'mono',
    regular: 'geistmono-regular.ttf',
    bold: 'geistmono-semibold.ttf',
    source: { regular: 'GeistMono-Regular.ttf', bold: 'GeistMono-SemiBold.ttf' },
  },
];

export interface LoadedFonts {
  regular: Uint8Array;
  bold: Uint8Array;
  /** Familles CSS à employer dans l'aperçu. */
  css: { regular: string; bold: string };
  name: string;
}

/**
 * Ressources du Studio. La page anglaise vit ailleurs dans l'arborescence et déclare où les
 * trouver par `data-studio` sur `<body>` ; `data-assets`, lui, désigne celles du validateur
 * (runtime XSLT et schematrons), que le Studio emprunte sans les copier.
 */
export function studioAsset(path: string): string {
  const declared = typeof document !== 'undefined' ? document.body?.dataset.studio : undefined;
  const base = declared ? new URL(declared, pageBase()).href : pageBase();
  return new URL(path, base).href;
}

const bytesCache = new Map<string, Promise<Uint8Array>>();

function fetchBytes(file: string): Promise<Uint8Array> {
  let pending = bytesCache.get(file);
  if (!pending) {
    pending = fetch(studioAsset(`polices/${file}`)).then(async (response) => {
      if (!response.ok) throw new Error(`police introuvable : ${file} (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    });
    pending.catch(() => bytesCache.delete(file));
    bytesCache.set(file, pending);
  }
  return pending;
}

const registered = new Map<string, Promise<void>>();

/** Déclare la police au navigateur sous un nom propre au Studio, une fois. */
function register(family: string, bytes: Uint8Array): Promise<void> {
  let pending = registered.get(family);
  if (!pending) {
    const face = new FontFace(family, bytes.slice().buffer as ArrayBuffer);
    pending = face.load().then((loaded) => {
      document.fonts.add(loaded);
    });
    pending.catch(() => registered.delete(family));
    registered.set(family, pending);
  }
  return pending;
}

/** Charge une famille du catalogue : octets pour le SDK, faces pour l'aperçu. */
export async function loadFamily(id: string): Promise<LoadedFonts> {
  const family = FONT_FAMILIES.find((f) => f.id === id) ?? (FONT_FAMILIES[0] as FontFamily);
  const [regular, bold] = await Promise.all([fetchBytes(family.regular), fetchBytes(family.bold)]);
  const css = { regular: `fxs-${family.id}-regular`, bold: `fxs-${family.id}-bold` };
  await Promise.all([register(css.regular, regular), register(css.bold, bold)]);
  return { regular, bold, css, name: family.name };
}

/** Empreinte courte d'une police importée, pour la nommer sans collision. */
function fingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 4096))) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Charge une police importée par l'utilisateur ; sans gras, la régulière sert aux deux. */
export async function loadCustom(
  regular: Uint8Array,
  bold: Uint8Array | undefined,
  name: string,
): Promise<LoadedFonts> {
  const css = {
    regular: `fxs-custom-${fingerprint(regular)}`,
    bold: `fxs-custom-${fingerprint(bold ?? regular)}-b`,
  };
  await Promise.all([register(css.regular, regular), register(css.bold, bold ?? regular)]);
  return { regular, bold: bold ?? regular, css, name };
}
