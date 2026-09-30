/**
 * Thèmes de la page lisible : modèles de mise en page, couleur d'accent, logo.
 *
 * Un thème change l'apparence, jamais le contenu : les mentions obligatoires sont écrites quel que
 * soit le modèle, et aucune option ne permet de les masquer. La couleur ne peut pas non plus rendre
 * la facture illisible : le texte posé sur l'accent, ou écrit dans sa teinte, est assombri ou
 * inversé jusqu'à atteindre le contraste recommandé pour du texte courant (WCAG, 4,5:1).
 */

import { FacturXPdfError } from './errors.js';

/** Modèles fournis : chacun est un jeu de réglages de `RenderStyle`, surchargeable un par un. */
export type RenderTemplate = 'classic' | 'modern' | 'minimal' | 'letterhead' | 'cards' | 'compact';

export interface RenderStyle {
  /**
   * En-tête : `plain` titre et dates sur fond blanc ; `band` bandeau pleine largeur dans la couleur
   * d'accent ; `letterhead` papier à en-tête — l'émetteur en haut à gauche, le client en regard.
   */
  header: 'plain' | 'band' | 'letterhead';
  /** Blocs vendeur et acheteur : texte simple, ou cartes teintées. */
  parties: 'plain' | 'boxed';
  /** En-tête du tableau des lignes : filet, fond d'accent, ou fond teinté. */
  tableHeader: 'rule' | 'filled' | 'tinted';
  /** Séparation des lignes : filets, bandes alternées, ou rien. */
  rows: 'rules' | 'zebra' | 'plain';
  /** Totaux : alignés, ou encadrés dans une carte teintée. */
  totals: 'plain' | 'boxed';
  /** Net à payer : texte en gras, ou pavé dans la couleur d'accent. */
  amountDue: 'text' | 'filled';
  /** Casse du titre du document. */
  titleCase: 'normal' | 'upper';
  /** Densité : corps de texte, marges et espacements. */
  density: 'comfortable' | 'compact';
  /** Angles des cartes et pavés. */
  corners: 'square' | 'rounded';
}

export interface RenderTheme {
  /** Modèle de départ. Défaut : `classic`. */
  template?: RenderTemplate;
  /** Couleur d'accent, `#RRGGBB` ou `#RGB`. Défaut : celle du modèle. */
  accent?: string;
  /** Réglages fins, appliqués par-dessus ceux du modèle. */
  style?: Partial<RenderStyle>;
  /** Placement et hauteur du logo (en points, bornée entre 16 et 120). */
  logo?: { position?: 'left' | 'right'; height?: number };
  /** Format de page. Défaut : `A4`. */
  pageSize?: 'A4' | 'Letter';
}

export const RENDER_TEMPLATES: Readonly<
  Record<RenderTemplate, { readonly accent: string; readonly style: Readonly<RenderStyle> }>
> = {
  classic: {
    accent: '#111111',
    style: {
      header: 'plain',
      parties: 'plain',
      tableHeader: 'rule',
      rows: 'rules',
      totals: 'plain',
      amountDue: 'text',
      titleCase: 'normal',
      density: 'comfortable',
      corners: 'square',
    },
  },
  modern: {
    accent: '#2F4BD8',
    style: {
      header: 'band',
      parties: 'plain',
      tableHeader: 'filled',
      rows: 'zebra',
      totals: 'plain',
      amountDue: 'filled',
      titleCase: 'upper',
      density: 'comfortable',
      corners: 'rounded',
    },
  },
  minimal: {
    accent: '#B0413E',
    style: {
      header: 'plain',
      parties: 'plain',
      tableHeader: 'rule',
      rows: 'plain',
      totals: 'plain',
      amountDue: 'text',
      titleCase: 'upper',
      density: 'comfortable',
      corners: 'square',
    },
  },
  letterhead: {
    accent: '#1E3A5F',
    style: {
      header: 'letterhead',
      parties: 'boxed',
      tableHeader: 'tinted',
      rows: 'rules',
      totals: 'boxed',
      amountDue: 'filled',
      titleCase: 'upper',
      density: 'comfortable',
      corners: 'square',
    },
  },
  cards: {
    accent: '#0F766E',
    style: {
      header: 'plain',
      parties: 'boxed',
      tableHeader: 'tinted',
      rows: 'rules',
      totals: 'boxed',
      amountDue: 'filled',
      titleCase: 'normal',
      density: 'comfortable',
      corners: 'rounded',
    },
  },
  compact: {
    accent: '#374151',
    style: {
      header: 'plain',
      parties: 'plain',
      tableHeader: 'tinted',
      rows: 'zebra',
      totals: 'plain',
      amountDue: 'text',
      titleCase: 'normal',
      density: 'compact',
      corners: 'square',
    },
  },
};

export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;

// ---------- couleurs ----------

type Rgb = [number, number, number];

/** `#RRGGBB` ou `#RGB` → composantes 0–255 ; `undefined` si le texte n'est pas une couleur. */
export function parseHexColor(value: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const hex =
    (match[1] as string).length === 3
      ? [...(match[1] as string)].map((c) => c + c).join('')
      : (match[1] as string);
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Mélange linéaire de deux couleurs (`t` = part de la seconde). */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => (a[i] as number) * (1 - t) + (b[i] as number) * t) as Rgb;
}

/** Luminance relative (WCAG 2). */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHexColor(a) ?? [0, 0, 0]);
  const lb = luminance(parseHexColor(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contraste visé pour du texte courant (WCAG AA). */
const READABLE = 4.5;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

export interface Palette {
  /** Texte principal. */
  ink: string;
  /** Texte secondaire : adresses, libellés, mentions. */
  muted: string;
  /** Filets. */
  rule: string;
  /** Fond neutre très clair. */
  soft: string;
  /** Couleur d'accent telle que choisie : aplats. */
  accent: string;
  /** Accent lisible en texte sur fond blanc (assombri si besoin). */
  accentText: string;
  /** Texte posé sur un aplat d'accent : blanc ou encre, selon le contraste. */
  onAccent: string;
  /** Accent très dilué : bandes alternées, cartes. */
  tint: string;
  /** Accent dilué, un cran plus soutenu : en-têtes teintés. */
  tintStrong: string;
  /** Texte d'accent lisible sur `tint` et `tintStrong`. */
  accentOnTint: string;
}

/** Assombrit (ou éclaircit) `color` jusqu'à atteindre `target` de contraste contre `against`. */
function ensureContrast(color: Rgb, against: Rgb, target: number): Rgb {
  const toward = luminance(against) > 0.5 ? BLACK : WHITE;
  let current = color;
  for (let step = 0; step <= 20; step++) {
    if (contrastRatio(toHex(current), toHex(against)) >= target) return current;
    current = mix(color, toward, (step + 1) / 20);
  }
  return toward;
}

export function buildPalette(accent: string): Palette {
  const rgb = parseHexColor(accent);
  if (!rgb) {
    throw new FacturXPdfError(
      'INVALID_OPTION',
      `Couleur d'accent illisible : « ${accent} » (attendu : #RRGGBB ou #RGB).`,
    );
  }
  const tint = mix(rgb, WHITE, 0.92);
  const tintStrong = mix(rgb, WHITE, 0.84);
  const white = contrastRatio(toHex(rgb), '#ffffff');
  const ink = contrastRatio(toHex(rgb), '#0a0a0a');
  return {
    ink: '#0a0a0a',
    muted: '#5c5c5c',
    rule: '#d9d9d9',
    soft: '#f4f4f5',
    accent: toHex(rgb),
    accentText: toHex(ensureContrast(rgb, WHITE, READABLE)),
    onAccent: white >= READABLE || white >= ink ? '#ffffff' : '#0a0a0a',
    tint: toHex(tint),
    tintStrong: toHex(tintStrong),
    accentOnTint: toHex(ensureContrast(rgb, tintStrong, READABLE)),
  };
}

/** Réglages effectifs d'un thème : modèle, puis surcharges, validés. */
export function resolveTheme(theme: RenderTheme = {}): {
  template: RenderTemplate;
  style: RenderStyle;
  palette: Palette;
  logo: { position: 'left' | 'right'; height: number };
  page: { width: number; height: number };
} {
  const template = theme.template ?? 'classic';
  const preset = RENDER_TEMPLATES[template];
  if (!preset) {
    throw new FacturXPdfError(
      'INVALID_OPTION',
      `Modèle inconnu : « ${template} » (attendu : ${Object.keys(RENDER_TEMPLATES).join(', ')}).`,
    );
  }
  const page = PAGE_SIZES[theme.pageSize ?? 'A4'];
  if (!page) {
    throw new FacturXPdfError('INVALID_OPTION', `Format de page inconnu : « ${theme.pageSize} ».`);
  }
  const height = theme.logo?.height ?? 44;
  return {
    template,
    style: { ...preset.style, ...definedOnly(theme.style ?? {}) },
    palette: buildPalette(theme.accent ?? preset.accent),
    logo: {
      position: theme.logo?.position ?? 'left',
      height: Math.min(120, Math.max(16, Number.isFinite(height) ? height : 44)),
    },
    page,
  };
}

/** Retire les clés `undefined` : une surcharge absente ne doit pas effacer le réglage du modèle. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
