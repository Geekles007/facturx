/**
 * Les lignes : désignation, quantité, unité, prix, TVA ; et, dépliés, les détails qu'EN 16931
 * sait porter — références d'article, période, prix brut, quantité de base, remises et frais.
 *
 * Le montant affiché est celui que le SDK calcule (`computeLineNetAmount`), au centime près,
 * jamais une approximation de l'interface.
 */

import { ALLOWANCE_REASONS, CHARGE_REASONS, COUNTRIES, UNITS, VAT_CHOICES } from '../catalog.js';
import { useDerived } from '../context.js';
import { formatMoney, t } from '../i18n.js';
import { lineToProduct, productToLine } from '../library.js';
import { blankAdjustment, blankLine, type FormAdjustment, type FormLine, uid } from '../model.js';
import { storage } from '../storage.js';
import { setForm, store, toast, updateForm, useStudio } from '../store.js';
import {
  Button,
  Card,
  Disclosure,
  Field,
  Icon,
  IconButton,
  Input,
  Menu,
  Segmented,
  Select,
  TextArea,
} from '../ui.js';

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

/** Remises ou frais d'une ligne (ou du document, sans la TVA). */
export function AdjustmentRows({
  items,
  base,
  kind,
}: {
  items: FormAdjustment[];
  base: string;
  kind: 'allowances' | 'charges';
}) {
  const reasons = kind === 'allowances' ? ALLOWANCE_REASONS : CHARGE_REASONS;
  return (
    <div class="adjust-list">
      {items.map((item, i) => {
        const path = `${base}[${i}]`;
        return (
          <div class="adjust-row" key={item.uid}>
            <Field label={t.adjustments.reason} path={`${path}.reason`}>
              {(id) => (
                <Input
                  id={id}
                  path={`${path}.reason`}
                  value={item.reason}
                  onValue={(v) => setForm(`${path}.reason`, v)}
                />
              )}
            </Field>
            <Field label={t.adjustments.value} path={`${path}.value`}>
              {(id) => (
                <div class="combo">
                  <Input
                    id={id}
                    path={`${path}.value`}
                    value={item.value}
                    onValue={(v) => setForm(`${path}.value`, v)}
                    decimal
                  />
                  <Segmented
                    size="sm"
                    label={t.adjustments.value}
                    value={item.mode}
                    options={[
                      { value: 'percent', label: '%' },
                      { value: 'amount', label: '€' },
                    ]}
                    onValue={(v) => setForm(`${path}.mode`, v)}
                  />
                </div>
              )}
            </Field>
            <Field label={t.adjustments.reasonCode} path={`${path}.reasonCode`}>
              {(id) => (
                <Select
                  id={id}
                  value={item.reasonCode}
                  options={reasons}
                  onValue={(v) => setForm(`${path}.reasonCode`, v)}
                />
              )}
            </Field>
            <IconButton
              icon="trash"
              label={t.app.remove}
              class="adjust-remove"
              onClick={() =>
                updateForm<FormAdjustment[]>(base, (list) => list.filter((_, j) => j !== i))
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function LineDetails({ line, index }: { line: FormLine; index: number }) {
  const p = (key: string) => `lines[${index}].${key}`;
  const set = (key: string) => (value: string) => setForm(p(key), value);
  return (
    <>
      <Field label={t.lines.description} path={p('description')} optional>
        {(id) => (
          <TextArea
            id={id}
            path={p('description')}
            value={line.description}
            onValue={set('description')}
            rows={2}
          />
        )}
      </Field>
      <div class="grid">
        <Field label={t.lines.itemId} path={p('sellerItemId')} span={2} optional>
          {(id) => (
            <Input
              id={id}
              path={p('sellerItemId')}
              value={line.sellerItemId}
              onValue={set('sellerItemId')}
            />
          )}
        </Field>
        <Field label={t.lines.buyerItemId} path={p('buyerItemId')} span={2} optional>
          {(id) => (
            <Input
              id={id}
              path={p('buyerItemId')}
              value={line.buyerItemId}
              onValue={set('buyerItemId')}
            />
          )}
        </Field>
        <Field label={t.lines.gtin} path={p('gtin')} span={2} optional>
          {(id) => (
            <Input
              id={id}
              path={p('gtin')}
              value={line.gtin}
              onValue={set('gtin')}
              inputMode="numeric"
            />
          )}
        </Field>
        <Field
          label={t.lines.periodStart}
          path={p('periodStart')}
          also={[p('periodEnd')]}
          span={2}
          optional
        >
          {(id) => (
            <Input
              id={id}
              type="date"
              path={p('periodStart')}
              value={line.periodStart}
              onValue={set('periodStart')}
            />
          )}
        </Field>
        <Field label={t.lines.periodEnd} path={p('periodEnd')} span={2} optional>
          {(id) => (
            <Input
              id={id}
              type="date"
              path={p('periodEnd')}
              value={line.periodEnd}
              onValue={set('periodEnd')}
            />
          )}
        </Field>
        <Field label={t.lines.origin} path={p('originCountry')} span={2} optional>
          {(id) => (
            <Select
              id={id}
              path={p('originCountry')}
              value={line.originCountry}
              options={[{ value: '', fr: '—', en: '—' }, ...COUNTRIES]}
              onValue={set('originCountry')}
            />
          )}
        </Field>
        <Field
          label={t.lines.grossPrice}
          path={p('grossUnitPrice')}
          span={3}
          hint={t.lines.grossPriceHint}
          optional
        >
          {(id) => (
            <Input
              id={id}
              path={p('grossUnitPrice')}
              value={line.grossUnitPrice}
              onValue={set('grossUnitPrice')}
              decimal
              suffix="€"
            />
          )}
        </Field>
        <Field
          label={t.lines.baseQuantity}
          path={p('baseQuantity')}
          span={3}
          hint={t.lines.baseQuantityHint}
          optional
        >
          {(id) => (
            <Input
              id={id}
              path={p('baseQuantity')}
              value={line.baseQuantity}
              onValue={set('baseQuantity')}
              decimal
              placeholder="1"
            />
          )}
        </Field>
        <Field label={t.lines.orderLine} path={p('orderLineReference')} span={3} optional>
          {(id) => (
            <Input
              id={id}
              path={p('orderLineReference')}
              value={line.orderLineReference}
              onValue={set('orderLineReference')}
            />
          )}
        </Field>
        <Field label={t.lines.accounting} path={p('buyerAccountingReference')} span={3} optional>
          {(id) => (
            <Input
              id={id}
              path={p('buyerAccountingReference')}
              value={line.buyerAccountingReference}
              onValue={set('buyerAccountingReference')}
            />
          )}
        </Field>
      </div>
      <Field label={t.lines.note} path={p('note')} optional>
        {(id) => <Input id={id} path={p('note')} value={line.note} onValue={set('note')} />}
      </Field>
      <div class="subhead">
        <span>{t.lines.allowances}</span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() =>
            updateForm<FormAdjustment[]>(p('allowances'), (l) => [
              ...l,
              blankAdjustment(t.adjustments.defaultAllowance),
            ])
          }
        >
          {t.lines.addAllowance}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() =>
            updateForm<FormAdjustment[]>(p('charges'), (l) => [
              ...l,
              blankAdjustment(t.adjustments.defaultCharge),
            ])
          }
        >
          {t.lines.addCharge}
        </Button>
      </div>
      {line.allowances.length > 0 && (
        <AdjustmentRows items={line.allowances} base={p('allowances')} kind="allowances" />
      )}
      {line.charges.length > 0 && (
        <>
          <p class="subhead-label">{t.lines.charges}</p>
          <AdjustmentRows items={line.charges} base={p('charges')} kind="charges" />
        </>
      )}
    </>
  );
}

function LineRow({ line, index, count }: { line: FormLine; index: number; count: number }) {
  const { built } = useDerived();
  const currency = useStudio((s) => s.form.currency);
  const p = (key: string) => `lines[${index}].${key}`;
  const set = (key: string) => (value: string) => setForm(p(key), value);
  const lineErrors = built.errors.some((e) => e.path.startsWith(`lines[${index}]`));
  const amount = built.invoice.lines[index]?.netAmount;
  const detailCount =
    [
      line.description,
      line.sellerItemId,
      line.buyerItemId,
      line.gtin,
      line.periodStart,
      line.grossUnitPrice,
      line.baseQuantity,
      line.note,
      line.orderLineReference,
      line.buyerAccountingReference,
      line.originCountry,
    ].filter(Boolean).length +
    line.allowances.length +
    line.charges.length;
  const saveProduct = () => {
    const { products } = store.get();
    const existing = products.find(
      (pr) => pr.name.trim().toLowerCase() === line.name.trim().toLowerCase(),
    );
    const record = lineToProduct(line, existing?.uid);
    store.set({
      products: existing
        ? products.map((pr) => (pr.uid === record.uid ? record : pr))
        : [...products, record],
    });
    storage.put('products', record).catch(() => undefined);
    toast(t.lines.productSaved);
  };
  return (
    <li class="line" data-line={index}>
      <div class="line-top">
        <span class="line-num" aria-hidden="true">
          {index + 1}
        </span>
        <Field
          label={<span class="sr-only">{t.lines.designation}</span>}
          path={p('name')}
          also={[`lines[${index}].id`]}
        >
          {(id) => (
            <Input
              id={id}
              path={p('name')}
              value={line.name}
              onValue={set('name')}
              placeholder={t.lines.designation}
              class="line-name"
            />
          )}
        </Field>
        <Menu
          label={t.lines.details}
          align="right"
          trigger={(props) => (
            <button
              type="button"
              class="icon-btn"
              aria-label={t.lines.details}
              title={t.lines.details}
              {...props}
            >
              <Icon name="more" />
            </button>
          )}
          items={[
            {
              label: t.lines.duplicate,
              icon: 'copy',
              onSelect: () =>
                updateForm<FormLine[]>('lines', (lines) => {
                  const copy = structuredClone(line);
                  copy.uid = uid();
                  for (const a of [...copy.allowances, ...copy.charges]) a.uid = uid();
                  return [...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)];
                }),
            },
            {
              label: t.lines.moveUp,
              icon: 'up',
              disabled: index === 0,
              onSelect: () => updateForm<FormLine[]>('lines', (l) => move(l, index, index - 1)),
            },
            {
              label: t.lines.moveDown,
              icon: 'down',
              disabled: index === count - 1,
              onSelect: () => updateForm<FormLine[]>('lines', (l) => move(l, index, index + 1)),
            },
            {
              label: t.lines.saveProduct,
              icon: 'book',
              disabled: !line.name.trim(),
              onSelect: saveProduct,
            },
            'separator',
            {
              label: t.lines.remove,
              icon: 'trash',
              danger: true,
              disabled: count === 1,
              onSelect: () =>
                updateForm<FormLine[]>('lines', (l) => l.filter((_, i) => i !== index)),
            },
          ]}
        />
      </div>
      <div class="line-grid">
        <Field label={t.lines.quantity} path={p('quantity')}>
          {(id) => (
            <Input
              id={id}
              path={p('quantity')}
              value={line.quantity}
              onValue={set('quantity')}
              decimal
            />
          )}
        </Field>
        <Field label={t.lines.unit} path={p('unitCode')}>
          {(id) => (
            <Select
              id={id}
              path={p('unitCode')}
              value={line.unitCode}
              options={UNITS}
              moreLabel={t.app.more}
              onValue={set('unitCode')}
            />
          )}
        </Field>
        <Field label={t.lines.unitPrice} path={p('unitPrice')}>
          {(id) => (
            <Input
              id={id}
              path={p('unitPrice')}
              value={line.unitPrice}
              onValue={set('unitPrice')}
              decimal
              suffix="€"
              placeholder="0,00"
            />
          )}
        </Field>
        <Field label={t.lines.vat} path={p('vat')}>
          {(id, invalid) => (
            <Select
              id={id}
              path={p('vat')}
              value={line.vat}
              options={VAT_CHOICES}
              moreLabel={t.app.more}
              invalid={invalid}
              onValue={set('vat')}
            />
          )}
        </Field>
        <div class="line-amount" aria-live="polite">
          <span class="amount-label">{t.lines.amount}</span>
          <strong>
            {lineErrors || amount === undefined ? '—' : formatMoney(amount, currency)}
          </strong>
        </div>
      </div>
      <Disclosure
        label={t.lines.details}
        count={detailCount}
        paths={[
          p('description'),
          p('sellerItemId'),
          p('buyerItemId'),
          p('gtin'),
          p('periodStart'),
          p('periodEnd'),
          p('grossUnitPrice'),
          p('baseQuantity'),
          p('note'),
          p('orderLineReference'),
          p('buyerAccountingReference'),
          p('originCountry'),
          p('allowances'),
          p('charges'),
        ]}
      >
        <LineDetails line={line} index={index} />
      </Disclosure>
    </li>
  );
}

export function LinesSection() {
  const lines = useStudio((s) => s.form.lines);
  const products = useStudio((s) => s.products);
  const currency = useStudio((s) => s.form.currency);
  const vat = useStudio((s) => s.company.defaults.vat);
  const { built } = useDerived();
  const totals = built.invoice.totals;
  const credit = ['381', '261', '262', '396'].includes(built.invoice.typeCode);
  return (
    <Card
      id="lines"
      icon="menu"
      title={t.sections.lines}
      subtitle={`${lines.length}`}
      paths={['lines']}
    >
      <ol class="lines">
        {lines.map((line, index) => (
          <LineRow key={line.uid} line={line} index={index} count={lines.length} />
        ))}
      </ol>
      <div class="lines-actions">
        <Button
          icon="plus"
          onClick={() =>
            updateForm<FormLine[]>('lines', (l) => [...l, blankLine(l[l.length - 1]?.vat ?? vat)])
          }
        >
          {t.lines.add}
        </Button>
        <Menu
          label={t.lines.fromCatalog}
          trigger={(props) => (
            <Button icon="book" variant="ghost" {...props}>
              {t.lines.fromCatalog}
            </Button>
          )}
          items={
            products.length
              ? [...products]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((pr) => ({
                    label: pr.name,
                    hint: pr.unitPrice ? `${pr.unitPrice} €` : undefined,
                    onSelect: () =>
                      updateForm<FormLine[]>('lines', (l) => {
                        // Une première ligne encore vide est remplacée plutôt que laissée en blanc.
                        const blank =
                          l.length === 1 && !l[0]?.name.trim() && !l[0]?.unitPrice.trim();
                        return blank ? [productToLine(pr)] : [...l, productToLine(pr)];
                      }),
                  }))
              : [{ label: t.lines.emptyCatalog, disabled: true, onSelect: () => undefined }]
          }
        />
      </div>
      <dl class="totals-mini">
        <div>
          <dt>{t.lines.totalHT}</dt>
          <dd>{formatMoney(totals.taxExclusiveAmount, currency)}</dd>
        </div>
        <div>
          <dt>{t.lines.totalVAT}</dt>
          <dd>{formatMoney(totals.taxTotalAmount, currency)}</dd>
        </div>
        <div>
          <dt>{t.lines.totalTTC}</dt>
          <dd>{formatMoney(totals.taxInclusiveAmount, currency)}</dd>
        </div>
        <div class="due">
          <dt>
            {credit ? (t.lang === 'fr' ? "Montant de l'avoir" : 'Credit amount') : t.lines.due}
          </dt>
          <dd>{formatMoney(totals.amountDueForPayment, currency)}</dd>
        </div>
      </dl>
    </Card>
  );
}
