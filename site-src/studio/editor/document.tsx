/** Le document : type, numéro, dates, nature de l'opération, et les options de la réforme. */

import type { InvoiceTypeCode, OperationCategory } from 'facturx-sdk';
import {
  BUSINESS_PROCESSES,
  CURRENCIES,
  DOCUMENT_TYPES,
  OPERATION_CATEGORIES,
  OPERATION_SHORT,
  PROCESSING,
  pick,
} from '../catalog.js';
import { t } from '../i18n.js';
import { formatNumber, nextRank, numberProblems } from '../library.js';
import { setForm, store, useStudio } from '../store.js';
import { Card, Disclosure, Field, Input, Segmented, Select, Toggle } from '../ui.js';

export function DocumentSection() {
  const form = useStudio((s) => s.form);
  const numbering = useStudio((s) => s.numbering);
  const history = useStudio((s) => s.history);
  const issued = useStudio((s) => s.ui.issued);
  const type = DOCUMENT_TYPES.find((d) => d.value === form.typeCode);
  const next = formatNumber(
    numbering.pattern,
    nextRank(numbering, form.issueDate || '2026-01-01'),
    form.issueDate || '',
  );
  const problems = numberProblems(form.id.trim());
  const duplicate =
    !issued && history.some((h) => h.form.id.trim() === form.id.trim() && form.id.trim() !== '');
  const warning = duplicate
    ? t.document.numberDuplicate
    : problems.includes('length')
      ? t.document.numberLength
      : problems.includes('chars')
        ? t.document.numberChars
        : undefined;
  const setNumber = (id: string) => {
    // La référence de paiement suit le numéro tant qu'elle n'a pas été changée à la main.
    const { form: current } = store.get();
    if (current.remittanceInformation === current.id || current.remittanceInformation === '') {
      setForm('remittanceInformation', id);
    }
    setForm('id', id);
  };
  return (
    <Card
      id="document"
      icon="receipt"
      title={t.sections.document}
      subtitle={type ? pick(type, t.lang) : undefined}
      paths={[
        'id',
        'typeCode',
        'issueDate',
        'operationCategory',
        'currency',
        'businessProcess',
        'processing',
        'vatOnDebits',
        'taxPointDate',
        'buyerReference',
      ]}
    >
      <div class="grid">
        <Field
          label={t.document.type}
          path="typeCode"
          span={3}
          hint={type ? (t.lang === 'fr' ? type.hintFr : type.hintEn) : undefined}
        >
          {(id) => (
            <Select<InvoiceTypeCode>
              id={id}
              path="typeCode"
              value={form.typeCode}
              options={DOCUMENT_TYPES}
              moreLabel={t.app.more}
              onValue={(v) => setForm('typeCode', v)}
            />
          )}
        </Field>
        <Field
          label={t.document.number}
          path="id"
          span={3}
          warning={warning}
          hint={t.document.numberHint}
          action={
            next !== form.id && !issued ? (
              <button
                type="button"
                class="link-btn"
                onClick={() => setNumber(next)}
                title={t.document.nextNumber}
              >
                {next}
              </button>
            ) : undefined
          }
        >
          {(id, invalid) => (
            <Input
              id={id}
              path="id"
              value={form.id}
              onValue={setNumber}
              aria-invalid={invalid || undefined}
              spellcheck={false}
            />
          )}
        </Field>
        <Field label={t.document.issueDate} path="issueDate" span={2}>
          {(id) => (
            <Input
              id={id}
              type="date"
              path="issueDate"
              value={form.issueDate}
              onValue={(v) => setForm('issueDate', v)}
            />
          )}
        </Field>
        <Field
          label={t.document.nature}
          path="operationCategory"
          span={4}
          hint={t.document.natureHint}
        >
          {() => (
            <Segmented<OperationCategory | ''>
              label={t.document.nature}
              path="operationCategory"
              value={form.operationCategory}
              options={OPERATION_CATEGORIES.map((o) => ({
                value: o.value,
                label: pick(OPERATION_SHORT[o.value], t.lang),
                title: pick(o, t.lang),
              }))}
              onValue={(v) => setForm('operationCategory', v)}
            />
          )}
        </Field>
      </div>
      <Disclosure
        label={t.app.more}
        paths={[
          'currency',
          'businessProcess',
          'processing',
          'vatOnDebits',
          'taxPointDate',
          'buyerReference',
        ]}
        defaultOpen={Boolean(
          form.processing || form.businessProcess || form.vatOnDebits || form.buyerReference,
        )}
      >
        <div class="grid">
          <Field label={t.document.currency} path="currency" span={2}>
            {(id) => (
              <Select
                id={id}
                path="currency"
                value={form.currency}
                options={CURRENCIES}
                onValue={(v) => setForm('currency', v)}
              />
            )}
          </Field>
          <Field label={t.document.businessProcess} path="businessProcess" span={4}>
            {(id) => (
              <Select
                id={id}
                path="businessProcess"
                value={form.businessProcess}
                options={BUSINESS_PROCESSES}
                onValue={(v) => setForm('businessProcess', v)}
              />
            )}
          </Field>
          <Field
            label={t.document.processing}
            path="processing"
            span={6}
            hint={(() => {
              const p = PROCESSING.find((o) => o.value === form.processing);
              return p ? (t.lang === 'fr' ? p.hintFr : p.hintEn) : undefined;
            })()}
          >
            {(id) => (
              <Select
                id={id}
                path="processing"
                value={form.processing}
                options={PROCESSING}
                onValue={(v) => setForm('processing', v)}
              />
            )}
          </Field>
          <Field
            label={t.document.buyerReference}
            path="buyerReference"
            span={3}
            hint={t.document.buyerReferenceHint}
            optional
          >
            {(id) => (
              <Input
                id={id}
                path="buyerReference"
                value={form.buyerReference}
                onValue={(v) => setForm('buyerReference', v)}
              />
            )}
          </Field>
          <Field label={t.document.taxPointDate} path="taxPointDate" span={3} optional>
            {(id) => (
              <Input
                id={id}
                type="date"
                path="taxPointDate"
                value={form.taxPointDate}
                onValue={(v) => setForm('taxPointDate', v)}
                disabled={form.vatOnDebits}
              />
            )}
          </Field>
        </div>
        <Toggle
          checked={form.vatOnDebits}
          onValue={(v) => {
            setForm('vatOnDebits', v);
            if (v) setForm('taxPointDate', '');
          }}
          label={t.document.vatOnDebits}
          hint={t.document.vatOnDebitsHint}
          path="vatOnDebits"
        />
      </Disclosure>
    </Card>
  );
}
