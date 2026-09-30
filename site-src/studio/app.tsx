/**
 * L'application : calculs dérivés, barre d'outils, éditeur, aperçu, dialogues.
 *
 * À chaque modification, le formulaire devient une `Invoice` (`buildInvoice`), le SDK la valide
 * (`validateInvoice`), la met en page (`layoutInvoice`) et, une fois conforme, produit son XML
 * (`toCiiXml`) que les trois schematrons officiels jugent. Rien de cela ne quitte le navigateur.
 */

import { toCiiXml, validateInvoice } from 'facturx-sdk';
import type { InvoiceLayout } from 'facturx-sdk/pdf';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { compterControle } from '../validateur/compteur.js';
import { anchorOf, type SectionId, sectionOf as sectionFor } from './anchors.js';
import { AppearancePanel } from './appearance.js';
import { CheckPanel } from './check.js';
import { CodePanel } from './codeview.js';
import {
  type Derived,
  DerivedContext,
  type JudgeResult,
  type OfficialState,
  type StudioIssue,
} from './context.js';
import { DocumentSection } from './editor/document.js';
import { AttachmentsSection, NotesSection, ReferencesSection } from './editor/extras.js';
import { LinesSection } from './editor/lines.js';
import { AdjustmentsSection, ExemptionsSection } from './editor/money.js';
import { BuyerSection, SellerSection } from './editor/parties.js';
import { DeliverySection, PaymentSection } from './editor/payment.js';
import { getFile } from './files.js';
import { type LoadedFonts, loadCustom, loadFamily, studioAsset } from './fonts.js';
import { formatDate, formatMoney, t } from './i18n.js';
import { exportStudioDocument, ImportError, importBytes } from './importer.js';
import { defaultAppearance, newInvoiceForm } from './library.js';
import { LibraryPanel } from './librarypanel.js';
import { buildInvoice } from './model.js';
import { type Assets, buildXml, download, fileStem, layoutFor } from './pipeline.js';
import { Preview } from './preview.js';
import { sampleForm } from './sample.js';
import { storage } from './storage.js';
import { persistKeys, store, type Tab, toast, ui, useStudio } from './store.js';
import { Button, Dialog, FilePick, Icon, IconButton, IssuesContext, Menu } from './ui.js';
import { creditNoteForm, duplicateForm, issueInvoice, startDraft } from './workflows.js';

// ---------- ressources : police et logo ----------

function useAssets(): {
  assets: Assets | undefined;
  fonts: LoadedFonts | undefined;
  logoUrl: string | undefined;
  error?: string;
} {
  const font = useStudio((s) => s.appearance.font);
  const custom = useStudio((s) => s.appearance.customFont);
  const logo = useStudio((s) => s.appearance.logo);
  const [fonts, setFonts] = useState<LoadedFonts>();
  const [logoAsset, setLogoAsset] = useState<{
    bytes: Uint8Array;
    type: 'png' | 'jpeg';
    url: string;
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (font === 'custom' && custom) {
        const regular = await getFile(custom.regularKey);
        const bold = custom.boldKey ? await getFile(custom.boldKey) : undefined;
        if (regular) return loadCustom(regular, bold, custom.name);
      }
      return loadFamily(font === 'custom' ? 'geist' : font);
    };
    load()
      .then((loaded) => {
        if (!cancelled) {
          setFonts(loaded);
          setError(undefined);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [font, custom?.regularKey, custom?.boldKey]);

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    if (!logo) {
      setLogoAsset(undefined);
      return;
    }
    getFile(logo.key).then((bytes) => {
      if (cancelled || !bytes) return;
      url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: logo.type === 'png' ? 'image/png' : 'image/jpeg' }),
      );
      setLogoAsset({ bytes, type: logo.type, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [logo?.key]);

  const assets = useMemo<Assets | undefined>(() => {
    if (!fonts) return undefined;
    const out: Assets = { fonts: { regular: fonts.regular, bold: fonts.bold } };
    if (logoAsset && logo) out.logo = { bytes: logoAsset.bytes, type: logoAsset.type };
    return out;
  }, [fonts, logoAsset, logo]);
  const result: ReturnType<typeof useAssets> = {
    assets,
    fonts,
    logoUrl: logo ? logoAsset?.url : undefined,
  };
  if (error) result.error = error;
  return result;
}

// ---------- anomalies ----------

function inputMessage(kind: string, scale?: number): string {
  const m = t.check.input;
  switch (kind) {
    case 'decimals':
      return m.decimals(scale ?? 2);
    case 'negative':
      return m.negative;
    case 'vat':
      return m.vat;
    case 'gross':
      return m.gross;
    default:
      return m.number;
  }
}

// ---------- validateurs officiels ----------

function useOfficial(xml: string | undefined): { official: OfficialState; run: () => void } {
  const [official, setOfficial] = useState<OfficialState>({ status: 'idle', judges: [] });
  const running = useRef(false);
  const run = useCallback(async () => {
    if (!xml || running.current) return;
    running.current = true;
    const judges: JudgeResult[] = [];
    setOfficial({ status: 'running', judges, xml });
    try {
      const [{ runSchematron }, { severityOf, TOLERATED }] = await Promise.all([
        import('../validateur/schematron.js'),
        import('../validateur/analyze.js'),
      ]);
      for (const id of ['cen', 'facturx', 'brfr'] as const) {
        try {
          const failures = (await runSchematron(id, xml)).map((f) => {
            const severity = severityOf(f);
            return {
              ...f,
              severity,
              reason: severity === 'tolerated' ? TOLERATED[f.id ?? ''] : undefined,
            };
          });
          judges.push({
            id,
            status: failures.some((f) => f.severity !== 'tolerated') ? 'failed' : 'ok',
            failures,
          });
        } catch (error) {
          judges.push({ id, status: 'skipped', failures: [], note: (error as Error).message });
        }
        setOfficial({ status: 'running', judges: [...judges], xml });
      }
      setOfficial({ status: 'done', judges, xml });
    } catch (error) {
      setOfficial({ status: 'error', judges, xml, error: (error as Error).message });
    } finally {
      running.current = false;
    }
  }, [xml]);
  // Lancés d'eux-mêmes une fois la facture conforme pour le SDK, après une pause de saisie.
  useEffect(() => {
    if (!xml) return;
    const timer = setTimeout(run, 1800);
    return () => clearTimeout(timer);
  }, [xml, run]);
  return { official, run };
}

// ---------- éditeur ----------

const SECTIONS: { id: SectionId; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'document', icon: 'receipt' },
  { id: 'seller', icon: 'building' },
  { id: 'buyer', icon: 'user' },
  { id: 'lines', icon: 'menu' },
  { id: 'adjustments', icon: 'percent' },
  { id: 'delivery', icon: 'truck' },
  { id: 'payment', icon: 'card' },
  { id: 'references', icon: 'link' },
  { id: 'notes', icon: 'note' },
  { id: 'attachments', icon: 'paperclip' },
];

function SectionNav({ issues }: { issues: StudioIssue[] }) {
  return (
    <nav class="section-nav" aria-label={t.app.sections}>
      {SECTIONS.map((section) => {
        const count = issues.filter((i) => i.anchor && sectionFor(i.anchor) === section.id).length;
        return (
          <button
            type="button"
            key={section.id}
            onClick={() =>
              document
                .getElementById(`section-${section.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            {t.sections[section.id]}
            {count > 0 && <span class="count bad">{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function ContentEditor({ issues }: { issues: StudioIssue[] }) {
  const issued = useStudio((s) => s.ui.issued);
  return (
    // `inert` : une facture émise ne se modifie plus, au clavier comme à la souris.
    <div
      class={`content-editor${issued ? ' readonly' : ''}`}
      {...({ inert: issued ? true : undefined } as object)}
    >
      <SectionNav issues={issues} />
      <DocumentSection />
      <SellerSection />
      <BuyerSection />
      <LinesSection />
      <AdjustmentsSection />
      <ExemptionsSection />
      <DeliverySection />
      <PaymentSection />
      <ReferencesSection />
      <NotesSection />
      <AttachmentsSection />
      <footer class="editor-foot">
        <p>{t.app.footPrivacy}</p>
        <p>{t.app.footLegal}</p>
        <p class="foot-links">
          <a href="../">{t.app.footLinks.home}</a>
          <a href="../validateur/">{t.app.footLinks.validator}</a>
          <a href="https://github.com/Geekles007/facturx">{t.app.footLinks.source}</a>
          <a href={studioAsset('polices/LICENCES.txt')}>{t.app.footLinks.fonts}</a>
        </p>
      </footer>
    </div>
  );
}

/** Conduit au champ demandé : défilement, focus, et un bref surlignage. */
function useFocusRequests(scroller: { current: HTMLElement | null }) {
  const focus = useStudio((s) => s.ui.focus);
  useEffect(() => {
    if (!focus) return;
    const find = (path: string): HTMLElement | null => {
      const root = scroller.current;
      if (!root) return null;
      const exact =
        root.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) ??
        root.querySelector<HTMLElement>(`[data-field="${CSS.escape(path)}"]`);
      if (exact) return exact;
      if (path === 'lines' || path === 'exemptions')
        return document.getElementById(`section-${path}`);
      const parent = path.replace(/(\.[^.[\]]+|\[\d+\])$/, '');
      return parent && parent !== path
        ? find(parent)
        : document.getElementById(`section-${sectionFor(path)}`);
    };
    // Laisser le temps à un bloc replié de s'ouvrir.
    const timer = setTimeout(() => {
      const target = find(focus.path);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const control = target.matches('input,select,textarea,button')
        ? target
        : target.querySelector<HTMLElement>('input,select,textarea,button');
      control?.focus({ preventScroll: true });
      const box = target.closest<HTMLElement>('.field,.toggle-row,.card-ui') ?? target;
      box.classList.remove('flash');
      void box.offsetWidth;
      box.classList.add('flash');
    }, 60);
    return () => clearTimeout(timer);
  }, [focus?.nonce]);
}

// ---------- barre d'outils ----------

function StatusPill({ issues, official }: { issues: StudioIssue[]; official: OfficialState }) {
  const ok = issues.length === 0;
  const officialOk = official.status === 'done' && official.judges.every((j) => j.status === 'ok');
  return (
    <button
      type="button"
      class={`status-pill ${ok ? 'ok' : 'ko'}`}
      onClick={() => ui({ tab: 'check', mobile: 'edit' })}
    >
      <Icon name={ok ? 'shield' : 'alert'} size={14} />
      <span>{ok ? t.status.ok : t.status.issues(issues.length)}</span>
      {ok && official.status === 'running' && <span class="pill-sub">{t.status.checking}</span>}
      {ok && officialOk && <Icon name="check" size={12} />}
    </button>
  );
}

function confirmReplace(): boolean {
  const { ui: state } = store.get();
  return state.sample || state.issued !== undefined || confirm(t.app.replaceConfirm);
}

async function openFile(file: File): Promise<void> {
  if (!confirmReplace()) return;
  toast(t.app.importing(file.name), 'info');
  try {
    const imported = await importBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    startDraft(imported.form, imported.appearance);
    toast(t.app.imported(t.app.sources[imported.source] ?? imported.source));
  } catch (error) {
    toast(
      t.app.importFailed(error instanceof ImportError ? error.message : String(error)),
      'error',
    );
  }
}

async function newBlank(): Promise<void> {
  if (!confirmReplace()) return;
  const { company, numbering, form, ui: state } = store.get();
  const saved = await storage
    .get<ReturnType<typeof defaultAppearance>>(persistKeys.appearance)
    .catch(() => undefined);
  // Sans entreprise enregistrée, le vendeur déjà saisi est gardé — sauf celui de l'exemple.
  const profile =
    company.seller.name.trim() || state.sample
      ? company
      : { ...company, seller: form.seller, paymentMeans: form.paymentMeans };
  startDraft(newInvoiceForm(profile, numbering), saved ?? store.get().appearance);
}

function TopBar({ derived, onIssue }: { derived: Derived; onIssue: () => void }) {
  const form = useStudio((s) => s.form);
  const appearance = useStudio((s) => s.appearance);
  const issued = useStudio((s) => s.ui.issued);
  const ok = derived.issues.length === 0;
  const title = form.id.trim() || t.app.untitled;
  return (
    <header class="topbar">
      <a class="brand" href="../" aria-label="facturx-sdk">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 3.5h11l5 5V20.5H4z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M15 3.5v5h5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M8 12h8M8 16h5"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <span>
          facturx <b>{t.app.studio}</b>
        </span>
      </a>
      <div class="doc-title">
        <strong>{title}</strong>
        {form.buyer.name && <span>{form.buyer.name}</span>}
        <span class="money">
          {formatMoney(derived.built.invoice.totals.amountDueForPayment, form.currency)}
        </span>
      </div>
      <StatusPill issues={derived.issues} official={derived.official} />
      <div class="topbar-actions">
        <Menu
          label={t.app.new}
          align="right"
          trigger={(props) => (
            <Button icon="plus" variant="ghost" title={t.app.new} {...props}>
              <span class="hide-md">{t.app.new}</span>
            </Button>
          )}
          items={[
            { label: t.app.newBlank, icon: 'file', onSelect: newBlank },
            {
              label: t.app.duplicate,
              icon: 'copy',
              onSelect: () => startDraft(duplicateForm(store.get().form)),
            },
            {
              label: t.app.creditNote,
              icon: 'receipt',
              onSelect: () => startDraft(creditNoteForm(store.get().form)),
            },
            'separator',
            {
              label: t.app.newSample,
              icon: 'sparkle',
              onSelect: () => {
                if (!confirmReplace()) return;
                startDraft(sampleForm(), defaultAppearance());
                ui({ sample: true });
              },
            },
          ]}
        />
        <FilePick
          accept=".pdf,.xml,.json,application/pdf,text/xml,application/xml,application/json"
          onFile={openFile}
          icon="folder"
          variant="ghost"
        >
          <span class="hide-md">{t.app.open}</span>
        </FilePick>
        <Button
          icon="book"
          variant="ghost"
          title={t.app.library}
          onClick={() => ui({ library: 'company' })}
        >
          <span class="hide-md">{t.app.library}</span>
        </Button>
        <div class="split">
          <Button
            icon={issued ? 'download' : 'check'}
            variant="primary"
            disabled={!ok || !derived.assets}
            onClick={onIssue}
            title={ok ? undefined : t.issueDialog.blocked}
          >
            {issued ? (
              t.app.download
            ) : (
              <>
                <span class="label-long">{t.app.issue}</span>
                <span class="label-short">{t.app.issueShort}</span>
              </>
            )}
          </Button>
          <Menu
            label={t.app.download}
            align="right"
            trigger={(props) => (
              <button
                type="button"
                class="btn-ui primary md split-caret"
                aria-label={t.app.download}
                {...props}
              >
                <Icon name="chevronDown" />
              </button>
            )}
            items={[
              {
                label: t.app.downloadPdfNoIssue,
                icon: 'download',
                disabled: !ok || !derived.assets,
                onSelect: () =>
                  derived.assets &&
                  issueInvoice(derived.assets, { record: false }).then(
                    (done) => done && countIssued(),
                  ),
              },
              {
                label: t.app.downloadXml,
                icon: 'code',
                disabled: !derived.xml,
                onSelect: () =>
                  download(
                    buildXml(derived.built.invoice),
                    `${fileStem(form.id)}.xml`,
                    'application/xml',
                  ),
              },
              {
                label: t.app.downloadJson,
                icon: 'file',
                onSelect: () =>
                  download(
                    exportStudioDocument(form, appearance),
                    `${fileStem(form.id)}.facturx-studio.json`,
                    'application/json',
                  ),
              },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

/** Un signal sans contenu par PDF Factur-X produit (voir site/README.md). */
function countIssued(): void {
  compterControle(studioAsset('compteur/facture'));
}

function IssueDialog({
  open,
  onClose,
  derived,
}: {
  open: boolean;
  onClose: () => void;
  derived: Derived;
}) {
  const form = useStudio((s) => s.form);
  const history = useStudio((s) => s.history);
  const [busy, setBusy] = useState(false);
  const duplicate = history.some((h) => h.form.id.trim() === form.id.trim());
  const invoice = derived.built.invoice;
  const confirmIssue = async () => {
    if (!derived.assets) return;
    setBusy(true);
    const done = await issueInvoice(derived.assets, { record: true });
    setBusy(false);
    if (done) {
      countIssued();
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.issueDialog.title(form.id)}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.app.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={busy || duplicate}
            onClick={confirmIssue}
          >
            {t.issueDialog.confirm}
          </Button>
        </>
      }
    >
      <dl class="issue-summary">
        <div>
          <dt>{t.sections.buyer}</dt>
          <dd>{invoice.buyer.name}</dd>
        </div>
        <div>
          <dt>{t.document.issueDate}</dt>
          <dd>{formatDate(invoice.issueDate)}</dd>
        </div>
        <div>
          <dt>{t.lines.totalTTC}</dt>
          <dd>{formatMoney(invoice.totals.taxInclusiveAmount, invoice.currency)}</dd>
        </div>
      </dl>
      <p>{t.issueDialog.body}</p>
      {duplicate && <p class="field-issue">{t.issueDialog.duplicateNumber}</p>}
    </Dialog>
  );
}

function Banners() {
  const sample = useStudio((s) => s.ui.sample);
  const issued = useStudio((s) => s.ui.issued);
  const storageState = useStudio((s) => s.ui.storage);
  const history = useStudio((s) => s.history);
  const saved = issued ? history.find((h) => h.uid === issued) : undefined;
  // Un seul conteneur, toujours présent : la grille de l'application a une rangée pour lui.
  return (
    <div class="banners">
      {storageState === 'memory' && (
        <p class="banner warn">
          <Icon name="alert" /> {t.app.storageMemory}
        </p>
      )}
      {sample && !issued && (
        <p class="banner info">
          <Icon name="sparkle" /> <span>{t.app.sample}</span>
          <Button size="sm" onClick={newBlank}>
            {t.app.startBlank}
          </Button>
        </p>
      )}
      {saved && (
        <div class="banner issued">
          <Icon name="lock" />
          <span>
            <strong>{t.app.issuedBanner(formatDate(saved.issuedAt.slice(0, 10)))}</strong>{' '}
            {t.app.issuedHint}
          </span>
          <div class="banner-actions">
            <Button
              size="sm"
              icon="copy"
              onClick={() =>
                startDraft(duplicateForm(saved.form), structuredClone(saved.appearance))
              }
            >
              {t.app.duplicate}
            </Button>
            {!['381', '261', '262', '396'].includes(saved.summary.typeCode) && (
              <Button
                size="sm"
                icon="receipt"
                onClick={() =>
                  startDraft(creditNoteForm(saved.form), structuredClone(saved.appearance))
                }
              >
                {t.app.creditNote}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={newBlank}>
              {t.app.newBlank}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const toastState = useStudio((s) => s.ui.toast);
  if (!toastState) return null;
  return (
    <div
      class={`toast ${toastState.kind}`}
      role={toastState.kind === 'error' ? 'alert' : 'status'}
      key={toastState.id}
    >
      <Icon
        name={toastState.kind === 'error' ? 'alert' : toastState.kind === 'info' ? 'info' : 'check'}
      />
      <span>{toastState.text}</span>
      <IconButton icon="x" label={t.app.close} onClick={() => ui({ toast: undefined })} />
    </div>
  );
}

// ---------- application ----------

const TABS: { id: Tab; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'content', icon: 'edit' },
  { id: 'appearance', icon: 'palette' },
  { id: 'check', icon: 'shield' },
  { id: 'code', icon: 'code' },
];

export function App() {
  const form = useStudio((s) => s.form);
  const appearance = useStudio((s) => s.appearance);
  const tab = useStudio((s) => s.ui.tab);
  const mobile = useStudio((s) => s.ui.mobile);
  const issued = useStudio((s) => s.ui.issued);
  const history = useStudio((s) => s.history);
  const { assets, fonts, logoUrl, error: assetError } = useAssets();
  const scroller = useRef<HTMLDivElement>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const built = useMemo(() => buildInvoice(form), [form]);
  const validation = useMemo(() => validateInvoice(built.invoice), [built]);
  const xml = useMemo(() => {
    if (!validation.ok || built.errors.length) return undefined;
    try {
      return toCiiXml(built.invoice, { pretty: true });
    } catch {
      return undefined;
    }
  }, [built, validation]);

  const [layoutState, setLayoutState] = useState<{
    layout?: InvoiceLayout;
    error?: string;
    pending: boolean;
  }>({ pending: true });
  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    setLayoutState((s) => ({ ...s, pending: true }));
    const timer = setTimeout(() => {
      layoutFor(built.invoice, appearance, assets)
        .then((layout) => !cancelled && setLayoutState({ layout, pending: false }))
        .catch(
          (e: Error) =>
            !cancelled && setLayoutState((s) => ({ ...s, error: e.message, pending: false })),
        );
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [built, appearance, assets]);

  const issues = useMemo<StudioIssue[]>(() => {
    const input: StudioIssue[] = built.errors.map((e) => ({
      code: 'SAISIE',
      message: inputMessage(e.kind, e.scale),
      path: e.path,
      anchor: anchorOf(e.path),
      source: 'input',
    }));
    const sdk: StudioIssue[] = validation.issues
      // Une saisie illisible produit un 0 que le SDK relèverait aussi : on ne le dit qu'une fois.
      .filter((i) => !built.errors.some((e) => e.path === i.path))
      .map((i) => ({
        code: i.code,
        message: i.message,
        path: i.path,
        anchor: anchorOf(built.toFormPath(i.path)),
        source: 'sdk',
      }));
    const glyphs: StudioIssue[] = (layoutState.layout?.missingGlyphs ?? []).map((g) => ({
      code: 'GLYPH',
      message: `« ${g.char} » (U+${g.codePoint.toString(16).toUpperCase().padStart(4, '0')}) ${t.lang === 'fr' ? 'absent de la police' : 'missing from the font'}`,
      path: g.ref ?? '',
      anchor: g.ref ? anchorOf(built.toFormPath(g.ref), 'preview') : 'seller.name',
      source: 'glyph',
    }));
    return [...input, ...sdk, ...glyphs];
  }, [built, validation, layoutState.layout]);

  const { official, run } = useOfficial(xml);
  const derived: Derived = {
    built,
    issues,
    xml,
    layout: layoutState.layout,
    layoutError: layoutState.error ?? assetError,
    layoutPending: layoutState.pending,
    fonts,
    logoUrl,
    official,
    runOfficial: run,
    assets,
  };

  useFocusRequests(scroller);

  // Un clic dans l'éditeur surligne le bloc correspondant de l'aperçu.
  const onFocusOut = (event: FocusEvent) => {
    if (!(event.relatedTarget as HTMLElement | null)?.closest?.('[data-path]'))
      ui({ hover: undefined });
  };
  const onFocusIn = (event: FocusEvent) => {
    const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
    if (!path) return;
    const block =
      path.match(/^(lines\[\d+\]|paymentMeans\[\d+\]|notes\[\d+\]|seller|buyer|payee)/)?.[1] ??
      path.replace(/\.(value|scheme)$/, '');
    ui({ hover: block });
  };

  const onIssue = async () => {
    if (issued) {
      const pdf = await getFile(`pdf-${issued}`);
      const saved = history.find((h) => h.uid === issued);
      if (pdf && saved) download(pdf, `${fileStem(saved.summary.id)}.pdf`, 'application/pdf');
      return;
    }
    setIssueOpen(true);
  };

  return (
    <DerivedContext.Provider value={derived}>
      <IssuesContext.Provider value={issues}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: déposer un fichier n'est qu'un raccourci du bouton « Ouvrir un fichier… ». */}
        <div
          class={`studio mobile-${mobile}${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.relatedTarget === null) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer?.files?.[0];
            if (file) void openFile(file);
          }}
        >
          <TopBar derived={derived} onIssue={onIssue} />
          <Banners />
          <main class="workspace" id="contenu">
            <div class="editor-pane">
              <div class="tabs-ui" role="tablist" aria-label={t.app.studio}>
                {TABS.map((item) => {
                  const count = item.id === 'check' ? issues.length : 0;
                  return (
                    <button
                      type="button"
                      role="tab"
                      key={item.id}
                      aria-selected={tab === item.id}
                      class={tab === item.id ? 'on' : ''}
                      onClick={() => ui({ tab: item.id })}
                    >
                      <Icon name={item.icon} />
                      <span>{t.app.tabs[item.id]}</span>
                      {count > 0 && <span class="count bad">{count}</span>}
                    </button>
                  );
                })}
              </div>
              <div
                class="editor-scroll"
                ref={scroller}
                onFocusIn={onFocusIn}
                onFocusOut={onFocusOut}
              >
                {issued && tab === 'content' && (
                  <p class="readonly-note">
                    <Icon name="lock" /> {t.app.readOnly}
                  </p>
                )}
                {tab === 'content' && <ContentEditor issues={issues} />}
                {tab === 'appearance' && <AppearancePanel />}
                {tab === 'check' && <CheckPanel />}
                {tab === 'code' && <CodePanel />}
              </div>
            </div>
            <div class="preview-pane">
              <Preview />
            </div>
          </main>
          <nav class="mobile-nav" aria-label={t.app.studio}>
            <button
              type="button"
              class={mobile === 'edit' ? 'on' : ''}
              onClick={() => ui({ mobile: 'edit' })}
            >
              <Icon name="edit" /> {t.app.mobile.edit}
            </button>
            <button
              type="button"
              class={mobile === 'preview' ? 'on' : ''}
              onClick={() => ui({ mobile: 'preview' })}
            >
              <Icon name="eye" /> {t.app.mobile.preview}
            </button>
          </nav>
          <LibraryPanel />
          <IssueDialog open={issueOpen} onClose={() => setIssueOpen(false)} derived={derived} />
          <Toasts />
          {dragging && (
            <div class="drop-overlay" aria-hidden="true">
              <Icon name="upload" size={28} />
              <p>{t.app.dropHere}</p>
            </div>
          )}
        </div>
      </IssuesContext.Provider>
    </DerivedContext.Provider>
  );
}
