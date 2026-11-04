/**
 * Des réglages d'apparence aux options de rendu du SDK, partagé entre le Studio et les Edge
 * Functions : l'aperçu et le PDF émis par le serveur sortent des mêmes options.
 *
 * Le seul import est le SDK (`facturx-sdk/pdf`), que Deno résout par l'import map de
 * supabase/functions/deno.json ; aucun import relatif, car Deno ne résout pas `./x.js` vers `./x.ts`.
 */

import {
  type LayoutInvoiceOptions,
  RENDER_LABELS,
  type RenderDisplay,
  type RenderLabels,
  type RenderStyle,
  type RenderTemplate,
} from 'facturx-sdk/pdf';

/**
 * Ce que le rendu lit de l'apparence : le sous-ensemble de l'`Appearance` du Studio (la police et
 * les clés des fichiers importés n'y sont pas, ils arrivent par `Assets`).
 */
export interface RenderAppearance {
  template: RenderTemplate;
  accent: string;
  /** Réglages fins, par-dessus ceux du modèle. */
  style: Partial<RenderStyle>;
  logo?: { position: 'left' | 'right'; height: number } | undefined;
  /** Langue du document : libellés, nombres, dates. */
  language: 'fr' | 'en';
  /** Libellés renommés ; les mentions légales, elles, ne se renomment pas. */
  labels: Partial<Record<string, string>>;
  footer: string;
  display: RenderDisplay;
  pageSize: 'A4' | 'Letter';
}

export interface Assets {
  fonts: { regular: Uint8Array; bold: Uint8Array };
  logo?: { bytes: Uint8Array; type: 'png' | 'jpeg' };
}

/** Table de libellés : la langue du document, et ce que l'utilisateur a renommé. */
export function labelsFor(appearance: RenderAppearance): RenderLabels {
  const base = RENDER_LABELS[appearance.language];
  const renamed = Object.fromEntries(
    Object.entries(appearance.labels).filter(
      ([, value]) => typeof value === 'string' && value.trim() !== '',
    ),
  );
  return { ...base, ...renamed };
}

export function renderOptions(appearance: RenderAppearance, assets: Assets): LayoutInvoiceOptions {
  const options: LayoutInvoiceOptions = {
    fonts: assets.fonts,
    labels: Object.keys(appearance.labels).length ? labelsFor(appearance) : appearance.language,
    locale: appearance.language,
    theme: {
      template: appearance.template,
      accent: appearance.accent,
      style: appearance.style,
      pageSize: appearance.pageSize,
      logo: {
        position: appearance.logo?.position ?? 'left',
        height: appearance.logo?.height ?? 44,
      },
    },
    display: appearance.display,
  };
  if (appearance.footer.trim()) options.footer = appearance.footer.trim();
  if (assets.logo) options.logo = assets.logo;
  return options;
}
