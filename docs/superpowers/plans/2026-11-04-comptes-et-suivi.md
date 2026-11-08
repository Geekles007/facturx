# Comptes, factures conservées et suivi des paiements — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner au Studio des comptes facultatifs, des factures émises et conservées côté serveur, le suivi des paiements, un tableau de bord et la relance en un clic, sans rien changer au Studio sans compte.

**Architecture :** Supabase (Auth, Postgres sous RLS, Storage, Edge Functions Deno) sert de serveur. Le Studio Preact actuel reste l'interface : sa persistance passe derrière une interface, avec deux implémentations (IndexedDB, Supabase). Tout ce qui engage juridiquement (émettre, importer, relancer, purger) passe par une Edge Function qui emploie le SDK du dépôt, copié dans les fonctions à la construction.

**Tech Stack :** TypeScript, Preact, esbuild, Vitest (Studio) ; Supabase CLI, Postgres 17, pgTAP, `pg_cron`, `pg_net`, Supabase Vault ; Deno (Edge Functions, `deno test`) ; `postgres` (postgres.js), `@supabase/supabase-js` ; Brevo (API transactionnelle et SMTP) ; `fflate` (archive d'export) ; `fake-indexeddb` (tests).

**Spec :** [docs/superpowers/specs/2026-11-03-comptes-et-suivi-design.md](../specs/2026-11-03-comptes-et-suivi-design.md)

## Global Constraints

- Messages de commit en français, dans le style du dépôt (`git log`) ; **aucune mention de Claude ni d'Anthropic**, ni trailer `Co-Authored-By`, ni « Generated with ».
- Commentaires en français, à la densité du code voisin ; formatage Biome (2 espaces, guillemets simples, 100 colonnes). `pnpm lint` passe à chaque commit.
- `supabase/` est sous **AGPL-3.0-or-later** ; tout le reste du dépôt reste sous MIT.
- Données en **région UE** (projet Supabase en `eu-west-3`, Paris), **plan Pro**.
- Montants en **centimes**, `bigint` en base. Dates d'affaires en `date`, « aujourd'hui » toujours calculé en **Europe/Paris**.
- Types d'avoir : **381, 261, 262, 396**. Moyens de paiement : `virement`, `cheque`, `especes`, `carte`, `prelevement`, `autre`.
- Limites : `emettre` **60 par heure** et par compte ; relance **une par facture tous les 3 jours**, **20 par jour** et par compte.
- URL signées valables **60 secondes**. Logo PNG ou JPEG de **1 Mo** au plus, police TTF de **2 Mo** au plus, type vérifié par signature d'octets, jamais d'après l'extension.
- Enregistrement du brouillon **1 seconde** après la dernière frappe en mode compte (400 ms en local, inchangé).
- Suppression de compte : délai de grâce de **30 jours** ; PDF orphelins effacés après **1 jour**.
- Tableau de bord : échéances des **15 prochains jours**.
- Réponse d'erreur des fonctions : `{ code, message, details? }`, statuts et codes du § 13 de la spec.
- Relances : expéditeur « *Nom de l'entreprise* via facturx », `Reply-To` = adresse du compte ; état affiché « envoyée », jamais « reçue ».
- Tout libellé ajouté au Studio existe en français et en anglais dans `site-src/studio/i18n.ts` (la table anglaise a le type de la française).
- Sans compte, le Studio ne charge ni `supabase-js` ni le code de `compte/` (`import()` à la première connexion).

## Review Focus

1. **Minuit à Paris.** Une émission ou un paiement à 00 h 30 heure de Paris (la veille en UTC) doit pouvoir porter la date du jour à Paris. Test : tâche 8, `regles.test.ts`, « aujourd'hui à Paris quand UTC est encore la veille ».
2. **Changement d'année.** Avec la numérotation annuelle, la première facture de janvier repart à 1 (`F-2027-0001` après `F-2026-0137`), et la date du 2 janvier est admise après une facture du 31 décembre. Test : tâche 8, `emettre.test.ts`, « première facture de l'année ».
3. **Session expirée pendant une longue saisie.** L'enregistrement automatique reçoit 401 : la saisie reste dans IndexedDB, le Studio demande de se reconnecter, et rien n'est perdu au retour. Test : tâche 15, « 401 à l'enregistrement : le miroir local garde la saisie ».
4. **Deux onglets sur le même brouillon.** Le second enregistrement, sur une version périmée, ne doit pas écraser le premier en silence : le Studio signale le conflit et propose de recharger. Test : tâche 15, « version périmée : conflit signalé, rien d'écrasé ».
5. **Client sans adresse e-mail.** Une facture dont l'acheteur n'a pas d'adresse de contact : « Relancer » ouvre le dialogue avec un destinataire vide et obligatoire, et le serveur refuse une adresse mal formée (422). Tests : tâche 11, « destinataire mal formé » ; tâche 19, « destinataire vide : envoi désactivé ».

---

## Phase A — Fondations

### Task 1: Outillage, projet Supabase local, licences

**Files:**
- Create : `supabase/config.toml` (par `supabase init`), `supabase/LICENSE`, `supabase/seed.sql` (vide pour l'instant), `scripts/compte-preparer.mjs`, `scripts/compte-preparer.test.mjs`, `scripts/compte-test.mjs`, `supabase/functions/deno.json`
- Modify : `package.json` (scripts), `.gitignore`, `LICENSE`, `docs/decisions.md` (D73)

**Interfaces :**
- Produces : `pnpm compte:preparer` écrit `supabase/functions/_vendor/` (non versionné) avec :
  - `facturx-sdk/` : copie de `packages/facturx/dist/` ;
  - `shared/` : copie de `site-src/shared/*.ts`, tests exclus ;
  - `sdk-version.ts` : `export const SDK_VERSION = '<version de packages/facturx/package.json>';` ;
  - `srgb.ts` : `export const SRGB_ICC_BASE64 = '…';`, l'encodage de `packages/facturx/test/fixtures/sRGB.icc`.
- Produces : `supabase/functions/deno.json`, avec les `imports` suivants :
  - `"facturx-sdk": "./_vendor/facturx-sdk/index.js"` et `"facturx-sdk/pdf": "./_vendor/facturx-sdk/pdf.js"` ;
  - `"pdf-lib": "npm:pdf-lib@1.17.1"` et `"@pdf-lib/fontkit": "npm:@pdf-lib/fontkit@1.1.1"` ;
  - `"postgres": "npm:postgres@<version exacte>"` ;
  - `"@supabase/supabase-js": "npm:@supabase/supabase-js@<version du lockfile racine>"`.

  Toutes les versions sont exactes, jamais des plages. Chaque fonction y renvoie dans `config.toml` (`[functions.<nom>] import_map = "./functions/deno.json"`).
- Produces : `pnpm compte:test` = `node scripts/compte-test.mjs`. Le script :
  1. lit `supabase status -o env` ;
  2. lance `supabase test db` ;
  3. démarre `supabase functions serve` en arrière-plan ;
  4. attend que `/functions/v1/` réponde ;
  5. lance `deno test -A supabase/functions/tests`, avec dans l'environnement `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` et `SUPABASE_DB_URL` ;
  6. arrête le serveur, et sort avec le code de `deno test`.

- [ ] **Step 1 : installer les outils** — `brew install supabase/tap/supabase deno` ; vérifier `supabase --version` (≥ 2) et `deno --version` (≥ 2). Docker est déjà là.
- [ ] **Step 2 : `supabase init`** à la racine ; dans `config.toml` : `project_id = "facturx"`, `[auth] site_url = "http://localhost:8080/studio/"`, `additional_redirect_urls = ["http://localhost:8080/en/studio/"]`, `[auth.email] enable_confirmations = true`.
- [ ] **Step 3 : licences** — `supabase/LICENSE` : le texte de l'AGPL-3.0 tel que publié sur gnu.org, précédé de `Copyright (c) 2026 geekles007`. À la fin de `LICENSE` (racine), un paragraphe : le dossier `supabase/` relève de l'AGPL-3.0-or-later (voir `supabase/LICENSE`), le reste du dépôt de la licence MIT ci-dessus.
- [ ] **Step 4 : écrire le test qui échoue**, `scripts/compte-preparer.test.mjs` :

```js
test('les versions de deno.json suivent le SDK', () => {
  const deno = JSON.parse(readFileSync('supabase/functions/deno.json', 'utf8'));
  const sdk = JSON.parse(readFileSync('packages/facturx/package.json', 'utf8'));
  expect(deno.imports['pdf-lib']).toBe(`npm:pdf-lib@${sdk.dependencies['pdf-lib'].replace(/^\^/, '')}`);
  expect(deno.imports['@pdf-lib/fontkit']).toBe(`npm:@pdf-lib/fontkit@${sdk.peerDependencies['@pdf-lib/fontkit'].replace(/^\^/, '')}`);
  for (const spec of Object.values(deno.imports)) expect(spec).not.toMatch(/[\^~]|@\d+$/);
});
test('preparer copie le SDK, les modules partagés, la version et le profil sRGB', async () => {
  await preparer(); // export de scripts/compte-preparer.mjs
  expect(existsSync('supabase/functions/_vendor/facturx-sdk/pdf.js')).toBe(true);
  expect(readFileSync('supabase/functions/_vendor/sdk-version.ts', 'utf8')).toContain(`'${sdk.version}'`);
  const icc = readFileSync('packages/facturx/test/fixtures/sRGB.icc');
  expect(readFileSync('supabase/functions/_vendor/srgb.ts', 'utf8')).toContain(icc.toString('base64'));
});
```

- [ ] **Step 5 :** `pnpm exec vitest run --config vitest.site.config.mts scripts/compte-preparer.test.mjs` → FAIL (`preparer` introuvable).
- [ ] **Step 6 : implémenter** `export async function preparer(): Promise<void>` dans `scripts/compte-preparer.mjs`. Le script vide `_vendor/` puis le reconstruit ; il exige que `packages/facturx/dist/` existe et, sinon, s'arrête en conseillant `pnpm build`. Écrire `supabase/functions/deno.json`. Ajouter au `package.json` : `"compte:preparer": "node scripts/compte-preparer.mjs"`, `"compte:start": "supabase start"`, `"compte:test": "node scripts/compte-test.mjs"`. Dans `.gitignore` : `supabase/functions/_vendor/`, `supabase/.temp/`, `supabase/.branches/`.
- [ ] **Step 7 :** relancer le test → PASS ; `supabase start` démarre la pile ; `pnpm lint` passe.
- [ ] **Step 8 : consigner D73** dans `docs/decisions.md` (session du 2026-11-03), au contenu du § 16 de la spec : « Les comptes : ce que devient "rien n'est transmis" ». Le validateur reste entièrement local, le Studio sans compte aussi. Avec un compte, les données sont sur un serveur, chiffrées au repos par l'hébergeur mais lisibles par le service, et c'est l'utilisateur qui fait ce choix. D73 explique aussi pourquoi `supabase/` passe en AGPL, et pourquoi le SDK est copié dans les fonctions plutôt que pris sur npm : la fonction emploie exactement le SDK du bundle du Studio, sans attendre une publication.
- [ ] **Step 9 : commit** — `git add supabase scripts/compte-*.mjs package.json .gitignore LICENSE docs/decisions.md && git commit -m "D73 : supabase/, projet local, outillage et licence AGPL"`

### Task 2: Mesurer le rendu PDF dans une Edge Function

Tâche d'exploration : le code de mesure ne se garde pas, on ne garde que son résultat.

**Files :**
- Create (jetable, non commité) : `supabase/functions/mesure-rendu/index.ts`
- Modify : `docs/decisions.md` (D74 : la mesure et la décision)

**Interfaces :**
- Produces : la décision consignée en D74. Si la mesure passe, l'émission se fait dans la transaction (tâche 8) ; sinon, la tâche 9 s'applique.

- [ ] **Step 1 : l'utilisateur crée le projet** Supabase « facturx », région `eu-west-3`, plan Pro (action payante : l'utilisateur la fait lui-même), puis donne la référence du projet. `supabase link --project-ref <ref>`.
- [ ] **Step 2 :** `pnpm build && pnpm compte:preparer`. Écrire `mesure-rendu/index.ts`. La fonction construit deux factures :
  - la facture d'exemple de `scripts/example-invoice.mjs` ;
  - la même avec 50 lignes, totaux recalculés par `computeTotals`.

  Pour chacune, elle mesure 20 fois `renderInvoicePdf` + `embedFacturX` avec `performance.now()`, en police Geist (octets lus depuis `site/studio/polices/`, puis passés en base64), et renvoie médiane et p95 en millisecondes.
- [ ] **Step 3 :** `supabase functions serve mesure-rendu`, appeler la fonction et noter les chiffres locaux.
- [ ] **Step 4 :** `supabase functions deploy mesure-rendu`, appeler la fonction déployée 3 fois, noter les chiffres et lire les journaux. Une erreur « CPU time exceeded » tranche à elle seule. Relever dans la documentation Supabase le budget de CPU en vigueur, attendu à 2 s par requête.
- [ ] **Step 5 : décider.** Le p95 déployé de la facture de 50 lignes doit rester sous la moitié du budget relevé. Si c'est le cas, on suit la tâche 8 telle quelle et on saute la tâche 9 ; sinon, la tâche 9 s'applique. Supprimer la fonction (`supabase functions delete mesure-rendu`) et son dossier.
- [ ] **Step 6 : consigner** D74 dans `docs/decisions.md`, sur le modèle de D72 : les chiffres, le budget relevé, la décision. Commit : `git commit -am "D74 : le rendu PDF mesuré dans une Edge Function"`

### Task 3: Modules partagés entre le Studio et les fonctions

**Files :**
- Create : `site-src/shared/numerotation.ts`, `site-src/shared/portable.ts`, `site-src/shared/rendu.ts`, `site-src/shared/polices.ts`, `site-src/shared/shared.test.ts`
- Modify : `site-src/studio/library.ts` (les fonctions déplacées sont réexportées, les appelants ne changent pas), `site-src/studio/pipeline.ts`, `site-src/studio/fonts.ts`

**Interfaces :**
- Produces :
  - `numerotation.ts` : `interface Numbering`, `formatNumber`, `nextRank`, `rankOf`, `advance` et `numberProblems`, sorties de `library.ts`, et `fileStem`, sortie de `pipeline.ts`. Ni signature ni comportement ne changent, et le module n'a aucun `import` ;
  - `portable.ts` : `toBase64`, `fromBase64`, `toPortableJson` et `fromPortableJson`, sorties de `library.ts`, sans aucun `import` ;
  - `polices.ts` : `export const FICHIERS_POLICES: Record<string, { regular: string; bold: string }>` (la clé est l'`id` de chaque famille de `FONT_FAMILIES`), sans aucun `import`. `fonts.ts` en tire ses champs `regular` et `bold` ;
  - `rendu.ts` : `export interface RenderAppearance`, le sous-ensemble d'`Appearance` que lit le rendu (`template`, `accent`, `style`, `logo?: { position; height }`, `language`, `labels`, `footer`, `display`, `pageSize`). Puis `labelsFor(a: RenderAppearance): RenderLabels`, `renderOptions(a: RenderAppearance, assets: Assets): LayoutInvoiceOptions` et `interface Assets`, sortis de `pipeline.ts`. Le seul import autorisé est `facturx-sdk/pdf`.

- [ ] **Step 1 : écrire le test qui échoue**, `shared.test.ts` :

```ts
test('aucun module partagé n’importe un fichier relatif (Deno ne résout pas .js → .ts)', () => {
  for (const f of ['numerotation.ts', 'portable.ts', 'polices.ts', 'rendu.ts'])
    expect(readFileSync(join(__dirname, f), 'utf8')).not.toMatch(/from\s+['"]\./);
});
test('rendu.ts n’importe que facturx-sdk/pdf', () => {
  const imports = [...readFileSync(join(__dirname, 'rendu.ts'), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  expect(new Set(imports)).toEqual(new Set(['facturx-sdk/pdf']));
});
test('chaque famille du Studio a ses fichiers dans FICHIERS_POLICES', () => {
  for (const f of FONT_FAMILIES) expect(FICHIERS_POLICES[f.id]).toEqual({ regular: f.regular, bold: f.bold });
});
```

- [ ] **Step 2 :** `pnpm exec vitest run --config vitest.site.config.mts site-src/shared` → FAIL (fichiers absents).
- [ ] **Step 3 : déplacer** le code, réexporter depuis `library.ts` et `pipeline.ts`.
- [ ] **Step 4 :** `pnpm site:check` → PASS, tests existants du Studio compris : le comportement n'a pas bougé.
- [ ] **Step 5 : commit** — `git commit -m "Studio : numérotation, JSON portable et rendu en modules partagés"`

## Phase B — Base de données

### Task 4: Schéma, RLS et création de l'entreprise à l'inscription

**Files :**
- Create : `supabase/migrations/20261104000100_schema.sql`, `supabase/tests/01-isolation.test.sql`
- Modify : `supabase/seed.sql` (fonctions d'aide aux tests, locales seulement), `.github/workflows/ci.yml` (job `compte`)

**Interfaces :**
- Produces : les tables de la spec (§ 6), avec ces précisions. `supabase/functions/` et `site-src/studio/compte/` emploient ces noms exacts.
  - `entreprises (id uuid pk default gen_random_uuid(), profil jsonb not null, apparence_defaut jsonb, cree_le timestamptz default now(), suppression_demandee_le timestamptz)`. La colonne `apparence_defaut` ne figure pas dans la spec : elle porte l'apparence par défaut que le Studio conserve aujourd'hui sous la clé `appearance-default`.
  - `membres (entreprise_id uuid references entreprises on delete cascade, user_id uuid references auth.users on delete cascade, role text check (role = 'titulaire'), cgu_version text not null, cgu_acceptees_le timestamptz not null default now(), primary key (entreprise_id, user_id))`.
  - `clients (id text pk, entreprise_id, party jsonb, nom text, email text, modifie_le)` et `produits (id text pk, entreprise_id, fiche jsonb, nom text, modifie_le)`. Les `id` sont en `text` pour accueillir les `uid` du Studio.
  - `brouillons (id uuid pk, entreprise_id, form jsonb, appearance jsonb, version int not null default 1, modifie_le)`.
  - `numerotation (entreprise_id pk, gabarit text, prochain int, annuelle bool, annee int)`.
  - `factures` : les colonnes de la spec, plus `ht bigint not null` (BT-109). Le tableau de bord en a besoin et la spec l'avait omise. Contraintes : `unique (entreprise_id, numero)`, `brouillon_id uuid unique`, `origine text check (origine in ('emise','importee'))`.
  - `paiements` (`moyen` en `check` sur les six valeurs) et `relances` (`niveau` en `check` de 1 à 3, `etat` en `check` dans `envoyee` et `refusee`).
  - Toute clé étrangère vers `entreprises` est `on delete cascade`.
  - `public.mes_entreprises() returns setof uuid`, `security definer`, `stable` : les entreprises de `auth.uid()`.
  - Un déclencheur `after insert on auth.users` crée l'entreprise (profil vide = `defaultCompany()` sérialisé), le membre `titulaire` avec `cgu_version` tiré de `raw_user_meta_data->>'cgu'`, et la numérotation `('F-{AAAA}-{NNNN}', 1, true, année courante)`. Sans `cgu` dans les métadonnées, l'inscription est refusée.
  - RLS activée partout. Chaque table métier a des règles `using / with check (entreprise_id in (select mes_entreprises()))` :
    - pour `select` : toutes les tables ;
    - pour `insert`, `update` et `delete` : `clients`, `produits` et `brouillons` ;
    - pour `update` seul : `entreprises`, sur les colonnes `profil` et `apparence_defaut` uniquement (privilèges par colonne : `revoke update on entreprises from authenticated; grant update (profil, apparence_defaut) on entreprises to authenticated`), et `numerotation` ;
    - `factures`, `relances` et `paiements` n'ont aucune règle d'écriture ici : les paiements viennent à la tâche 5.
- Produces (`seed.sql`) : `tests.creer_utilisateur(email text) returns uuid`, qui insère dans `auth.users` avec `raw_user_meta_data = '{"cgu":"2026-11"}'`, et `tests.agir_comme(uid uuid)`, qui fait `set local role authenticated` et `set local request.jwt.claims` avec le `sub` donné.

- [ ] **Step 1 : écrire le test qui échoue**, `01-isolation.test.sql` (pgTAP, `begin; select plan(n); … select * from finish(); rollback;`). En tête du fichier, les identifiants sont tirés dans des variables psql par `\gset` (`:a` et `:b` pour les utilisateurs, `:entreprise_a` et `:entreprise_b` pour leurs entreprises) ; c'est vrai de tous les fichiers pgTAP du plan. Assertions :

```sql
select isnt_empty($$ select 1 from entreprises e join membres m on m.entreprise_id = e.id where m.user_id = :a $$, 'inscription : entreprise créée');
select results_eq($$ select gabarit, prochain, annuelle from numerotation where entreprise_id = (select entreprise_id from membres where user_id = :a) $$, $$ values ('F-{AAAA}-{NNNN}', 1, true) $$, 'numérotation par défaut');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'x@test', '{}') $$, 'P0001', 'CGU_ABSENTES');
-- en tant que A, pour chaque table : ne voit rien de B
select tests.agir_comme(:a);
select is_empty($$ select 1 from clients where entreprise_id = :entreprise_b $$, 'clients de B invisibles');
-- … même assertion pour entreprises, produits, brouillons, numerotation, factures, paiements, relances
select throws_ok($$ insert into clients (id, entreprise_id, party, nom) values ('c1', :entreprise_b, '{}', 'x') $$, '42501');
select throws_ok($$ update entreprises set suppression_demandee_le = now() $$, '42501');
select throws_ok($$ insert into factures (entreprise_id) values (:entreprise_a) $$, '42501');
```

- [ ] **Step 2 :** `supabase test db` → FAIL (tables absentes).
- [ ] **Step 3 : écrire la migration**, puis `supabase db reset`.
- [ ] **Step 4 :** `supabase test db` → PASS.
- [ ] **Step 5 : CI** — ajouter dans `ci.yml` un job `compte` (Node 24 seulement), avec ces étapes :
  1. checkout, pnpm, `pnpm install --frozen-lockfile` ;
  2. `supabase/setup-cli@v1` et `denoland/setup-deno@v2` ;
  3. `supabase start -x studio,imgproxy,vector,logflare,supavisor` ;
  4. `pnpm build && pnpm site:build && pnpm compte:preparer` ;
  5. `pnpm compte:test`.

  Le shim veraPDF entre dans le `PATH` comme dans le job `ci`.
- [ ] **Step 6 : commit** — `git commit -m "supabase : schéma, RLS et entreprise créée à l'inscription"`

### Task 5: Factures figées, numérotation qui ne recule pas, paiements, relances

**Files :**
- Create : `supabase/migrations/20261104000200_regles.sql`, `supabase/tests/02-regles.test.sql`

**Interfaces :**
- Produces : des déclencheurs qui lèvent `P0001` avec ces messages exacts. Le Studio et les fonctions les reconnaissent à ce texte.
  - Sur `factures`, avant `update` ou `delete` : `FACTURE_FIGEE`, sauf si `current_setting('facturx.purge', true) = 'on'`. Même règle sur `relances` (`RELANCE_FIGEE`) et pour la suppression d'un paiement (`PAIEMENT_FIGE`).
  - Sur `numerotation`, avant `update`, hors émission (`current_setting('facturx.emission', true) is distinct from 'on'`) : `NUMEROTATION_RECUL` si `prochain` diminue, `NUMEROTATION_ANNEE` si `annee` change.
  - Sur `brouillons`, avant `update` : `version := old.version + 1`, `modifie_le := now()`.
  - Paiements :
    - règles RLS : `insert`, puis `update` limité par colonne à `annule_le` ;
    - avant `insert`, le déclencheur verrouille la facture (`for update`, en `security definer`). Il lève `PAIEMENT_AVOIR` si la facture est un avoir, `PAIEMENT_DATE` si `date > (now() at time zone 'Europe/Paris')::date`, et `PAIEMENT_EXCESSIF` si le total encaissé non annulé plus `montant` dépasse `net_a_payer − TTC des avoirs qui la citent`. Il fixe `cree_par := auth.uid()` ;
    - avant `update` : `PAIEMENT_ANNULATION` si autre chose que `annule_le` change, ou si `annule_le` repasse à `null`.

- [ ] **Step 1 : écrire le test qui échoue**, `02-regles.test.sql`. Une facture de test est insérée en `service_role` : `ttc` et `net_a_payer` de 12 000, puis un avoir 381 de 2 000 qui la cite. Assertions :

```sql
select throws_ok($$ update factures set ttc = 1 where id = :f $$, 'P0001', 'FACTURE_FIGEE');
select throws_ok($$ delete from factures where id = :f $$, 'P0001', 'FACTURE_FIGEE');
select lives_ok($$ set local facturx.purge = 'on'; delete from factures where id = :f_jetable $$, 'purge autorisée');
select tests.agir_comme(:a);
select throws_ok($$ update numerotation set prochain = 0 $$, 'P0001', 'NUMEROTATION_RECUL');
select lives_ok($$ update numerotation set prochain = 138 $$, 'reprendre une suite existante');
select throws_ok($$ insert into paiements (facture_id, entreprise_id, date, montant, moyen) values (:f, :ea, current_date, 10001, 'virement') $$, 'P0001', 'PAIEMENT_EXCESSIF'); -- 12000 − 2000 d'avoir
select lives_ok($$ insert into paiements (…) values (:f, :ea, current_date, 10000, 'virement') $$);
select throws_ok($$ insert into paiements (…) values (:avoir, :ea, current_date, 1, 'virement') $$, 'P0001', 'PAIEMENT_AVOIR');
select throws_ok($$ insert into paiements (…) values (:f, :ea, current_date + 2, 1, 'cheque') $$, 'P0001', 'PAIEMENT_DATE');
select throws_ok($$ update paiements set montant = 1 $$, 'P0001', 'PAIEMENT_ANNULATION');
select lives_ok($$ update paiements set annule_le = now() $$, 'annuler un paiement');
select throws_ok($$ delete from paiements $$, '42501');
select results_eq($$ select version from brouillons where id = :b $$, $$ values (2) $$, 'version incrémentée après update');
```

- [ ] **Step 2 :** `supabase test db` → FAIL.
- [ ] **Step 3 : écrire la migration**, puis `supabase db reset`.
- [ ] **Step 4 :** `supabase test db` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "supabase : factures figées, numérotation et paiements contrôlés par la base"`

### Task 6: Vue de suivi, tableau de bord, indicateurs

**Files :**
- Create : `supabase/migrations/20261104000300_suivi.sql`, `supabase/tests/03-suivi.test.sql`

**Interfaces :**
- Produces : `suivi_factures`, une vue `with (security_invoker = true)` qui ne retient pas les avoirs. Colonnes : `facture_id`, `entreprise_id`, `numero`, `type_code`, `date_emission`, `date_echeance`, `client_id`, `client_nom`, `client_email`, `devise`, `ht`, `ttc`, `net_a_payer`, `encaisse`, `avoirs`, `reste_du`, `statut` (`payee`, `a_rembourser`, `en_retard`, `payee_en_partie` ou `a_payer`, dans cet ordre de priorité, comme au § 6 de la spec) et `jours_retard`. « Aujourd'hui » s'y calcule à Paris.
- Produces : `tableau_de_bord(debut date, fin date) returns table (facture_ht bigint, encaisse bigint, reste_a_encaisser bigint, retard_montant bigint, retard_nombre int)`, en `security invoker`. Ses champs :
  - `facture_ht` : HT des factures moins HT des avoirs émis sur `[debut, fin]` ;
  - `encaisse` : paiements non annulés datés sur `[debut, fin]` ;
  - les trois derniers : l'état à date, quelle que soit la période.
- Produces : `indicateurs(mois date) returns table (comptes_crees int, comptes_actifs int, factures_emises int, relances_envoyees int)`, en `security definer`. `execute` est retiré à `public`, `anon` et `authenticated`, et accordé à `service_role`. Un compte est actif s'il a émis au moins une facture dans le mois.

- [ ] **Step 1 : écrire le test qui échoue**, `03-suivi.test.sql`. Les factures sont insérées en `service_role`, avec des dates relatives à `current_date` (notée J) pour que le test ne dépende pas du jour où il tourne. Les montants sont en centimes (HT / TTC = net à payer).

| Facture | Type | Émise | Échéance | HT / TTC | Paiements (date J−1) | Statut attendu |
|---|---|---|---|---|---|---|
| F-1 | 380 | J−1 | J+10 | 10 000 / 12 000 | — | `a_payer` |
| F-2 | 380 | J−1 | J+10 | 10 000 / 12 000 | 5 000 | `payee_en_partie` |
| F-3 | 380 | J−100 | J−30 | 10 000 / 12 000 | — | `en_retard` |
| F-4 | 380 | J−1 | J+10 | 5 000 / 6 000 | 6 000 | `payee` |
| F-5 | 380 | J−1 | J+10 | 5 000 / 6 000 | 6 000, puis l'avoir A-1 | `a_rembourser` |
| F-6 | 380 | J−300 | aucune | 1 000 / 1 200 | — | `a_payer` |
| F-7 | 386 | J−1 | J+10 | 2 000 / 2 400 | 2 400 | `payee` |
| A-1 | 381 | J−1 | — | 1 000 / 1 200, cite F-5 | — | absent de la vue |

Assertions :

```sql
select results_eq($$ select numero, statut from suivi_factures order by numero $$,
  $$ values ('F-1','a_payer'),('F-2','payee_en_partie'),('F-3','en_retard'),('F-4','payee'),('F-5','a_rembourser'),('F-6','a_payer'),('F-7','payee') $$);
select is((select reste_du from suivi_factures where numero = 'F-5'), -1200::bigint);
select is((select count(*)::int from suivi_factures where type_code = '381'), 0, 'les avoirs ne sont pas suivis');
-- facturé HT sur [J−3, J] : 10000 + 10000 + 5000 + 5000 + 2000 − 1000 (A-1) ; encaissé : 5000 + 6000 + 6000 + 2400
-- reste à encaisser : F-1 12000 + F-2 7000 + F-3 12000 + F-6 1200 ; en retard : F-3
select results_eq($$ select * from tableau_de_bord(current_date - 3, current_date) $$,
  $$ values (31000::bigint, 19400::bigint, 32200::bigint, 12000::bigint, 1) $$);
select tests.agir_comme(:a);
select throws_ok($$ select * from indicateurs(date_trunc('month', current_date)::date) $$, '42501');
```

- [ ] **Step 2 :** `supabase test db` → FAIL.
- [ ] **Step 3 : écrire la migration.**
- [ ] **Step 4 :** `supabase test db` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "supabase : statut de paiement calculé, tableau de bord et indicateurs"`

### Task 7: Stockage des PDF, logos et polices

**Files :**
- Create : `supabase/migrations/20261104000400_stockage.sql`, `supabase/tests/04-stockage.test.sql`, `scripts/compte-polices.mjs`
- Modify : `package.json` (`"compte:polices": "node scripts/compte-polices.mjs"`), `scripts/compte-test.mjs` (envoie les polices avant les tests de fonctions)

**Interfaces :**
- Produces :
  - les buckets `factures` (privé), `fichiers` (privé, `file_size_limit` de 2 Mo, `allowed_mime_types` `image/png`, `image/jpeg` et `font/ttf`) et `polices` (public) ;
  - les règles sur `storage.objects` :
    - `factures` : `select` pour les membres, quand `(storage.foldername(name))[1]::uuid in (select mes_entreprises())` ;
    - `fichiers` : `select`, `insert`, `update` et `delete` aux mêmes conditions ;
    - `polices` : lecture publique ;
  - aucune écriture dans `factures` ni dans `polices` sauf par `service_role`.
- Produces : `pnpm compte:polices` envoie `site/studio/polices/*.ttf` dans le bucket `polices` sous le même nom, avec `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1 : écrire le test qui échoue**, `04-stockage.test.sql`. En tant que A :

```sql
select is_empty($$ select 1 from storage.objects where bucket_id = 'factures' and name like :eb || '/%' $$, 'PDF de B invisibles');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner) values ('factures', :ea || '/x.pdf', :a) $$, '42501');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', :eb || '/logo', :a) $$, '42501');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner) values ('fichiers', :ea || '/logo', :a) $$);
```

- [ ] **Step 2 :** `supabase test db` → FAIL.
- [ ] **Step 3 : écrire la migration et le script.**
- [ ] **Step 4 :** `supabase test db` → PASS ; `pnpm site:build && pnpm compte:polices` envoie les 12 fichiers TTF.
- [ ] **Step 5 : commit** — `git commit -m "supabase : PDF, logos et polices dans le Storage, sous RLS"`

## Phase C — Edge Functions

### Task 8: `emettre`

**Files :**
- Create :
  - `supabase/functions/_shared/erreurs.ts`, `_shared/contexte.ts`, `_shared/db.ts`, `_shared/fichiers.ts`, `_shared/pdf.ts` ;
  - `supabase/functions/emettre/index.ts`, `emettre/regles.ts` ;
  - `supabase/functions/tests/aide.ts`, `tests/regles.test.ts`, `tests/emettre.test.ts`.
- Modify : `supabase/config.toml` (`[functions.emettre]`)

**Interfaces :**
- Consumes : `facturx-sdk`, `facturx-sdk/pdf`, `_vendor/shared/numerotation.ts`, `_vendor/shared/portable.ts`, `_vendor/shared/rendu.ts`, `_vendor/shared/polices.ts`, `_vendor/srgb.ts` et `_vendor/sdk-version.ts` (tâches 1 et 3) ; les tables, déclencheurs et buckets des tâches 4 à 7.
- Produces (`_shared/`) :
  - `type CodeErreur = 'SESSION' | 'DROITS' | 'NON_CONFIRME' | 'SUPPRESSION' | 'BROUILLON_MODIFIE' | 'DATE' | 'DOUBLON' | 'PDF_DEJA_DEPOSE' | 'ANOMALIES' | 'LIMITE' | 'ENVOI' | 'INTERNE'`. `DOUBLON` (tâche 10) et `PDF_DEJA_DEPOSE` (tâche 9), tous deux en 409, complètent le tableau du § 13 ;
  - `erreur(status: number, code: CodeErreur, message: string, details?: unknown): Response` et `json(body: unknown, status = 200): Response` ;
  - `contexte(req: Request): Promise<Contexte>`, avec `Contexte = { userId: string; email: string; confirme: boolean; entrepriseId: string; suppressionDemandee: boolean }`. L'entreprise est lue dans `membres` ; la fonction lève une `Response` 401 ou 403 ;
  - `sql`, une instance `postgres(Deno.env.get('SUPABASE_DB_URL'))`, et `admin()`, un client supabase-js avec la clé de service ;
  - `lireFichier(entrepriseId: string, cle: string, attendu: 'png' | 'jpeg' | 'ttf'): Promise<Uint8Array>`, qui vérifie la signature d'octets (`89 50 4E 47`, `FF D8 FF`, `00 01 00 00` ou `true`) et la taille (1 Mo pour un logo, 2 Mo pour une police), et sinon lève 422 `ANOMALIES` avec `[{ code: 'FICHIER', path: 'appearance.logo' | 'appearance.customFont' }]` ;
  - `produirePdf(invoice: Invoice, appearance: RenderAppearance & { font: string; logo?: { key; type; … }; customFont?: { regularKey; boldKey? } }, entrepriseId: string): Promise<Uint8Array>`. Les polices viennent de `polices` par `FICHIERS_POLICES[appearance.font]`, ou de `fichiers` pour `custom` ; le PDF est produit par `renderInvoicePdf(invoice, renderOptions(…))` puis `embedFacturX(…, { creator: 'facturx', outputIntent: { iccProfile } })`.
- Produces (`emettre/regles.ts`) : `aujourdhuiParis(maintenant: Date): string` (ISO `AAAA-MM-JJ`) et `controlerDate(issueDate: string, aujourdhui: string, derniere: string | undefined): { min: string | undefined; max: string } | undefined`. La seconde ne renvoie rien si la date est admise.
- Produces (`_shared/contexte.ts`) : `aujourdhui(req: Request): string`, qui renvoie l'en-tête `x-facturx-aujourdhui` si `FACTURX_TESTS` vaut `1` (fichier `.env` local et CI seulement, jamais en production), et `aujourdhuiParis(new Date())` sinon. `emettre` et `relancer` n'ont pas d'autre horloge.
- Produces (HTTP) : `POST /functions/v1/emettre`, avec le corps en JSON portable `{ brouillonId: string; version: number; invoice: Invoice; appearance: Appearance }`. `invoice.id` y porte le numéro proposé par le Studio. Réponse 201 `{ id: string; numero: string }`, ou 200 avec le même corps pour un rejeu.
- Produces (`tests/aide.ts`) : `creerCompte(email?: string): Promise<{ jwt: string; userId: string; entrepriseId: string }>` (`auth.admin.createUser` avec `email_confirm: true` et `user_metadata: { cgu: '2026-11' }`, puis `signInWithPassword`), `appeler(fonction: string, jwt: string, corps: unknown): Promise<Response>`, `factureDeTest(lignes = 1): Invoice` (la facture d'exemple du site, totaux par `computeTotals`) et `brouillonDeTest(entrepriseId): Promise<{ id: string; version: number }>`.

Le déroulé de `emettre/index.ts` suit le § 7 de la spec, étapes 1 à 10, avec ces précisions :
- la limite de débit est comptée sur les `factures.emise_le` de la dernière heure ;
- le rejeu par `brouillon_id` est vérifié avant la transaction et de nouveau après le verrou ;
- dans la transaction, `set local facturx.emission = 'on'` précède la mise à jour de `numerotation` ;
- `invoice.id` reçoit le numéro attribué, et `invoice.remittanceInformation` aussi s'il valait le numéro proposé ;
- le PDF est déposé sous `factures/{entrepriseId}/{factureId}.pdf` avant l'insertion. `factureId` est tiré par `crypto.randomUUID()` dès le début ;
- les montants enregistrés sont pris dans `invoice.totals` : `taxExclusiveAmount` → `ht`, `taxInclusiveAmount` → `ttc`, `amountDueForPayment` → `net_a_payer` ;
- `client_email` = `invoice.buyer.contact?.email`, et `invoice` est stocké sous sa forme portable.

- [ ] **Step 1 : écrire les tests qui échouent.** `regles.test.ts` :

```ts
Deno.test('aujourd’hui à Paris quand UTC est encore la veille', () => {
  assertEquals(aujourdhuiParis(new Date('2026-11-04T23:30:00Z')), '2026-11-05');
});
Deno.test('date future refusée, date antérieure à la dernière facture refusée, bornes admises', () => {
  assertEquals(controlerDate('2026-11-06', '2026-11-05', '2026-11-01'), { min: '2026-11-01', max: '2026-11-05' });
  assertEquals(controlerDate('2026-10-31', '2026-11-05', '2026-11-01'), { min: '2026-11-01', max: '2026-11-05' });
  assertEquals(controlerDate('2026-11-01', '2026-11-05', '2026-11-01'), undefined);
  assertEquals(controlerDate('2026-11-05', '2026-11-05', undefined), undefined);
});
```

`emettre.test.ts`, chacun contre la pile locale :
- **nominal** : la facture est datée du jour (`factureDeTest` prend `issueDate` = aujourd'hui à Paris). Réponse 201, avec `numero` = `` `F-${année}-0001` `` ; la ligne `factures` existe, `numerotation.prochain` = 2, le brouillon est supprimé, et le PDF du Storage passe `extractInvoice` avec `id` égal à ce numéro. Avec `VERAPDF=1`, `scripts/verapdf` sur le PDF sort avec le code 0 ;
- **rejeu** : un second appel avec le même `brouillonId` renvoie 200, le même `id`, et une seule ligne `factures` ;
- **version périmée** : 409 `BROUILLON_MODIFIE` ;
- **date future** : 409 `DATE`, avec `details` `{ min, max }` ;
- **anomalies** : une facture sans `paymentTerms.dueDate` ni moyen de paiement, rendue invalide, donne 422 `ANOMALIES`, et `details` contient des `Issue` avec `code` et `path`. Aucun numéro n'est consommé : `prochain` est inchangé ;
- **émissions simultanées** : 5 brouillons émis par `Promise.all` donnent 5 numéros distincts et consécutifs ;
- **première facture de l'année** : une facture a été émise le 2026-12-31, avec l'en-tête `x-facturx-aujourdhui: 2026-12-31`, et la numérotation est à `annee` = 2026, `prochain` = 138. Une facture datée du 2027-01-02, émise avec `x-facturx-aujourdhui: 2027-01-02`, donne `F-2027-0001`, et `prochain` passe à 2 ;
- **avoir** : un avoir 381 qui cite une facture d'une autre entreprise donne 422 `ANOMALIES` avec `path` `references.precedingInvoices[0].id` ; s'il cite la bonne, 201 et `facture_origine_id` est renseigné ;
- **adresse non confirmée** : 403 `NON_CONFIRME` ; **sans jeton** : 401 `SESSION` ;
- **logo invalide** : un fichier `logo` qui n'est pas un PNG donne 422 `ANOMALIES` avec `code` `FICHIER`.

- [ ] **Step 2 :** `pnpm compte:test` → FAIL (fonction absente).
- [ ] **Step 3 : implémenter** `_shared/*`, `emettre/regles.ts`, `emettre/index.ts`. Créer `supabase/functions/.env` (non versionné, ajouté au `.gitignore`) avec `FACTURX_TESTS=1`, et `supabase/functions/.env.example` (versionné) qui en liste les clés. `scripts/compte-test.mjs` passe ce fichier à `supabase functions serve --env-file`.
- [ ] **Step 4 :** `pnpm compte:test` → PASS, puis `VERAPDF=1 pnpm compte:test` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "emettre : numéro, validation par le SDK et PDF dans une transaction"`

### Task 9 (si la mesure de la tâche 2 échoue) : la facture figée d'abord, le PDF ensuite

Sautée si D74 retient l'émission dans la transaction.

**Files :**
- Modify : `supabase/functions/emettre/index.ts`, `supabase/tests/02-regles.test.sql`, `supabase/migrations/20261104000500_pdf_differe.sql`
- Create : `supabase/functions/deposer-pdf/index.ts`, `supabase/functions/tests/deposer-pdf.test.ts`

**Interfaces :**
- Produces : `emettre` sans l'étape 9 (`pdf_chemin` nul). Le déclencheur de `factures` admet une seule mise à jour : `pdf_chemin` de `null` à une valeur, avec `facturx.depot_pdf = 'on'`. `POST /functions/v1/deposer-pdf { factureId, pdf: base64 }` vérifie que `extractInvoice(pdf)` redit à l'identique l'`invoice` figée (égalité profonde du JSON portable), puis dépose le fichier et renseigne `pdf_chemin`. Il répond 422 `ANOMALIES` si ce n'est pas le cas.

- [ ] **Step 1 :** tests : un PDF conforme est accepté ; un PDF d'une autre facture est refusé avec 422 `ANOMALIES` ; un second dépôt donne 409 `PDF_DEJA_DEPOSE` ; dans `02-regles`, la mise à jour de `pdf_chemin` hors dépôt est refusée avec `FACTURE_FIGEE`.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : commit** — `git commit -m "deposer-pdf : la facture figée d'abord, son PDF vérifié ensuite"`

### Task 10: `importer` (les factures émises en local)

Cette fonction ne figure pas dans la spec, mais la spec la rend nécessaire : une facture importée doit entrer dans `factures`, que le navigateur ne peut pas écrire.

**Files :**
- Create : `supabase/functions/importer/index.ts`, `supabase/functions/tests/importer.test.ts`

**Interfaces :**
- Produces : `POST /functions/v1/importer`, avec le corps en JSON portable `{ form: unknown; appearance: unknown; pdf: Uint8Array }` (`form` et `appearance` d'un `SavedInvoice` du Studio, que la fonction stocke sans les lire). La facture est lue par `extractInvoice(pdf)`, jamais par le formulaire, et les montants viennent d'elle. Elle est enregistrée avec `origine = 'importee'` et `brouillon_id = null`, et `pdf_chemin` est le PDF déposé. Réponse 201 `{ id, numero }`. Un numéro déjà présent dans l'entreprise donne 409 `DOUBLON` avec `details: { numero }` : l'import est idempotent par numéro.

- [ ] **Step 1 :** tests : import nominal (201, `origine` vaut `importee`, `ttc` égale celui du PDF) ; second import du même numéro (409 `DOUBLON`, une seule ligne) ; un PDF sans Factur-X donne 422 `ANOMALIES`.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : commit** — `git commit -m "importer : les factures émises en local, lues dans leur PDF"`

### Task 11: `relancer`

**Files :**
- Create : `supabase/functions/relancer/index.ts`, `relancer/message.ts`, `relancer/brevo.ts`, `supabase/functions/tests/relancer.test.ts`, `supabase/functions/tests/message.test.ts`

**Interfaces :**
- Produces (`message.ts`) :
  - `echapper(texte: string): string` ;
  - `nettoyerObjet(objet: string): string`, qui retire CR, LF et les caractères de contrôle, puis coupe à 200 caractères ;
  - `composer(m: { objet: string; corps: string; entreprise: string; destinataire: string; replyTo: string; numero: string; pdf: Uint8Array }): MessageBrevo`. Le corps en texte est échappé, puis placé dans un gabarit HTML fixe (paragraphes sur les lignes vides, `<br>` sur les retours simples). Le texte brut va dans `textContent`. Le nom de l'expéditeur, `« ${entreprise} via facturx »`, est débarrassé des guillemets et des retours à la ligne. La pièce jointe s'appelle `${fileStem(numero)}.pdf` ;
  - `MessageBrevo` est le corps de `POST https://api.brevo.com/v3/smtp/email` : `sender`, `to`, `replyTo`, `subject`, `htmlContent`, `textContent` et `attachment[{ name, content }]`.
- Produces (`brevo.ts`) : `interface Expediteur { envoyer(m: MessageBrevo): Promise<{ messageId: string }> }`. `brevo(cle: string)` appelle l'API et lève une erreur portant le statut si la réponse n'est pas 2xx. `simule()` répond `{ messageId: 'simule-' + crypto.randomUUID() }` ; il est choisi quand `BREVO_API_KEY` vaut `simule`, en local et en CI.
- Produces (HTTP) : `POST /functions/v1/relancer { factureId, destinataire, objet, corps }` → 201 `{ id, niveau }`. Le niveau vaut le nombre de relances `envoyee` de la facture plus un, plafonné à 3. Les vérifications suivent le § 9 de la spec, avec ces codes :
  - adresse du compte non confirmée : 403 `NON_CONFIRME` ;
  - `profil->seller->siren` vide : 422 `ANOMALIES` avec `[{ code: 'SIREN', path: 'company.seller.siren' }]` ;
  - échéance non passée, ou reste dû nul : 422 `ANOMALIES` avec `code` `PAS_DE_RETARD` ;
  - destinataire mal formé : 422 `ANOMALIES` avec `path` `destinataire` ;
  - délai ou plafond dépassé : 429 `LIMITE`, avec `details: { reessayerApres: ISO }`. Le délai est de 72 heures depuis la dernière relance `envoyee` de la facture ; le plafond, de 20 relances `envoyee` depuis minuit à Paris pour l'entreprise ;
  - refus de Brevo : la ligne est consignée avec `etat = 'refusee'`, et la fonction répond 502 `ENVOI`.

  L'expéditeur est lu dans `RELANCES_EXPEDITEUR`.

- [ ] **Step 1 : écrire les tests qui échouent.** `message.test.ts` :

```ts
Deno.test('le corps est échappé', () => {
  const m = composer({ ...base, corps: '<script>x</script>\n\nMerci' });
  assert(!m.htmlContent.includes('<script>'));
  assert(m.htmlContent.includes('&lt;script&gt;'));
  assertEquals(m.textContent, '<script>x</script>\n\nMerci');
});
Deno.test('l’objet ne peut pas injecter d’en-tête', () => {
  assertEquals(nettoyerObjet('Relance\r\nBcc: x@y'), 'Relance Bcc: x@y');
});
Deno.test('expéditeur et réponse', () => {
  const m = composer({ ...base, entreprise: 'Atelier "Exemple"\nSAS' });
  assertEquals(m.sender.name, 'Atelier Exemple SAS via facturx');
  assertEquals(m.replyTo.email, base.replyTo);
});
```

`relancer.test.ts` : nominal (201, `niveau` 1, la ligne est en `envoyee` avec un `message_id` qui commence par `simule-`) ; deuxième relance immédiate (429) ; vingt et unième relance du jour sur 21 factures différentes (429) ; facture non échue (422 `PAS_DE_RETARD`) ; **destinataire mal formé** (422, `path` `destinataire`) ; SIREN vide (422 `SIREN`) ; la facture d'une autre entreprise donne 403 `DROITS`.
- [ ] **Step 2 :** `pnpm compte:test` → FAIL.
- [ ] **Step 3 : implémenter.** Ajouter `BREVO_API_KEY=simule` et `RELANCES_EXPEDITEUR=relances@localhost` à `supabase/functions/.env` et à `.env.example` (tâche 8).
- [ ] **Step 4 :** `pnpm compte:test` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "relancer : e-mail relu par l'utilisateur, échappé, limité, consigné"`

### Task 12: `supprimer-compte` et `purger`

**Files :**
- Create : `supabase/functions/supprimer-compte/index.ts`, `supabase/functions/purger/index.ts`, `supabase/migrations/20261104000600_purge.sql`, `supabase/functions/tests/purge.test.ts`
- Modify : `supabase/functions/emettre/index.ts`, `supabase/functions/relancer/index.ts` (refus 403 `SUPPRESSION`, par `contexte().suppressionDemandee`)

**Interfaces :**
- Produces : `POST /functions/v1/supprimer-compte { action: 'demander' | 'annuler' }`, qui renseigne ou efface `entreprises.suppression_demandee_le` et répond 200 `{ suppressionDemandeeLe: string | null }`.
- Produces : `POST /functions/v1/purger`, refusé (401) sans l'en-tête `x-purge-secret` égal à `PURGE_SECRET`. Il supprime, par l'API Storage, chaque objet de `factures` créé depuis plus d'un jour dont le chemin ne correspond à aucun `factures.pdf_chemin`. Puis, pour chaque entreprise dont la suppression a été demandée il y a plus de 30 jours :
  1. il supprime ses objets de `factures` et de `fichiers` ;
  2. dans une transaction, il fait `set local facturx.purge = 'on'` puis `delete from entreprises where id = …` ;
  3. il supprime ses utilisateurs par `auth.admin.deleteUser`.

  Il répond `{ orphelins: number, comptes: number }`.
- Produces (migration) : `pg_cron` et `pg_net` activés, et une tâche `purger-chaque-nuit` à `17 3 * * *`. Elle appelle `net.http_post` avec l'URL et le secret lus dans `vault.decrypted_secrets`, sous les noms `purger_url` et `purger_secret`. La migration ne contient aucun secret : la tâche 23 les crée.

- [ ] **Step 1 :** tests : après `demander`, `emettre` et `relancer` répondent 403 `SUPPRESSION` ; après `annuler`, ils répondent de nouveau normalement ; une demande antidatée de 31 jours par `sql` est purgée par `purger` (plus aucune ligne de l'entreprise, plus aucun objet, plus d'utilisateur), alors qu'une demande de 29 jours est laissée intacte ; un PDF orphelin daté d'avant-hier est effacé, tandis qu'un PDF rattaché à une facture reste ; sans secret, la réponse est 401.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : commit** — `git commit -m "supprimer-compte et purger : 30 jours de grâce, puis tout s'efface"`

## Phase D — Le Studio

### Task 13: La persistance derrière une interface

**Files :**
- Create : `site-src/studio/persistence.ts`, `site-src/studio/persistence.contract.ts`, `site-src/studio/storage.test.ts`
- Modify : `site-src/studio/storage.ts`, `package.json` (devDependency `fake-indexeddb`)

**Interfaces :**
- Produces : `interface Persistence`, qui reprend l'API actuelle de `storage` sans rien changer à ses signatures : `available`, `get`, `set`, `list`, `put`, `remove`, `getFile`, `setFile` et `dump`. `storage.ts` exporte `indexedDbPersistence: Persistence` (l'implémentation actuelle), `export let storage: Persistence = indexedDbPersistence` et `utiliser(p: Persistence): void`. Aucun appelant (`store.ts`, `files.ts`, `workflows.ts`, `librarypanel.tsx`, `editor/*`, `appearance.tsx`) ne change.
- Produces : `contratPersistence(nom: string, fabriquer: () => Promise<Persistence>): void`, une suite Vitest qui s'applique aux deux implémentations. Elle vérifie que `set` puis `get` relisent la valeur, que `put` puis `list` relisent les clients et les produits, que `remove` supprime, que `setFile` puis `getFile` relisent les octets à l'identique, et que `dump` contient ce qui a été écrit.

- [ ] **Step 1 : écrire le test qui échoue**, `storage.test.ts` : `import 'fake-indexeddb/auto'; contratPersistence('IndexedDB', async () => indexedDbPersistence);`
- [ ] **Step 2 :** `pnpm exec vitest run --config vitest.site.config.mts site-src/studio/storage.test.ts` → FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 :** `pnpm site:check` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "Studio : la persistance derrière une interface, IndexedDB inchangé"`

### Task 14: Construction, client Supabase, inscription et connexion

**Files :**
- Create : `site-src/studio/compte/index.ts`, `compte/client.ts`, `compte/session.ts`, `compte/connexion.tsx`, `compte/session.test.ts`
- Modify : `scripts/build-site.mjs` (`define`), `Dockerfile` (`ARG` et `ENV` des deux variables pendant l'étape de construction), `site-src/studio/main.tsx`, `site-src/studio/app.tsx` (boutons d'en-tête), `site-src/studio/store.ts` (`ui.compte`), `site-src/studio/i18n.ts`, `package.json` (devDependency `@supabase/supabase-js`)

**Interfaces :**
- Produces : `__FACTURX_SUPABASE_URL__` et `__FACTURX_SUPABASE_KEY__`, injectées par esbuild depuis `FACTURX_SUPABASE_URL` et `FACTURX_SUPABASE_KEY` (la clé publique). Quand elles sont vides, aucun bouton de compte ne s'affiche.
- Produces (`store.ts`) : `ui.compte: CompteUi | undefined`, avec `CompteUi = { email: string; confirme: boolean; entrepriseId: string; suppressionDemandeeLe: string | undefined; session: 'active' | 'expiree' }`, et `ui.reseau: 'ok' | 'hors-ligne'`.
- Produces (`compte/client.ts`) : `client(): SupabaseClient`, créé au premier appel avec les deux constantes injectées, la session étant gardée dans `localStorage` (comportement par défaut de supabase-js).
- Produces (`session.ts`, chargé sans `supabase-js`) : `sessionProbable(): boolean`, vrai si une clé `localStorage` commence par `sb-` et finit par `-auth-token` ; la lecture est protégée par `try/catch`.
- Produces (`compte/index.ts`, chargé par `import()`) :
  - `demarrer(): Promise<CompteUi | undefined>`, qui restaure la session, lit `membres` et renseigne `ui.compte`. La tâche 15 y branchera la persistance Supabase ; jusque-là, le Studio connecté garde IndexedDB ;
  - `inscrire(email, motDePasse, cguVersion: '2026-11')`, `connecter(email, motDePasse)`, `reinitialiser(email)` et `deconnecter()`. Le retour de confirmation et de réinitialisation se fait sur `/studio/` ou `/en/studio/`, selon `t.lang`.
- Produces (`main.tsx`) : si `sessionProbable()`, `await import('./compte/index.js').then((m) => m.demarrer())` avant `loadPersisted()`. Une connexion ou une déconnexion recharge la page.
- Produces (`connexion.tsx`) : un dialogue à trois volets (se connecter, créer un compte, mot de passe oublié). La case « J'accepte les CGU » est obligatoire et renvoie vers `/cgu/` (ou `/en/cgu/`).

- [ ] **Step 1 : écrire le test qui échoue**, `session.test.ts` : `sessionProbable()` est faux sans `localStorage`, faux avec une autre clé, vrai avec `sb-abc-auth-token`, et faux, sans lever, quand l'accès lève une exception.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm site:check` → PASS. Vérifier que le bundle principal ne contient pas supabase-js (`! grep -q GoTrueClient site/studio/app.js`), avec et sans les variables : le code du compte vit dans un fragment à part.
- [ ] **Step 5 : vérifier dans le navigateur** (`docker build` puis `run`, ou un serveur statique sur `site/`, avec la pile locale) : création de compte, e-mail lu dans Mailpit (`http://127.0.0.1:54324`), confirmation, connexion, déconnexion.
- [ ] **Step 6 : commit** — `git commit -m "Studio : créer un compte et se connecter, sans rien charger pour qui n'en a pas"`

### Task 15: La persistance Supabase, les brouillons, le hors-ligne

**Files :**
- Create : `site-src/studio/compte/persistence.ts`, `compte/brouillons.tsx`, `compte/persistence.test.ts`, `compte/test-aide.ts`
- Modify : `site-src/studio/store.ts` (`startPersistence({ delai })`, conflit et hors-ligne), `site-src/studio/i18n.ts`

**Interfaces :**
- Consumes : `Persistence` (tâche 13), `client()` (tâche 14).
- Produces : `supabasePersistence(sb: SupabaseClient, entrepriseId: string): Persistence`. Correspondances :
  - `get` et `set` de `company` → `entreprises.profil` ; de `appearance-default` → `entreprises.apparence_defaut` ; de `numbering` → `numerotation`, en convertissant les noms de colonnes ;
  - `get` et `set` de `draft` → le brouillon courant, dont l'`id` est gardé sous la clé locale `brouillon-courant-${entrepriseId}`. La mise à jour se fait par `update … where id and version`, une clé absente passe par une insertion, et chaque écriture est recopiée dans IndexedDB sous `draft-compte-${entrepriseId}` ;
  - `list` et `put` de `clients` et `products` → `clients` et `produits`. Les `uid` deviennent `id`, et `nom` et `email` sont tirés de la fiche ;
  - `list('invoices')` → `factures`, en `SavedInvoice` (`uid` = `id`) ; `put('invoices')` lève `Error('EMISSION_SERVEUR')` ;
  - `getFile('pdf-<id>')` → `factures/{entrepriseId}/<id>.pdf` ; toute autre clé → `fichiers/{entrepriseId}/<clé>`. `setFile` refuse les clés `pdf-` ;
  - `dump()` → le même format que la sauvegarde locale, que l'export complète (tâche 20).
- Produces (`compte/index.ts`) : `demarrer()` appelle désormais `utiliser(supabasePersistence(client(), entrepriseId))` avant de rendre la main.
- Produces (`store.ts`) :
  - `startPersistence(options?: { delai?: number })`, avec 1 000 ms en mode compte ;
  - `ui.conflit: boolean`. Un `update` sans ligne touchée le met à `true` ; le Studio affiche « modifié ailleurs » et propose de recharger ;
  - une erreur réseau met `ui.reseau = 'hors-ligne'` et le Studio rejoue l'écriture à l'évènement `online` ;
  - un 401 met `ui.compte.session = 'expiree'` et ouvre la connexion. Le miroir local garde la saisie, et le brouillon est rejoué après la reconnexion.
- Produces (`brouillons.tsx`) : la liste des brouillons (ouvrir, supprimer, nouveau).
- Produces (`test-aide.ts`) : `compteDeTest(): Promise<{ sb: SupabaseClient; entrepriseId: string }>`, à partir de `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1 : écrire les tests qui échouent**, `compte/persistence.test.ts`, en `describe.skipIf(!process.env.SUPABASE_URL)` :
  - `contratPersistence('Supabase', async () => supabasePersistence(...(await compteDeTest())))` ;
  - « version périmée : conflit signalé, rien d'écrasé » : deux instances enregistrent le même brouillon, et la seconde écriture, sur l'ancienne version, échoue et laisse la première intacte ;
  - « 401 à l'enregistrement : le miroir local garde la saisie » : on remplace le jeton du client par un jeton expiré, puis on écrit. `ui.compte.session` passe à `expiree`, et `indexedDbPersistence.get('draft-compte-…')` relit la saisie ;
  - `put('invoices')` lève `EMISSION_SERVEUR`.
- [ ] **Step 2 :** `SUPABASE_URL=… pnpm exec vitest run --config vitest.site.config.mts site-src/studio/compte` → FAIL. Ajouter cette commande, avec les variables, au job CI `compte`.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 :** → PASS ; `pnpm site:check` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "Studio : brouillons, entreprise, clients et catalogue sur le serveur"`

### Task 16: Émettre en mode compte

**Files :**
- Create : `site-src/studio/compte/emission.ts`, `compte/erreurs.ts`, `compte/erreurs.test.ts`
- Modify : `site-src/studio/workflows.ts` (`issueInvoice` passe à `emettreSurServeur` quand `ui.compte` est défini), `site-src/studio/editor/document.tsx` (en mode compte, le numéro est en lecture seule avec l'aide « attribué à l'émission »), `site-src/studio/i18n.ts`

**Interfaces :**
- Produces (`erreurs.ts`) : `type Reaction = { kind: 'connexion' } | { kind: 'message'; texte: string } | { kind: 'recharger'; texte: string } | { kind: 'controle'; issues: Issue[] } | { kind: 'date'; min?: string; max: string }`, et `reaction(statut: number, corps: { code: string; message: string; details?: unknown }): Reaction`. La correspondance suit le tableau du § 13 de la spec.
- Produces (`emission.ts`) : `emettreSurServeur(): Promise<boolean>`. Il vide d'abord l'enregistrement en attente, puis envoie `{ brouillonId, version, invoice: buildInvoice(form).invoice, appearance }` en JSON portable par `client().functions.invoke('emettre')`. En cas de succès, il recharge l'historique, ouvre la facture émise et affiche un toast. Sur `controle`, il fait `ui({ tab: 'check' })` et `focusField(issues[0].path, 'check')`. En cas d'échec, le brouillon reste intact, avec le message « aucun numéro n'a été consommé ».

- [ ] **Step 1 : écrire le test qui échoue**, `erreurs.test.ts` :

```ts
test.each([
  [401, 'SESSION', 'connexion'], [403, 'NON_CONFIRME', 'message'], [409, 'BROUILLON_MODIFIE', 'recharger'],
  [409, 'DATE', 'date'], [422, 'ANOMALIES', 'controle'], [429, 'LIMITE', 'message'], [502, 'ENVOI', 'message'], [500, 'INTERNE', 'message'],
])('%i %s → %s', (statut, code, kind) => expect(reaction(statut, { code, message: '' , details: code === 'ANOMALIES' ? [] : code === 'DATE' ? { max: '2026-11-05' } : undefined }).kind).toBe(kind));
```

- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS ; `pnpm site:check`.
- [ ] **Step 5 : vérifier dans le navigateur** : émettre une facture, la retrouver dans l'historique, ouvrir son PDF ; puis une facture invalide, pour laquelle l'onglet Contrôle s'ouvre sur le champ en cause.
- [ ] **Step 6 : commit** — `git commit -m "Studio : émettre par le serveur en mode compte"`

### Task 17: Factures, fiche, paiements

**Files :**
- Create : `site-src/studio/compte/suivi.ts`, `compte/factures.tsx`, `compte/fiche.tsx`, `compte/navigation.tsx`, `compte/suivi.test.ts`
- Modify : `site-src/studio/app.tsx` (la navigation du mode compte remplace le bouton Bibliothèque), `site-src/studio/i18n.ts`

**Interfaces :**
- Produces (`suivi.ts`) :
  - `type Statut = 'payee' | 'a_rembourser' | 'en_retard' | 'payee_en_partie' | 'a_payer'` et `interface LigneSuivi`, les colonnes de `suivi_factures` en camelCase ;
  - `listerSuivi(f: { statut?: Statut; clientId?: string; debut?: string; fin?: string }): Promise<LigneSuivi[]>` ;
  - `paiementsDe(factureId)` et `relancesDe(factureId)` ;
  - `enregistrerPaiement(p: { factureId; date: string; montant: number; moyen; note?: string })`, `marquerPayee(factureId, aujourdhui: string)` et `annulerPaiement(id)`. Ces trois fonctions traduisent `PAIEMENT_EXCESSIF`, `PAIEMENT_DATE` et `PAIEMENT_AVOIR` en messages localisés ;
  - `urlPdf(factureId): Promise<string>`, une URL signée de 60 secondes. La fiche ne l'emploie pas directement : elle récupère le PDF par `fetch(urlPdf)` et l'affiche depuis une URL `blob:`, ce que la CSP de la tâche 22 autorise (`frame-src blob:`).
- Produces (`navigation.tsx`) : les entrées Tableau de bord, Factures, Nouvelle facture, Brouillons, Clients, Catalogue et Entreprise, dans l'ordre du § 10 de la spec.
- Produces (`fiche.tsx`) : le PDF, les paiements (actifs, puis annulés et barrés), les relances, et les actions « Enregistrer un paiement », « Marquer comme payée », « Annuler ce paiement », « Dupliquer », « Faire un avoir » et « Facturer le solde ». Les trois dernières passent par `duplicateForm`, `creditNoteForm` et `balanceForm`, sans changement. Le montant se saisit avec le même analyseur que l'éditeur (`parseScaled`).

- [ ] **Step 1 : écrire les tests qui échouent**, `suivi.test.ts`, en `skipIf` sans pile locale. Les factures sont émises par `emettre` :
  - un paiement partiel donne `payee_en_partie`, et `marquerPayee` donne `payee` ;
  - un paiement au-delà du reste dû est refusé avec le message localisé de `PAIEMENT_EXCESSIF` ;
  - `annulerPaiement` fait revenir le statut à son état précédent ;
  - le filtre par statut ne renvoie que ce statut ;
  - `urlPdf` renvoie une URL dont le contenu commence par `%PDF`.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : vérifier dans le navigateur**, sur un téléphone de 375 px de large et sur un ordinateur.
- [ ] **Step 6 : commit** — `git commit -m "Studio : liste des factures, fiche et paiements"`

### Task 18: Tableau de bord

**Files :**
- Create : `site-src/studio/compte/tableau.tsx`, `compte/periode.ts`, `compte/periode.test.ts`
- Modify : `site-src/studio/compte/suivi.ts`, `site-src/studio/i18n.ts`

**Interfaces :**
- Produces : `periode(type: 'mois' | 'annee', aujourdhui: string): { debut: string; fin: string }` ; `tableauDeBord(debut, fin): Promise<{ factureHt; encaisse; resteAEncaisser; retardMontant; retardNombre }>` dans `suivi.ts` (`rpc('tableau_de_bord')`). La page montre les quatre chiffres, les factures en retard triées par `joursRetard` décroissant avec « Relancer », et les échéances des 15 prochains jours (`a_payer` ou `payee_en_partie`, échéance dans `[aujourd'hui, aujourd'hui + 15]`).

- [ ] **Step 1 :** test : `periode('mois', '2026-02-14')` donne `{ debut: '2026-02-01', fin: '2026-02-28' }` ; `periode('mois', '2028-02-10')` finit le `2028-02-29` ; `periode('annee', '2026-11-04')` donne `{ debut: '2026-01-01', fin: '2026-12-31' }`.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : vérifier dans le navigateur** avec des factures de chaque statut.
- [ ] **Step 6 : commit** — `git commit -m "Studio : tableau de bord"`

### Task 19: Relance en un clic

**Files :**
- Create : `site-src/studio/compte/relances.ts`, `compte/relance.tsx`, `compte/relances.test.ts`
- Modify : `site-src/studio/i18n.ts`

**Interfaces :**
- Produces : `preparerRelance(d: DonneesRelance, niveau: 1 | 2 | 3, langue: 'fr' | 'en'): { objet: string; corps: string }`, avec `DonneesRelance = { numero: string; echeance: string; resteDu: number; devise: string; entreprise: string; iban?: string; reference?: string; penalites?: string; indemnite?: number }`. Dates et montants sont formatés dans la langue demandée, avec `Intl`.
- Produces (`relances.ts`) : `peutEnvoyer(destinataire: string): boolean`, vrai pour une adresse non vide de la forme `x@y.z`, après suppression des espaces.
- Produces (`relance.tsx`) : le dialogue. Le destinataire est prérempli avec l'adresse de la facture ; l'objet et le corps sont modifiables. « Envoyer » appelle `relancer`, et porte `disabled={!peutEnvoyer(destinataire)}`. L'état affiché est « envoyée », jamais « reçue ».

- [ ] **Step 1 : écrire les tests qui échouent**, `relances.test.ts` :
  - le niveau 1 en français contient `F-2026-0042`, `11/10/2026` et le reste dû au format `fr-FR`, et ne contient pas « pénalités » ;
  - le niveau 3 mentionne les pénalités au taux donné et l'indemnité de `40,00 €` ;
  - la version anglaise est en anglais, avec la date au format `en-GB` ;
  - sans IBAN, aucune ligne de coordonnées bancaires ;
  - « destinataire vide : envoi désactivé » : `peutEnvoyer('')`, `peutEnvoyer('  ')` et `peutEnvoyer('client')` sont faux ; `peutEnvoyer(' compta@client.fr ')` est vrai.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : vérifier dans le navigateur**, avec `BREVO_API_KEY=simule` : la relance apparaît dans la fiche, et une deuxième relance immédiate affiche la limite.
- [ ] **Step 6 : commit** — `git commit -m "Studio : relance en un clic, relue avant l'envoi"`

### Task 20: Importer les données locales, exporter les siennes

**Files :**
- Create : `site-src/studio/compte/import.ts`, `compte/export.ts`, `compte/import.test.ts`, `compte/export.test.ts`
- Modify : `site-src/studio/compte/index.ts` (l'import est proposé à la première connexion), `package.json` (devDependency `fflate`), `site-src/studio/i18n.ts`

**Interfaces :**
- Produces (`import.ts`) : `importerLocal(dump: Awaited<ReturnType<typeof indexedDbPersistence.dump>>, cible: Persistence, importer: (s: SavedInvoice, pdf: Uint8Array) => Promise<void>): Promise<{ clients: number; produits: number; factures: number; doublons: string[] }>`. Il reprend l'entreprise, les clients, le catalogue et l'apparence par défaut. La numérotation passe à `prochain = max(serveur, local)`, sans jamais diminuer. Chaque facture passe par la fonction `importer`, avec son PDF `pdf-<uid>`. Les données locales ne sont pas effacées.
- Produces (`export.ts`) : `exporterArchive(): Promise<Uint8Array>`, un zip `fflate` qui contient `donnees.json` (`toPortableJson` de l'entreprise, des clients, des produits, des brouillons, de la numérotation, des factures sans leur PDF, des paiements et des relances) et `factures/<fileStem(numero)>.pdf`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `import.test.ts` (unitaire, avec une `Persistence` en mémoire et un `importer` simulé) : une sauvegarde de 2 clients, 1 produit et 3 factures donne `{ clients: 2, produits: 1, factures: 3 }` ; quand `importer` renvoie un doublon pour l'une, elle est listée dans `doublons` et les autres passent ; avec une numérotation locale à 12 et serveur à 40, on garde 40.
  - `export.test.ts` (`skipIf`) : l'archive se décompresse, `donnees.json` contient les factures, et chaque PDF commence par `%PDF`.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : commit** — `git commit -m "Studio : importer ses données locales, exporter une archive complète"`

### Task 21: Page Entreprise, compte et suppression

**Files :**
- Create : `site-src/studio/compte/entreprise.tsx`, `compte/suppression.ts`, `compte/suppression.test.ts`
- Modify : `site-src/studio/main.tsx` (un compte en suppression n'ouvre que l'écran d'annulation), `site-src/studio/i18n.ts`

**Interfaces :**
- Produces : la page Entreprise. Elle regroupe le profil vendeur (le formulaire actuel de la bibliothèque, réutilisé) et la numérotation (gabarit, remise à zéro annuelle, prochain rang, dont le champ refuse une valeur plus basse avant même l'envoi). Elle permet aussi de changer d'adresse et de mot de passe (`auth.updateUser`) et d'exporter.
- Produces (`suppression.ts`) : `peutSupprimer(etat: { exportFaitLe?: string }): boolean`, vrai seulement si un export a été fait pendant cette session ; `demanderSuppression()` et `annulerSuppression()`, qui appellent `supprimer-compte`.

- [ ] **Step 1 :** test : `peutSupprimer({})` est faux, `peutSupprimer({ exportFaitLe: '…' })` est vrai. Avec la pile (`skipIf`) : après une demande, `emettre` répond 403 `SUPPRESSION` et `demarrer()` renvoie `suppressionDemandeeLe` ; après l'annulation, tout redevient normal.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → **Step 4 :** PASS.
- [ ] **Step 5 : vérifier dans le navigateur** tout le parcours : export, demande, reconnexion, annulation.
- [ ] **Step 6 : commit** — `git commit -m "Studio : entreprise, numérotation, compte et suppression en deux temps"`

## Phase E — Exploitation et textes

### Task 22: Une CSP pour le site

**Files :**
- Create : `docker/csp.conf`, `site/accueil.js`, `site/en/accueil.js`, `site/validateur/demarrage.js` (les noms suivent le contenu des scripts déplacés)
- Modify : `docker/nginx.conf`, `docker/entrypoint.sh`, `Dockerfile`, `.github/workflows/image.yml`, `site/index.html`, `site/en/index.html`, `site/validateur/index.html` (leurs `<script>` en ligne passent dans des fichiers : `script-src 'self'` les bloquerait)

**Interfaces :**
- Produces : `docker/csp.conf`, avec une seule ligne : `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' ${FACTURX_SUPABASE_URL}; frame-src blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;`. L'URL est substituée au démarrage par `entrypoint.sh`, comme `stats.conf`. Le fichier est inclus au niveau `server` **et dans chaque `location` qui a son propre `add_header`** : nginx n'hérite pas des `add_header` quand une `location` en définit.

- [ ] **Step 1 : écrire le test qui échoue**, dans `image.yml` : `curl -sI` sur `/`, `/validateur/`, `/studio/`, `/fonts/<un fichier>` et `/studio/polices/geist-regular.ttf` ; chaque réponse contient `content-security-policy`.
- [ ] **Step 2 :** `docker build` et `docker run`, puis les mêmes `curl` en local → FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 :** les `curl` → PASS. Ouvrir ensuite dans le navigateur la page d'accueil, le validateur (déposer une facture et attendre le verdict des trois schematrons : Saxon-JS doit tourner sous la CSP) et le Studio (aperçu, émission locale, connexion). La console ne doit montrer aucune violation. Si Saxon-JS exige `'unsafe-eval'`, l'ajouter à `script-src` et consigner pourquoi dans une décision D75.
- [ ] **Step 5 : commit** — `git commit -m "site : une CSP, avec le projet Supabase pour seule origine extérieure"`

### Task 23: Mise en production, e-mails et sauvegardes

**Files :**
- Create : `docs/compte.md` (guide d'exploitation), `.github/workflows/sauvegarde.yml`, `.github/workflows/compte-deploy.yml`

**Interfaces :**
- Produces : `docs/compte.md`, qui décrit :
  - les secrets du projet (`BREVO_API_KEY`, `RELANCES_EXPEDITEUR`, `PURGE_SECRET`) ;
  - les secrets du Vault (`purger_url`, `purger_secret`) ;
  - le SMTP de l'authentification (`smtp-relay.brevo.com:587`), `site_url` et les URL de redirection de production ;
  - le déploiement : `pnpm build && pnpm site:build && pnpm compte:preparer && supabase db push && supabase functions deploy && pnpm compte:polices` ;
  - les enregistrements DNS SPF, DKIM et DMARC ;
  - la restauration d'une sauvegarde.
- Produces : `compte-deploy.yml`, déclenché à la main (`workflow_dispatch`), qui rejoue cette suite avec `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`.
- Produces : `sauvegarde.yml`, chaque dimanche à `23 2 * * 0` :
  1. `pg_dump` de la base ;
  2. téléchargement des buckets `factures` et `fichiers` par leur API S3 ;
  3. une archive `tar` chiffrée avec `age -r $AGE_RECIPIENT` ;
  4. le dépôt chez Scaleway Object Storage (`fr-par`), avec 12 semaines de rétention.

  Il porte ses secrets dans GitHub (`SAUVEGARDE_DB_URL`, `SUPABASE_S3_*`, `SCALEWAY_S3_*`, `AGE_RECIPIENT`).

- [ ] **Step 1 : actions de l'utilisateur**, que l'agent ne fait pas :
  1. créer le compte Brevo et valider le domaine d'envoi ;
  2. poser les enregistrements DNS ;
  3. créer le bucket Scaleway et la paire de clés `age`, en gardant la clé privée hors du dépôt ;
  4. saisir les secrets dans Supabase et dans GitHub.
- [ ] **Step 2 :** lancer `compte-deploy.yml`. Vérifier une inscription réelle (l'e-mail arrive, la confirmation fonctionne), puis une émission et une relance vers l'adresse de l'utilisateur.
- [ ] **Step 3 :** lancer `sauvegarde.yml` à la main. Restaurer l'archive dans la pile locale en suivant `docs/compte.md` (`supabase db reset` puis `psql < dump`, buckets renvoyés), et vérifier que la facture de production et son PDF y sont.
- [ ] **Step 4 : commit** — `git commit -m "compte : déploiement, e-mails et sauvegarde chiffrée hebdomadaire"`

### Task 24: CGU, confidentialité, sous-traitance

**Files :**
- Create : `site/cgu/index.html`, `site/confidentialite/index.html`, `site/sous-traitance/index.html`, `site/en/cgu/index.html`, `site/en/confidentialite/index.html`, `site/en/sous-traitance/index.html`
- Modify : `docker/nginx.conf` (redirections sans barre finale, comme pour `/studio`), `site/index.html` et `site/en/index.html` (liens de pied de page)

**Interfaces :**
- Produces : des pages au style du site, versionnées `2026-11`, la valeur que reçoit `cgu_version`. Elles disent :
  - responsable de traitement et sous-traitant (article 28) ;
  - les sous-traitants ultérieurs, dont Supabase, société américaine, hébergement `eu-west-3`, et Brevo ;
  - la conservation des factures, obligation légale de l'utilisateur pendant dix ans ;
  - la suppression en 30 jours après export ;
  - les limites d'envoi ;
  - le Studio sans compte, qui ne transmet rien.

- [ ] **Step 1 :** rédiger les six pages ; l'image du site les sert.
- [ ] **Step 2 :** ajouter à `image.yml` : `curl -fsS` sur `/cgu/`, `/confidentialite/`, `/sous-traitance/` et leurs versions anglaises.
- [ ] **Step 3 : action de l'utilisateur** : faire relire les textes par un juriste avant l'ouverture au public. C'est noté dans `docs/compte.md` comme condition d'ouverture.
- [ ] **Step 4 : commit** — `git commit -m "site : CGU, confidentialité et accord de sous-traitance"`

### Task 25: README et site

**Files :**
- Modify : `README.md`, `README.en.md`, `site/index.html`, `site/en/index.html`, `site/studio/index.html`, `site/en/studio/index.html`, `site-src/studio/i18n.ts` (`app.privacy`)

**Interfaces :**
- Produces :
  - la section Studio des deux README : les deux modes, un renvoi à D73, et la licence de `supabase/` ;
  - la page d'accueil et la page du Studio : « Créer un compte gratuit », et la mention « rien ne quitte votre navigateur » réservée au mode sans compte. En mode compte, `t.app.privacy` dit où sont les données.

- [ ] **Step 1 :** rédiger. `pnpm check` → PASS.
- [ ] **Step 2 : commit** — `git commit -m "README et site : le Studio avec et sans compte"`

---

## Ordre et dépendances

- Les tâches 1 à 3 viennent en premier ; la tâche 2 décide du sort de la tâche 9.
- Les tâches 4 à 7 (la base de données) se suivent.
- Les tâches 8 à 12 (les fonctions) supposent la base. La tâche 8 vient en premier, parce qu'elle installe `_shared/`.
- Les tâches 13 à 21 (le Studio) supposent la tâche 3. La tâche 13 ne dépend de rien d'autre et peut se faire à tout moment après elle ; à partir de la tâche 15, le Studio suppose les tâches 4 à 8.
- La tâche 22 peut se faire dès la tâche 14.
- La tâche 23 suppose tout le reste.
- La tâche 24 doit précéder l'ouverture, pas le développement.
- La tâche 25 vient en dernier.
