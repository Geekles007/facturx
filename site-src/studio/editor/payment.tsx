/** Livraison, paiement, bénéficiaire : les mentions de date, d'échéance et de règlement. */

import { buildLegalNotes, isValidIban, type PaymentTerms } from 'facturx-sdk';
import { PAYMENT_MEANS } from '../catalog.js';
import { useDerived } from '../context.js';
import { t } from '../i18n.js';
import { dueDateFrom } from '../library.js';
import { addDays, blankPaymentMeans, type FormPaymentMeans } from '../model.js';
import { setForm, updateForm, useStudio } from '../store.js';
import {
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  TextArea,
  Toggle,
} from '../ui.js';
import { AddressFields } from './parties.js';

export function DeliverySection() {
  const delivery = useStudio((s) => s.form.delivery);
  const nature = useStudio((s) => s.form.operationCategory);
  return (
    <Card id="delivery" icon="truck" title={t.sections.delivery} paths={['delivery']}>
      <p class="card-hint">{t.delivery.hint}</p>
      <Segmented
        label={t.sections.delivery}
        path="delivery.mode"
        value={delivery.mode}
        options={[
          { value: 'date', label: t.delivery.date },
          { value: 'period', label: t.delivery.period },
        ]}
        onValue={(v) => setForm('delivery.mode', v)}
      />
      {delivery.mode === 'date' ? (
        <div class="grid">
          <Field label={t.delivery.dateLabel} path="delivery.date" also={['delivery']} span={3}>
            {(id) => (
              <Input
                id={id}
                type="date"
                path="delivery.date"
                value={delivery.date}
                onValue={(v) => setForm('delivery.date', v)}
              />
            )}
          </Field>
        </div>
      ) : (
        <div class="grid">
          <Field label={t.delivery.start} path="delivery.start" also={['delivery']} span={3}>
            {(id) => (
              <Input
                id={id}
                type="date"
                path="delivery.start"
                value={delivery.start}
                onValue={(v) => setForm('delivery.start', v)}
              />
            )}
          </Field>
          <Field label={t.delivery.end} path="delivery.end" span={3}>
            {(id) => (
              <Input
                id={id}
                type="date"
                path="delivery.end"
                value={delivery.end}
                onValue={(v) => setForm('delivery.end', v)}
              />
            )}
          </Field>
        </div>
      )}
      <Toggle
        checked={delivery.hasAddress}
        onValue={(v) => setForm('delivery.hasAddress', v)}
        label={t.delivery.address}
        hint={nature === 'services' ? t.delivery.addressServices : undefined}
        path="delivery.hasAddress"
      />
      {delivery.hasAddress && (
        <>
          <div class="grid">
            <Field label={t.delivery.partyName} path="delivery.partyName" span={3} optional>
              {(id) => (
                <Input
                  id={id}
                  path="delivery.partyName"
                  value={delivery.partyName}
                  onValue={(v) => setForm('delivery.partyName', v)}
                />
              )}
            </Field>
            <Field label={t.delivery.locationId} path="delivery.locationId" span={3} optional>
              {(id) => (
                <Input
                  id={id}
                  path="delivery.locationId"
                  value={delivery.locationId}
                  onValue={(v) => setForm('delivery.locationId', v)}
                />
              )}
            </Field>
          </div>
          <AddressFields
            address={delivery.address}
            prefix="delivery.address"
            set={(key, v) => setForm(`delivery.address.${key}`, v)}
          />
        </>
      )}
    </Card>
  );
}

function MeansCard({ means, index }: { means: FormPaymentMeans; index: number }) {
  const p = (key: string) => `paymentMeans[${index}].${key}`;
  const set = (key: string) => (value: string) => setForm(p(key), value);
  const transfer = ['30', '58', '42'].includes(means.typeCode);
  const debit = ['49', '59'].includes(means.typeCode);
  const iban = means.iban.replace(/\s+/g, '');
  return (
    <div class="means-card">
      <div class="grid">
        <Field label={t.payment.type} path={p('typeCode')} span={3}>
          {(id) => (
            <Select
              id={id}
              path={p('typeCode')}
              value={means.typeCode}
              options={PAYMENT_MEANS}
              moreLabel={t.app.more}
              onValue={set('typeCode')}
            />
          )}
        </Field>
        <Field label={t.payment.label} path={p('text')} span={3} optional>
          {(id) => <Input id={id} path={p('text')} value={means.text} onValue={set('text')} />}
        </Field>
        {transfer && (
          <>
            <Field
              label={t.payment.iban}
              path={p('iban')}
              span={4}
              warning={iban && !isValidIban(iban) ? t.payment.ibanInvalid : undefined}
            >
              {(id) => (
                <Input
                  id={id}
                  path={p('iban')}
                  value={means.iban}
                  onValue={set('iban')}
                  spellcheck={false}
                  placeholder="FR76 3000 6000 0112 3456 7890 189"
                />
              )}
            </Field>
            <Field label={t.payment.bic} path={p('bic')} span={2} optional>
              {(id) => (
                <Input
                  id={id}
                  path={p('bic')}
                  value={means.bic}
                  onValue={set('bic')}
                  spellcheck={false}
                />
              )}
            </Field>
            <Field label={t.payment.accountName} path={p('accountName')} span={6} optional>
              {(id) => (
                <Input
                  id={id}
                  path={p('accountName')}
                  value={means.accountName}
                  onValue={set('accountName')}
                />
              )}
            </Field>
          </>
        )}
        {debit && (
          <>
            <Field label={t.payment.mandate} path={p('mandateReference')} span={3}>
              {(id) => (
                <Input
                  id={id}
                  path={p('mandateReference')}
                  value={means.mandateReference}
                  onValue={set('mandateReference')}
                />
              )}
            </Field>
            <Field label={t.payment.creditorId} path={p('creditorId')} span={3}>
              {(id) => (
                <Input
                  id={id}
                  path={p('creditorId')}
                  value={means.creditorId}
                  onValue={set('creditorId')}
                />
              )}
            </Field>
            <Field label={t.payment.debitedIban} path={p('debitedIban')} span={6} optional>
              {(id) => (
                <Input
                  id={id}
                  path={p('debitedIban')}
                  value={means.debitedIban}
                  onValue={set('debitedIban')}
                  spellcheck={false}
                />
              )}
            </Field>
          </>
        )}
      </div>
      <IconButton
        icon="trash"
        label={t.app.remove}
        class="adjust-remove"
        onClick={() =>
          updateForm<FormPaymentMeans[]>('paymentMeans', (l) => l.filter((_, i) => i !== index))
        }
      />
    </div>
  );
}

/** Aperçu des trois mentions légales, générées par le SDK depuis les champs : exactement ce qui part. */
function LegalPreview({ terms }: { terms: PaymentTerms }) {
  if (
    terms.latePenaltyRate === undefined ||
    terms.recoveryIndemnity === undefined ||
    terms.earlyPaymentDiscount === undefined
  ) {
    return null;
  }
  let notes: { text: string }[];
  try {
    notes = buildLegalNotes(terms);
  } catch {
    return null;
  }
  return (
    <div class="legal-preview">
      <p class="legal-title">{t.payment.generated}</p>
      <ul>
        {notes.map((n) => (
          <li key={n.text}>{n.text}</li>
        ))}
      </ul>
    </div>
  );
}

export function PaymentSection() {
  const terms = useStudio((s) => s.form.paymentTerms);
  const means = useStudio((s) => s.form.paymentMeans);
  const issueDate = useStudio((s) => s.form.issueDate);
  const remittance = useStudio((s) => s.form.remittanceInformation);
  const payee = useStudio((s) => s.form.payee);
  const { built } = useDerived();
  const presets = [
    { label: t.payment.onReceipt, date: issueDate },
    { label: t.payment.days30, date: issueDate ? addDays(issueDate, 30) : '' },
    { label: t.payment.days45eom, date: issueDate ? dueDateFrom(issueDate, 45, true) : '' },
    { label: t.payment.days60, date: issueDate ? addDays(issueDate, 60) : '' },
  ];
  return (
    <Card
      id="payment"
      icon="card"
      title={t.sections.payment}
      paths={['paymentTerms', 'paymentMeans', 'remittanceInformation', 'payee']}
    >
      <div class="grid">
        <Field label={t.payment.dueDate} path="paymentTerms.dueDate" span={3}>
          {(id) => (
            <Input
              id={id}
              type="date"
              path="paymentTerms.dueDate"
              value={terms.dueDate}
              onValue={(v) => setForm('paymentTerms.dueDate', v)}
            />
          )}
        </Field>
        <div class="span-3 chips-field">
          {presets.map((preset) => (
            <button
              type="button"
              class={`chip-btn${preset.date === terms.dueDate ? ' on' : ''}`}
              key={preset.label}
              disabled={!preset.date}
              onClick={() => setForm('paymentTerms.dueDate', preset.date)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <Segmented
        label={t.payment.terms}
        path="paymentTerms.mode"
        value={terms.mode}
        options={[
          { value: 'structured', label: t.payment.structured },
          { value: 'text', label: t.payment.text },
        ]}
        onValue={(v) => setForm('paymentTerms.mode', v)}
      />
      {terms.mode === 'structured' ? (
        <>
          <div class="grid">
            <Field
              label={t.payment.penalty}
              path="paymentTerms.latePenaltyRate"
              also={['notes']}
              span={3}
              hint={t.payment.penaltyHint}
            >
              {(id) => (
                <Input
                  id={id}
                  path="paymentTerms.latePenaltyRate"
                  value={terms.latePenaltyRate}
                  onValue={(v) => setForm('paymentTerms.latePenaltyRate', v)}
                  decimal
                  suffix="%"
                />
              )}
            </Field>
            <Field
              label={t.payment.indemnity}
              path="paymentTerms.recoveryIndemnity"
              span={3}
              hint={t.payment.indemnityHint}
            >
              {(id) => (
                <Input
                  id={id}
                  path="paymentTerms.recoveryIndemnity"
                  value={terms.recoveryIndemnity}
                  onValue={(v) => setForm('paymentTerms.recoveryIndemnity', v)}
                  decimal
                  suffix="€"
                />
              )}
            </Field>
          </div>
          <Field
            label={t.payment.discount}
            path="paymentTerms.discount"
            also={['paymentTerms.discountRate', 'paymentTerms.discountDays']}
          >
            {() => (
              <div class="combo wrap">
                <Segmented
                  label={t.payment.discount}
                  value={terms.discount}
                  options={[
                    { value: 'none', label: t.payment.noDiscount },
                    { value: 'rate', label: t.payment.withDiscount },
                  ]}
                  onValue={(v) => setForm('paymentTerms.discount', v)}
                />
                {terms.discount === 'rate' && (
                  <>
                    <Input
                      aria-label={t.payment.discountRate}
                      path="paymentTerms.discountRate"
                      value={terms.discountRate}
                      onValue={(v) => setForm('paymentTerms.discountRate', v)}
                      decimal
                      suffix="%"
                      placeholder="2"
                    />
                    <Input
                      aria-label={t.payment.discountDays}
                      path="paymentTerms.discountDays"
                      value={terms.discountDays}
                      onValue={(v) => setForm('paymentTerms.discountDays', v)}
                      inputMode="numeric"
                      suffix={t.lang === 'fr' ? 'jours' : 'days'}
                      placeholder="10"
                    />
                  </>
                )}
              </div>
            )}
          </Field>
          <LegalPreview terms={built.invoice.paymentTerms} />
        </>
      ) : (
        <Field
          label={t.payment.termsText}
          path="paymentTerms.text"
          also={['notes']}
          hint={t.payment.termsTextHint}
        >
          {(id) => (
            <TextArea
              id={id}
              path="paymentTerms.text"
              value={terms.text}
              onValue={(v) => setForm('paymentTerms.text', v)}
              rows={4}
            />
          )}
        </Field>
      )}
      <div class="subhead">
        <span>{t.payment.means}</span>
      </div>
      {means.map((m, i) => (
        <MeansCard key={m.uid} means={m} index={i} />
      ))}
      <div class="row-actions">
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            updateForm<FormPaymentMeans[]>('paymentMeans', (l) => [
              ...l,
              blankPaymentMeans(l.length ? '20' : '58'),
            ])
          }
        >
          {t.payment.addMeans}
        </Button>
      </div>
      <div class="grid">
        <Field
          label={t.payment.remittance}
          path="remittanceInformation"
          span={6}
          hint={t.payment.remittanceHint}
          optional
        >
          {(id) => (
            <Input
              id={id}
              path="remittanceInformation"
              value={remittance}
              onValue={(v) => setForm('remittanceInformation', v)}
            />
          )}
        </Field>
      </div>
      <Toggle
        checked={payee.enabled}
        onValue={(v) => setForm('payee.enabled', v)}
        label={t.payee.enable}
        path="payee.enabled"
      />
      {payee.enabled && (
        <div class="grid">
          <Field label={t.payee.name} path="payee.name" span={6}>
            {(id) => (
              <Input
                id={id}
                path="payee.name"
                value={payee.name}
                onValue={(v) => setForm('payee.name', v)}
              />
            )}
          </Field>
          <Field label={t.payee.id} path="payee.id" span={3} optional>
            {(id) => (
              <Input
                id={id}
                path="payee.id"
                value={payee.id}
                onValue={(v) => setForm('payee.id', v)}
                inputMode="numeric"
              />
            )}
          </Field>
          <Field label={t.payee.legalId} path="payee.legalId" span={3} optional>
            {(id) => (
              <Input
                id={id}
                path="payee.legalId"
                value={payee.legalId}
                onValue={(v) => setForm('payee.legalId', v)}
                inputMode="numeric"
              />
            )}
          </Field>
        </div>
      )}
    </Card>
  );
}
