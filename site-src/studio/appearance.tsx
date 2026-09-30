/**
 * L'onglet Apparence : modèle, couleur, police, logo, réglages fins, libellés, pied de page.
 *
 * Tout ce qui se règle ici est une option de `renderInvoicePdf` — rien n'est propre au Studio.
 * Et rien ne touche au contenu légal : l'encadré « Toujours imprimé » le rappelle.
 */

import type { Invoice } from 'facturx-sdk';
import {
  FacturXPdfError,
  type InvoiceLayout,
  RENDER_LABELS,
  RENDER_TEMPLATES,
  type RenderStyle,
  type RenderTemplate,
} from 'facturx-sdk/pdf';
import { useEffect, useState } from 'preact/hooks';
import { useDerived } from './context.js';
import { getFile, normalizeLogo, putFile } from './files.js';
import { FONT_FAMILIES, type LoadedFonts, loadFamily } from './fonts.js';
import { t } from './i18n.js';
import type { Appearance, LabelKey } from './library.js';
import { uid } from './model.js';
import { type Assets, layoutFor } from './pipeline.js';
import { Thumbnail } from './preview.js';
import { storage } from './storage.js';
import { persistKeys, setAppearance, store, toast, useStudio } from './store.js';
import { Button, Field, FilePick, Icon, Input, Segmented, TextArea, Toggle } from './ui.js';

const SWATCHES = [
  '#111111',
  '#2f4bd8',
  '#b0413e',
  '#0f766e',
  '#1e3a5f',
  '#7c3aed',
  '#c2410c',
  '#15803d',
  '#be185d',
  '#475569',
];

const TEMPLATE_IDS = Object.keys(RENDER_TEMPLATES) as RenderTemplate[];

/** Vignettes des six modèles sur la facture en cours, recalculées quand l'onglet est ouvert. */
function useThumbnails(
  invoice: Invoice,
  appearance: Appearance,
  fonts: LoadedFonts | undefined,
  logo: Assets['logo'],
) {
  const [thumbs, setThumbs] = useState<Partial<Record<RenderTemplate, InvoiceLayout>>>({});
  useEffect(() => {
    if (!fonts) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const next: Partial<Record<RenderTemplate, InvoiceLayout>> = {};
      for (const template of TEMPLATE_IDS) {
        const variant: Appearance = {
          ...appearance,
          template,
          accent: RENDER_TEMPLATES[template].accent,
          style: {},
        };
        try {
          const assets: Assets = { fonts: { regular: fonts.regular, bold: fonts.bold } };
          if (logo) assets.logo = logo;
          next[template] = await layoutFor(invoice, variant, assets);
        } catch {
          // Une vignette manquante n'empêche pas les autres.
        }
        if (cancelled) return;
      }
      setThumbs(next);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    invoice,
    appearance.language,
    appearance.labels,
    appearance.display,
    appearance.footer,
    appearance.pageSize,
    fonts,
    logo,
  ]);
  return thumbs;
}

function TemplateGallery({ logo }: { logo: Assets['logo'] }) {
  const appearance = useStudio((s) => s.appearance);
  const { built, fonts, logoUrl } = useDerived();
  const thumbs = useThumbnails(built.invoice, appearance, fonts, logo);
  return (
    <fieldset class="templates">
      <legend class="sr-only">{t.appearance.template}</legend>
      {TEMPLATE_IDS.map((id) => {
        const [name, description] = t.appearance.templates[id] ?? [id, ''];
        const layout = thumbs[id];
        const on = appearance.template === id;
        return (
          <button
            type="button"
            key={id}
            aria-pressed={on}
            class={`template${on ? ' on' : ''}`}
            onClick={() =>
              setAppearance({ template: id, accent: RENDER_TEMPLATES[id].accent, style: {} })
            }
          >
            <span class="template-art">
              {layout && fonts ? (
                <Thumbnail layout={layout} fonts={fonts} logoUrl={logoUrl} width={132} />
              ) : (
                <span class="thumb-skeleton" />
              )}
            </span>
            <span class="template-name">{name}</span>
            <span class="template-desc">{description}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

function ColorPicker() {
  const accent = useStudio((s) => s.appearance.accent);
  const [draft, setDraft] = useState(accent);
  useEffect(() => setDraft(accent), [accent]);
  return (
    <div class="colors">
      <fieldset class="swatches">
        <legend class="sr-only">{t.appearance.color}</legend>
        {SWATCHES.map((color) => (
          <button
            type="button"
            key={color}
            aria-pressed={accent.toLowerCase() === color}
            class={`swatch${accent.toLowerCase() === color ? ' on' : ''}`}
            style={{ background: color }}
            title={color}
            onClick={() => setAppearance({ accent: color })}
          />
        ))}
        <label class="swatch custom" title={t.appearance.customColor}>
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#111111'}
            onInput={(e) => setAppearance({ accent: (e.currentTarget as HTMLInputElement).value })}
            aria-label={t.appearance.customColor}
          />
        </label>
        <Input
          class="hex"
          value={draft}
          aria-label={t.appearance.customColor}
          spellcheck={false}
          onValue={(v) => {
            setDraft(v);
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) setAppearance({ accent: v.trim() });
          }}
        />
      </fieldset>
      <p class="field-hint">{t.appearance.contrast}</p>
    </div>
  );
}

function FontPicker() {
  const appearance = useStudio((s) => s.appearance);
  const { built } = useDerived();
  const [loaded, setLoaded] = useState<Record<string, LoadedFonts>>({});
  const [regular, setRegular] = useState<File | undefined>();
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    for (const family of FONT_FAMILIES) {
      loadFamily(family.id)
        .then((fonts) => {
          if (!cancelled) setLoaded((current) => ({ ...current, [family.id]: fonts }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  /** Vérifie la police avec le SDK lui-même, puis la conserve. */
  const importFont = async (file: File, boldFile?: File) => {
    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const boldBytes = boldFile ? new Uint8Array(await boldFile.arrayBuffer()) : undefined;
      const { layoutInvoice } = await import('facturx-sdk/pdf');
      await layoutInvoice(built.invoice, {
        fonts: boldBytes ? { regular: bytes, bold: boldBytes } : { regular: bytes },
      });
      const regularKey = `font-${uid()}`;
      await putFile(regularKey, bytes);
      const customFont: NonNullable<Appearance['customFont']> = {
        regularKey,
        name: file.name.replace(/\.(ttf|otf)$/i, ''),
      };
      if (boldBytes) {
        customFont.boldKey = `font-${uid()}`;
        await putFile(customFont.boldKey, boldBytes);
      }
      setAppearance({ font: 'custom', customFont });
      setRegular(undefined);
    } catch (error) {
      toast(
        error instanceof FacturXPdfError ? error.message : String((error as Error).message),
        'error',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div class="fonts">
      <fieldset class="font-list">
        <legend class="sr-only">{t.appearance.font}</legend>
        {FONT_FAMILIES.map((family) => {
          const fonts = loaded[family.id];
          const on = appearance.font === family.id;
          return (
            <button
              type="button"
              key={family.id}
              aria-pressed={on}
              class={`font-item${on ? ' on' : ''}`}
              onClick={() => setAppearance({ font: family.id })}
            >
              <span
                class="font-sample"
                style={fonts ? { fontFamily: fonts.css.regular } : undefined}
              >
                Aa 2 880,00 €
              </span>
              <span class="font-name">{family.name}</span>
            </button>
          );
        })}
        {appearance.customFont && (
          <button
            type="button"
            aria-pressed={appearance.font === 'custom'}
            class={`font-item${appearance.font === 'custom' ? ' on' : ''}`}
            onClick={() => setAppearance({ font: 'custom' })}
          >
            <span class="font-sample">Aa</span>
            <span class="font-name">{appearance.customFont.name}</span>
          </button>
        )}
      </fieldset>
      <div class="font-import">
        {!regular ? (
          <FilePick
            accept=".ttf,.otf"
            onFile={(file) => setRegular(file)}
            icon="upload"
            size="sm"
            variant="ghost"
          >
            {t.appearance.fontImport}
          </FilePick>
        ) : (
          <div class="font-import-step">
            <span>
              <Icon name="file" /> {regular.name}
            </span>
            <FilePick
              accept=".ttf,.otf"
              onFile={(bold) => importFont(regular, bold)}
              icon="upload"
              size="sm"
            >
              {t.appearance.fontBold}
            </FilePick>
            <Button
              size="sm"
              variant="primary"
              disabled={importing}
              onClick={() => importFont(regular)}
            >
              {t.party.insert}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRegular(undefined)}>
              {t.app.cancel}
            </Button>
          </div>
        )}
        <p class="field-hint">{t.appearance.fontImportHint}</p>
      </div>
    </div>
  );
}

function LogoPicker() {
  const logo = useStudio((s) => s.appearance.logo);
  const { logoUrl } = useDerived();
  const add = async (file: File) => {
    try {
      const { bytes, type } = await normalizeLogo(file);
      const key = `logo-${uid()}`;
      await putFile(key, bytes);
      setAppearance({
        logo: {
          key,
          type,
          position: logo?.position ?? 'left',
          height: logo?.height ?? 44,
          name: file.name,
        },
      });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };
  return (
    <div class="logo-picker">
      <div class="logo-box">
        {logo && logoUrl ? <img src={logoUrl} alt={logo.name} /> : <Icon name="image" size={22} />}
      </div>
      <div class="logo-controls">
        <div class="row-actions">
          <FilePick
            accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
            onFile={add}
            size="sm"
          >
            {logo ? t.appearance.logoReplace : t.appearance.logoAdd}
          </FilePick>
          {logo && (
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              onClick={() => setAppearance({ logo: undefined })}
            >
              {t.appearance.logoRemove}
            </Button>
          )}
        </div>
        {logo ? (
          <>
            <Segmented
              size="sm"
              label={t.appearance.logoPosition}
              value={logo.position}
              options={[
                { value: 'left', label: t.appearance.left },
                { value: 'right', label: t.appearance.right },
              ]}
              onValue={(position) => setAppearance({ logo: { ...logo, position } })}
            />
            <label class="range">
              <span>{t.appearance.logoSize}</span>
              <input
                type="range"
                min={20}
                max={110}
                step={2}
                value={logo.height}
                onInput={(e) =>
                  setAppearance({
                    logo: { ...logo, height: Number((e.currentTarget as HTMLInputElement).value) },
                  })
                }
              />
              <output>{logo.height} pt</output>
            </label>
          </>
        ) : (
          <p class="field-hint">{t.appearance.logoHint}</p>
        )}
      </div>
    </div>
  );
}

const STYLE_KEYS = [
  'header',
  'parties',
  'tableHeader',
  'rows',
  'totals',
  'amountDue',
  'titleCase',
  'density',
  'corners',
] as const;

function StyleTuner() {
  const appearance = useStudio((s) => s.appearance);
  const base = RENDER_TEMPLATES[appearance.template].style;
  const effective: RenderStyle = { ...base, ...appearance.style };
  const changed = Object.keys(appearance.style).length > 0;
  return (
    <div class="tuner">
      {STYLE_KEYS.map((key) => {
        const [label, values] = t.appearance.styles[key] ?? [key, {}];
        return (
          <div class="tuner-row" key={key}>
            <span class="tuner-label">{label}</span>
            <Segmented
              size="sm"
              label={label}
              value={effective[key] as string}
              options={Object.entries(values).map(([value, text]) => ({ value, label: text }))}
              onValue={(value) => {
                const style = { ...appearance.style, [key]: value } as Partial<RenderStyle>;
                if (base[key] === value) delete style[key];
                setAppearance({ style });
              }}
            />
          </div>
        );
      })}
      {changed && (
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          onClick={() => setAppearance({ style: {} })}
        >
          {t.appearance.reset}
        </Button>
      )}
    </div>
  );
}

const LABEL_KEYS: LabelKey[] = [
  'designation',
  'quantity',
  'unitPrice',
  'vat',
  'netAmount',
  'seller',
  'buyer',
  'amountDue',
  'paymentTerms',
  'notes',
];

function LabelsEditor() {
  const appearance = useStudio((s) => s.appearance);
  const defaults = RENDER_LABELS[appearance.language];
  return (
    <div class="grid">
      {LABEL_KEYS.map((key) => (
        <Field key={key} label={t.appearance.labelNames[key]} span={3}>
          {(id) => (
            <Input
              id={id}
              value={appearance.labels[key] ?? ''}
              placeholder={String(defaults[key])}
              onValue={(value) => setAppearance({ labels: { ...appearance.labels, [key]: value } })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

const DISPLAY_KEYS = [
  'lineNumbers',
  'itemDetails',
  'contacts',
  'electronicAddresses',
  'paymentDetails',
  'references',
  'facturxNotice',
] as const;
const DISPLAY_DEFAULTS: Record<(typeof DISPLAY_KEYS)[number], boolean> = {
  lineNumbers: false,
  itemDetails: true,
  contacts: true,
  electronicAddresses: false,
  paymentDetails: true,
  references: true,
  facturxNotice: false,
};

export function AppearancePanel() {
  const appearance = useStudio((s) => s.appearance);
  const legalInfo = useStudio((s) => s.form.seller.legalInfo);
  const [logoAsset, setLogoAsset] = useState<Assets['logo']>();
  useEffect(() => {
    const logo = appearance.logo;
    if (!logo) {
      setLogoAsset(undefined);
      return;
    }
    getFile(logo.key).then((bytes) => setLogoAsset(bytes ? { bytes, type: logo.type } : undefined));
  }, [appearance.logo?.key]);
  const saveDefault = () => {
    const current = store.get().appearance;
    storage.set(persistKeys.appearance, current).catch(() => undefined);
    toast(t.appearance.defaultSaved);
  };
  return (
    <div class="panel appearance">
      <section class="panel-section">
        <h3>{t.appearance.template}</h3>
        <TemplateGallery logo={logoAsset} />
      </section>
      <section class="panel-section">
        <h3>{t.appearance.color}</h3>
        <ColorPicker />
      </section>
      <section class="panel-section" data-field="logo">
        <h3>{t.appearance.logo}</h3>
        <LogoPicker />
      </section>
      <section class="panel-section">
        <h3>{t.appearance.font}</h3>
        <FontPicker />
      </section>
      <section class="panel-section">
        <h3>{t.appearance.layout}</h3>
        <p class="field-hint">{t.appearance.layoutHint}</p>
        <StyleTuner />
      </section>
      <section class="panel-section">
        <h3>{t.appearance.language}</h3>
        <div class="tuner">
          <div class="tuner-row">
            <span class="tuner-label">{t.appearance.language}</span>
            <Segmented
              size="sm"
              label={t.appearance.language}
              value={appearance.language}
              options={[
                { value: 'fr', label: t.appearance.languages.fr },
                { value: 'en', label: t.appearance.languages.en },
              ]}
              onValue={(language) => setAppearance({ language })}
            />
          </div>
          <div class="tuner-row">
            <span class="tuner-label">{t.appearance.page}</span>
            <Segmented
              size="sm"
              label={t.appearance.page}
              value={appearance.pageSize}
              options={[
                { value: 'A4', label: 'A4' },
                { value: 'Letter', label: 'Letter' },
              ]}
              onValue={(pageSize) => setAppearance({ pageSize })}
            />
          </div>
        </div>
        <p class="field-hint">{t.appearance.languageHint}</p>
      </section>
      <section class="panel-section">
        <h3>{t.appearance.display}</h3>
        {DISPLAY_KEYS.map((key) => (
          <Toggle
            key={key}
            checked={appearance.display[key] ?? DISPLAY_DEFAULTS[key]}
            onValue={(value) => setAppearance({ display: { ...appearance.display, [key]: value } })}
            label={t.appearance.displays[key]}
          />
        ))}
      </section>
      <section class="panel-section">
        <h3>{t.appearance.labels}</h3>
        <p class="field-hint">{t.appearance.labelsHint}</p>
        <LabelsEditor />
      </section>
      <section class="panel-section" data-field="footer">
        <h3>{t.appearance.footer}</h3>
        <Field
          label={t.appearance.footer}
          path="footer"
          hint={t.appearance.footerHint}
          action={
            legalInfo ? (
              <button
                type="button"
                class="link-btn"
                onClick={() => setAppearance({ footer: legalInfo })}
              >
                {t.appearance.footerFromLegal}
              </button>
            ) : undefined
          }
        >
          {(id) => (
            <TextArea
              id={id}
              path="footer"
              value={appearance.footer}
              onValue={(footer) => setAppearance({ footer })}
              rows={2}
            />
          )}
        </Field>
      </section>
      <section class="panel-section locked">
        <h3>
          <Icon name="lock" /> {t.appearance.locked}
        </h3>
        <p class="locked-text">{t.appearance.lockedText}</p>
      </section>
      <div class="panel-foot">
        <Button icon="check" onClick={saveDefault}>
          {t.appearance.saveDefault}
        </Button>
      </div>
    </div>
  );
}
