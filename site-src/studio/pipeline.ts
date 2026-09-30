/**
 * Du formulaire au document : options de rendu tirées de l'apparence, mise en page pour
 * l'aperçu, PDF Factur-X pour le téléchargement.
 *
 * Tout passe par l'API publique du SDK — `layoutInvoice`, `renderInvoicePdf`, `embedFacturX`,
 * `toCiiXml` : ce que fait le Studio, un développeur le fait avec les mêmes appels, et le code
 * affiché dans l'onglet « Code » est celui-là.
 */

import { type Invoice, toCiiXml } from 'facturx-sdk';
import {
  embedFacturX,
  type InvoiceLayout,
  type LayoutInvoiceOptions,
  layoutInvoice,
  RENDER_LABELS,
  type RenderLabels,
  renderInvoicePdf,
} from 'facturx-sdk/pdf';
// Le profil sRGB compact (CC0, 456 octets) que les tests veraPDF du SDK emploient déjà : le même
// fichier, embarqué dans le bundle, plutôt qu'une copie qui pourrait diverger.
import srgb from '../../packages/facturx/test/fixtures/sRGB.icc';
import type { Appearance } from './library.js';

export interface Assets {
  fonts: { regular: Uint8Array; bold: Uint8Array };
  logo?: { bytes: Uint8Array; type: 'png' | 'jpeg' };
}

/** Table de libellés : la langue du document, et ce que l'utilisateur a renommé. */
export function labelsFor(appearance: Appearance): RenderLabels {
  const base = RENDER_LABELS[appearance.language];
  const renamed = Object.fromEntries(
    Object.entries(appearance.labels).filter(
      ([, value]) => typeof value === 'string' && value.trim() !== '',
    ),
  );
  return { ...base, ...renamed };
}

export function renderOptions(appearance: Appearance, assets: Assets): LayoutInvoiceOptions {
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

export function layoutFor(
  invoice: Invoice,
  appearance: Appearance,
  assets: Assets,
): Promise<InvoiceLayout> {
  return layoutInvoice(invoice, renderOptions(appearance, assets));
}

/** Le PDF/A-3 Factur-X complet : page rendue, XML CII embarqué, intention de sortie sRGB. */
export async function buildFacturX(
  invoice: Invoice,
  appearance: Appearance,
  assets: Assets,
): Promise<Uint8Array> {
  const page = await renderInvoicePdf(invoice, renderOptions(appearance, assets));
  // Le titre du document est celui que le rendu a posé (« Avoir F-… », « Invoice F-… ») :
  // embedFacturX le conserve.
  return embedFacturX(
    page,
    { invoice },
    {
      creator: 'facturx-sdk Studio',
      outputIntent: { iccProfile: srgb },
    },
  );
}

/** Le XML CII seul, lisible (indenté) ou compact comme dans le PDF. */
export function buildXml(invoice: Invoice, pretty = true): string {
  return toCiiXml(invoice, { pretty });
}

/** Télécharge des octets sous un nom de fichier, sans rien envoyer nulle part. */
export function download(bytes: Uint8Array | string, filename: string, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nom de fichier sûr, tiré du numéro de facture. */
export const fileStem = (id: string): string =>
  id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'facture';
