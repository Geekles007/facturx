/**
 * L'onglet Code : le programme TypeScript qui refait la facture avec le SDK, le XML CII produit,
 * et l'objet `Invoice` lui-même. Coloration syntaxique minimale, sans dépendance.
 */

import type { VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { generateCode } from './codegen.js';
import { useDerived } from './context.js';
import { FONT_FAMILIES } from './fonts.js';
import { t } from './i18n.js';
import { renderOptions } from './pipeline.js';
import { useStudio } from './store.js';
import { Button, Segmented } from './ui.js';

const TS_TOKENS =
  /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|const|await|new|type|export|true|false|undefined)\b|\b(\d+)\b/g;

function highlightTs(code: string): (string | VNode)[] {
  const out: (string | VNode)[] = [];
  let last = 0;
  for (const match of code.matchAll(TS_TOKENS)) {
    const index = match.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    const [text, comment, string, keyword] = match;
    const cls = comment ? 'c' : string ? 's' : keyword ? 'k' : 'd';
    out.push(
      <span class={cls} key={index}>
        {text}
      </span>,
    );
    last = index + text.length;
  }
  out.push(code.slice(last));
  return out;
}

const XML_TOKENS = /(<\/?[\w:.-]+)|(\s[\w:.-]+=)("[^"]*")|(\/?>)|(<!--[\s\S]*?-->)/g;

function highlightXml(xml: string): (string | VNode)[] {
  const out: (string | VNode)[] = [];
  let last = 0;
  for (const match of xml.matchAll(XML_TOKENS)) {
    const index = match.index ?? 0;
    if (index > last) out.push(xml.slice(last, index));
    const [text, tag, attr, value, close, comment] = match;
    if (attr && value) {
      out.push(
        <span class="a" key={`${index}a`}>
          {attr}
        </span>,
        <span class="s" key={`${index}v`}>
          {value}
        </span>,
      );
    } else {
      out.push(
        <span class={tag || close ? 'k' : comment ? 'c' : ''} key={index}>
          {text}
        </span>,
      );
    }
    last = index + text.length;
  }
  out.push(xml.slice(last));
  return out;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      icon={copied ? 'check' : 'copy'}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? t.app.copied : t.app.copy}
    </Button>
  );
}

/** JSON lisible d'une facture : les octets des pièces jointes sont abrégés. */
function invoiceJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (v instanceof Uint8Array ? `<${v.length} octets>` : v), 2);
}

export function CodePanel() {
  const { built, xml, fonts } = useDerived();
  const appearance = useStudio((s) => s.appearance);
  const [view, setView] = useState<'ts' | 'xml' | 'json'>('ts');
  const family = FONT_FAMILIES.find((f) => f.id === appearance.font);
  const code = useMemo(() => {
    const render = renderOptions(appearance, {
      fonts: { regular: fonts?.regular ?? new Uint8Array(), bold: fonts?.bold ?? new Uint8Array() },
      ...(appearance.logo ? { logo: { bytes: new Uint8Array(), type: appearance.logo.type } } : {}),
    });
    const input: Parameters<typeof generateCode>[0] = {
      invoice: built.invoice,
      totalsOptions: built.totalsOptions,
      render,
      fontFiles:
        appearance.font === 'custom'
          ? {
              regular: `${appearance.customFont?.name ?? 'police'}.ttf`,
              bold: `${appearance.customFont?.name ?? 'police'}-Bold.ttf`,
            }
          : {
              regular: family?.source.regular ?? 'Geist-Regular.ttf',
              bold: family?.source.bold ?? 'Geist-SemiBold.ttf',
            },
      labels: {
        language: appearance.language,
        renamed: Object.fromEntries(
          Object.entries(appearance.labels).filter(([, v]) => typeof v === 'string'),
        ) as Record<string, string>,
      },
    };
    if (appearance.logo) input.logoFile = appearance.logo.name.replace(/\.svg$/i, '.png');
    return generateCode(input);
  }, [built, appearance, fonts, family]);
  const json = useMemo(() => invoiceJson(built.invoice), [built.invoice]);
  const text = view === 'ts' ? code : view === 'xml' ? (xml ?? '') : json;
  return (
    <div class="panel code">
      <p class="panel-intro">{t.code.intro}</p>
      <div class="install-line">
        <span class="install-label">{t.code.install}</span>
        <code>pnpm add facturx-sdk @pdf-lib/fontkit</code>
      </div>
      <div class="code-bar">
        <Segmented
          size="sm"
          label="Code"
          value={view}
          options={[
            { value: 'ts', label: t.code.ts },
            { value: 'xml', label: t.code.xml },
            { value: 'json', label: t.code.json },
          ]}
          onValue={setView}
        />
        {text && <CopyButton text={text} />}
      </div>
      {view === 'xml' && !xml ? (
        <p class="check-wait">{t.code.xmlInvalid}</p>
      ) : (
        <pre class="code-block">
          <code>
            {view === 'ts' ? highlightTs(code) : view === 'xml' ? highlightXml(text) : text}
          </code>
        </pre>
      )}
    </div>
  );
}
