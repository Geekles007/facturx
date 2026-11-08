/**
 * La bibliothèque : mon entreprise, clients, catalogue, historique, numérotation, sauvegarde.
 * Sans compte, tout reste dans ce navigateur ; avec un compte, c'est le serveur qui garde. Dans les
 * deux cas, la sauvegarde est un fichier que l'utilisateur garde où il veut.
 *
 * En mode compte, l'entreprise et la numérotation sont dans la page Entreprise (`compte/entreprise.tsx`),
 * qui reprend leurs formulaires : la bibliothèque n'en garde pas les onglets.
 */

import { useEffect, useState } from 'preact/hooks';
import { OPERATION_CATEGORIES, pick, VAT_CHOICES } from './catalog.js';
import { PartyFields } from './editor/parties.js';
import { getFile } from './files.js';
import { formatDate, formatMoney, t } from './i18n.js';
import {
  type ClientRecord,
  FORMAT_SAUVEGARDE,
  formatNumber,
  lireSauvegarde,
  nextRank,
  type ProductRecord,
  productToLine,
  restaurerSauvegarde,
  type SavedInvoice,
  toPortableJson,
} from './library.js';
import { blankPaymentMeans, type FormLine, isoToday } from './model.js';
import { download, fileStem } from './pipeline.js';
import { storage } from './storage.js';
import {
  conserver,
  type LibraryTab,
  setIn,
  store,
  toast,
  ui,
  updateForm,
  useStudio,
} from './store.js';
import { Button, Dialog, Field, FilePick, IconButton, Input, Select, Toggle } from './ui.js';
import { balanceForm, creditNoteForm, duplicateForm, openIssued, startDraft } from './workflows.js';

/** Le profil vendeur et les préférences des nouvelles factures ; la page Entreprise le reprend. */
export function CompanyTab() {
  const company = useStudio((s) => s.company);
  const means = company.paymentMeans[0] ?? blankPaymentMeans();
  const set = (path: string, value: unknown) =>
    store.set((s) => ({ company: setIn(s.company, path, value) }));
  return (
    <div class="lib-tab">
      <p class="field-hint">{t.library.companyIntro}</p>
      <Button
        size="sm"
        variant="ghost"
        icon="copy"
        onClick={() => set('seller', structuredClone(store.get().form.seller))}
      >
        {t.library.fromCurrent}
      </Button>
      <PartyFields
        party={company.seller}
        prefix="company.seller"
        kind="seller"
        set={(path, value) => set(`seller.${path}`, value)}
      />
      <div class="grid">
        <Field label={t.payment.iban} span={4}>
          {(id) => (
            <Input
              id={id}
              value={means.iban}
              onValue={(v) => set('paymentMeans', [{ ...means, iban: v }])}
              spellcheck={false}
            />
          )}
        </Field>
        <Field label={t.payment.bic} span={2}>
          {(id) => (
            <Input
              id={id}
              value={means.bic}
              onValue={(v) => set('paymentMeans', [{ ...means, bic: v }])}
              spellcheck={false}
            />
          )}
        </Field>
      </div>
      <h4 class="lib-subhead">{t.library.defaults}</h4>
      <div class="grid">
        <Field label={t.library.defaultNature} span={3}>
          {(id) => (
            <Select
              id={id}
              value={company.defaults.operationCategory}
              options={OPERATION_CATEGORIES}
              onValue={(v) => set('defaults.operationCategory', v)}
            />
          )}
        </Field>
        <Field label={t.library.defaultVat} span={3}>
          {(id) => (
            <Select
              id={id}
              value={company.defaults.vat}
              options={VAT_CHOICES}
              moreLabel={t.app.more}
              onValue={(v) => set('defaults.vat', v)}
            />
          )}
        </Field>
        <Field label={t.library.paymentDays} span={3}>
          {(id) => (
            <Input
              id={id}
              value={String(company.defaults.paymentDays)}
              inputMode="numeric"
              onValue={(v) =>
                set('defaults.paymentDays', Math.min(365, Math.max(0, Number.parseInt(v, 10) || 0)))
              }
            />
          )}
        </Field>
        <Field label={t.payment.penalty} span={3}>
          {(id) => (
            <Input
              id={id}
              value={company.defaults.latePenaltyRate}
              decimal
              suffix="%"
              onValue={(v) => set('defaults.latePenaltyRate', v)}
            />
          )}
        </Field>
      </div>
      <Toggle
        checked={company.defaults.endOfMonth}
        onValue={(v) => set('defaults.endOfMonth', v)}
        label={t.library.endOfMonth}
      />
      <Toggle
        checked={company.defaults.vatOnDebits}
        onValue={(v) => set('defaults.vatOnDebits', v)}
        label={t.document.vatOnDebits}
      />
    </div>
  );
}

function ClientsTab() {
  const clients = useStudio((s) => s.clients);
  const [query, setQuery] = useState('');
  const shown = clients
    .filter((c) =>
      `${c.party.name} ${c.party.siren} ${c.party.address.city}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.party.name.localeCompare(b.party.name));
  const remove = (client: ClientRecord) => {
    if (!confirm(t.library.deleteConfirm)) return;
    store.set((s) => ({ clients: s.clients.filter((c) => c.uid !== client.uid) }));
    void conserver(`clients:${client.uid}`, () => storage.remove('clients', client.uid));
  };
  if (clients.length === 0) return <p class="lib-empty">{t.library.clientsEmpty}</p>;
  return (
    <div class="lib-tab">
      <Input
        value={query}
        onValue={setQuery}
        placeholder={t.library.search}
        aria-label={t.library.search}
        type="text"
      />
      <ul class="lib-list">
        {shown.map((client) => (
          <li key={client.uid}>
            <div class="lib-main">
              <strong>{client.party.name}</strong>
              <span>
                {[client.party.siren, client.party.address.postCode, client.party.address.city]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => {
                updateForm('buyer', () => structuredClone(client.party));
                ui({ library: undefined });
              }}
            >
              {t.library.use}
            </Button>
            <IconButton icon="trash" label={t.app.remove} onClick={() => remove(client)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductsTab() {
  const products = useStudio((s) => s.products);
  const remove = (product: ProductRecord) => {
    if (!confirm(t.library.deleteConfirm)) return;
    store.set((s) => ({ products: s.products.filter((p) => p.uid !== product.uid) }));
    void conserver(`products:${product.uid}`, () => storage.remove('products', product.uid));
  };
  if (products.length === 0) return <p class="lib-empty">{t.library.productsEmpty}</p>;
  return (
    <ul class="lib-list">
      {[...products]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((product) => (
          <li key={product.uid}>
            <div class="lib-main">
              <strong>{product.name}</strong>
              <span>
                {product.unitPrice
                  ? `${product.unitPrice} € ${t.lang === 'fr' ? 'HT' : 'excl. VAT'}`
                  : '—'}{' '}
                ·{' '}
                {pick(
                  VAT_CHOICES.find((v) => v.value === product.vat) ?? {
                    fr: product.vat,
                    en: product.vat,
                  },
                  t.lang,
                )}
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => updateForm<FormLine[]>('lines', (l) => [...l, productToLine(product)])}
            >
              {t.library.addToInvoice}
            </Button>
            <IconButton icon="trash" label={t.app.remove} onClick={() => remove(product)} />
          </li>
        ))}
    </ul>
  );
}

function HistoryTab() {
  const history = useStudio((s) => s.history);
  const [balancing, setBalancing] = useState<string[] | undefined>();
  const sorted = [...history].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const deposits = history.filter((h) => h.summary.typeCode === '386');
  const redownload = async (saved: SavedInvoice) => {
    const pdf = await getFile(`pdf-${saved.uid}`);
    if (pdf) download(pdf, `${fileStem(saved.summary.id)}.pdf`, 'application/pdf');
    else openIssued(saved);
  };
  if (history.length === 0) return <p class="lib-empty">{t.library.historyEmpty}</p>;
  return (
    <div class="lib-tab">
      <ul class="lib-list history">
        {sorted.map((saved) => (
          <li key={saved.uid}>
            <div class="lib-main">
              <strong>
                {saved.summary.id} <span class="type-tag">{saved.summary.typeCode}</span>
              </strong>
              <span>
                {saved.summary.buyerName} ·{' '}
                {t.library.issuedOn(formatDate(saved.summary.issueDate))} ·{' '}
                {formatMoney(saved.summary.total, saved.summary.currency)}
              </span>
            </div>
            <div class="lib-actions">
              <Button size="sm" variant="ghost" onClick={() => openIssued(saved)}>
                {t.library.open}
              </Button>
              <Button size="sm" variant="ghost" icon="download" onClick={() => redownload(saved)}>
                {t.library.redownload}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                onClick={() =>
                  void startDraft(duplicateForm(saved.form), structuredClone(saved.appearance))
                }
              >
                {t.library.duplicate}
              </Button>
              {!['381', '261', '262', '396'].includes(saved.summary.typeCode) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void startDraft(creditNoteForm(saved.form), structuredClone(saved.appearance))
                  }
                >
                  {t.library.credit}
                </Button>
              )}
              {saved.summary.typeCode === '386' && (
                <Button size="sm" variant="ghost" onClick={() => setBalancing([saved.uid])}>
                  {t.library.balance}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={balancing !== undefined}
        onClose={() => setBalancing(undefined)}
        title={t.library.balance}
      >
        <p class="field-hint">{t.library.balanceHint}</p>
        <p class="lib-subhead">{t.library.selectDeposits}</p>
        {deposits.map((d) => (
          <label class="check-row" key={d.uid}>
            <input
              type="checkbox"
              checked={balancing?.includes(d.uid) ?? false}
              onChange={(e) =>
                setBalancing((current) =>
                  (e.currentTarget as HTMLInputElement).checked
                    ? [...(current ?? []), d.uid]
                    : (current ?? []).filter((u) => u !== d.uid),
                )
              }
            />
            <span>
              {d.summary.id} — {d.summary.buyerName} —{' '}
              {formatMoney(d.summary.total, d.summary.currency)}
            </span>
          </label>
        ))}
        <div class="row-actions">
          <Button
            variant="primary"
            disabled={!balancing?.length}
            onClick={() => {
              try {
                const chosen = history.filter((h) => balancing?.includes(h.uid));
                void startDraft(
                  balanceForm(chosen),
                  structuredClone(chosen[0]?.appearance ?? store.get().appearance),
                );
                setBalancing(undefined);
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            {t.library.createBalance}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * Le prochain rang saisi : un entier de 1 au moins, comme toujours. Avec `minimum` (le compte : le
 * rang du serveur, que la base ne laisse pas reculer), un rang plus bas est refusé ici, avant tout
 * envoi — un champ vidé aussi, le temps de retaper.
 */
export function rangSaisi(texte: string, minimum?: number): { rang: number } | { refus: number } {
  const rang = Math.max(1, Number.parseInt(texte, 10) || 1);
  return minimum !== undefined && rang < minimum ? { refus: minimum } : { rang };
}

/** Pose le rang saisi dans la numérotation s'il est admis ; sinon rend le refus, et rien ne change. */
export function saisirRang(texte: string, minimum?: number): { refus: number } | undefined {
  const lu = rangSaisi(texte, minimum);
  if ('refus' in lu) return lu;
  store.set((s) => ({ numbering: { ...s.numbering, next: lu.rang } }));
  return undefined;
}

/**
 * La numérotation ; la page Entreprise la reprend avec `minimum`, le plus bas rang que le serveur
 * admet, lu au moment de la frappe. Un rang refusé reste affiché, avec la raison, et la numérotation
 * garde le dernier rang admis : rien ne part.
 */
export function NumberingTab({ minimum }: { minimum?: () => number | undefined }) {
  const numbering = useStudio((s) => s.numbering);
  const [refuse, setRefuse] = useState<{ texte: string; minimum: number }>();
  const today = isoToday();
  const set = (patch: Partial<typeof numbering>) =>
    store.set((s) => ({ numbering: { ...s.numbering, ...patch } }));
  return (
    <div class="lib-tab">
      <div class="grid">
        <Field label={t.library.pattern} span={4} hint={t.library.patternHint}>
          {(id) => (
            <Input
              id={id}
              value={numbering.pattern}
              onValue={(pattern) => set({ pattern })}
              spellcheck={false}
            />
          )}
        </Field>
        <Field label={t.library.nextRank} span={2}>
          {(id) => (
            <Input
              id={id}
              value={refuse?.texte ?? String(numbering.next)}
              inputMode="numeric"
              aria-invalid={refuse ? true : undefined}
              onValue={(v) => {
                const refus = saisirRang(v, minimum?.());
                setRefuse(refus ? { texte: v, minimum: refus.refus } : undefined);
              }}
            />
          )}
        </Field>
      </div>
      {refuse && (
        <p class="field-issue" role="alert">
          {t.library.nextRankTooLow(refuse.minimum)}
        </p>
      )}
      <Toggle
        checked={numbering.yearly}
        onValue={(yearly) => set({ yearly })}
        label={t.library.yearly}
      />
      <p class="numbering-preview">
        {t.library.nextPreview} :{' '}
        <code>{formatNumber(numbering.pattern, nextRank(numbering, today), today)}</code>
      </p>
      <p class="field-hint">{t.library.numberingWarning}</p>
    </div>
  );
}

function BackupTab() {
  const clients = useStudio((s) => s.clients.length);
  const products = useStudio((s) => s.products.length);
  const invoices = useStudio((s) => s.history.length);
  // Avec un compte, restaurer une sauvegarde locale écrirait par-dessus le serveur, clé par clé :
  // « Importer les données de ce navigateur », dans le menu du compte, en tient lieu.
  const compte = useStudio((s) => s.ui.compte !== undefined);
  const exportAll = async () => {
    const dump = await storage.dump().catch(() => undefined);
    const data = dump ?? {
      kv: { company: store.get().company, numbering: store.get().numbering },
      invoices: store.get().history,
    };
    download(
      toPortableJson({ format: FORMAT_SAUVEGARDE, version: 1, data }),
      `studio-sauvegarde-${isoToday()}.json`,
      'application/json',
    );
  };
  const restore = async (file: File) => {
    try {
      // Une sauvegarde du Studio, ou l'export d'un compte (`donnees.json`), PDF compris.
      await restaurerSauvegarde(lireSauvegarde(await file.text()), storage);
      toast(t.library.restored);
      setTimeout(() => location.reload(), 600);
    } catch {
      toast(t.library.restoreFailed, 'error');
    }
  };
  return (
    <div class="lib-tab">
      <p class="field-hint">{compte ? t.library.backupIntroCompte : t.library.backupIntro}</p>
      <p class="numbering-preview">{t.library.counts(clients, products, invoices)}</p>
      <div class="row-actions">
        <Button icon="download" variant="primary" onClick={exportAll}>
          {t.library.export}
        </Button>
        {!compte && (
          <FilePick accept=".json,application/json" onFile={restore} icon="upload">
            {t.library.restore}
          </FilePick>
        )}
      </div>
    </div>
  );
}

const TABS: LibraryTab[] = ['company', 'clients', 'products', 'history', 'numbering', 'backup'];

export function LibraryPanel() {
  const tab = useStudio((s) => s.ui.library);
  // En mode compte, l'entreprise et la numérotation ont leur page (la navigation, « Entreprise »).
  const compte = useStudio((s) => s.ui.compte !== undefined);
  const onglets = compte ? TABS.filter((id) => id !== 'company' && id !== 'numbering') : TABS;
  useEffect(() => {
    if (!tab) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]'))
        ui({ library: undefined });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tab]);
  if (!tab) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: un clic hors du tiroir le ferme ; au clavier, Échap et le bouton Fermer.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Échap est écouté sur le document.
    <div
      class="drawer-scrim"
      onClick={(e) => e.target === e.currentTarget && ui({ library: undefined })}
    >
      <aside class="drawer" aria-label={t.library.title}>
        <header class="drawer-head">
          <h2>{t.library.title}</h2>
          <IconButton icon="x" label={t.app.close} onClick={() => ui({ library: undefined })} />
        </header>
        <nav class="drawer-tabs" aria-label={t.library.title}>
          {onglets.map((id) => (
            <button
              type="button"
              key={id}
              class={tab === id ? 'on' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => ui({ library: id })}
            >
              {t.library.tabs[id]}
            </button>
          ))}
        </nav>
        <div class="drawer-body">
          {tab === 'company' && <CompanyTab />}
          {tab === 'clients' && <ClientsTab />}
          {tab === 'products' && <ProductsTab />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'numbering' && <NumberingTab />}
          {tab === 'backup' && <BackupTab />}
        </div>
      </aside>
    </div>
  );
}
