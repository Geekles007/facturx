/**
 * Peinture d'une mise en page dans un document pdf-lib.
 *
 * Rien n'est décidé ici : positions, tailles et couleurs viennent de `composeInvoice`. Le peintre
 * traduit chaque instruction en opérateurs PDF, sans transparence (des teintes pleines, calculées
 * d'avance), ce qui garde le document dans ce que PDF/A-3 accepte sans condition.
 */

import {
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
} from 'pdf-lib';
import type { InvoiceLayout, LayoutRect } from './layout.js';

function color(hex: string): Color {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/**
 * Rectangle aux angles arrondis, en chemin SVG (repère de pdf-lib : origine au coin supérieur
 * gauche, ordonnées vers le bas). Quarts de cercle approchés par des courbes de Bézier cubiques.
 */
function roundedPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const k = r * 0.5523;
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `C ${width - r + k} 0 ${width} ${r - k} ${width} ${r}`,
    `V ${height - r}`,
    `C ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
    `H ${r}`,
    `C ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
    `V ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0`,
    'Z',
  ].join(' ');
}

function paintRect(page: PDFPage, op: LayoutRect): void {
  const paint: { color?: Color; borderColor?: Color; borderWidth?: number } = {};
  if (op.fill) paint.color = color(op.fill);
  if (op.stroke) {
    paint.borderColor = color(op.stroke);
    paint.borderWidth = op.strokeWidth ?? 0.75;
  }
  if (!paint.color && !paint.borderColor) return;
  if (op.radius && op.radius > 0) {
    page.drawSvgPath(roundedPath(op.width, op.height, op.radius), {
      x: op.x,
      y: op.y + op.height,
      ...paint,
    });
    return;
  }
  page.drawRectangle({ x: op.x, y: op.y, width: op.width, height: op.height, ...paint });
}

/** Ajoute au document une page par page de la mise en page. */
export function paintLayout(
  doc: PDFDocument,
  layout: InvoiceLayout,
  fonts: { regular: PDFFont; bold: PDFFont },
  logo: PDFImage | undefined,
): void {
  for (const source of layout.pages) {
    const page = doc.addPage([source.width, source.height]);
    for (const op of source.ops) {
      switch (op.kind) {
        case 'text':
          page.drawText(op.text, {
            x: op.x,
            y: op.y,
            size: op.size,
            font: fonts[op.font],
            color: color(op.color),
          });
          break;
        case 'line':
          page.drawLine({
            start: { x: op.x1, y: op.y1 },
            end: { x: op.x2, y: op.y2 },
            thickness: op.width,
            color: color(op.color),
          });
          break;
        case 'rect':
          paintRect(page, op);
          break;
        case 'image':
          if (logo) page.drawImage(logo, { x: op.x, y: op.y, width: op.width, height: op.height });
          break;
        case 'area':
          break;
      }
    }
  }
}
