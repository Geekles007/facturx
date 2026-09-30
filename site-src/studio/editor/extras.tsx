/** Références documentaires, notes libres, pièces jointes. */

import { ATTACHMENT_KINDS, ATTACHMENT_TYPES, NOTE_SUBJECTS } from '../catalog.js';
import { t } from '../i18n.js';
import { type FormAttachment, type FormNote, type FormPreceding, uid } from '../model.js';
import { setForm, toast, updateForm, useStudio } from '../store.js';
import {
  Button,
  Card,
  Disclosure,
  Field,
  FilePick,
  IconButton,
  Input,
  Menu,
  Select,
  TextArea,
} from '../ui.js';

const OTHER_REFERENCES = [
  'contract',
  'project',
  'salesOrder',
  'despatchAdvice',
  'receivingAdvice',
  'tenderOrLot',
  'invoicedObject',
  'buyerAccountingReference',
] as const;

/** Types dont la facture d'origine est attendue : avoirs, rectificative, définitive après acompte. */
const NEEDS_ORIGINAL = new Set(['381', '261', '262', '396', '384']);

export function ReferencesSection() {
  const refs = useStudio((s) => s.form.references);
  const typeCode = useStudio((s) => s.form.typeCode);
  const businessProcess = useStudio((s) => s.form.businessProcess);
  const needsOriginal = NEEDS_ORIGINAL.has(typeCode) || businessProcess.endsWith('4');
  const others = OTHER_REFERENCES.filter((key) => refs[key]).length;
  return (
    <Card id="references" icon="link" title={t.sections.references} paths={['references']}>
      <div class="grid">
        <Field
          label={t.references.purchaseOrder}
          path="references.purchaseOrder"
          span={6}
          hint={t.references.hint}
          optional
        >
          {(id) => (
            <Input
              id={id}
              path="references.purchaseOrder"
              value={refs.purchaseOrder}
              onValue={(v) => setForm('references.purchaseOrder', v)}
            />
          )}
        </Field>
      </div>
      <div class="subhead">
        <span>{t.references.preceding}</span>
        {needsOriginal && refs.precedingInvoices.length === 0 && (
          <span class="pill-warn">{t.app.required}</span>
        )}
      </div>
      <p class="card-hint">
        {needsOriginal ? t.references.precedingRequired : t.references.precedingHint}
      </p>
      <div data-path="references.precedingInvoices">
        {refs.precedingInvoices.map((ref, i) => {
          const p = `references.precedingInvoices[${i}]`;
          return (
            <div class="inline-row" key={ref.uid}>
              <Field label={t.references.precedingId} path={`${p}.id`}>
                {(id) => (
                  <Input
                    id={id}
                    path={`${p}.id`}
                    value={ref.id}
                    onValue={(v) => setForm(`${p}.id`, v)}
                  />
                )}
              </Field>
              <Field label={t.references.precedingDate} path={`${p}.issueDate`}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    path={`${p}.issueDate`}
                    value={ref.issueDate}
                    onValue={(v) => setForm(`${p}.issueDate`, v)}
                  />
                )}
              </Field>
              <IconButton
                icon="trash"
                label={t.app.remove}
                onClick={() =>
                  updateForm<FormPreceding[]>('references.precedingInvoices', (l) =>
                    l.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <div class="row-actions">
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            updateForm<FormPreceding[]>('references.precedingInvoices', (l) => [
              ...l,
              { uid: uid(), id: '', issueDate: '' },
            ])
          }
        >
          {t.references.addPreceding}
        </Button>
      </div>
      <Disclosure
        label={t.references.others}
        paths={OTHER_REFERENCES.map((k) => `references.${k}`)}
        count={others}
        defaultOpen={others > 0}
      >
        <div class="grid">
          {OTHER_REFERENCES.map((key) => (
            <Field key={key} label={t.references[key]} path={`references.${key}`} span={3} optional>
              {(id) => (
                <Input
                  id={id}
                  path={`references.${key}`}
                  value={refs[key]}
                  onValue={(v) => setForm(`references.${key}`, v)}
                />
              )}
            </Field>
          ))}
        </div>
      </Disclosure>
    </Card>
  );
}

export function NotesSection() {
  const notes = useStudio((s) => s.form.notes);
  return (
    <Card
      id="notes"
      icon="note"
      title={t.sections.notes}
      subtitle={notes.length ? String(notes.length) : undefined}
      paths={['notes']}
      actions={
        <Menu
          label={t.notes.presets}
          align="right"
          trigger={(props) => (
            <Button size="sm" variant="ghost" icon="sparkle" {...props}>
              {t.notes.presets}
            </Button>
          )}
          items={t.notes.presetList.map((preset) => ({
            label: preset.label,
            hint: preset.text.length > 60 ? `${preset.text.slice(0, 58)}…` : preset.text,
            onSelect: () =>
              updateForm<FormNote[]>('notes', (l) => [
                ...l,
                { uid: uid(), subjectCode: preset.code, text: preset.text },
              ]),
          }))}
        />
      }
    >
      <p class="card-hint">{t.notes.hint}</p>
      {notes.map((note, i) => {
        const p = `notes[${i}]`;
        return (
          <div class="note-row" key={note.uid}>
            <Field label={t.notes.subject} path={`${p}.subjectCode`}>
              {(id) => (
                <Select
                  id={id}
                  value={note.subjectCode}
                  options={NOTE_SUBJECTS}
                  onValue={(v) => setForm(`${p}.subjectCode`, v)}
                />
              )}
            </Field>
            <Field label={t.notes.text} path={`${p}.text`}>
              {(id) => (
                <TextArea
                  id={id}
                  path={`${p}.text`}
                  value={note.text}
                  onValue={(v) => setForm(`${p}.text`, v)}
                  rows={2}
                />
              )}
            </Field>
            <IconButton
              icon="trash"
              label={t.app.remove}
              onClick={() => updateForm<FormNote[]>('notes', (l) => l.filter((_, j) => j !== i))}
            />
          </div>
        );
      })}
      <div class="row-actions">
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            updateForm<FormNote[]>('notes', (l) => [
              ...l,
              { uid: uid(), subjectCode: 'AAI', text: '' },
            ])
          }
        >
          {t.notes.add}
        </Button>
      </div>
    </Card>
  );
}

const MAX_ATTACHMENT = 20 * 1024 * 1024;

export function AttachmentsSection() {
  const attachments = useStudio((s) => s.form.attachments);
  const addFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = ATTACHMENT_TYPES[extension];
    if (!mimeType) {
      toast(t.attachments.badType, 'error');
      return;
    }
    if (file.size > MAX_ATTACHMENT) {
      toast(t.attachments.tooLarge, 'error');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stem =
      file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .slice(0, 30) || 'PJ';
    updateForm<FormAttachment[]>('attachments', (l) => [
      ...l,
      {
        uid: uid(),
        id: stem,
        description: 'DOCUMENT_ANNEXE',
        uri: '',
        file: { name: file.name, mimeType, bytes },
      },
    ]);
  };
  return (
    <Card
      id="attachments"
      icon="paperclip"
      title={t.sections.attachments}
      subtitle={attachments.length ? String(attachments.length) : undefined}
      paths={['attachments']}
    >
      <p class="card-hint">{t.attachments.hint}</p>
      {attachments.map((a, i) => {
        const p = `attachments[${i}]`;
        return (
          <div class="attachment-row" key={a.uid}>
            <div class="attachment-file">
              <span class="file-icon">
                {a.file ? (a.file.name.split('.').pop() ?? '').toUpperCase() : 'URL'}
              </span>
              <span class="file-name">
                {a.file
                  ? `${a.file.name} · ${Math.max(1, Math.round(a.file.bytes.length / 1024))} ${t.lang === 'fr' ? 'Ko' : 'KB'}`
                  : a.uri || '—'}
              </span>
            </div>
            <div class="grid">
              <Field label={t.attachments.id} path={`${p}.id`} span={2}>
                {(id) => (
                  <Input
                    id={id}
                    path={`${p}.id`}
                    value={a.id}
                    onValue={(v) => setForm(`${p}.id`, v)}
                  />
                )}
              </Field>
              <Field label={t.attachments.kind} path={`${p}.description`} span={4}>
                {(id) => (
                  <Select
                    id={id}
                    value={a.description}
                    options={[
                      ...ATTACHMENT_KINDS,
                      ...(ATTACHMENT_KINDS.some((k) => k.value === a.description) || !a.description
                        ? []
                        : [{ value: a.description, fr: a.description, en: a.description }]),
                    ]}
                    onValue={(v) => setForm(`${p}.description`, v)}
                  />
                )}
              </Field>
              {!a.file && (
                <Field label={t.attachments.uri} path={`${p}.uri`} span={6}>
                  {(id) => (
                    <Input
                      id={id}
                      type="url"
                      path={`${p}.uri`}
                      value={a.uri}
                      onValue={(v) => setForm(`${p}.uri`, v)}
                      placeholder="https://"
                    />
                  )}
                </Field>
              )}
            </div>
            <IconButton
              icon="trash"
              label={t.app.remove}
              class="adjust-remove"
              onClick={() =>
                updateForm<FormAttachment[]>('attachments', (l) => l.filter((_, j) => j !== i))
              }
            />
          </div>
        );
      })}
      <div class="row-actions">
        <FilePick
          accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.ods"
          onFile={addFile}
          icon="paperclip"
          size="sm"
        >
          {t.attachments.addFile}
        </FilePick>
        <Button
          size="sm"
          icon="link"
          variant="ghost"
          onClick={() =>
            updateForm<FormAttachment[]>('attachments', (l) => [
              ...l,
              { uid: uid(), id: `LIEN-${l.length + 1}`, description: 'DOCUMENT_ANNEXE', uri: '' },
            ])
          }
        >
          {t.attachments.addLink}
        </Button>
      </div>
    </Card>
  );
}
