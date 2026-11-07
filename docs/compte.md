# Le compte en production

Le guide d'exploitation du compte (spec `docs/superpowers/specs/2026-11-03-comptes-et-suivi-design.md`) : mettre en service le projet Supabase, les e-mails et les sauvegardes, confirmer la mesure D74 sur le projet déployé, déployer chaque nouvelle version, restaurer une sauvegarde.

Les services : **Supabase** (projet en `eu-west-3`, Paris, plan Pro), **Brevo** (e-mails de l'authentification par SMTP, relances par API), **Scaleway Object Storage** (`fr-par`, les sauvegardes chiffrées), **GitHub Actions** (deux workflows : [`compte-deploy.yml`](../.github/workflows/compte-deploy.yml), à la main ; [`sauvegarde.yml`](../.github/workflows/sauvegarde.yml), chaque dimanche), **Coolify** (le site, comme aujourd'hui).

Conventions de ce guide : `<ref>` est l'identifiant du projet Supabase (20 lettres minuscules, dans l'adresse du tableau de bord : `supabase.com/dashboard/project/<ref>`) ; le site est `https://facturx.ibird.dev` ; le domaine d'envoi des e-mails est `facturx.ibird.dev` (voir 1.3 s'il faut en prendre un autre). Les commandes se lancent depuis la racine du dépôt.

**Le dépôt est public, et les journaux de ses Actions aussi.** Aucun secret ne s'écrit dans un fichier du dépôt, une issue, une commande partagée ou un journal. Les valeurs secrètes vont dans un gestionnaire de mots de passe, puis dans Supabase ou dans les secrets GitHub.

## Les secrets et réglages, en un coup d'œil

**Secrets des Edge Functions** (`supabase secrets set`, section 1.5). Les noms sont ceux que lit le code (`supabase/functions/_shared/erreurs.ts`, `relancer/brevo.ts`, `relancer/message.ts`, `purger/secret.ts`) ; `supabase/functions/.env.example` en donne les valeurs locales.

| Nom | Valeur en production | Sans lui |
|---|---|---|
| `FACTURX_ORIGINES` | `https://facturx.ibird.dev` : l'origine du site, sans barre finale (plusieurs, séparées par des virgules) | aucune origine admise : le navigateur bloque tout appel du Studio (CORS) |
| `BREVO_API_KEY` | la clé de l'API Brevo (`xkeysib-…`) ; **jamais `simule`**, refusé sur un projet hébergé | `relancer` échoue (500) |
| `RELANCES_EXPEDITEUR` | `relances@facturx.ibird.dev`, sur le domaine authentifié chez Brevo | `relancer` échoue (500) |
| `PURGE_SECRET` | 64 caractères aléatoires (`openssl rand -hex 32`), **la même valeur** que `purger_secret` dans le Vault | `purger` refuse tout (401) ; un secret de moins de 32 caractères, ou celui de `.env.example`, aussi |
| `FACTURX_TESTS` | **absent** : il laisserait un en-tête fixer « aujourd'hui » (la fonction l'ignore déjà sur `*.supabase.co`) | — |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `SUPABASE_DB_URL` sont fournis par Supabase à chaque fonction : ne pas les poser.

**Secrets du Vault** (la purge de nuit, migration `20261104000600_purge.sql`, section 1.8) : `purger_url` (`https://<ref>.supabase.co/functions/v1/purger`) et `purger_secret` (la valeur de `PURGE_SECRET`).

**Authentification** (tableau de bord, section 1.4) : SMTP `smtp-relay.brevo.com:587` ; Site URL `https://facturx.ibird.dev/studio/` ; Redirect URLs `https://facturx.ibird.dev/studio/` et `https://facturx.ibird.dev/en/studio/` (le Studio y renvoie, `site-src/studio/compte/index.ts`) ; e-mail confirmé obligatoire.

**Secrets GitHub** (Settings → Secrets and variables → Actions) :

| Workflow | Secrets |
|---|---|
| `compte-deploy.yml` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` ; `SUPABASE_SERVICE_ROLE_KEY` facultatif (sinon lue par le CLI) |
| `sauvegarde.yml` | `SAUVEGARDE_DB_URL`, `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `SCALEWAY_S3_BUCKET`, `SCALEWAY_S3_ACCESS_KEY_ID`, `SCALEWAY_S3_SECRET_ACCESS_KEY`, `AGE_RECIPIENT` |

**Le site** (Coolify, variables de construction) : `FACTURX_SUPABASE_URL` (`https://<ref>.supabase.co`) et `FACTURX_SUPABASE_KEY` (la clé **publique** ; une clé de service arrête la construction).

## 1. Mise en service, une fois, dans l'ordre

Chaque étape dit ce qu'on doit voir. Si ce n'est pas ce qu'on voit, s'arrêter là : les étapes suivantes en dépendent.

### 1.1 Les outils de la machine

- **CLI Supabase 3.0.0**, la version avec laquelle `config.toml` et les workflows ont été écrits (`supabase --version` doit répondre `3.0.0`). Sur la machine de développement, il a été installé hors Homebrew : `brew install supabase/tap/supabase` échouait (Command Line Tools trop anciens), l'archive `supabase_3.0.0_darwin_arm64.tar.gz` des releases du dépôt `supabase/cli` a été vérifiée contre l'empreinte de la formule puis copiée dans `/opt/homebrew/bin/supabase`. `brew upgrade` ne la met donc pas à jour.
- **age** et **AWS CLI** (les sauvegardes) : `brew install age awscli`. **Deno** (la confirmation de D74), **psql** (`postgresql@18`) et **jq** sont déjà sur la machine de développement.
- **Docker**, pour la pile locale (la restauration d'essai).
- **gh**, connecté au dépôt (`gh auth status`).

### 1.2 Le projet Supabase

1. Dans une organisation au **plan Pro** : *New project*, région **West EU (Paris)** (`eu-west-3`), un mot de passe de base généré, gardé dans le gestionnaire de mots de passe. Noter `<ref>`.
2. *Project Settings → Infrastructure* : la version de Postgres doit être **17** (celle de `config.toml`, `major_version = 17`, et de `PG_MAJEURE` dans `sauvegarde.yml`). Si le projet est créé dans une autre version majeure, changer les deux avant d'aller plus loin.
3. Un jeton d'accès personnel : *Account → Access Tokens → Generate new token*, nommé `facturx-deploiement`. Il ouvre **tous** les projets du compte : il ne va que dans le secret GitHub `SUPABASE_ACCESS_TOKEN` et le gestionnaire de mots de passe.
4. Sur la machine : `supabase login` (navigateur), puis `supabase link --project-ref <ref>` (le CLI demande le mot de passe de la base, ou le lit dans `SUPABASE_DB_PASSWORD`). Le CLI confirme le lien, que `supabase/.temp/` (non versionné) garde.

### 1.3 Brevo et le domaine d'envoi

Brevo envoie les e-mails de l'authentification (inscription, réinitialisation) par SMTP, et les relances par son API. Les deux partent du domaine d'envoi, authentifié par SPF, DKIM et DMARC **avant le premier envoi** (spec § 15).

1. Créer le compte sur brevo.com (palier gratuit : 300 e-mails par jour à l'inscription, à vérifier sur la grille du moment ; le plafond est commun aux e-mails de compte et aux relances).
2. *Senders, Domains & Dedicated IPs → Domains → Add a domain* : `facturx.ibird.dev`. Brevo affiche les enregistrements à poser (étape 1.3 bis) ; les copier **exactement**.
3. Une fois les enregistrements posés et propagés, *Authenticate this domain* : toutes les lignes doivent passer au vert.
4. *Senders → Add a sender* : `relances@facturx.ibird.dev` (nom : `facturx` ; chaque relance le remplace par « *Nom de l'entreprise* via facturx ») et l'adresse des e-mails de compte, par exemple `compte@facturx.ibird.dev` (nom : `facturx`). Sur un domaine authentifié, Brevo les admet ; s'il demande de valider une adresse par un code envoyé à celle-ci, il faut pouvoir lire cette boîte.
5. *SMTP & API → SMTP* : noter le serveur (`smtp-relay.brevo.com`, port `587`) et l'identifiant SMTP, puis *Generate a new SMTP key* : c'est le mot de passe SMTP de l'étape 1.4.
6. *SMTP & API → API Keys → Generate a new API key*, nommée `facturx-relances` : c'est `BREVO_API_KEY` (étape 1.5).

**Si `facturx.ibird.dev` est un CNAME** (vers l'hôte de Coolify, par exemple) : le DNS n'admet aucun autre enregistrement sous ce même nom, donc ni le TXT de SPF ni celui de Brevo. Prendre alors un autre domaine d'envoi (`ibird.dev` lui-même, ou un sous-domaine dédié comme `mail.facturx.ibird.dev`), et le reporter partout où ce guide écrit `facturx.ibird.dev` pour les e-mails (`RELANCES_EXPEDITEUR`, expéditeur SMTP, enregistrements). `dig +short CNAME facturx.ibird.dev` le dit : une réponse non vide est un CNAME.

### 1.3 bis Les enregistrements DNS

Chez l'hébergeur de la zone `ibird.dev`. Les valeurs exactes sont celles que Brevo affiche ; le tableau en donne la forme.

| Type | Nom | Valeur | Rôle |
|---|---|---|---|
| TXT | `facturx.ibird.dev` | `brevo-code:<code donné par Brevo>` | prouve à Brevo que le domaine est à vous |
| TXT | `facturx.ibird.dev` | `v=spf1 include:spf.brevo.com ~all` (celle de Brevo) | **SPF** : les serveurs de Brevo peuvent envoyer pour ce domaine. Un seul enregistrement SPF par nom : s'il en existe un, y ajouter l'`include` au lieu d'en créer un second |
| CNAME (ou TXT) | `brevo1._domainkey.facturx.ibird.dev`, `brevo2._domainkey.facturx.ibird.dev` (ou `mail._domainkey…`) | ceux de Brevo | **DKIM** : la signature des e-mails |
| TXT | `_dmarc.facturx.ibird.dev` | `v=DMARC1; p=none; rua=mailto:<une adresse que vous lisez>` | **DMARC** : la politique, et les rapports d'envoi |

Commencer DMARC à `p=none` ; après deux à quatre semaines de rapports propres (tout l'envoi légitime passe DKIM aligné), passer à `p=quarantine`.

Ce qu'on doit voir, une fois propagé :

```sh
dig +short TXT facturx.ibird.dev              # brevo-code:…  et  "v=spf1 include:spf.brevo.com ~all"
dig +short CNAME brevo1._domainkey.facturx.ibird.dev   # la cible donnée par Brevo
dig +short TXT _dmarc.facturx.ibird.dev       # "v=DMARC1; p=none; …"
```

### 1.4 L'authentification

Dans le tableau de bord du projet. **Ne jamais lancer `supabase config push`** avec ce dépôt : `config.toml` porte les réglages de la pile locale (adresses `localhost`, 2 e-mails par heure, Mailpit), qu'il écrirait sur la production.

1. *Authentication → URL Configuration* :
   - **Site URL** : `https://facturx.ibird.dev/studio/`
   - **Redirect URLs** : `https://facturx.ibird.dev/studio/` et `https://facturx.ibird.dev/en/studio/`

   C'est le pendant de `site_url` et `additional_redirect_urls` dans `config.toml`. Le Studio demande le retour sur `/studio/` ou `/en/studio/` de son origine : une adresse absente de la liste renverrait sur la Site URL, dans la mauvaise langue.
2. *Authentication → Emails → SMTP Settings* → *Enable custom SMTP* :
   - Sender email : `compte@facturx.ibird.dev` (l'adresse ajoutée chez Brevo) ; Sender name : `facturx`
   - Host : `smtp-relay.brevo.com` ; Port : `587`
   - Username : l'identifiant SMTP de Brevo ; Password : la clé SMTP de Brevo (étape 1.3, 5)
3. *Authentication → Sign In / Providers → Email* : **Confirm email** activé (`emettre`, `importer` et `relancer` refusent un compte non confirmé) ; **Secure email change** activé (`double_confirm_changes = true` en local).
4. *Authentication → Rate Limits* : la limite d'envoi d'e-mails par heure, que Supabase règle bas par défaut, sous le plafond quotidien de Brevo (300 par jour : 12 par heure tiennent dans la journée).
5. Facultatif : *Authentication → Emails → Templates*, les gabarits sont en anglais par défaut.

Ce qu'on doit voir : à l'étape 1.10, l'e-mail de confirmation arrive, de `compte@facturx.ibird.dev`, et ses en-têtes disent `spf=pass`, `dkim=pass` et `dmarc=pass` (Gmail : *Afficher l'original*).

### 1.5 Les secrets des fonctions

Dans un fichier **hors du dépôt**, lisible par vous seul, écrit avec un éditeur (pas par `echo` ni par un `cat <<EOF` : l'historique du shell garderait les valeurs), puis effacé :

```sh
openssl rand -hex 32 | pbcopy   # PURGE_SECRET, dans le presse-papiers : le coller d'abord dans le gestionnaire de mots de passe
umask 077 && nano ~/facturx-fonctions.env
```

Le fichier, quatre lignes :

```sh
FACTURX_ORIGINES=https://facturx.ibird.dev
BREVO_API_KEY=<la clé API de Brevo>
RELANCES_EXPEDITEUR=relances@facturx.ibird.dev
PURGE_SECRET=<la valeur tirée ci-dessus>
```

Puis :

```sh
supabase secrets set --env-file ~/facturx-fonctions.env
rm ~/facturx-fonctions.env
supabase secrets list
```

Ce qu'on doit voir : `supabase secrets list` donne les quatre noms (avec une empreinte, jamais la valeur), plus ceux que Supabase fournit (`SUPABASE_URL`…), et **pas** `FACTURX_TESTS`. S'il y est : `supabase secrets unset FACTURX_TESTS`. Le workflow de déploiement fait le même contrôle et s'arrête avant d'écrire quoi que ce soit.

### 1.6 Les secrets du déploiement

Les deux workflows ne se lancent que depuis la branche par défaut (`main`) : GitHub n'offre `workflow_dispatch` et ne planifie un workflow que s'il y est. Ils ne tournent pas dans une copie du dépôt (`if: github.repository == 'Geekles007/facturx'`), et le déploiement refuse en plus toute autre branche que `main` (`github.ref == 'refs/heads/main'`) : lancé depuis une autre, son job est sauté, sans rien déployer. Ses secrets ne sont donnés qu'aux étapes qui parlent au projet (lier, vérifier les secrets, migrer, déployer, déposer les polices, contrôler), jamais à l'installation des dépendances ni aux constructions.

```sh
gh secret set SUPABASE_ACCESS_TOKEN     # le jeton de 1.2 ; gh le demande sans l'afficher
gh secret set SUPABASE_DB_PASSWORD      # le mot de passe de la base
gh secret set SUPABASE_PROJECT_REF      # <ref>
```

`SUPABASE_SERVICE_ROLE_KEY` est facultatif : sans lui, le workflow lit la clé de service par `supabase projects api-keys` et la masque avant tout usage. Le poser seulement si cette lecture échoue (le journal le dit : « clé de service introuvable »).

### 1.7 Le premier déploiement

*Actions → Déploiement du compte → Run workflow* (branche `main`), ou `gh workflow run compte-deploy.yml --ref main` puis `gh run watch`. Il rejoue la suite de la section 2 et s'arrête à la première étape en échec.

Ce qu'on doit voir, étape par étape :

- **Secrets des fonctions** : rien, sinon le nom du secret absent ;
- **Migrations** : les huit migrations `20261104000100` à `20261104000900` appliquées (il n'y a pas de `000500`) ;
- **Edge Functions** : `Fonctions : emettre importer relancer supprimer-compte purger`, puis le déploiement de chacune ;
- **Polices du Studio** : `Polices TTF déposées dans le bucket « polices » : 14.` ;
- **Les fonctions répondent** : `emettre : 401 {"code":"SESSION"}` et `purger : 401 {"code":"SESSION"}`.

Le premier `db push` est la première application des migrations sur une base vide hors de la CI : en local, `supabase db reset` n'a pas pu être lancé pendant le développement ; c'est le job `compte` de `ci.yml` qui les applique à chaque fois depuis zéro (`supabase start`). Une erreur ici est à rapporter telle quelle.

### 1.8 Le Vault et la purge de nuit

La migration `20261104000600_purge.sql` a créé la tâche `pg_cron` `purger-chaque-nuit` (`17 3 * * *`, en UTC : 4 h 17 ou 5 h 17 à Paris). Elle lit l'adresse de la fonction et son secret dans le Vault, à chaque passage. Sans eux, elle échoue en le disant dans `cron.job_run_details`.

L'adresse de connexion : *Connect → Session pooler* (`postgresql://postgres.<ref>:<mot de passe>@<hôte du pooler>:5432/postgres`), à laquelle on ajoute `?sslmode=require`. C'est aussi `SAUVEGARDE_DB_URL` (1.12). Le secret passe par l'environnement, que psql lit (`\getenv`, psql 15 ou plus) : il n'apparaît ni dans les arguments d'une commande, que la liste des processus montre, ni dans l'éditeur SQL du tableau de bord, qui garde l'historique de ses requêtes. Le mot de passe de la base passe de même par `PGPASSWORD`, hors de l'adresse :

```sh
read -rs PGPASSWORD && export PGPASSWORD        # le mot de passe de la base ; rien ne s'affiche
read -rs PURGE_SECRET && export PURGE_SECRET    # la valeur de PURGE_SECRET (1.5)
psql 'postgresql://postgres.<ref>@<hôte du pooler>:5432/postgres?sslmode=require' -X -v ON_ERROR_STOP=1 <<'SQL'
\getenv secret PURGE_SECRET
select vault.create_secret('https://<ref>.supabase.co/functions/v1/purger', 'purger_url',
  'Adresse de la fonction purger (purge de nuit)');
select vault.create_secret(:'secret', 'purger_secret', 'Secret de la purge de nuit (= PURGE_SECRET)');
SQL
unset PGPASSWORD PURGE_SECRET
```

Pour changer plus tard le secret : de la même façon, `\getenv secret PURGE_SECRET` puis `select vault.update_secret((select id from vault.secrets where name = 'purger_secret'), :'secret');`, et `supabase secrets set PURGE_SECRET=…` avec la même valeur (par `--env-file`, comme en 1.5).

Ce qu'on doit voir, dans l'éditeur SQL (aucune de ces requêtes ne lit de secret) :

```sql
select name from vault.secrets where name in ('purger_url', 'purger_secret');   -- 2 lignes
select jobname, schedule, active from cron.job;                -- purger-chaque-nuit | 17 3 * * * | t
select has_table_privilege('postgres', 'storage.objects', 'SELECT');           -- t
```

La troisième vérifie le droit dont la purge dépend : elle lit `storage.objects` par sa connexion `postgres` (les PDF orphelins, les dossiers d'un compte supprimé). Puis lancer la tâche une fois sans attendre la nuit : copier sa commande (`select command from cron.job where jobname = 'purger-chaque-nuit';`), l'exécuter telle quelle dans l'éditeur, et lire la réponse quelques secondes plus tard :

```sql
select status_code, content::text from net._http_response order by created desc limit 1;
-- 200 | {"orphelins":0,"comptes":0}
```

Un 401 : `purger_secret` n'est pas `PURGE_SECRET`. Un 500 : les journaux de `purger` (*Edge Functions → purger → Logs*) disent quelle passe a échoué, sans donnée personnelle. Le lendemain : `select status, return_message from cron.job_run_details order by start_time desc limit 3;` doit dire `succeeded`.

### 1.9 Le site

Dans Coolify, l'application du site : deux **variables de construction** (cocher *Build Variable*), puis redéployer.

- `FACTURX_SUPABASE_URL` = `https://<ref>.supabase.co`
- `FACTURX_SUPABASE_KEY` = la clé publique du projet (*Project Settings → API Keys* : `anon`, ou `sb_publishable_…`)

`pnpm site:build` refuse une clé de service (`scripts/cle-supabase.mjs`) : le bundle du Studio est public. L'URL entre aussi dans la CSP de l'image (`connect-src`), à la construction.

Ce qu'on doit voir : sur `https://facturx.ibird.dev/studio/`, « Se connecter » et « Créer un compte gratuit » dans l'en-tête ; la console du navigateur ne signale aucune violation de CSP.

### 1.10 Vérifications après le premier déploiement

Avec un **compte d'essai** (une adresse que vous lisez, par exemple un alias `+essai`), pas votre compte réel : une facture émise ne se supprime pas, et ces essais en émettent. Le même compte sert à la confirmation de D74 (1.11) ; on le supprime ensuite.

1. **Inscription réelle** : *Créer un compte gratuit*, CGU acceptées. L'e-mail de confirmation arrive (en-têtes `spf=pass`, `dkim=pass`, `dmarc=pass`) ; le lien ramène sur `/studio/`, connecté.
2. **Émission** : renseigner l'entreprise (avec un SIREN : `relancer` l'exige), puis une facture dont l'acheteur a pour adresse de contact la vôtre, **datée d'il y a quelques jours (de cette année) et échue d'hier** (pour pouvoir la relancer tout de suite). *Émettre* : la facture prend son numéro, son PDF s'ouvre.
3. **Relance** : sur cette facture, *Relancer*, destinataire votre adresse, *Envoyer*. L'e-mail arrive de « *Nom de l'entreprise* via facturx » `<relances@facturx.ibird.dev>`, avec le PDF joint, et y répondre écrit à l'adresse du compte (`Reply-To`). Le Studio dit « envoyée ».
4. Les contrôles du déploiement déjà vus : migrations appliquées depuis la base vide (1.7) ; `deno.lock` en version 5 accepté au déploiement (l'étape *Edge Functions* a réussi ; sinon, voir la section 5) ; `postgres` lit `storage.objects` et la tâche `purger-chaque-nuit` est là (1.8).

### 1.11 Confirmer D74 sur le projet déployé

D74 (`docs/decisions.md`) a décidé, sur une mesure **locale**, que l'émission rend le PDF dans sa requête (tâche 8) plutôt qu'en différé (tâche 9). Elle est provisoire jusqu'à cette confirmation, **à faire avant d'ouvrir les comptes** : si elle échoue, la tâche 9 s'applique, et l'émission change.

Les outils sont dans `supabase/mesure-rendu/`, sous la licence AGPL de `supabase/`, comme le code des fonctions qu'ils importent ; le CI (job `compte`) en vérifie les types à chaque passage :

- `fonction/index.ts`, la fonction jetable `mesure-rendu` : celle de la mesure locale, plus le logo, le temps de démarrage du worker et d'import des modules (`modules_ms`), et les mêmes modules que `emettre`. Elle vit hors de `supabase/functions/` et n'est pas dans `config.toml` : rien ne la déploie par mégarde. Sa copie temporaire de l'étape 1, `supabase/functions/mesure-rendu/`, est ignorée par git ;
- `mesurer.ts`, qui l'appelle selon le protocole, garde chaque réponse brute dans un fichier JSONL, en fait le bilan selon la règle de D74, et mène aussi la rafale et l'essai mémoire contre les vraies fonctions.

**Le protocole** (celui de la mesure locale ; pas 20 rendus dans une requête, qui dépassent le budget par construction) :

- **froid, import compris** : trois requêtes d'un seul rendu, chacune sur un worker neuf (`requete: 1`, rang 0). Le chiffre retenu est `modules_ms` + le rendu : le démarrage du worker et l'import des modules comptent dans le budget de la requête qui le réveille. En local, sur une machine chargée (relecture de la tâche 8), l'import des modules a pris environ 277 ms de CPU et le premier rendu 577 ms, soit près de 850 ms, déjà près du seuil ;
- **chaud** : au moins 20 rendus de rang 1 ou plus, en lots de trois rendus au plus par requête ; p95 = la ⌈0,95·n⌉-ième valeur triée ;
- **« CPU time exceeded »** (un 546 `WORKER_LIMIT`) ne tranche que sur une requête d'un seul rendu : un lot refusé est réduit, jusqu'à un rendu, avant d'en tirer quoi que ce soit ;
- **configurations**, chacune avec son froid et ses 20 rendus à chaud, pour la facture de 50 lignes : Geist (126 et 128 Ko, la référence), Inter (342 Ko), puis les **cas extrêmes** : une police importée de près de 2 Mo, un logo PNG de 1 Mo (du bruit, presque incompressible), et un logo PNG de 4 000 × 4 000 pixels (77 Ko de fichier, 64 Mo de pixels à décoder : le poids d'un fichier ne borne pas le coût de son décodage). La facture de 2 lignes, pour mémoire ;
- **rafale** : cinq émissions simultanées d'une même entreprise par `emettre` (le verrou de numérotation les fait se suivre : CPU et mémoire de chacune, numéros consécutifs) ;
- **mémoire** : le corps de 10 Mio de la pire forme admise connue (celle de `supabase/functions/tests/decodage-large.ts`, aux quatre limites du pré-examen), envoyé à `importer` et à `emettre`. En local, il a pris environ 290 Mio de mémoire résidente, dont 96 de bibliothèques, pour un tas plafonné à 256 Mo : si la limite hébergée de 256 Mo porte sur la mémoire résidente, il échouera.

**La règle** (D74) : la tâche 9 s'applique si, pour la facture de 50 lignes, dans l'une des configurations, le p95 à chaud dépasse 1 s, ou un rendu seul sur un worker neuf, import des modules compris, atteint 1 s, ou une requête d'un seul rendu est coupée (« CPU time exceeded »). **Si seuls les cas extrêmes échouent** (police de 2 Mo, logos), une autre réponse est possible : plafonner le poids des polices et logos, ou les dimensions des images, plutôt que de passer à la tâche 9. C'est une décision de produit, à prendre au vu des chiffres ; `mesurer.ts bilan` la signale sans la trancher. Un échec de la rafale ou de l'essai mémoire se lit de même : mémoire dépassée à l'essai mémoire → baisser le plafond du corps (`PLAFOND_CORPS`, `supabase/functions/_shared/corps.ts`) ; rafale refusée → lire les journaux de `emettre` avant de conclure.

Un essai natif sur la machine de développement (Deno 2.9, hors du runtime des fonctions, qui y était environ deux fois plus lent), 50 lignes, rendus à chaud : Geist ≈ 110 ms, Inter ≈ 230 ms, logo de bruit ≈ 220 ms, logo de 4 000 × 4 000 ≈ 900 ms et plus de 500 Mo de mémoire résidente. Le grand logo dépassera donc très probablement le budget et la mémoire en ligne ; c'est ce que la mesure doit établir.

**Les étapes**

1. Préparer, depuis la racine du dépôt, le projet lié (1.2, 4) :

   ```sh
   pnpm build && pnpm site:build && pnpm compte:preparer
   mkdir -p supabase/functions/mesure-rendu
   cp supabase/mesure-rendu/fonction/index.ts supabase/functions/mesure-rendu/index.ts
   supabase functions deploy mesure-rendu --import-map supabase/functions/deno.json --yes
   ```

   Le CLI confirme le déploiement de `mesure-rendu`. Elle garde la vérification du jeton par la passerelle, mais la clé publique du projet en est un : quiconque la lit dans le site peut l'appeler et dépenser du calcul. Ne pas la laisser déployée au-delà de la mesure (étape 8).

2. L'environnement de `mesurer.ts`, et les fichiers d'essai, hors du dépôt (une fonction `m` abrège la commande, en bash comme en zsh) :

   ```sh
   export MESURE_URL=https://<ref>.supabase.co
   export MESURE_CLE_PUBLIQUE=<la clé publique du projet>
   export MESURE_EMAIL=<l'adresse du compte d'essai>
   read -rs MESURE_MOT_DE_PASSE && export MESURE_MOT_DE_PASSE
   m() { deno run -A --no-lock --config supabase/functions/deno.json supabase/mesure-rendu/mesurer.ts "$@"; }
   D=$HOME/facturx-d74 && mkdir -p $D
   m logo $D/logo-1mo.png
   m logo $D/logo-grand.png --grand
   ```

   Ce qu'on doit voir : `…/logo-1mo.png : 1041293 octets, 510 × 510 RVBA` (à quelques octets près : c'est du bruit) et `…/logo-grand.png : <environ 77 000> octets, 4000 × 4000 RVBA`. Il faut aussi une police TTF statique (non variable) de 1,8 à 2 Mo, 2 097 152 octets au plus (`wc -c`), que le Studio accepterait : la copier en `$D/police-2mo.ttf`.

3. Les rendus, configuration par configuration (chacune prend quelques minutes ; chaque ligne affichée est une requête) :

   ```sh
   P=site/studio/polices && R=$D/releves.jsonl
   m rendu --config geist --regular $P/geist-regular.ttf --gras $P/geist-semibold.ttf --sortie $R
   m rendu --config inter --regular $P/inter-regular.ttf --gras $P/inter-semibold.ttf --sortie $R
   m rendu --config police-2mo --extreme --regular $D/police-2mo.ttf --gras $D/police-2mo.ttf --sortie $R
   m rendu --config logo-1mo --extreme --regular $P/geist-regular.ttf --gras $P/geist-semibold.ttf --logo $D/logo-1mo.png --sortie $R
   m rendu --config logo-grand --extreme --regular $P/geist-regular.ttf --gras $P/geist-semibold.ttf --logo $D/logo-grand.png --sortie $R
   m rendu --config geist --lignes 2 --regular $P/geist-regular.ttf --gras $P/geist-semibold.ttf --sortie $R
   ```

   La règle ne lit que la facture de 50 lignes ; D74 demande aussi celle de 2 lignes, pour mémoire : chaque commande relancée avec `--lignes 2`, comme la dernière ligne le fait pour Geist.

   Un worker se retire de lui-même après environ 1 s de CPU (mesure locale) : les workers neufs viennent en général seuls. Si une configuration finit par « froid : 1 worker(s) neuf(s) sur 3 ; relancer avec --redeployer », la relancer avec `--redeployer` : chaque essai à froid redéploie alors la fonction, ce qui garantit un worker neuf. Les relevés s'ajoutent au même fichier.

4. Le bilan : `m bilan $R`. Pour chaque configuration : le chaud (n, médiane, p95, max), les trois froids import compris, les refus, puis `→ tenu`, `→ incomplet` ou `→ règle de D74 dépassée` ; enfin une ligne `BILAN :` qui dit, selon la règle, « D74 confirmée », « seul le cas extrême dépasse » ou « la tâche 9 s'applique ».
5. Les journaux : *Edge Functions → mesure-rendu → Logs* (et *Invocations*). Relever le démarrage des workers (boot) et tout message `CPU time exceeded`, `Memory limit exceeded`, `WorkerAlreadyRetired`. Si `bilan` signale un `modules_ms` incohérent (plus de 10 s : l'horloge du worker ne part pas de sa naissance), le froid se lit dans ces journaux.
6. La rafale, puis la même avec les fichiers extrêmes (déposés dans `fichiers` sous le compte d'essai) :

   ```sh
   m rafale
   m rafale --police $D/police-2mo.ttf --logo $D/logo-1mo.png
   ```

   Ce qu'on doit voir : cinq `HTTP 201`, puis `RAFALE : tenue — numéros …, consécutifs et sans doublon.` Chaque rafale émet cinq factures sur le compte d'essai. **Après chaque rafale**, lire les journaux d'`emettre` (*Edge Functions → emettre → Logs*), comme à l'étape 5 : aucun `CPU time exceeded`, `Memory limit exceeded` ni 546, même quand les cinq réponses sont des 201 (un worker coupé après sa réponse ne se voit que là).
7. L'essai mémoire : `m memoire`. Ce qu'on doit voir : `importer : HTTP 422 ANOMALIES`, `emettre : HTTP 422 ANOMALIES`, puis `MÉMOIRE : tenue`. Rien n'est importé ni émis (les deux corps sont refusés après avoir été lus jusqu'au bout).
8. Ranger :

   ```sh
   supabase functions delete mesure-rendu --yes
   rm -r supabase/functions/mesure-rendu
   ```

   Puis, dans le Studio, supprimer le compte d'essai (*Entreprise → Supprimer le compte*) : la purge l'efface avec ses factures au bout de 30 jours.
9. Consigner le résultat dans D74 (`docs/decisions.md`) : les chiffres du bilan par configuration, la rafale, la mémoire, les journaux. Si elle est confirmée, retirer « provisoire » du titre ; sinon, écrire la décision prise (tâche 9, ou un plafond sur les cas extrêmes).

### 1.12 Les sauvegardes

En plus des sauvegardes quotidiennes du plan Pro (*Database → Backups*, sur le même hébergeur), une archive chiffrée chaque semaine chez un autre hébergeur européen (spec § 11). Ce que fait `scripts/sauvegarde.sh` est à la section 3.

1. **Scaleway** : dans un projet dédié (par exemple `facturx-sauvegardes`), *Object Storage → Create bucket* : région **Paris** (`fr-par`), visibilité **privée**, un nom unique, par exemple `facturx-sauvegardes-<suffixe>`. Puis *IAM → Applications* : une application `facturx-sauvegarde`, une politique qui lui donne `ObjectStorageFullAccess` sur ce seul projet, et une clé d'API pour elle (*Generate API key*, projet Object Storage préféré : celui du bucket). La clé d'accès (`SCW…`) et la clé secrète vont dans les secrets GitHub et le gestionnaire de mots de passe : il faut aussi les avoir pour restaurer.

   **Cette clé peut effacer les sauvegardes** : la rétention (section 3) les efface avec elle. Quiconque la vole (une fuite des secrets GitHub, un workflow modifié) peut donc vider le bucket. Pour s'en garder sans rien changer au script, activer à la création du bucket le **versionnement**, ou mieux le **verrouillage d'objets** (*Object Lock*, qui suppose le versionnement et ne s'active qu'à la création) : un effacement n'y pose qu'un marqueur, et la version effacée reste récupérable (en mode *compliance*, personne ne peut l'effacer avant la fin de sa durée de rétention, par exemple 12 semaines). Le prix : les versions effacées occupent de la place jusqu'à ce qu'une règle de cycle de vie les expire ; vérifier dans la documentation de Scaleway la règle qui expire les versions non courantes, et la poser (par exemple à 30 jours), sans quoi la facture de stockage grossit chaque semaine.
2. **La paire de clés age**, sur votre machine :

   ```sh
   mkdir -p ~/.config/facturx && age-keygen -o ~/.config/facturx/sauvegarde.key
   ```

   La commande affiche `Public key: age1…` : c'est `AGE_RECIPIENT`. **La clé privée** (le fichier `sauvegarde.key`, qui commence par `AGE-SECRET-KEY-`) ne va ni dans le dépôt, ni dans GitHub, ni chez Scaleway : dans le gestionnaire de mots de passe, plus une copie hors ligne. Sans elle, aucune archive ne se relit. `AGE_RECIPIENT` admet plusieurs clés publiques, séparées par des espaces (une seconde clé gardée ailleurs, par exemple) ; le script refuse une clé privée collée là par erreur.
3. **Les clés S3 de Supabase** : *Project Settings → Storage → S3 Connection* : noter l'**Endpoint** (`https://<ref>.storage.supabase.co/storage/v1/s3`) et la **Region** (`eu-west-3`), puis *New access key* : l'identifiant et le secret (affiché une seule fois). Ces clés lisent et écrivent tous les buckets, comme la clé de service.
4. **L'adresse de la base** : celle de 1.8 (*Session pooler*, avec `?sslmode=require`). Les machines de GitHub Actions n'ont pas d'IPv6, et la connexion directe d'un projet Supabase n'est joignable qu'en IPv6 (sans l'option IPv4 payante) : le pooler en mode session, lui, l'est en IPv4 et admet `pg_dump`.
5. **Les secrets GitHub** :

   ```sh
   gh secret set SAUVEGARDE_DB_URL
   gh secret set SUPABASE_S3_ENDPOINT
   gh secret set SUPABASE_S3_REGION
   gh secret set SUPABASE_S3_ACCESS_KEY_ID
   gh secret set SUPABASE_S3_SECRET_ACCESS_KEY
   gh secret set SCALEWAY_S3_BUCKET
   gh secret set SCALEWAY_S3_ACCESS_KEY_ID
   gh secret set SCALEWAY_S3_SECRET_ACCESS_KEY
   gh secret set AGE_RECIPIENT
   ```

6. **Le premier passage, à la main** : *Actions → Sauvegarde → Run workflow* (ou `gh workflow run sauvegarde.yml --ref main`). Ce qu'on doit voir dans le journal : `sauvegarde : base (pg_dump (PostgreSQL) 17.…)` ; un avertissement de `pg_dump` sur des « contraintes de clés étrangères circulaires » de `factures` (un avoir cite sa facture : attendu, la restauration suspend ces contrôles) ; `sauvegarde : bucket factures`, `bucket fichiers` ; `sauvegarde : facturx/facturx-<date>.tar.age (<n> octets) déposée et vérifiée` ; `rétention de 84 jours, 0 archive(s) antérieure(s) … effacée(s)`. Chez Scaleway, l'objet est dans `facturx/`.
7. **La restauration d'essai**, une fois au moins avant l'ouverture (spec § 11) : section 4, dans la pile locale. On doit y retrouver la facture émise en 1.10 et son PDF.

### 1.13 Avant d'ouvrir les comptes au public

- D74 confirmée, ou la décision qui la remplace prise et faite (1.11).
- La restauration d'essai réussie (1.12, 7).
- Les blocs « À compléter par l'éditeur » des pages légales remplis : `site/cgu/`, `site/confidentialite/`, `site/sous-traitance/` et leurs versions `site/en/…` (nom ou raison sociale, adresse, SIREN, contact, directeur de la publication, date d'entrée en vigueur de la version `2026-11`).
- **Une relecture de ces textes par un juriste.**
- Le compte d'essai supprimé (1.11, 8).

## 2. Déployer une nouvelle version

Après la fusion dans `main` : *Actions → Déploiement du compte → Run workflow*. La suite, que le workflow rejoue dans cet ordre :

```sh
pnpm build && pnpm site:build && pnpm compte:preparer
supabase db push --remote
supabase functions deploy emettre importer relancer supprimer-compte purger
pnpm compte:polices
```

- `pnpm build` construit le SDK, `pnpm site:build` les polices du Studio (`site/studio/polices/`), `pnpm compte:preparer` copie le SDK et les modules partagés dans `supabase/functions/_vendor/`.
- **`supabase db push --remote`** : avec le CLI 3, `db push` sans `--remote` vise la base **locale**. Le workflow ajoute `--yes`, qui confirme sans question une modification du projet hébergé.
- Les fonctions déployées sont celles que `config.toml` déclare (`[functions.<nom>]`, avec `verify_jwt = false` et l'import map) : une nouvelle fonction y a son entrée, sans quoi le workflow ne la déploie pas.
- `pnpm compte:polices` lit `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` ; il remplace les polices du bucket `polices`.

À la main, depuis un poste lié au projet (1.2), la même suite : `supabase functions deploy` vise le projet lié ; `pnpm compte:polices` demande `SUPABASE_URL=https://<ref>.supabase.co` et la clé de service dans l'environnement (`read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY`).

Le site se redéploie par Coolify, comme avant. Une version qui change le Studio et le serveur à la fois : le serveur d'abord, puis le site.

## 3. Les sauvegardes

`sauvegarde.yml` lance `scripts/sauvegarde.sh` chaque dimanche à 2 h 23 UTC (`23 2 * * 0`), et à la main.

1. **La base** : `pg_dump --data-only` du schéma `public` entier et, dans `auth`, des seules tables `users` et `identities` (les comptes et leurs mots de passe hachés). Le schéma se reconstruit par les migrations, les sessions se rouvrent, et les secrets du Vault ne se déchiffrent que dans leur projet. Le `pg_dump` est celui de la version majeure du serveur (`PG_MAJEURE`), pris au dépôt apt de PostgreSQL.
2. **Les buckets privés** `factures` et `fichiers`, par l'API S3 de Supabase Storage ; tout objet listé doit être arrivé. Le bucket public `polices` se redépose par `pnpm compte:polices`.
3. **Une archive `tar`** (`manifeste.txt`, `donnees.sql`, `stockage/`), chiffrée par `age -r $AGE_RECIPIENT`. Le manifeste dit la date, les versions, les migrations appliquées, le nombre de lignes de chaque table et d'objets de chaque bucket : la restauration s'y compare. Le clair ne vit que dans un dossier temporaire privé, effacé dès l'archive chiffrée.
4. **Le dépôt chez Scaleway** (`fr-par`), sous `facturx/facturx-<date UTC>.tar.age`, vérifié par sa taille ; puis la **rétention** : les archives `facturx/*.tar.age` de plus de 12 semaines (84 jours) sont effacées, et seulement après le dépôt réussi d'une nouvelle. Une semaine en échec n'efface donc rien. La clé qui efface ainsi pourrait tout effacer : d'où le versionnement ou le verrouillage d'objets recommandés en 1.12.

Le script échoue à la première étape qui échoue. Il n'écrit dans le journal, public, ni secret, ni nombre de comptes ou de factures, ni nom de fichier.

**Surveiller.** GitHub envoie un courriel quand un passage planifié échoue (à la personne qui a modifié en dernier la ligne `cron`). Dans un dépôt public, il **suspend un workflow planifié après 60 jours sans activité** sur le dépôt, et l'annonce par courriel : *Actions → Sauvegarde → Enable workflow* le rétablit. Une fois par mois, regarder la liste des archives chez Scaleway (une par semaine, douze au plus).

**Essayer le script en local**, contre la pile locale : `scripts/sauvegarde.sh --dossier <dossier>` écrit l'archive, chiffrée de même, dans ce dossier au lieu de Scaleway (les variables `SCALEWAY_S3_*` ne sont alors pas demandées). L'adresse de la base et les clés S3 sont celles de `supabase status -o env` (`DB_URL`, `STORAGE_S3_URL`, `S3_PROTOCOL_REGION`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET`).

## 4. Restaurer une sauvegarde

`scripts/restaurer.sh` restaure une archive dans une base dont les migrations viennent d'être rejouées, et **vide** : la pile locale après `supabase db reset`, ou un projet neuf après `supabase db push --remote`. Il refuse une cible qui a déjà un compte, une entreprise ou un fichier, ou à laquelle manque une migration de la sauvegarde, sans rien y écrire.

**Pourquoi un script plutôt que `psql < dump`.** Une restauration logique rejoue les déclencheurs, qui refusent alors des lignes valides : un paiement saisi avant l'avoir qui solde sa facture dépasse, relu après lui, le reste dû (`PAIEMENT_EXCESSIF`) ; une ligne antérieure à un déclencheur plus récent est refusée par lui (l'essai local l'a montré avec `AVOIR_DEVISE`) ; et le déclencheur de l'inscription créerait une seconde entreprise pour chaque compte restauré. Les données viennent d'un même instantané : elles sont déjà cohérentes. Le script les rejoue donc en une transaction, déclencheurs suspendus (`set session_replication_role = replica`, que Supabase permet au rôle `postgres` ; `pg_restore --disable-triggers` désactive les déclencheurs table par table, ce qui demande d'en être propriétaire, et celles d'`auth` ne sont pas à `postgres`). Puis il renvoie les fichiers avec leur type : le bucket `fichiers` n'admet que PNG, JPEG et TTF, reconnus à leurs premiers octets. Enfin il recompte lignes et objets contre le manifeste.

**Dans la pile locale** (la restauration d'essai de 1.12) :

1. Récupérer l'archive, avec la clé Scaleway (1.12, 1), hors du dépôt :

   ```sh
   read -r AWS_ACCESS_KEY_ID && read -rs AWS_SECRET_ACCESS_KEY && export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
   export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
   scw() { aws --endpoint-url https://s3.fr-par.scw.cloud --region fr-par "$@"; }
   scw s3 ls s3://<bucket>/facturx/
   mkdir -p ~/facturx-restauration
   scw s3 cp s3://<bucket>/facturx/facturx-<date>.tar.age ~/facturx-restauration/
   unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
   ```

2. Vider la pile locale et rejouer les migrations. **Local seulement : jamais `--remote`**, qui viderait la production.

   ```sh
   supabase start            # si elle ne tourne pas
   supabase db reset
   ```

3. Restaurer :

   ```sh
   bash scripts/restaurer.sh ~/facturx-restauration/facturx-<date>.tar.age \
     --cle ~/.config/facturx/sauvegarde.key --pile-locale
   ```

   Ce qu'on doit voir : `restauration : déchiffrement`, les quatre premières lignes du manifeste (date, versions), `restauration : base`, `restauration : buckets`, puis `restauration : terminée, conforme au manifeste (11 tables, buckets factures et fichiers)`. Un écart avec le manifeste est dit table par table, et le script sort en erreur. Une erreur de `psql` sur `auth.users` ou `auth.identities` (colonne inconnue) veut dire que le serveur d'authentification de la pile locale n'est pas de la même version que celui du projet : rien n'a été écrit (une seule transaction) ; mettre le CLI à jour, ou restaurer dans un projet neuf.

4. Vérifier, dans le Studio de la pile locale (`http://127.0.0.1:55423`) : *Table Editor → factures*, la facture de production (son numéro) ; *Storage → factures → <id de l'entreprise>*, son PDF, qui s'ouvre. Les comptes restaurés se connectent avec leur mot de passe de production (sur un Studio construit contre la pile locale).

5. **Effacer ensuite ces données de production de la machine** : `supabase db reset` (les lignes), puis `supabase stop --no-backup` (les volumes, donc les fichiers des buckets), et `rm -r ~/facturx-restauration`.

**Dans un projet neuf** (perte du projet) : créer le projet (1.2), `supabase link --project-ref <nouveau ref>`, `supabase db push --remote` ; puis `scripts/restaurer.sh <archive> --cle <clé>` sans `--pile-locale`, avec la cible dans `RESTAURATION_DB_URL` (le pooler en mode session du nouveau projet), `RESTAURATION_S3_ENDPOINT`, `RESTAURATION_S3_REGION`, `RESTAURATION_S3_ACCESS_KEY_ID` et `RESTAURATION_S3_SECRET_ACCESS_KEY` (ses clés S3). Ensuite, la mise en service à partir de 1.4 : authentification, secrets des fonctions, déploiement (qui redépose les polices), Vault, site.

## 5. Nuances

- **Les URL signées de 60 secondes ne sont pas une garantie.** Le Studio demande des URL valables 60 s, mais un membre lit les objets de son entreprise dans le bucket `factures` et peut signer lui-même une URL pour la durée qu'il veut, par l'API Storage : la base n'impose pas la durée (`supabase/migrations/20261104000400_stockage.sql`).
- **Les erreurs de la plateforme n'ont pas d'en-têtes CORS.** Un 546 (`WORKER_LIMIT`, budget de CPU ou de mémoire dépassé) ou une erreur `WorkerAlreadyRetired` viennent du runtime, pas de la fonction : sans `Access-Control-Allow-Origin`, le navigateur les présente au Studio comme une erreur réseau. Leur cause se lit dans les journaux de la fonction.
- **Le CLI Supabase** de la machine de développement est la version 3.0.0, installée hors Homebrew (1.1) ; les workflows épinglent la même. Avec le CLI 3, `db push`, `db reset` et `migration list` visent la base locale sans `--remote`, et une modification du projet hébergé sans question demande `--yes` (ou `SUPABASE_YES=1` exporté dans le shell).
- **`deno.lock` est en version 5** (Deno 2.9), alors que le runtime des fonctions se dit compatible Deno 2.1. `supabase functions serve` l'accepte ; le premier déploiement dira si le regroupement des fonctions l'accepte aussi. S'il le refuse : réessayer avec `supabase functions deploy … --use-api` (regroupement par Supabase) ; à défaut, écarter `deno.lock` le temps du déploiement (les versions de `deno.json` restent exactes, seule la vérification d'intégrité des paquets npm manque alors), et le consigner.
- **Le plafond de Brevo est commun.** Les e-mails de compte et les relances partagent le plafond quotidien de Brevo ; `relancer` en permet 20 par jour et par compte. Une poignée de comptes actifs suffit à l'atteindre : passer à un palier payant avant.
- **Un worker sert plusieurs requêtes** sur le service hébergé : la rafale (1.11) le mesure ; en local, `config.toml` règle le runtime en `oneshot` (un worker par requête), sans effet sur le service hébergé.
- **Le jeton `SUPABASE_ACCESS_TOKEN` ouvre tous les projets du compte Supabase**, pas seulement celui-ci : le révoquer (*Account → Access Tokens*) dès qu'il n'est plus utile ou s'il a pu fuir, et en générer un autre.

## Annexe : la mesure locale de D74 (tâche 2, 6 novembre 2026)

Les chiffres sont dans D74. Voici les sorties brutes auxquelles elle renvoie. La fonction de mesure de la tâche 2 chronométrait le même rendu que `supabase/mesure-rendu/fonction/index.ts`, qui la reprend (avec, en plus, le logo, `modules_ms` et les modules de `emettre`) ; elle était servie par `supabase functions serve` (CLI 3.0.0, edge runtime 1.77.9, Docker sur un Mac), avec les polices Geist en base64 dans le corps.

Les deux essais préliminaires, avant la forme finale de la fonction (seuls `premier` et les statistiques existaient). Le tout premier appel après la création du conteneur, un rendu de 50 lignes :

```
{"requete":1,"decodage_polices_ms":56.4,"total_ms":708.6,"memoire":{"rss":0,"heapTotal":32313344,"heapUsed":28125504,"external":5780313},"lignes_50":{"n":1,"min":613.8,"mediane":613.8,"p95":613.8,"max":613.8,"brut":[613.8],"premier":613.8,"pdf_octets":149255,"pages":3}}
{"client_time_total_s":1.604861,"http_code":200}
```

La requête suivante (20 rendus de chaque taille) a été coupée par le runtime : `{"code":"WORKER_LIMIT",…}`, HTTP 546, après 3,07 s ; limite douce de CPU franchie à +1,02 s, limite dure à +3,04 s. Le worker neuf qui l'a suivie, trois rendus de 50 lignes :

```
{"requete":1,"decodage_polices_ms":28.4,"total_ms":957.9,"memoire":{"rss":0,"heapTotal":36507648,"heapUsed":33304520,"external":6666088},"lignes_50":{"n":3,"min":184.2,"mediane":234.3,"p95":500.7,"max":500.7,"brut":[500.7,234.3,184.2],"premier":500.7,"pdf_octets":149255,"pages":3}}
{"client_time_total_s":1.245040,"http_code":200}
```

Les séries. Froid, un rendu sur un worker neuf, trois fois par taille (ms ; durée vue du client) : 50 lignes 396,0 (0,72 s), 400,2 (0,70 s), 395,0 (0,69 s) ; 2 lignes 314,5 (0,63 s), 353,3 (0,65 s), 287,2 (0,56 s). À chaud, dix requêtes de trois rendus par taille ; `rang` est le rang du premier rendu du lot dans la vie de son worker :

```
50 lignes                                          2 lignes
requete=2 rang=1 brut=[280.7,184.6,274.6]          requete=1 rang=0 brut=[303.3,133.8,127.7]
requete=1 rang=0 brut=[398.4,280.3,190.6]          requete=2 rang=3 brut=[136.2,122.7,113.4]
requete=1 rang=0 brut=[408.7,244.9,207.7]          requete=1 rang=0 brut=[267.9,142.1,138.4]
requete=2 rang=3 brut=[255.4,182.7,241.6]          requete=2 rang=3 brut=[212,133.8,112.4]
requete=1 rang=0 brut=[352.7,197.1,177.6]          requete=1 rang=0 brut=[400.6,138.1,131.6]
requete=2 rang=3 brut=[211.6,175.7,164.4]          requete=2 rang=3 brut=[146.5,139.4,116.5]
requete=1 rang=0 brut=[371,210.9,182.6]            requete=1 rang=0 brut=[320.8,134.3,137.2]
requete=2 rang=3 brut=[217.2,230.8,180.1]          requete=2 rang=3 brut=[170.2,162.5,143]
requete=1 rang=0 brut=[366,198.2,180.6]            requete=1 rang=0 brut=[303.1,138.4,128.9]
requete=2 rang=3 brut=[230.2,181.5,185.8]          requete=2 rang=3 brut=[141.5,127.9,112.2]
```

Agrégés (rendus de rang 1 ou plus, les 20 premiers) : 50 lignes, médiane 209,3 ms, p95 280,3 ms, max 280,7 ms ; 2 lignes, médiane 136,7 ms, p95 170,2 ms, max 212,0 ms. Les 30 rendus de la série de 50 lignes, froids compris : p95 398,4 ms. Décodage des polices, hors chronomètre : de 16,5 à 45,0 ms sur les 26 requêtes des séries ; `heapUsed` de 22,8 à 34,5 Mo (`rss` vaut 0 dans ce runtime).
