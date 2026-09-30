/**
 * Vendeur et client : identité, adresse, identifiants, contact, adresse électronique de routage.
 *
 * Les aides ne corrigent rien d'elles-mêmes : « Calculer depuis le SIREN » ou « Reprendre le SIREN »
 * sont des boutons, et la clé d'un SIREN mal saisi est signalée sous le champ, pas réparée.
 */

import { frenchVatKey, isValidSiren, isValidSiret } from 'facturx-sdk';
import { useState } from 'preact/hooks';
import { ADDRESS_SCHEMES, COUNTRIES } from '../catalog.js';
import { t } from '../i18n.js';
import type { ClientRecord } from '../library.js';
import { type FormAddress, type FormParty, uid } from '../model.js';
import { storage } from '../storage.js';
import { setForm, store, toast, useStudio } from '../store.js';
import { Button, Card, Disclosure, Field, Input, Menu, Select, Toggle } from '../ui.js';

type Setter = (path: string, value: unknown) => void;

const digits = (value: string) => value.replace(/\s+/g, '');

export function AddressFields({
  address,
  prefix,
  set,
}: {
  address: FormAddress;
  prefix: string;
  set: Setter;
}) {
  const p = (key: keyof FormAddress) => `${prefix}.${key}`;
  return (
    <div class="grid">
      <Field label={t.party.line1} path={p('line1')} span={6}>
        {(id) => (
          <Input
            id={id}
            path={p('line1')}
            value={address.line1}
            onValue={(v) => set('line1', v)}
            autoComplete="address-line1"
          />
        )}
      </Field>
      <Field label={t.party.line2} path={p('line2')} span={6} optional>
        {(id) => (
          <Input
            id={id}
            path={p('line2')}
            value={address.line2}
            onValue={(v) => set('line2', v)}
            autoComplete="address-line2"
          />
        )}
      </Field>
      <Field label={t.party.postCode} path={p('postCode')} span={2}>
        {(id) => (
          <Input
            id={id}
            path={p('postCode')}
            value={address.postCode}
            onValue={(v) => set('postCode', v)}
            autoComplete="postal-code"
          />
        )}
      </Field>
      <Field label={t.party.city} path={p('city')} span={2}>
        {(id) => (
          <Input
            id={id}
            path={p('city')}
            value={address.city}
            onValue={(v) => set('city', v)}
            autoComplete="address-level2"
          />
        )}
      </Field>
      <Field label={t.party.country} path={p('countryCode')} span={2}>
        {(id, invalid) => (
          <Select
            id={id}
            path={p('countryCode')}
            value={address.countryCode}
            options={COUNTRIES}
            invalid={invalid}
            onValue={(v) => set('countryCode', v)}
          />
        )}
      </Field>
    </div>
  );
}

const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SNC', 'SCI', 'SELARL', 'EI'];

/** Compose « SAS au capital de 10 000 € — RCS Paris 443 061 841 » depuis trois champs. */
function LegalComposer({ siren, onInsert }: { siren: string; onInsert: (text: string) => void }) {
  const [form, setFormName] = useState('SAS');
  const [capital, setCapital] = useState('');
  const [city, setCity] = useState('');
  const grouped = digits(siren).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
  const rcs = city.trim() ? `RCS ${city.trim()}${grouped ? ` ${grouped}` : ''}` : '';
  const amount = capital.trim().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const text =
    form === 'EI'
      ? ['Entrepreneur individuel (EI)', rcs].filter(Boolean).join(' — ')
      : [amount ? `${form} au capital de ${amount} €` : form, rcs].filter(Boolean).join(' — ');
  return (
    <div class="composer">
      <div class="grid">
        <Field label={t.party.legalForm} span={2}>
          {(id) => (
            <Select
              id={id}
              value={form}
              options={LEGAL_FORMS.map((f) => ({
                value: f,
                label: f === 'EI' ? 'EI / micro-entreprise' : f,
              }))}
              onValue={setFormName}
            />
          )}
        </Field>
        <Field label={t.party.capital} span={2}>
          {(id) => (
            <Input id={id} value={capital} onValue={setCapital} decimal disabled={form === 'EI'} />
          )}
        </Field>
        <Field label={t.party.rcsCity} span={2}>
          {(id) => <Input id={id} value={city} onValue={setCity} placeholder="Paris" />}
        </Field>
      </div>
      <div class="composer-out">
        <span>{text}</span>
        <Button size="sm" variant="primary" icon="check" onClick={() => onInsert(text)}>
          {t.party.insert}
        </Button>
      </div>
    </div>
  );
}

/** Champs d'une partie ; `prefix` sert aux anomalies et au focus (`seller`, `buyer`). */
export function PartyFields({
  party,
  prefix,
  kind,
  set,
}: {
  party: FormParty;
  prefix: string;
  kind: 'seller' | 'buyer';
  set: Setter;
}) {
  const [composing, setComposing] = useState(false);
  const p = (key: string) => `${prefix}.${key}`;
  const siren = digits(party.siren);
  const siret = digits(party.siret);
  const sirenWarning = siren && !isValidSiren(siren) ? t.party.sirenInvalid : undefined;
  const siretWarning = siret && !isValidSiret(siret) ? t.party.sirenInvalid : undefined;
  const consumer = kind === 'buyer' && party.consumer;
  return (
    <>
      {kind === 'buyer' && (
        <Toggle
          checked={party.consumer}
          onValue={(v) => set('consumer', v)}
          label={t.party.consumer}
          hint={t.party.consumerHint}
          path={p('consumer')}
        />
      )}
      <div class="grid">
        <Field
          label={kind === 'seller' ? t.party.name : t.party.buyerName}
          path={p('name')}
          span={6}
        >
          {(id) => (
            <Input
              id={id}
              path={p('name')}
              value={party.name}
              onValue={(v) => set('name', v)}
              autoComplete="organization"
            />
          )}
        </Field>
        {!consumer && (
          <>
            <Field label={t.party.siren} path={p('siren')} warning={sirenWarning} span={3}>
              {(id, invalid) => (
                <Input
                  id={id}
                  path={p('siren')}
                  value={party.siren}
                  onValue={(v) => set('siren', v)}
                  inputMode="numeric"
                  aria-invalid={invalid || undefined}
                  placeholder="443 061 841"
                />
              )}
            </Field>
            <Field label={t.party.siret} path={p('siret')} warning={siretWarning} span={3} optional>
              {(id) => (
                <Input
                  id={id}
                  path={p('siret')}
                  value={party.siret}
                  onValue={(v) => set('siret', v)}
                  inputMode="numeric"
                  placeholder="443 061 841 00004"
                />
              )}
            </Field>
            <Field
              label={t.party.vatId}
              path={p('vatId')}
              span={6}
              optional={kind === 'buyer'}
              action={
                isValidSiren(siren) && party.address.countryCode === 'FR' ? (
                  <button
                    type="button"
                    class="link-btn"
                    onClick={() => set('vatId', `FR${frenchVatKey(siren)}${siren}`)}
                  >
                    {t.party.computeVat}
                  </button>
                ) : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  path={p('vatId')}
                  value={party.vatId}
                  onValue={(v) => set('vatId', v)}
                  placeholder="FR64443061841"
                />
              )}
            </Field>
          </>
        )}
      </div>
      <AddressFields
        address={party.address}
        prefix={p('address')}
        set={(key, v) => set(`address.${key}`, v)}
      />
      {kind === 'seller' && (
        <Field
          label={t.party.legalInfo}
          path={p('legalInfo')}
          hint={t.party.legalInfoHint}
          action={
            <button
              type="button"
              class="link-btn"
              onClick={() => setComposing(!composing)}
              aria-expanded={composing}
            >
              {t.party.compose}
            </button>
          }
        >
          {(id) => (
            <Input
              id={id}
              path={p('legalInfo')}
              value={party.legalInfo}
              onValue={(v) => set('legalInfo', v)}
            />
          )}
        </Field>
      )}
      {kind === 'seller' && composing && (
        <LegalComposer
          siren={party.siren}
          onInsert={(text) => {
            set('legalInfo', text);
            setComposing(false);
          }}
        />
      )}
      {!consumer && (
        <Field
          label={t.party.electronic}
          path={p('electronicAddress.value')}
          also={[p('electronicAddress')]}
          hint={t.party.electronicHint}
          action={
            isValidSiren(siren) && party.electronicAddress.value !== siren ? (
              <button
                type="button"
                class="link-btn"
                onClick={() => {
                  set('electronicAddress', { value: siren, scheme: '0225' });
                }}
              >
                {t.party.fromSiren}
              </button>
            ) : undefined
          }
        >
          {(id) => (
            <div class="combo">
              <Select
                value={party.electronicAddress.scheme}
                options={ADDRESS_SCHEMES}
                compact
                ariaLabel={t.party.scheme}
                onValue={(v) => set('electronicAddress.scheme', v)}
              />
              <Input
                id={id}
                path={p('electronicAddress.value')}
                value={party.electronicAddress.value}
                onValue={(v) => set('electronicAddress.value', v)}
                placeholder={
                  party.electronicAddress.scheme === 'EM' ? 'factures@exemple.fr' : '443061841'
                }
              />
            </div>
          )}
        </Field>
      )}
      <Disclosure
        label={t.party.contact}
        paths={[p('contact'), p('tradingName'), p('routingCode'), p('taxRegistrationId')]}
        defaultOpen={Boolean(party.contact.email || party.contact.phone || party.contact.name)}
      >
        <div class="grid">
          <Field label={t.party.contactName} path={p('contact.name')} span={2} optional>
            {(id) => (
              <Input
                id={id}
                path={p('contact.name')}
                value={party.contact.name}
                onValue={(v) => set('contact.name', v)}
              />
            )}
          </Field>
          <Field label={t.party.phone} path={p('contact.phone')} span={2} optional>
            {(id) => (
              <Input
                id={id}
                type="tel"
                path={p('contact.phone')}
                value={party.contact.phone}
                onValue={(v) => set('contact.phone', v)}
              />
            )}
          </Field>
          <Field label={t.party.email} path={p('contact.email')} span={2} optional>
            {(id) => (
              <Input
                id={id}
                type="email"
                path={p('contact.email')}
                value={party.contact.email}
                onValue={(v) => set('contact.email', v)}
              />
            )}
          </Field>
          <Field label={t.party.tradingName} path={p('tradingName')} span={3} optional>
            {(id) => (
              <Input
                id={id}
                path={p('tradingName')}
                value={party.tradingName}
                onValue={(v) => set('tradingName', v)}
              />
            )}
          </Field>
          {kind === 'buyer' ? (
            <Field label={t.party.routingCode} path={p('routingCode')} span={3} optional>
              {(id) => (
                <Input
                  id={id}
                  path={p('routingCode')}
                  value={party.routingCode}
                  onValue={(v) => set('routingCode', v)}
                />
              )}
            </Field>
          ) : (
            <Field
              label={t.party.taxRegistrationId}
              path={p('taxRegistrationId')}
              span={3}
              optional
            >
              {(id) => (
                <Input
                  id={id}
                  path={p('taxRegistrationId')}
                  value={party.taxRegistrationId}
                  onValue={(v) => set('taxRegistrationId', v)}
                />
              )}
            </Field>
          )}
        </div>
      </Disclosure>
    </>
  );
}

export function SellerSection() {
  const seller = useStudio((s) => s.form.seller);
  const saveCompany = () => {
    store.set((s) => ({ company: { ...s.company, seller: structuredClone(s.form.seller) } }));
    toast(t.party.companySaved);
  };
  return (
    <Card
      id="seller"
      icon="building"
      title={t.sections.seller}
      subtitle={seller.name || undefined}
      paths={['seller']}
      actions={
        <Button size="sm" variant="ghost" icon="check" onClick={saveCompany}>
          {t.party.saveCompany}
        </Button>
      }
    >
      <PartyFields
        party={seller}
        prefix="seller"
        kind="seller"
        set={(path, value) => setForm(`seller.${path}`, value)}
      />
    </Card>
  );
}

/** Enregistre (ou met à jour) le client courant dans le carnet. */
export function saveClient(party: FormParty): void {
  const { clients } = store.get();
  const key = (p: FormParty) => digits(p.siren) || p.name.trim().toLowerCase();
  const existing = clients.find((c) => key(c.party) === key(party));
  const record: ClientRecord = {
    uid: existing?.uid ?? uid(),
    party: structuredClone(party),
    updatedAt: new Date().toISOString(),
  };
  store.set({
    clients: existing
      ? clients.map((c) => (c.uid === record.uid ? record : c))
      : [...clients, record],
  });
  storage.put('clients', record).catch(() => undefined);
  toast(existing ? t.party.clientUpdated : t.party.clientSaved);
}

export function BuyerSection() {
  const buyer = useStudio((s) => s.form.buyer);
  const clients = useStudio((s) => s.clients);
  return (
    <Card
      id="buyer"
      icon="user"
      title={t.sections.buyer}
      subtitle={buyer.name || undefined}
      paths={['buyer']}
      actions={
        <>
          {clients.length > 0 && (
            <Menu
              label={t.party.pickClient}
              align="right"
              trigger={(props) => (
                <Button size="sm" variant="ghost" icon="book" {...props}>
                  {t.party.pickClient}
                </Button>
              )}
              items={[...clients]
                .sort((a, b) => a.party.name.localeCompare(b.party.name))
                .map((c) => ({
                  label: c.party.name,
                  hint: [c.party.address.postCode, c.party.address.city].filter(Boolean).join(' '),
                  onSelect: () => setForm('buyer', structuredClone(c.party)),
                }))}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="check"
            onClick={() => saveClient(buyer)}
            disabled={!buyer.name.trim()}
          >
            {t.party.saveClient}
          </Button>
        </>
      }
    >
      <PartyFields
        party={buyer}
        prefix="buyer"
        kind="buyer"
        set={(path, value) => setForm(`buyer.${path}`, value)}
      />
    </Card>
  );
}
