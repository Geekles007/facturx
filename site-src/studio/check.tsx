/**
 * L'onglet Contrôle : ce que disent le SDK, les trois schematrons officiels et la mise en page.
 *
 * Même logique que le validateur en ligne — mêmes jeux de règles, mêmes tolérances motivées —,
 * appliquée au XML que le Studio produit, avant qu'il ne parte.
 */

import { sectionOf } from './anchors.js';
import { useDerived } from './context.js';
import { t } from './i18n.js';
import { focusField } from './store.js';
import { Button, Icon } from './ui.js';

function IssueList() {
  const { issues } = useDerived();
  if (issues.length === 0) {
    return (
      <p class="check-empty">
        <Icon name="check" /> {t.check.noIssues}
      </p>
    );
  }
  return (
    <ul class="issues">
      {issues.map((issue) => (
        <li key={`${issue.code}|${issue.path}|${issue.message}`} class={`issue ${issue.source}`}>
          <div class="issue-head">
            <code>{issue.code}</code>
            <span class="issue-section">{t.sections[sectionOf(issue.anchor)]}</span>
          </div>
          <p>{issue.message}</p>
          <div class="issue-foot">
            <code class="path">{issue.path}</code>
            <Button size="sm" variant="subtle" icon="edit" onClick={() => focusField(issue.anchor)}>
              {t.check.fix}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Official() {
  const { official, runOfficial, xml, issues } = useDerived();
  const blocked = issues.some((i) => i.source !== 'glyph') || !xml;
  const stale = official.xml !== undefined && official.xml !== xml;
  return (
    <div class="official">
      <div class="official-head">
        <p class="field-hint">{t.check.officialDetail}</p>
        <Button
          size="sm"
          icon="refresh"
          disabled={blocked || official.status === 'running'}
          onClick={runOfficial}
        >
          {official.status === 'running'
            ? t.check.running
            : official.status === 'done'
              ? t.check.rerun
              : t.check.run}
        </Button>
      </div>
      {blocked && <p class="check-wait">{t.check.waiting}</p>}
      {stale && !blocked && <p class="check-wait">{t.check.stale}</p>}
      {official.error && <p class="field-issue">{official.error}</p>}
      <div class="judges-ui">
        {(['cen', 'facturx', 'brfr'] as const).map((id) => {
          const judge = official.judges.find((j) => j.id === id);
          const [name, detail] = t.check.judges[id] ?? [id, ''];
          const status =
            official.status === 'running' && !judge ? 'running' : (judge?.status ?? 'idle');
          return (
            <article class={`judge-ui ${status}`} key={id}>
              <header>
                <strong>{name}</strong>
                <span class="judge-badge">
                  {status === 'ok'
                    ? t.check.judgeOk
                    : status === 'failed'
                      ? t.check.judgeFailed
                      : status === 'skipped'
                        ? t.check.judgeSkipped
                        : status === 'running'
                          ? t.check.running
                          : '—'}
                </span>
              </header>
              <p class="judge-detail">{detail}</p>
              {judge?.note && <p class="field-hint">{judge.note}</p>}
              {judge && judge.failures.length > 0 && (
                <ul class="findings-ui">
                  {judge.failures.map((f) => (
                    <li key={`${f.id}|${f.location}`} class={f.severity}>
                      <code>{f.id ?? '—'}</code> <span class="sev">{t.check[f.severity]}</span>
                      <p>{f.text}</p>
                      {f.reason && <p class="reason">{f.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      <p class="fine">{t.check.verapdf}</p>
    </div>
  );
}

function Mentions() {
  const { layout } = useDerived();
  if (!layout) return null;
  return (
    <ul class="mentions">
      {layout.mentions.map((id) => (
        <li key={id}>
          <Icon name="check" size={14} /> {t.check.mentionLabels[id]}
        </li>
      ))}
    </ul>
  );
}

export function CheckPanel() {
  const { issues, official, layout } = useDerived();
  const ok = issues.length === 0;
  const officialOk = official.status === 'done' && official.judges.every((j) => j.status === 'ok');
  return (
    <div class="panel check">
      <section class={`verdict-ui ${ok ? 'ok' : 'ko'}`}>
        <Icon name={ok ? 'shield' : 'alert'} size={22} />
        <div>
          <h3>{ok ? t.check.verdictOk : t.check.verdictIssues(issues.length)}</h3>
          {ok && officialOk && <p>{t.status.officialOk}</p>}
        </div>
      </section>
      <section class="panel-section">
        <h3>{t.check.sdk}</h3>
        <p class="field-hint">{t.check.sdkDetail}</p>
        <IssueList />
      </section>
      <section class="panel-section">
        <h3>{t.check.official}</h3>
        <Official />
      </section>
      {layout && layout.missingGlyphs.length > 0 && (
        <section class="panel-section">
          <h3>{t.check.glyphs}</h3>
          <p class="field-hint">{t.check.glyphsDetail}</p>
        </section>
      )}
      <section class="panel-section">
        <h3>{t.check.mentions}</h3>
        <p class="field-hint">{t.check.mentionsDetail}</p>
        <Mentions />
      </section>
    </div>
  );
}
