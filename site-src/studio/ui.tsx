/**
 * Composants d'interface du Studio : champs, menus, interrupteurs, icônes.
 *
 * Chaque champ porte `data-path`, le chemin qu'il édite : c'est par lui que l'éditeur retrouve le
 * champ désigné par une anomalie ou par un clic sur l'aperçu, et qu'il y affiche le message.
 */

import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks';
import { concerns } from './anchors.js';
import type { Option } from './catalog.js';
import { t } from './i18n.js';
import { useStudio } from './store.js';

// ---------- icônes ----------

const PATHS = {
  plus: 'M8 3v10M3 8h10',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  chevronDown: 'M4 6l4 4 4-4',
  chevronRight: 'M6 4l4 4-4 4',
  up: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7',
  down: 'M8 3.5v9M4.5 9L8 12.5 11.5 9',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  check: 'M3.5 8.5l3 3 6-7',
  x: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2.5l6 11H2zM8 6.5v3M8 11.5h.01',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5h.01',
  download: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10',
  upload: 'M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13.5h10',
  book: 'M3 3.5h4.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1 1 0 0 0-1-1H3zM13 3.5H9.5A1.5 1.5 0 0 0 8 5M13 3.5v9h-4',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.5h.01',
  code: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5',
  palette:
    'M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.6 1-1.3-.2-.8.4-1.7 1.3-1.7H12a2 2 0 0 0 2-2A5.5 5.5 0 0 0 8 2.5zM5 7h.01M7 5h.01M10 5.5h.01',
  shield: 'M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4zM5.5 8l2 2 3-3.5',
  edit: 'M10.5 3l2.5 2.5-7 7H3.5V10z',
  zoomIn: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM13.5 13.5L10.6 10.6M5 7h4M7 5v4',
  zoomOut: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM13.5 13.5L10.6 10.6M5 7h4',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  paperclip: 'M11.5 7l-4.2 4.2a2.5 2.5 0 0 1-3.5-3.5L8.5 3a1.7 1.7 0 0 1 2.4 2.4L6.3 10',
  lock: 'M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 3v2.5H5M8 5v3l2 1.5',
  refresh: 'M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4M11.5 2v2.7H8.8M4.5 14v-2.7h2.7',
  sparkle:
    'M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  receipt: 'M4 2.5h8v11l-2-1-2 1-2-1-2 1zM6 5.5h4M6 8h4',
  building: 'M3.5 13.5v-10h6v10M9.5 6.5h3v7M2.5 13.5h11M5.5 5.5h1M5.5 8h1M5.5 10.5h1',
  user: 'M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4',
  truck:
    'M1.5 4.5h7.5v6H1.5zM9 6.5h2.5l2 2v2H9M4 12.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM11.5 12.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  card: 'M2 4h12v8H2zM2 6.5h12M4 10h3',
  tag: 'M2.5 2.5h5l6 6-5 5-6-6zM5.5 5.5h.01',
  note: 'M3 2.5h10v8l-3 3H3zM10 13.5v-3h3M5.5 5.5h5M5.5 8h3',
  percent:
    'M12.5 3.5l-9 9M4.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.5 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  folder: 'M2 4.5v8h12V6H8L6.5 4.5z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  label,
}: {
  name: IconName;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      class="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- anomalies des champs ----------

export interface FieldIssue {
  code: string;
  message: string;
  /** Chemin du champ du formulaire concerné. */
  anchor: string;
}

/** Anomalies de la facture courante, par champ ; fourni par l'application. */
export const IssuesContext = createContext<FieldIssue[]>([]);

export function useFieldIssues(paths: readonly string[]): FieldIssue[] {
  const issues = useContext(IssuesContext);
  return issues.filter((issue) => paths.some((p) => concerns(p, issue.anchor)));
}

/** Vrai si l'éditeur doit rendre visible un contenu replié qui contient l'un de ces chemins. */
export function useRevealed(prefixes: readonly string[]): boolean {
  const focus = useStudio((s) => s.ui.focus);
  return focus !== undefined && prefixes.some((p) => focus.path === p || concerns(p, focus.path));
}

// ---------- champs ----------

interface FieldProps {
  label: ComponentChildren;
  /** Chemin édité ; sert à relier les anomalies et les demandes de focus. */
  path?: string;
  /** Autres chemins dont les anomalies s'affichent ici. */
  also?: string[];
  hint?: ComponentChildren;
  /** Message propre au champ, en plus des anomalies (ex. clé SIREN incorrecte). */
  warning?: string | undefined;
  optional?: boolean;
  action?: ComponentChildren;
  span?: 1 | 2 | 3 | 4 | 6;
  children: (id: string, invalid: boolean) => ComponentChildren;
}

export function Field({
  label,
  path,
  also = [],
  hint,
  warning,
  optional,
  action,
  span,
  children,
}: FieldProps) {
  const id = useId();
  const issues = useFieldIssues(path ? [path, ...also] : also);
  const invalid = issues.length > 0 || Boolean(warning);
  return (
    <div
      class={`field${span ? ` span-${span}` : ''}${invalid ? ' invalid' : ''}`}
      data-field={path}
    >
      <div class="field-head">
        <label for={id}>
          {label}
          {optional && <span class="optional"> · {t.app.optional}</span>}
        </label>
        {action}
      </div>
      {children(id, invalid)}
      {issues.map((issue) => (
        <p class="field-issue" key={`${issue.code}${issue.message}`} role="alert">
          <code>{issue.code}</code> {issue.message}
        </p>
      ))}
      {warning && issues.length === 0 && <p class="field-issue soft">{warning}</p>}
      {hint && <p class="field-hint">{hint}</p>}
    </div>
  );
}

/** Attributs d'un champ de saisie : ceux dont le Studio se sert, rien de plus. */
interface InputProps {
  id?: string;
  value: string;
  onValue: (value: string) => void;
  path?: string | undefined;
  type?: 'text' | 'date' | 'email' | 'tel' | 'url';
  decimal?: boolean;
  suffix?: string;
  class?: string;
  placeholder?: string | undefined;
  disabled?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url';
  spellcheck?: boolean;
  maxLength?: number;
  'aria-label'?: string;
  'aria-invalid'?: boolean | undefined;
}

export function Input({
  value,
  onValue,
  path,
  type = 'text',
  decimal,
  suffix,
  class: cls,
  ...rest
}: InputProps) {
  const input = (
    <input
      id={rest.id}
      class={`input${cls ? ` ${cls}` : ''}`}
      type={type}
      value={value}
      data-path={path}
      placeholder={rest.placeholder}
      disabled={rest.disabled}
      maxLength={rest.maxLength}
      aria-label={rest['aria-label']}
      aria-invalid={rest['aria-invalid']}
      inputMode={decimal ? 'decimal' : rest.inputMode}
      autoComplete={rest.autoComplete ?? 'off'}
      spellcheck={decimal ? false : rest.spellcheck}
      onInput={(event) => onValue((event.currentTarget as HTMLInputElement).value)}
    />
  );
  if (!suffix) return input;
  return (
    <div class="input-affix">
      {input}
      <span class="affix" aria-hidden="true">
        {suffix}
      </span>
    </div>
  );
}

interface TextAreaProps {
  id?: string;
  value: string;
  onValue: (value: string) => void;
  path?: string;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
}

export function TextArea({
  id,
  value,
  onValue,
  path,
  rows = 3,
  placeholder,
  invalid,
}: TextAreaProps) {
  return (
    <textarea
      id={id}
      class="input textarea"
      rows={rows}
      value={value}
      data-path={path}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onInput={(event) => onValue((event.currentTarget as HTMLTextAreaElement).value)}
    />
  );
}

interface SelectProps<T extends string> {
  id?: string;
  value: T;
  options: readonly (Option<T> | { value: T; label: string; group?: string })[];
  onValue: (value: T) => void;
  path?: string | undefined;
  invalid?: boolean;
  /** Rangement des options peu courantes sous un groupe « Autres ». */
  moreLabel?: string;
  compact?: boolean;
  ariaLabel?: string;
}

const optionLabel = (
  o: { value: string } & ({ fr: string; en: string } | { label: string }),
): string => ('label' in o ? o.label : o[t.lang]);

export function Select<T extends string>({
  id,
  value,
  options,
  onValue,
  path,
  invalid,
  moreLabel,
  compact,
  ariaLabel,
}: SelectProps<T>) {
  const common = options.filter((o) => o.group !== 'more');
  const more = options.filter((o) => o.group === 'more');
  const known = options.some((o) => o.value === value);
  return (
    <select
      id={id}
      class={`input select${compact ? ' compact' : ''}`}
      value={value}
      data-path={path}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      onChange={(event) => onValue((event.currentTarget as HTMLSelectElement).value as T)}
    >
      {!known && <option value={value}>{value}</option>}
      {common.map((o) => (
        <option key={o.value} value={o.value}>
          {optionLabel(o as never)}
        </option>
      ))}
      {more.length > 0 && (
        <optgroup label={moreLabel ?? '…'}>
          {more.map((o) => (
            <option key={o.value} value={o.value}>
              {optionLabel(o as never)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export function Toggle({
  checked,
  onValue,
  label,
  hint,
  path,
  disabled,
}: {
  checked: boolean;
  onValue: (value: boolean) => void;
  label: ComponentChildren;
  hint?: ComponentChildren;
  path?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div class={`toggle-row${disabled ? ' disabled' : ''}`} data-field={path}>
      <button
        id={id}
        type="button"
        role="switch"
        class="switch"
        aria-checked={checked}
        data-path={path}
        disabled={disabled}
        onClick={() => onValue(!checked)}
      >
        <span class="knob" />
      </button>
      <div>
        <label for={id}>{label}</label>
        {hint && <p class="field-hint">{hint}</p>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onValue,
  label,
  path,
  size = 'md',
}: {
  value: T;
  options: readonly { value: T; label: ComponentChildren; title?: string }[];
  onValue: (value: T) => void;
  label: string;
  path?: string;
  size?: 'sm' | 'md';
}) {
  return (
    // Un groupe de boutons à bascule : `aria-pressed` dit lequel est choisi.
    <fieldset class={`segmented ${size}`} data-path={path}>
      <legend class="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          class={o.value === value ? 'on' : ''}
          onClick={() => onValue(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

// ---------- boutons, menus ----------

/** Attributs d'un bouton : ceux dont le Studio se sert. */
interface ButtonAttrs {
  id?: string;
  class?: string;
  title?: string | undefined;
  disabled?: boolean | undefined;
  onClick?: (event: MouseEvent) => void;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu';
  'aria-current'?: 'page' | undefined;
  children?: ComponentChildren;
}

export function Button({
  icon,
  variant = 'default',
  size = 'md',
  children,
  class: cls,
  ...rest
}: ButtonAttrs & {
  icon?: IconName;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md';
}) {
  return (
    <button type="button" {...rest} class={`btn-ui ${variant} ${size}${cls ? ` ${cls}` : ''}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  children: _children,
  ...rest
}: ButtonAttrs & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      {...rest}
      class={`icon-btn${rest.class ? ` ${rest.class}` : ''}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}

export interface MenuItem {
  label: ComponentChildren;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string | undefined;
  danger?: boolean;
}

/** Menu déroulant : se ferme au clic extérieur, à Échap, ou au choix d'une entrée. */
export function Menu({
  trigger,
  items,
  align = 'left',
  label,
}: {
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
  }) => ComponentChildren;
  items: (MenuItem | 'separator')[];
  align?: 'left' | 'right';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const entries = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length];
    next?.focus();
  };
  return (
    <div class="menu-root" ref={root}>
      {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div class={`menu ${align}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <hr class="menu-sep" key={`sep${i}`} />
            ) : (
              <button
                type="button"
                role="menuitem"
                key={i}
                class={item.danger ? 'danger' : ''}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                <span class="menu-label">
                  {item.label}
                  {item.hint && <small>{item.hint}</small>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Bloc repliable ; s'ouvre de lui-même quand l'éditeur doit atteindre un champ qu'il contient. */
export function Disclosure({
  label,
  paths,
  children,
  defaultOpen = false,
  count,
}: {
  label: ComponentChildren;
  paths: string[];
  children: ComponentChildren;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const revealed = useRevealed(paths);
  const issues = useFieldIssues(paths);
  useEffect(() => {
    if (revealed) setOpen(true);
  }, [revealed]);
  return (
    <div class={`disclosure${open ? ' open' : ''}`}>
      <button
        type="button"
        class="disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevronRight" size={14} />
        <span>{label}</span>
        {count ? <span class="count">{count}</span> : null}
        {!open && issues.length > 0 && (
          <span class="dot-issue" role="img" aria-label={t.status.issues(issues.length)} />
        )}
      </button>
      {open && <div class="disclosure-body">{children}</div>}
    </div>
  );
}

/** Carte d'une section de l'éditeur. */
export function Card({
  id,
  icon,
  title,
  subtitle,
  actions,
  children,
  paths,
}: {
  id: string;
  icon: IconName;
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  actions?: ComponentChildren;
  children: ComponentChildren;
  paths: string[];
}) {
  const issues = useFieldIssues(paths);
  return (
    <section
      class="card-ui"
      id={`section-${id}`}
      data-section={id}
      aria-labelledby={`section-${id}-title`}
    >
      <header class="card-head">
        <span class="card-icon">
          <Icon name={icon} />
        </span>
        <div class="card-titles">
          <h2 id={`section-${id}-title`}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {issues.length > 0 && (
          <span class="badge-issues" title={t.status.issues(issues.length)}>
            {issues.length}
          </span>
        )}
        {actions && <div class="card-actions">{actions}</div>}
      </header>
      <div class="card-body">{children}</div>
    </section>
  );
}

/** Fenêtre modale native (`<dialog>`) : focus piégé et Échap gérés par le navigateur. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  children: ComponentChildren;
  actions?: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: le clic sur le fond double Échap, que `<dialog>` gère déjà.
    <dialog
      ref={ref}
      class={`dialog${wide ? ' wide' : ''}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div class="dialog-inner">
          <header>
            <h2>{title}</h2>
            <IconButton icon="x" label={t.app.close} onClick={onClose} />
          </header>
          <div class="dialog-body">{children}</div>
          {actions && <footer>{actions}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Choix d'un fichier par un bouton ; le fichier ne quitte pas le navigateur. */
export function FilePick({
  accept,
  onFile,
  children,
  icon = 'upload',
  variant = 'default',
  size = 'md',
}: {
  accept: string;
  onFile: (file: File) => void;
  children: ComponentChildren;
  icon?: IconName;
  variant?: 'default' | 'primary' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon={icon} variant={variant} size={size} onClick={() => input.current?.click()}>
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = (event.currentTarget as HTMLInputElement).files?.[0];
          if (file) onFile(file);
          (event.currentTarget as HTMLInputElement).value = '';
        }}
      />
    </>
  );
}
