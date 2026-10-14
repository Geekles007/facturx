/**
 * Veille sur France_RFE, où le FNFE-MPE publie les artefacts de validation de la réforme. Le projet
 * en épingle un commit (`FNFE_COMMIT`, scripts/fetch-schemas.mjs) et rien ne prévient quand le dépôt
 * bouge : ce script compare sa branche principale au commit épinglé et rédige le signalement.
 *
 *   pnpm rfe:check                                        # compare au commit épinglé
 *   pnpm rfe:check <commit>                               # compare à un autre commit
 *   node scripts/check-france-rfe.mjs --github-output     # pour le workflow « Veille France_RFE »
 *
 * Le signal qui compte le plus est la version du CEN embarquée : en 1.3.17, les règles de l'IGIC et
 * de l'IPSI changent de nom, et la 2.0 du SDK est à faire (docs/decisions.md, D70).
 */

import { appendFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FNFE_COMMIT, FNFE_TAG, fetchWithRetry } from './fetch-schemas.mjs';

export const REPO = 'fnfempe/France_RFE';
/** Le schematron CEN en syntaxe CII, celui que confronte `schematron.test.ts`. */
export const CEN_PATH = 'FNFE_RFE_INVOICE/CII/EN16931/2xslt/EN16931-CII-validation.xslt';
/** Les fichiers qui portent des règles : un README ou un exemple ne change aucun verdict. */
const RULE_FILE = /\.(xslt|xsl|sch|xsd)$|_codedb\.xml$/;
const LISTED = 20;

/** La version du CEN, que les artefacts de ConnectingEurope écrivent en tête de leurs XSLT. */
export function parseCenVersion(xslt) {
  return /Schematron version (\d+\.\d+\.\d+)/.exec(xslt)?.[1];
}

/** Un message de commit tiers, cité en code : ni mention qui notifie, ni balisage qui s'exécute. */
const quote = (message) => `\`${message.split('\n')[0].replaceAll('`', "'").trim()}\``;

const bullets = (items, render) => {
  const lines = items.slice(0, LISTED).map((item) => `- ${render(item)}`);
  if (items.length > LISTED) lines.push(`- … et ${items.length - LISTED} autres`);
  return lines.join('\n');
};

/**
 * Le signalement, ou `null` si la branche principale n'a pas bougé depuis `base`. `compare` et
 * `tags` sont les réponses des API GitHub du même nom ; `cen` porte les versions du CEN lues au
 * commit épinglé et à la tête (`undefined` : fichier introuvable).
 */
export function summarize({ base, baseLabel, compare, tags, cen }) {
  if (!compare || compare.ahead_by === 0) return null;
  const commits = compare.commits ?? [];
  const head = commits.at(-1)?.sha ?? base;
  const key = head.slice(0, 7);
  const shas = new Set(commits.map((c) => c.sha));
  const newTags = tags.filter((t) => shas.has(t.commit.sha)).map((t) => t.name);
  const ruleFiles = (compare.files ?? []).map((f) => f.filename).filter((f) => RULE_FILE.test(f));
  const cenChanged = cen.head !== cen.pinned;

  const n = compare.ahead_by;
  const title =
    cenChanged && cen.head
      ? `France_RFE embarque le CEN ${cen.head} (${key})`
      : cenChanged
        ? `France_RFE : schematron CEN introuvable (${key})`
        : newTags.length > 0
          ? `France_RFE : nouveau tag ${newTags.join(', ')} (${key})`
          : `France_RFE : ${n} commit${n > 1 ? 's' : ''} depuis ${baseLabel} (${key})`;

  const since =
    base === FNFE_COMMIT
      ? `le commit épinglé dans \`scripts/fetch-schemas.mjs\` (\`FNFE_COMMIT\`, ${baseLabel})`
      : `le commit \`${base.slice(0, 7)}\``;
  const body = [
    `Le dépôt [${REPO}](https://github.com/${REPO}) a bougé depuis ${since}.`,
    '',
    '| | Référence | Branche principale |',
    '|---|---|---|',
    `| Commit | \`${base.slice(0, 7)}\` | \`${key}\` |`,
    `| CEN EN 16931 | ${cen.pinned ?? 'introuvable'} | ${cen.head ?? `introuvable (\`${CEN_PATH}\` a changé de place)`} |`,
    '',
    `**Tags nouveaux** : ${newTags.length > 0 ? newTags.map((t) => `\`${t}\``).join(', ') : 'aucun'}`,
    '',
    ruleFiles.length > 0
      ? `**Fichiers de règles modifiés** (${ruleFiles.length}) :\n${bullets(ruleFiles, (f) => `\`${f}\``)}`
      : '**Fichiers de règles modifiés** : aucun, aucun verdict ne devrait bouger.',
    '',
    `**Commits** (${n}) :`,
    bullets(
      commits,
      (c) =>
        `\`${c.sha.slice(0, 7)}\` ${c.commit.committer.date.slice(0, 10)} — ${quote(c.commit.message)}`,
    ),
    '',
    '### Que faire',
    '1. Relever `FNFE_COMMIT` et `FNFE_TAG` dans `scripts/fetch-schemas.mjs`, et `RULES_VERSION` dans `site-src/validateur/schematron.ts`.',
    '2. `pnpm schemas:fetch --force`, puis `pnpm test` et `pnpm site:check`.',
    ...(cenChanged
      ? [
          `3. Le CEN passe de ${cen.pinned ?? '?'} à ${cen.head ?? '?'}. En 1.3.17, BR-AF et BR-AG deviennent BR-IP et BR-IG : la 2.0 du SDK est à faire (docs/decisions.md, D70).`,
        ]
      : []),
    '',
    `[Comparer sur GitHub](${compare.html_url})`,
  ].join('\n');

  return { key, title, body };
}

async function main() {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith('--')) ?? FNFE_COMMIT;
  const baseLabel = base === FNFE_COMMIT ? FNFE_TAG : base.slice(0, 7);

  // Authentifié dans le workflow : sans jeton, l'API limite à 60 requêtes par heure et par adresse,
  // et les machines de GitHub Actions partagent leurs adresses.
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'facturx-veille-france-rfe',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const api = async (path) =>
    (
      await fetchWithRetry(`https://api.github.com/repos/${REPO}${path && `/${path}`}`, {
        fetchImpl: (url) => fetch(url, { headers, signal: AbortSignal.timeout(20_000) }),
      })
    ).json();
  // L'en-tête suffit : le premier kilo-octet porte la version, le fichier en pèse plusieurs méga.
  const cenAt = (ref) =>
    fetchWithRetry(`https://raw.githubusercontent.com/${REPO}/${ref}/${CEN_PATH}`, {
      fetchImpl: (url) =>
        fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20_000) }),
    })
      .then(async (res) => parseCenVersion(await res.text()))
      .catch(() => undefined);

  const { default_branch } = await api('');
  const compare = await api(`compare/${base}...${default_branch}`);
  const report =
    compare.ahead_by === 0
      ? null
      : summarize({
          base,
          baseLabel,
          compare,
          tags: await api('tags?per_page=100'),
          cen: { pinned: await cenAt(base), head: await cenAt(compare.commits.at(-1).sha) },
        });

  if (args.includes('--github-output')) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out)
      throw new Error('--github-output : GITHUB_OUTPUT absent, lancer depuis GitHub Actions');
    const lines = [`changed=${report !== null}`];
    if (report) {
      const bodyFile = join(process.env.RUNNER_TEMP ?? '.', 'france-rfe.md');
      writeFileSync(bodyFile, `${report.body}\n`);
      lines.push(`key=${report.key}`, `title=${report.title}`, `body_file=${bodyFile}`);
    }
    appendFileSync(out, `${lines.join('\n')}\n`);
  }
  console.log(
    report
      ? `${report.title}\n\n${report.body}`
      : `France_RFE : rien de neuf depuis ${baseLabel} (${base.slice(0, 7)}).`,
  );
}

// Exécuté directement : on compare. Importé (par son test) : on n'expose que les fonctions.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
