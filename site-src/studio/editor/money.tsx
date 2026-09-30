/** Remises et frais du document, acomptes, arrondi ; motifs d'exonération des régimes sans TVA. */

import {
  ALLOWANCE_REASONS,
  CHARGE_REASONS,
  EXEMPT_CATEGORIES,
  EXEMPTIONS,
  type ExemptCategory,
  VAT_CHOICES,
} from '../catalog.js';
import { t } from '../i18n.js';
import { blankDocAdjustment, type FormDocAdjustment } from '../model.js';
import { setForm, updateForm, useStudio } from '../store.js';
import { Button, Card, Field, IconButton, Input, Segmented, Select } from '../ui.js';

function DocAdjustments({ kind }: { kind: 'allowances' | 'charges' }) {
  const items = useStudio((s) => s.form[kind]);
  const reasons = kind === 'allowances' ? ALLOWANCE_REASONS : CHARGE_REASONS;
  const vatOptions = [
    { value: 'auto', fr: t.adjustments.vatAuto, en: t.adjustments.vatAuto },
    ...VAT_CHOICES,
  ];
  return (
    <div class="adjust-list">
      {items.map((item, i) => {
        const path = `${kind}[${i}]`;
        return (
          <div class="adjust-card" key={item.uid}>
            <div class="adjust-kind">
              {kind === 'allowances' ? t.adjustments.allowance : t.adjustments.charge}
            </div>
            <div class="grid">
              <Field label={t.adjustments.reason} path={`${path}.reason`} span={3}>
                {(id) => (
                  <Input
                    id={id}
                    path={`${path}.reason`}
                    value={item.reason}
                    onValue={(v) => setForm(`${path}.reason`, v)}
                  />
                )}
              </Field>
              <Field label={t.adjustments.value} path={`${path}.value`} span={3}>
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
              <Field label={t.adjustments.vat} path={`${path}.vat`} span={3}>
                {(id) => (
                  <Select
                    id={id}
                    path={`${path}.vat`}
                    value={item.vat}
                    options={vatOptions}
                    moreLabel={t.app.more}
                    onValue={(v) => setForm(`${path}.vat`, v)}
                  />
                )}
              </Field>
              <Field label={t.adjustments.reasonCode} path={`${path}.reasonCode`} span={3}>
                {(id) => (
                  <Select
                    id={id}
                    value={item.reasonCode}
                    options={reasons}
                    onValue={(v) => setForm(`${path}.reasonCode`, v)}
                  />
                )}
              </Field>
            </div>
            <IconButton
              icon="trash"
              label={t.app.remove}
              class="adjust-remove"
              onClick={() =>
                updateForm<FormDocAdjustment[]>(kind, (list) => list.filter((_, j) => j !== i))
              }
            />
          </div>
        );
      })}
    </div>
  );
}

export function AdjustmentsSection() {
  const prepaid = useStudio((s) => s.form.prepaid);
  const rounding = useStudio((s) => s.form.rounding);
  const count = useStudio((s) => s.form.allowances.length + s.form.charges.length);
  return (
    <Card
      id="adjustments"
      icon="percent"
      title={t.sections.adjustments}
      subtitle={count ? String(count) : undefined}
      paths={['allowances', 'charges', 'prepaid', 'rounding']}
    >
      <p class="card-hint">{t.adjustments.hint}</p>
      <DocAdjustments kind="allowances" />
      <DocAdjustments kind="charges" />
      <div class="row-actions">
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            updateForm<FormDocAdjustment[]>('allowances', (l) => [
              ...l,
              blankDocAdjustment(t.adjustments.defaultAllowance),
            ])
          }
        >
          {t.adjustments.addAllowance}
        </Button>
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            updateForm<FormDocAdjustment[]>('charges', (l) => [
              ...l,
              { ...blankDocAdjustment(t.adjustments.defaultCharge), mode: 'amount' },
            ])
          }
        >
          {t.adjustments.addCharge}
        </Button>
      </div>
      <div class="grid">
        <Field
          label={t.adjustments.prepaid}
          path="prepaid"
          span={3}
          hint={t.adjustments.prepaidHint}
          optional
        >
          {(id) => (
            <Input
              id={id}
              path="prepaid"
              value={prepaid}
              onValue={(v) => setForm('prepaid', v)}
              decimal
              suffix="€"
            />
          )}
        </Field>
        <Field label={t.adjustments.rounding} path="rounding" span={3} optional>
          {(id) => (
            <Input
              id={id}
              path="rounding"
              value={rounding}
              onValue={(v) => setForm('rounding', v)}
              decimal
              suffix="€"
            />
          )}
        </Field>
      </div>
    </Card>
  );
}

/** Les catégories sans TVA employées par la facture, chacune avec son motif et sa mention. */
export function ExemptionsSection() {
  const lines = useStudio((s) => s.form.lines);
  const allowances = useStudio((s) => s.form.allowances);
  const charges = useStudio((s) => s.form.charges);
  const exemptions = useStudio((s) => s.form.exemptions);
  const used = new Set(
    [...lines.map((l) => l.vat), ...allowances.map((a) => a.vat), ...charges.map((c) => c.vat)].map(
      (v) => v.split(':')[0],
    ),
  );
  const categories = EXEMPT_CATEGORIES.filter((c) => used.has(c));
  if (categories.length === 0) return null;
  return (
    <Card id="exemptions" icon="shield" title={t.sections.exemptions} paths={['exemptions']}>
      <p class="card-hint">{t.exemptions.hint}</p>
      {categories.map((category: ExemptCategory) => {
        const current = exemptions[category];
        const options = EXEMPTIONS.filter((e) => e.categories.includes(category));
        return (
          <div class="exemption" key={category}>
            <p class="exemption-title">{t.exemptions.categories[category]}</p>
            <div class="grid">
              <Field label={t.exemptions.code} path={`exemptions.${category}.code`} span={3}>
                {(id) => (
                  <Select
                    id={id}
                    value={current.code}
                    options={options}
                    onValue={(code) => {
                      const known = EXEMPTIONS.find((e) => e.value === code);
                      setForm(`exemptions.${category}`, {
                        code,
                        reason: known?.text ?? current.reason,
                      });
                    }}
                  />
                )}
              </Field>
              <Field
                label={t.exemptions.text}
                path={`exemptions.${category}.reason`}
                also={['exemptions']}
                span={3}
              >
                {(id) => (
                  <Input
                    id={id}
                    path={`exemptions.${category}.reason`}
                    value={current.reason}
                    onValue={(v) => setForm(`exemptions.${category}.reason`, v)}
                  />
                )}
              </Field>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
