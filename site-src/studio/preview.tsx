/**
 * L'aperçu : la mise en page du SDK (`layoutInvoice`), peinte en SVG.
 *
 * Mêmes instructions, mêmes coordonnées, même police que le PDF : ce que l'on voit est ce que
 * l'on télécharge. Chaque texte est posé à la largeur mesurée par le SDK (`textLength`), ce qui
 * neutralise les écarts d'arrondi du moteur de rendu du navigateur. Les zones de la mise en page
 * rendent l'aperçu cliquable : un clic mène au champ qui a produit le bloc.
 */

import type { InvoiceLayout, LayoutOp, LayoutPage } from 'facturx-sdk/pdf';
import type { VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { APPEARANCE_REFS, anchorOf, concerns, sectionOf } from './anchors.js';
import { useDerived } from './context.js';
import type { LoadedFonts } from './fonts.js';
import { t } from './i18n.js';
import { focusField, ui, useStudio } from './store.js';
import { Icon, IconButton } from './ui.js';

function paint(
  op: LayoutOp,
  height: number,
  fonts: LoadedFonts,
  logoUrl: string | undefined,
  key: number,
): VNode | null {
  switch (op.kind) {
    case 'text':
      return (
        <text
          key={key}
          x={op.x}
          y={height - op.y}
          font-size={op.size}
          fill={op.color}
          font-family={op.font === 'bold' ? fonts.css.bold : fonts.css.regular}
          textLength={op.width > 0 ? op.width : undefined}
          lengthAdjust="spacing"
        >
          {op.text}
        </text>
      );
    case 'line':
      return (
        <line
          key={key}
          x1={op.x1}
          y1={height - op.y1}
          x2={op.x2}
          y2={height - op.y2}
          stroke={op.color}
          stroke-width={op.width}
        />
      );
    case 'rect':
      return (
        <rect
          key={key}
          x={op.x}
          y={height - op.y - op.height}
          width={op.width}
          height={op.height}
          rx={op.radius}
          fill={op.fill ?? 'none'}
          stroke={op.stroke}
          stroke-width={op.strokeWidth}
        />
      );
    case 'image':
      return logoUrl ? (
        <image
          key={key}
          href={logoUrl}
          x={op.x}
          y={height - op.y - op.height}
          width={op.width}
          height={op.height}
          preserveAspectRatio="none"
        />
      ) : null;
    default:
      return null;
  }
}

/** Le dessin d'une page ; recalculé seulement quand la page, la police ou le logo changent. */
function PageArt({
  page,
  fonts,
  logoUrl,
}: {
  page: LayoutPage;
  fonts: LoadedFonts;
  logoUrl: string | undefined;
}) {
  return useMemo(
    () => <g class="art">{page.ops.map((op, i) => paint(op, page.height, fonts, logoUrl, i))}</g>,
    [page, fonts, logoUrl],
  );
}

function PageView({
  page,
  index,
  scale,
  fonts,
  logoUrl,
  flagged,
  highlight,
  onPick,
  onHover,
}: {
  page: LayoutPage;
  index: number;
  scale: number;
  fonts: LoadedFonts;
  logoUrl: string | undefined;
  flagged: (ref: string) => boolean;
  highlight: string | undefined;
  onPick: (ref: string) => void;
  onHover: (ref: string | undefined) => void;
}) {
  const areas = page.ops.filter(
    (op): op is Extract<LayoutOp, { kind: 'area' }> => op.kind === 'area',
  );
  const size = { width: page.width * scale, height: page.height * scale };
  return (
    <div class="page" style={{ width: `${size.width}px`, height: `${size.height}px` }}>
      <svg
        class="page-art"
        viewBox={`0 0 ${page.width} ${page.height}`}
        width={size.width}
        height={size.height}
        role="img"
        aria-label={t.preview.page(index + 1)}
      >
        <rect x={0} y={0} width={page.width} height={page.height} fill="#ffffff" />
        <PageArt page={page} fonts={fonts} logoUrl={logoUrl} />
      </svg>
      <svg
        class="page-hits"
        viewBox={`0 0 ${page.width} ${page.height}`}
        width={size.width}
        height={size.height}
        onMouseLeave={() => onHover(undefined)}
      >
        <title>{t.preview.hint}</title>
        {areas.map((area, i) => {
          const bad = flagged(area.ref);
          const on =
            highlight !== undefined &&
            (highlight === area.ref ||
              concerns(area.ref, highlight) ||
              concerns(highlight, area.ref));
          return (
            // biome-ignore lint/a11y/useSemanticElements: une zone de SVG ne peut pas être un <button> ; elle en a le rôle, le focus et les touches.
            <rect
              key={`${i}-${area.ref}`}
              role="button"
              tabIndex={0}
              aria-label={describe(area.ref)}
              class={`hit${bad ? ' bad' : ''}${on ? ' on' : ''}`}
              x={area.x - 3}
              y={page.height - area.y - area.height - 2}
              width={area.width + 6}
              height={area.height + 4}
              rx={3}
              onMouseEnter={() => onHover(area.ref)}
              onFocus={() => onHover(area.ref)}
              onClick={() => onPick(area.ref)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPick(area.ref);
                }
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

/** Nom lisible d'une zone : la section qu'elle ouvre dans l'éditeur. */
function describe(ref: string): string {
  if (APPEARANCE_REFS.has(ref)) return `${t.app.tabs.appearance} — ${ref}`;
  return `${t.sections[sectionOf(anchorOf(ref, 'preview'))]} — ${ref}`;
}

export function Preview() {
  const { layout, layoutPending, layoutError, fonts, logoUrl, issues, built } = useDerived();
  const zoom = useStudio((s) => s.ui.zoom);
  const hover = useStudio((s) => s.ui.hover);
  const focus = useStudio((s) => s.ui.focus);
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState<InvoiceLayout | undefined>(layout);

  // Garder la dernière mise en page réussie pendant le calcul de la suivante : pas de clignotement.
  useEffect(() => {
    if (layout) setShown(layout);
  }, [layout]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageWidth = shown?.pages[0]?.width ?? 595.28;
  const fit = width > 0 ? Math.min(1.6, Math.max(0.3, (width - 48) / pageWidth)) : 1;
  const scale = zoom > 0 ? zoom : fit;
  const issuePaths = useMemo(
    () => issues.filter((i) => i.source === 'sdk').map((i) => i.path),
    [issues],
  );
  const flagged = (ref: string) => issuePaths.some((p) => concerns(ref, p) || concerns(p, ref));
  const focusRef = focus?.path;

  const pick = (ref: string) => {
    if (APPEARANCE_REFS.has(ref)) {
      focusField(ref, 'appearance');
      return;
    }
    focusField(anchorOf(built.toFormPath(ref), 'preview'));
  };
  const setZoom = (value: number) =>
    ui({ zoom: Math.round(Math.min(2.5, Math.max(0.3, value)) * 100) / 100 });

  return (
    <div class="preview" aria-busy={layoutPending}>
      <div class="stage" ref={stage}>
        {shown && fonts ? (
          <div class="pages">
            {shown.pages.map((page, index) => (
              <PageView
                key={index}
                page={page}
                index={index}
                scale={scale}
                fonts={fonts}
                logoUrl={logoUrl}
                flagged={flagged}
                highlight={hover ?? focusRef}
                onPick={pick}
                onHover={(ref) => ui({ hover: ref })}
              />
            ))}
          </div>
        ) : (
          <div class="preview-empty">
            {layoutError ? (
              <p class="preview-error">
                <Icon name="alert" /> {t.preview.error(layoutError)}
              </p>
            ) : (
              <div class="skeleton-page" role="img" aria-label={t.app.loading} />
            )}
          </div>
        )}
      </div>
      {layoutError && shown && (
        <p class="preview-error floating">
          <Icon name="alert" /> {t.preview.error(layoutError)}
        </p>
      )}
      <div class="preview-bar">
        <span class="preview-meta">
          {shown ? t.preview.pages(shown.pages.length) : ''}
          {layoutPending && <span class="updating">{t.preview.updating}</span>}
        </span>
        <span class="preview-hint">{t.preview.hint}</span>
        <div class="zoom">
          <IconButton
            icon="zoomOut"
            label={t.preview.zoomOut}
            onClick={() => setZoom(scale - 0.1)}
          />
          <button
            type="button"
            class="zoom-value"
            onClick={() => ui({ zoom: zoom > 0 ? 0 : 1 })}
            title={t.preview.fit}
          >
            {Math.round(scale * 100)} %
          </button>
          <IconButton icon="zoomIn" label={t.preview.zoomIn} onClick={() => setZoom(scale + 0.1)} />
          <IconButton
            icon="fit"
            label={t.preview.fit}
            class={zoom === 0 ? 'on' : ''}
            onClick={() => ui({ zoom: 0 })}
          />
        </div>
      </div>
    </div>
  );
}

/** Vignette d'une page, sans interaction : pour la galerie des modèles. */
export function Thumbnail({
  layout,
  fonts,
  logoUrl,
  width,
}: {
  layout: InvoiceLayout;
  fonts: LoadedFonts;
  logoUrl: string | undefined;
  width: number;
}) {
  const page = layout.pages[0];
  if (!page) return null;
  const scale = width / page.width;
  return (
    <svg
      viewBox={`0 0 ${page.width} ${page.height}`}
      width={width}
      height={page.height * scale}
      aria-hidden="true"
      class="thumb"
    >
      <rect x={0} y={0} width={page.width} height={page.height} fill="#ffffff" />
      <PageArt page={page} fonts={fonts} logoUrl={logoUrl} />
    </svg>
  );
}
