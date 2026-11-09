# Les e-mails de facturx — design

*9 novembre 2026. Conception validée en conversation : le périmètre (les e-mails du compte et la relance) et l'habillage de la relance (« l'entreprise d'abord »).*

## 1. Contexte

facturx envoie deux sortes d'e-mails, tous par Brevo (D73, docs/compte.md § 1.3) :

- **Les e-mails du compte**, envoyés par Supabase Auth depuis `compte@ibird.dev`. Ce sont aujourd'hui les modèles par défaut de Supabase : en anglais, sans mise en forme (« Confirm your signup / Follow this link to confirm your user »). Le Studio en déclenche trois : la confirmation d'inscription (`signUp`, et son renvoi par `resend`), la réinitialisation du mot de passe (`resetPasswordForEmail`) et le changement d'adresse (`updateUser({ email })`, envoyé à l'ancienne et à la nouvelle adresse, `double_confirm_changes`).
- **La relance**, envoyée par la fonction `relancer` depuis `relances@ibird.dev`, au nom de « *Entreprise* via facturx » (spec du 3 novembre, § 9). Son HTML est le texte relu par l'utilisateur, échappé, en paragraphes, dans un `<body>` en Arial (`supabase/functions/relancer/message.ts`, `gabarit`).

Un e-mail en anglais et sans forme, venu d'un service que la personne découvre, ressemble à du hameçonnage ; une relance sans cadre fait brouillon chez le client qui la reçoit.

## 2. Objectif

Des e-mails reconnaissables et soignés, dans la langue de la personne, versionnés dans le dépôt et déployés sans copier-coller :

- les e-mails du compte aux couleurs de facturx, en français ou en anglais ;
- la relance habillée au nom de l'entreprise, avec ce que le client doit savoir de la facture en un coup d'œil.

## 3. Périmètre

**Dans ce chantier**

- Cinq modèles de Supabase Auth : confirmation d'inscription, réinitialisation du mot de passe, changement d'adresse, lien de connexion (*magic link*) et code de réauthentification. Le Studio ne déclenche pas les deux derniers, mais l'API publique le permet (`signInWithOtp`, `reauthenticate`) : la personne qui les recevrait doit reconnaître facturx.
- La langue de ces e-mails, enregistrée dans les métadonnées du compte.
- L'habillage de la relance, son encadré et sa version texte.
- Une source unique pour le cadre, des modèles générés, leur déploiement par le workflow `compte-deploy.yml`.
- Le guide (`docs/compte.md`), la décision D76, la politique de confidentialité.

**Hors de ce chantier**

- Le modèle d'invitation : facturx n'invite personne (seul un administrateur le pourrait). Il reste celui de Supabase.
- Les notifications de sécurité de Supabase (mot de passe modifié, adresse modifiée…) : elles ne sont pas activées, et les activer est une autre décision.
- Les modèles hébergés chez Brevo, le suivi d'ouverture, les images et le logo en image, les polices web.
- Le contenu des relances (les textes des trois niveaux) : il ne change pas.

## 4. Le cadre commun

Le style du site (`site/style.css`), adapté à ce que les messageries affichent :

- **Couleurs.** Fond `#fafafa` ; carte `#ffffff`, bordure `#e5e5e5`, coins de 12 px ; texte `#0a0a0a`, texte secondaire `#555555`, mentions `#6b6b6b` ; bouton `#0a0a0a`, texte blanc. Chaque couple texte et fond atteint au moins 4,5:1.
- **Texte.** La pile système (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`) : Geist n'est pas chargée. Corps à 15 px, interligne 1,6 ; titre (`<h1>`) à 20 px.
- **Mise en page.** Des tableaux (`role="presentation"`) et des styles en ligne, 560 px de large au plus, sans `flex` ni `grid` : c'est ce qu'affichent Gmail et Outlook (dont la version de bureau, qui rend par le moteur de Word). Le bouton est un lien dans une cellule colorée ; Outlook de bureau en carre les coins, ce qui est admis.
- **Sous le bouton**, le même lien écrit en clair, pour la messagerie qui n'affiche pas le bouton. Les e-mails du compte ont en tête le mot « facturx », en texte, et en pied « facturx · facturx.ibird.dev » ; la relance a les siens (§ 6.1).
- **Un préheader** : une phrase cachée, que la messagerie montre dans la liste après l'objet.
- **Aucune ressource distante** : ni image, ni police, ni feuille de style. Rien ne se charge à l'ouverture, donc rien qui ressemble à un pixel de suivi, et rien ne manque quand la messagerie bloque les images.
- **Le mode sombre.** `<meta name="color-scheme" content="light dark">` et une règle `@media (prefers-color-scheme: dark)` dans le `<style>` de l'en-tête, pour les messageries qui l'appliquent (Apple Mail, iOS) ; les autres inversent les couleurs elles-mêmes, ou gardent le clair.
- `lang="fr"` ou `lang="en"` sur `<html>`. Chaque e-mail pèse moins de 30 Kio (Gmail coupe au-delà de 102 Kio).

## 5. Les e-mails du compte

### 5.1 Les modèles

Le lien de chaque e-mail reste `{{ .ConfirmationURL }}` : le mécanisme de Supabase (vérification, puis retour sur `/studio/` ou `/en/studio/`) ne change pas. Aucun texte ne donne de durée de validité : une durée écrite pourrait diverger du réglage du projet.

| Modèle Supabase | Déclenché par | Objet (fr / en) | Bouton (fr / en) |
|---|---|---|---|
| `confirmation` | `signUp`, `resend` | Confirmez votre adresse e-mail / Confirm your email address | Confirmer mon adresse / Confirm my address |
| `recovery` | `resetPasswordForEmail` | Réinitialisez votre mot de passe / Reset your password | Choisir un nouveau mot de passe / Choose a new password |
| `email_change` | `updateUser({ email })` | Confirmez le changement d'adresse / Confirm your email change | Confirmer le changement / Confirm the change |
| `magic_link` | `signInWithOtp` (API) | Votre lien de connexion / Your sign-in link | Me connecter / Sign in |
| `reauthentication` | `reauthenticate` (API) | Votre code de vérification / Your verification code | (pas de bouton : le code `{{ .Token }}`, en grand) |

Les textes :

- **confirmation** : vous venez de créer un compte facturx avec l'adresse `{{ .Email }}` ; confirmez-la pour conserver vos factures et relancer vos clients. Vous n'avez rien demandé ? Ignorez cet e-mail : le compte ne sera pas activé.
- **recovery** : une demande de nouveau mot de passe a été faite pour le compte `{{ .Email }}`. Vous n'avez rien demandé ? Ignorez cet e-mail : votre mot de passe ne change pas.
- **email_change** : le même e-mail part à l'ancienne et à la nouvelle adresse, et doit convenir aux deux. Une demande remplace l'adresse du compte, `{{ .Email }}`, par `{{ .NewEmail }}` ; le changement se fait quand les deux adresses l'ont confirmé. Vous n'avez rien demandé ? Ne cliquez pas : l'adresse ne change pas sans cette confirmation.
- **magic_link** : un lien de connexion a été demandé pour le compte `{{ .Email }}`. Vous n'avez rien demandé ? Ignorez cet e-mail.
- **reauthentication** : le code demandé pour confirmer une opération sur votre compte. Vous n'avez rien demandé ? Quelqu'un utilise peut-être votre session : changez votre mot de passe.

Les modèles n'affichent que `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` et `{{ .Token }}`. Jamais `{{ .Data }}` : ce sont les métadonnées du compte, que l'utilisateur modifie lui-même.

### 5.2 La langue

- Le Studio enregistre `langue` (`fr` ou `en`, sa propre langue, `t.lang`) dans les métadonnées du compte (`user_metadata`) :
  - à l'inscription, avec `cgu` (`signUp`, `options.data`) ;
  - au changement d'adresse, dans le même appel (`updateUser({ email, data: { langue } })`) ;
  - à l'ouverture du Studio avec une session active, si elle diffère de celle du compte (`updateUser({ data: { langue } })`, sans bloquer l'interface : un échec est ignoré). Pas au moment de la connexion : `connecter` recharge la page, qui interromprait l'appel.
- `data` s'ajoute aux métadonnées existantes sans effacer `cgu` (**à vérifier en local**).
- La réinitialisation du mot de passe se fait sans session : elle suit la langue enregistrée.
- Chaque modèle commence par `{{ $en := eq (printf "%v" .Data.langue) "en" }}`, puis donne le texte anglais sous `{{ if $en }}` et le français sinon. `printf "%v"` rend la comparaison sûre quelle que soit la valeur : absente, d'un autre type, ou mise par l'utilisateur. Le français est la langue par défaut, y compris pour un compte créé avant ce chantier.
- L'objet suit la même règle (`{{ if eq (printf "%v" .Data.langue) "en" }}…{{ else }}…{{ end }}`). **À vérifier en local** : que Supabase évalue l'objet avec `.Data`. Sinon, l'objet est bilingue (« Confirmez votre adresse e-mail · Confirm your email address »).

## 6. La relance

### 6.1 L'habillage

Dans cet ordre :

1. **En tête**, le nom de l'entreprise, celui qui signe déjà l'expéditeur (`vendeur.nom`). Sans nom, pas d'en-tête.
2. **Un encadré** lu par le serveur : le numéro (`factures.numero`), le reste dû (`suivi_factures.reste_du`, en centimes, dans `factures.devise`) et l'échéance (`factures.date_echeance`). `relancer` lit déjà la facture et sa ligne de suivi ; la requête ajoute `reste_du` et `devise`.
3. **Le texte relu** par l'utilisateur, en paragraphes, comme aujourd'hui.
4. **La mention du PDF** : « F-2026-0042.pdf est joint à cet e-mail. »
5. **Hors de la carte, le pied** : « Envoyé par *Entreprise* avec facturx. Pour lui écrire, répondez à cet e-mail. » Sans nom : « Envoyé avec facturx. »

Pas de mot « facturx » en tête : le client voit qui le relance, pas l'outil.

### 6.2 La langue

Les libellés (Facture / Invoice, Reste dû / Amount due, Échéance / Due date, la mention du PDF, le pied) sont dans la langue du texte. Le Studio l'envoie avec la demande (`langue`, celle dans laquelle il a préparé l'e-mail) ; le serveur n'accepte que `fr` ou `en` (sinon 422 `ANOMALIES`, avec une anomalie `CORPS` au chemin `langue`, comme pour tout champ mal formé du corps). Absente (un Studio d'avant ce chantier, resté ouvert), il prend celle de la facture (`appearance.language`), puis le français.

Le montant et la date sont formatés comme dans le texte que le Studio a préparé : `Intl`, `fr-FR` ou `en-GB`. Les deux fonctions de formatage de `site-src/studio/compte/relances.ts` (`montant`, `date`) passent dans le module partagé (§ 7), pour que l'encadré et le texte disent exactement la même chose.

### 6.3 La version texte

`textContent` porte les mêmes informations :

```
Facture F-2026-0042
Reste dû : 1 250,00 €
Échéance : 08/11/2026

<le texte relu>

F-2026-0042.pdf est joint à cet e-mail.
--
Envoyé par ACME SARL avec facturx. Pour lui écrire, répondez à cet e-mail.
```

### 6.4 Ce qui ne change pas

- La sécurité : le gabarit est fixe ; le nom de l'entreprise, le numéro, les montants et le texte y sont échappés. L'objet, le nom d'expéditeur et le destinataire gardent leurs règles (`message.ts`).
- Ce que la base consigne de la relance (destinataire, objet, texte) : l'habillage se reconstruit à partir de la facture.
- Le dialogue de relance ne montre pas d'aperçu ; une ligne, sous le message, dit ce qui s'ajoute : « L'e-mail ajoute un encadré (numéro, reste dû, échéance) et la ligne « Envoyé par … avec facturx ». »

## 7. Une seule source

- **`site-src/shared/courriel.ts`** dessine le cadre : le document, la carte, l'en-tête, le bouton, le lien en clair, le pied, le préheader, l'encadré, l'échappement ; et le formatage des montants et des dates (§ 6.2). Comme les autres modules partagés, il n'a aucun import relatif (Deno ne résout pas `./x.js` vers `./x.ts`). `pnpm compte:preparer` le copie dans `supabase/functions/_vendor/shared/`, où `relancer` le prend ; le Studio l'importe pour le formatage.
- **`pnpm emails:construire`** génère, à partir de ce module, les cinq modèles du compte dans `supabase/templates/` (`confirmation.html`, `recovery.html`, `email_change.html`, `magic_link.html`, `reauthentication.html`) et leurs objets (`supabase/templates/objets.json`). Les fichiers générés sont versionnés ; **la CI vérifie qu'ils sont à jour** (régénérer ne change rien).
- **En local**, `config.toml` désigne ces fichiers (`[auth.email.template.<modèle>]`, `subject` et `content_path`) ; un test vérifie que ses objets sont ceux de `objets.json`. Les e-mails s'affichent dans Mailpit, après un redémarrage de la pile locale, que fait l'utilisateur.
- **En production**, une étape de `compte-deploy.yml`, « Modèles d'e-mails », envoie les objets et les modèles par l'API de gestion de Supabase : `PATCH https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth`, avec les seules clés `mailer_subjects_<modèle>` et `mailer_templates_<modèle>_content`, et le jeton `SUPABASE_ACCESS_TOKEN` déjà dans les secrets. Ce n'est pas `supabase config push`, qui écrirait sur la production les réglages de la pile locale.
  - La réponse de l'API est la configuration d'authentification entière, qui peut contenir des secrets (le mot de passe SMTP) : **elle n'est jamais affichée**. L'étape n'écrit que le code HTTP.
  - Elle relit ensuite la configuration (`GET`) : `scripts/emails-deployer.mjs`, en Node, n'en garde que les clés envoyées et les compare à ce qu'il a envoyé (`clesQuiDifferent`) ; l'étape échoue si elles diffèrent, sans rien afficher d'autre que « identiques » (le journal dit « modèles identiques ») ou les noms des clés qui diffèrent.
- Les modèles du tableau de bord de Supabase ne se modifient plus à la main : le déploiement suivant les écraserait. Le guide le dit.

## 8. Vérifications

- **Tests du module** (Vitest) : l'échappement (un nom d'entreprise avec `<`, `&`, des guillemets), les deux langues de l'encadré et du pied, l'entreprise sans nom, la version texte, le formatage des montants et des dates.
- **Tests des modèles générés** : chaque `{{ … }}` appartient à la liste admise (`$en := …`, `if`, `else`, `end`, `.ConfirmationURL`, `.Email`, `.NewEmail`, `.Token`), aucun `.Data` n'est affiché, chaque modèle a ses deux langues et pèse moins de 30 Kio.
- **Tests de `relancer`** (Deno) : le message composé porte l'encadré et le pied dans la langue demandée ; `langue` invalide refusée ; `langue` absente, celle de la facture.
- **En local**, dans Mailpit : les cinq e-mails du compte, en français et en anglais, et un compte sans `langue` ; l'objet évalué avec `.Data`, et `cgu` gardé après un `updateUser({ data })` (§ 5.2).
- **En production**, à l'étape 1.10 du guide :
  - l'e-mail de confirmation dans Gmail, sur le web et sur mobile, en clair et en sombre ;
  - une inscription depuis `/en/studio/`, qui reçoit l'anglais ;
  - le lien du bouton commence par `https://moaxvyjhgaujujbtkckg.supabase.co/auth/v1/verify` : Brevo ne l'a pas réécrit pour suivre les clics (un lien réécrit peut être consommé par le service de suivi et casser la confirmation) ;
  - la relance reçue, avec son encadré, son pied et son PDF.

## 9. Documents

- **`docs/compte.md`** :
  - § 1.3 : vérifier chez Brevo que le suivi des clics et des ouvertures est désactivé pour les e-mails transactionnels ;
  - § 1.4, étape 5 : les modèles viennent du déploiement, ne pas les modifier dans le tableau de bord ;
  - § 1.7 : l'étape « Modèles d'e-mails » du workflow ;
  - § 1.10 : les contrôles du § 8.
- **`docs/decisions.md`** : D76, les e-mails (le cadre sans ressource distante, la langue dans les métadonnées, le déploiement par l'API de gestion).
- **La politique de confidentialité** (français et anglais) :
  - la ligne du compte ajoute la langue de l'interface (« écrire les e-mails du compte dans votre langue ») ;
  - ce que Brevo reçoit pour une relance ajoute le numéro, le reste dû et l'échéance de la facture.

  La version reste `2026-11` si aucun compte réel n'existe encore au moment de la fusion (à vérifier : seuls des comptes d'essai de l'éditeur dans `auth.users`).

## 10. Ce qui peut mal tourner

- **Une erreur dans un modèle Go** : Supabase n'envoie pas l'e-mail, et l'inscription ne se confirme plus. D'où la comparaison par `printf "%v"`, la liste admise des actions, l'essai des cinq modèles dans Mailpit avant tout déploiement, et l'étape 1.10 aussitôt après.
- **Outlook de bureau** : il ignore les coins arrondis, une partie du `padding` et toute règle `@media`. Le cadre reste lisible sans eux.
- **Le mode sombre forcé** (Gmail sur mobile, Outlook) inverse les couleurs à sa façon : pas de texte gris clair sur fond blanc qui deviendrait illisible une fois inversé.
- **Le secret dans la réponse de l'API de gestion** : jamais affichée (§ 7).
- **Une modification faite dans le tableau de bord** : écrasée au déploiement suivant, sans avertissement. Le guide le dit.
- **Les deux déploiements** (le site par Coolify, les fonctions et les modèles par le workflow) ne vont pas au même rythme : `relancer` accepte une demande sans `langue` (§ 6.2), et un modèle lit un compte sans `langue` en français (§ 5.2).
