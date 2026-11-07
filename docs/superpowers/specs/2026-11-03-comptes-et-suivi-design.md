# Comptes, factures conservées et suivi des paiements — design

*3 novembre 2026. Design validé section par section. Mis à jour le 7 novembre 2026 : les § 6 à 13 décrivent le service tel qu'il est construit.*

## 1. Contexte

facturx se compose aujourd'hui d'un SDK TypeScript (`facturx-sdk`, MIT, sur npm) et d'un site statique servi par nginx sur Coolify, avec deux outils : le validateur et le Studio. Les deux s'exécutent entièrement dans le navigateur : « rien n'est transmis » est posé comme leur différenciateur (D51, D60). Le Studio conserve déjà, dans IndexedDB, l'entreprise, les clients, le catalogue, l'historique des factures émises et la numérotation ; il sait faire des avoirs, des acomptes et une sauvegarde.

Ce qui lui manque pour servir au quotidien : un compte, donc un serveur, les mêmes données sur plusieurs appareils, et le suivi de ce qui est payé.

Deux faits pèsent sur le design :

- **La réforme.** Les TPE et les indépendants devront émettre leurs factures B2B domestiques par une plateforme agréée (PA) au 1er septembre 2027. Un outil de facturation pour eux devra s'y raccorder à cette date ; la v1 ne le fait pas, mais ne doit rien rendre plus difficile.
- **L'usage.** Au relevé du 28 octobre 2026, aucun visiteur n'avait produit de PDF dans le Studio depuis son lancement le 30 septembre. Des comptes n'amèneront pas de trafic par eux-mêmes ; l'acquisition reste un chantier à part.

## 2. Objectif

Faire du Studio un outil de facturation au quotidien pour les **TPE et les indépendants** : un compte gratuit, des factures conservées sur un serveur et accessibles partout, et le **suivi des paiements** — payée, payée en partie, en retard, relance en un clic, tableau de bord.

**Modèle économique.** Gratuit au lancement. Un abonnement viendra plus tard, vraisemblablement avec l'envoi via une PA. Rien de l'encaissement n'est construit maintenant.

**Mesure du succès.** Des comptes qui émettent chaque mois. Indicateurs, calculés en SQL sur la base, sans traceur : comptes créés, comptes actifs (au moins une facture émise dans le mois), factures émises, relances envoyées.

## 3. Périmètre

**Dans la v1**

- Comptes : e-mail et mot de passe, confirmation par e-mail, réinitialisation.
- Entreprise, clients, catalogue, brouillons multiples et numérotation conservés sur le serveur.
- Émission côté serveur : numéro attribué, facture validée par le SDK, PDF Factur-X produit et figé en une transaction.
- Paiements saisis à la main, statut de paiement calculé, tableau de bord.
- Relance en un clic, e-mail préparé envoyé au client après relecture.
- Import des données locales du Studio, export complet, suppression du compte.
- Le Studio sans compte, inchangé.

**Hors v1**

- Raccordement à une PA et statuts du cycle de vie (sous-projet 2).
- Abonnement et paliers (sous-projet 3).
- Envoi de la facture elle-même par e-mail, rapprochement bancaire, suivi des rebonds d'e-mails, plusieurs utilisateurs par entreprise, plusieurs entreprises par compte, connexion par un fournisseur d'identité (Google…), rappel avant échéance, relances automatiques.

**Sous-projets suivants**, chacun avec sa spec :

1. *Celui-ci.*
2. **Raccordement à une PA**, avant septembre 2027 : choix d'une PA partenaire, transmission des factures et des statuts (dont 212 « Encaissée », alimenté par les paiements de la v1), table `transmissions`.
3. **Abonnement** : paliers, encaissement, et factures de l'abonnement émises par facturx avec son propre SDK.

## 4. Décisions

| Sujet | Décision | Raison |
|---|---|---|
| Cible | TPE et indépendants | choix du produit |
| Suivi | les paiements d'abord | utile sans PA, et prépare le statut 212 |
| Plateforme serveur | Supabase, région UE, plan Pro | authentification, Postgres, stockage et sauvegardes résolus ; v1 la plus rapide ; déjà employé par l'auteur |
| Interface | le Studio existant, statique sur Coolify | rien à réécrire, l'éditeur est fait |
| Écritures juridiques | uniquement par Edge Functions | le navigateur n'a aucun droit d'écriture sur une facture émise |
| Format des données | les structures du Studio en `jsonb`, colonnes réelles pour ce que le serveur interroge ou contraint | un seul format entre Studio et serveur |
| Statut de paiement | calculé par une vue, jamais stocké | un calcul ne se désynchronise pas |
| Relances | en un clic, après relecture, jamais automatiques | rien ne part sans le geste de l'utilisateur ; pas de relance d'un client qui a payé sans que ce soit saisi |
| Mode sans compte | conservé, inchangé | la promesse locale reste offerte à qui la veut |
| Dépôt | ce monorepo public | le service est ouvert ; l'abonnement vendra l'hébergement et la PA, pas le code |
| Licence | `supabase/` en AGPL-3.0-or-later, le reste en MIT | un concurrent ne peut pas héberger le service sans publier ses modifications ; le SDK et le Studio restent libres d'usage |

## 5. Architecture

```
Navigateur : le Studio (Preact, statique sur Coolify)
 ├─ sans compte : IndexedDB, comme aujourd'hui
 └─ avec compte : supabase-js ──► Supabase (région UE, plan Pro)
                                   ├─ Auth : e-mail et mot de passe
                                   ├─ Postgres + RLS
                                   ├─ Storage : PDF émis, logos, polices (privé) ; polices du Studio (public)
                                   └─ Edge Functions (avec le SDK) : emettre, importer, relancer, supprimer-compte, purger
                                         └──► Brevo : e-mails d'authentification (SMTP) et relances (API)
```

- **Deux chemins vers la base.** Lire, et écrire ce qui n'engage à rien (brouillons, clients, catalogue, entreprise, paiements), se fait depuis le navigateur sous RLS. Émettre et relancer passent par une Edge Function.
- **Le SDK ne change pas.** Les fonctions emploient le SDK du dépôt, celui du bundle du Studio : `pnpm compte:preparer` copie `packages/facturx/dist/` et les modules partagés dans `supabase/functions/_vendor/` (non versionné) avant les tests et le déploiement. Le serveur n'attend donc pas une publication npm, et ne dépend pas de la façon dont le bundler des fonctions traite un import hors de leur dossier. Chaque facture garde la version du SDK qui l'a produite.
- **Le Studio sans compte ne paie rien.** `supabase-js` et le code du compte sont chargés par `import()` à la première connexion, comme Saxon-JS l'est au premier usage du validateur (D51).
- **Une entreprise par compte en v1**, mais tout est rattaché à une `entreprise` et l'accès passe par `membres` : ajouter un associé ou un comptable n'impose pas de migration lourde.
- **Configuration.** L'URL du projet et la clé publique sont injectées dans le bundle par `pnpm site:build` depuis des variables d'environnement. La clé de service ne quitte jamais les secrets des fonctions.
- **E-mails.** Brevo, société française, hébergement UE, palier gratuit de 300 e-mails par jour (à confirmer à l'inscription), sert de SMTP à l'authentification Supabase — le service intégré est trop limité pour la production — et d'API aux relances. Expéditeur sur le domaine facturx, avec SPF, DKIM et DMARC.
- **Environnements.** Local (`supabase start`, Docker) et production. Pas de préproduction en v1.

**Dans le dépôt**

```
supabase/                 AGPL-3.0-or-later, avec son propre LICENSE
  config.toml
  migrations/             schéma, RLS, déclencheurs, vue de suivi
  functions/
    emettre/
    relancer/
    supprimer-compte/
    purger/
    _shared/              connexion Postgres, auth, erreurs typées, gabarits de relance
  tests/                  pgTAP
site-src/shared/
  numerotation.ts         formatNumber, nextRank, rankOf, advance, numberProblems, sans dépendance
site-src/studio/
  persistence.ts          interface commune aux deux modes
  storage.ts              implémentation IndexedDB (l'actuelle)
  compte/                 implémentation Supabase, auth, tableau de bord, factures, paiements, relances, import, export
```

## 6. Modèle de données

Montants en centimes (`bigint`). Dates d'affaires en `date`, horodatages en `timestamptz`. Toute table porte `entreprise_id`, sauf `entreprises` elle-même.

| Table | Colonnes principales | Règles |
|---|---|---|
| `entreprises` | `id`, `profil jsonb` (`CompanyProfile`), `apparence_defaut jsonb`, `cree_le`, `suppression_demandee_le` (nullable) | lecture, et mise à jour de `profil` et `apparence_defaut` seulement, par ses membres |
| `membres` | `entreprise_id`, `user_id`, `role` (`titulaire`), `cgu_version`, `cgu_acceptees_le` | base de toutes les règles RLS ; créée avec l'entreprise à l'inscription, qui exige l'acceptation des CGU |
| `clients` | `id`, `party jsonb` (`FormParty`), `nom`, `email`, `modifie_le` | libres |
| `produits` | `id`, `fiche jsonb` (`ProductRecord` sans `uid`), `nom`, `modifie_le` | libres |
| `brouillons` | `id`, `form jsonb`, `appearance jsonb`, `version int`, `modifie_le` | libres ; `version` croît à chaque enregistrement |
| `numerotation` | `entreprise_id` (clé), `gabarit`, `prochain`, `annuelle`, `annee` | écriture par l'Edge Function `emettre` ; l'utilisateur peut changer le gabarit et `annuelle`, et augmenter `prochain`, jamais le diminuer (déclencheur) |
| `factures` | `id`, `numero`, `type_code`, `date_emission`, `date_echeance` (nullable), `client_id` (nullable), `client_nom`, `client_email`, `devise`, `ht`, `ttc`, `net_a_payer`, `invoice jsonb`, `form jsonb`, `appearance jsonb`, `pdf_chemin`, `sdk_version`, `facture_origine_id` (nullable), `brouillon_id` (unique), `origine` (`emise` ou `importee`), `emise_le`, `emise_par` | `unique (entreprise_id, numero)` ; lecture par les membres ; aucune écriture depuis le navigateur ; un déclencheur refuse toute modification et toute suppression, sauf dans la transaction de purge d'un compte supprimé, qui s'annonce par `set local facturx.purge = 'on'` |
| `paiements` | `id`, `facture_id`, `date`, `montant`, `moyen`, `note`, `cree_le`, `cree_par`, `annule_le` (nullable) | insertion et annulation par les membres ; `montant > 0` ; `date` ≤ aujourd'hui ; pas de paiement sur un avoir ; un déclencheur refuse qu'un paiement porte le total encaissé au-delà du reste dû ; jamais supprimé, seulement annulé |
| `relances` | `id`, `facture_id`, `niveau` (1 à 3), `envoyee_le`, `destinataire`, `objet`, `corps`, `message_id`, `etat` | écriture par l'Edge Function `relancer` seulement ; ajout seul |

`moyen` prend une valeur parmi `virement`, `cheque`, `especes`, `carte`, `prelevement`, `autre`. Les avoirs sont les types 381, 261, 262 et 396.

**La vue `suivi_factures`** donne pour chaque facture qui n'est pas un avoir :

- `encaisse` = somme des paiements non annulés ;
- `avoirs` = somme des TTC des avoirs émis qui la citent (`facture_origine_id`) ; un avoir est dans la devise de la facture qu'il cite, `emettre` le refuse sinon (422 `AVOIR_DEVISE`) et la base aussi, par un déclencheur, quel que soit l'écrivain ;
- `reste_du` = `net_a_payer` − `encaisse` − `avoirs` ;
- `statut`, dans cet ordre :
  - `payee` si `reste_du` = 0 ;
  - `a_rembourser` si `reste_du` < 0 ;
  - `en_retard` si `date_echeance` est passée ;
  - `payee_en_partie` si `encaisse` > 0 ;
  - `a_payer` sinon.

Une facture sans échéance n'est jamais en retard. Une facture d'acompte se suit comme une autre ; la facture de solde a déjà ses acomptes déduits par `withDeposits`, son net à payer est donc le bon.

**PDF.** Bucket privé `factures`, chemin `{entreprise_id}/{facture_id}.pdf`, servi par URL signée valable 60 secondes. Bucket privé `fichiers` pour les logos et les polices déposés par l'utilisateur. Bucket public `polices` pour les polices du Studio, rempli au déploiement depuis les mêmes paquets npm que le site.

**Pour 2027.** Les statuts renvoyés par la PA iront dans une table `transmissions` liée à `factures`, ajoutée par le sous-projet 2 sans toucher une seule facture émise.

## 7. Émission

L'Edge Function `emettre` reçoit `{ brouillonId, version, invoice, appearance }`. Le navigateur construit `invoice` avec le SDK, comme aujourd'hui (traduction du formulaire, `computeTotals`), sans numéro ; le code de traduction reste donc à un seul endroit, dans le Studio.

1. **Authentifier.** Retrouver l'entreprise de l'utilisateur par `membres`. Refuser si l'adresse du compte n'est pas confirmée.
2. **Rejouer sans dupliquer.** Si une facture porte déjà ce `brouillon_id`, la renvoyer telle quelle : un double clic ou un réseau qui coupe n'émet pas deux factures.
3. **Vérifier le brouillon.** Il appartient à l'entreprise et sa `version` est celle reçue ; sinon 409. Ce qu'on émet est ce que l'utilisateur voit.
4. **Ouvrir une transaction** sur une connexion Postgres directe (PostgREST ne tient pas une transaction sur plusieurs étapes) et verrouiller la ligne `numerotation` de l'entreprise (`SELECT … FOR UPDATE`). Deux émissions simultanées se suivent.
5. **Contrôler la date.** `issueDate` ne doit être ni postérieure à aujourd'hui (Europe/Paris), ni antérieure à la date de la dernière facture émise par l'entreprise. En numérotation annuelle, elle ne doit pas non plus être antérieure au 1er janvier de l'année de la numérotation : sans cette borne, une facture de décembre prendrait le rang 1 de la série courante, et celle de janvier commencerait à 2. Hors de ces bornes : 409. La numérotation reste chronologique.
6. **Attribuer le numéro.** Rang selon `nextRank`, numéro selon `formatNumber`, contrôle par `numberProblems`. Si ce numéro est déjà pris (une facture importée le porte), le serveur prend le premier libre qui suit ; s'il n'y en a pas dans les suivants, 409 `DOUBLON`. Ces fonctions quittent `library.ts` pour `site-src/shared/numerotation.ts`, que le Studio importe et que `pnpm compte:preparer` copie dans les fonctions (§ 5). En mode compte, on ne saisit pas de numéro à la main : le Studio propose le numéro suivant, et le serveur le remplace par celui qu'il attribue.
7. **Valider.** `validateInvoice` sur la facture numérotée. Des anomalies : 422 avec la liste, annulation de la transaction.
8. **Pour un avoir**, vérifier que chaque facture citée existe dans l'entreprise, et renseigner `facture_origine_id`. Un avoir est dans la devise des factures qu'il cite : sinon, 422 avec une `Issue` `AVOIR_DEVISE` sur la devise, avant le verrou et avant le dépôt du PDF.
9. **Produire le PDF.** `renderInvoicePdf` puis `embedFacturX`, avec les polices du bucket `polices`, ou la police et le logo de l'utilisateur depuis `fichiers`. Déposer le PDF dans `factures`.
10. **Enregistrer** la facture, avancer la numérotation (`advance`), supprimer le brouillon, valider la transaction.

Un échec avant la validation annule tout : aucun numéro n'est consommé, aucun trou n'apparaît. Au pire, un PDF déposé sans facture reste dans le bucket ; l'Edge Function `purger`, appelée chaque nuit par `pg_cron` et `pg_net`, supprime les PDF sans facture vieux de plus d'un jour. Elle passe par l'API Storage : effacer une ligne de `storage.objects` en SQL n'efface pas le fichier.

**Reprendre une numérotation existante.** On règle le prochain rang dans la numérotation, et seulement vers le haut (D62). Changer de gabarit est permis ; l'unicité `(entreprise_id, numero)` interdit de réémettre un numéro.

**Repli si le budget de calcul ne suffit pas.** Une Edge Function a un budget de CPU limité ; le rendu PDF/A avec polices embarquées pourrait le dépasser. Si la mesure (§ 15) le montre, l'étape 9 sort de la transaction : celle-ci fige la facture sans PDF (`pdf_chemin` nul), le navigateur produit ensuite le PDF, et une fonction `deposer-pdf` vérifie par `extractInvoice` qu'il redit exactement la facture figée avant de l'accepter. La numérotation reste continue : la pièce juridique est la facture figée, pas le fichier.

## 8. Paiements et tableau de bord

**Enregistrer un paiement.** Depuis la fiche d'une facture : date, montant (le reste dû par défaut), moyen, note facultative. « Marquer comme payée » enregistre le reste dû à la date du jour. Une erreur se corrige par « Annuler ce paiement » : l'entrée reste visible, barrée.

**Le tableau de bord**, sur la période choisie (mois ou année), **devise par devise** : il n'en convertit ni n'en additionne aucune. Chaque devise présente (une facture, un avoir ou un paiement dans la période, ou un reste dû positif) a ses propres chiffres :

- facturé HT, avoirs déduits ;
- encaissé ;
- reste à encaisser ;
- en retard, en montant et en nombre ;
- les factures en retard, triées par jours de retard, chacune avec « Relancer » ;
- les échéances des quinze prochains jours.

Tout est calculé par une fonction SQL `tableau_de_bord(debut, fin)` sur `suivi_factures`, qui rend une ligne par devise présente. Le Studio montre un bloc par devise, celle de l'entreprise d'abord : sans ligne pour elle, il affiche des zéros. Les factures en retard et les échéances gardent chacune la devise de leur facture.

**Vers 2027.** Une date et un montant encaissé sont le contenu du statut 212 « Encaissée » que la PA devra recevoir pour les prestations de services avec TVA sur les encaissements. Le sous-projet 2 les lira sans rien faire ressaisir.

## 9. Relances

**Quand.** « Relancer » est offert sur une facture dont l'échéance est passée et dont le reste dû est positif.

**L'e-mail préparé.**

- Destinataire : l'adresse de contact de l'acheteur sur la facture, modifiable.
- Objet et corps : numéro, date d'échéance, reste dû, coordonnées de paiement (IBAN et référence), signature de l'entreprise.
- Pièce jointe : le PDF de la facture.
- Niveau, d'après le nombre de relances déjà envoyées pour cette facture :
  1. rappel courtois ;
  2. rappel ferme ;
  3. dernier rappel, qui cite les pénalités de retard et l'indemnité forfaitaire de 40 € inscrites sur la facture. Au-delà, le niveau 3 se répète.
- Langue : celle des libellés de la facture (`fr` ou `en`).

L'utilisateur relit, modifie, puis envoie.

**L'Edge Function `relancer`**

1. Authentifie, et vérifie que la facture appartient à l'entreprise, que l'échéance est passée et que le reste dû est positif.
2. Applique les limites : adresse du compte confirmée, SIREN du vendeur renseigné, une relance par facture tous les trois jours au plus, vingt par jour et par compte au plus, et soixante refus du service d'envoi par jour et par compte au plus (une tentative refusée n'envoie rien, mais elle ne doit pas se répéter sans fin) ; sinon 429.
3. Compose l'e-mail : corps en texte, échappé, placé dans un gabarit HTML fixe ; objet débarrassé des retours à la ligne. Aucun HTML fourni par l'utilisateur n'est envoyé.
4. Envoie par l'API Brevo. Expéditeur « *Nom de l'entreprise* via facturx », adresse `relances@` du domaine facturx ; `Reply-To` : l'adresse du compte.
5. Consigne l'envoi dans `relances`, avec l'identifiant renvoyé par Brevo. Un refus de Brevo est consigné aussi, et répond 502.

Le Studio affiche « envoyée » et jamais « reçue » : le fournisseur a accepté l'e-mail, rien ne garantit qu'il soit lu.

## 10. Le Studio

**Entrer.** `/studio/` s'ouvre comme aujourd'hui, sans compte. L'en-tête gagne « Se connecter » et « Créer un compte gratuit » (ce dernier seulement quand la fenêtre est assez large ; sinon, « Se connecter » ouvre le dialogue, qui offre la création) ; la page d'accueil du site propose « Créer un compte gratuit », qui ouvre le Studio.

**Connecté, la navigation offre**

- **Tableau de bord** (§ 8) ;
- **Factures** : liste avec statut de paiement, filtres par statut, client et période. La fiche d'une facture montre le PDF, les paiements, les relances, et les actions existantes : dupliquer, faire un avoir, facturer le solde ;
- **Nouvelle facture** : l'éditeur actuel et ses onglets Contenu, Apparence, Contrôle, Code ; « Émettre » appelle `emettre` ;
- **Brouillons**, **Clients**, **Catalogue** ;
- **Entreprise** : profil vendeur, numérotation, compte (adresse, mot de passe, export, suppression).

**La persistance.** `persistence.ts` décrit ce que les deux modes partagent : entreprise, clients, catalogue, brouillon courant, numérotation, historique. `storage.ts` (IndexedDB) et `compte/` (Supabase) l'implémentent. Ce qui n'existe qu'avec un compte — paiements, relances, tableau de bord, brouillons multiples — vit dans `compte/` seulement.

**Ne rien perdre de ce qu'on tape.** En mode compte, le brouillon ouvert est enregistré sur le serveur au fil de la saisie (avec un délai d'une seconde après la dernière frappe) et recopié dans IndexedDB. Hors ligne, le Studio affiche « hors ligne, non enregistré » et rattrape l'enregistrement au retour du réseau. Si la copie d'IndexedDB ne se relit pas au démarrage, elle n'est pas tenue pour absente : relue avant d'être remplacée, une saisie que le serveur n'avait pas reçue y est mise de côté, et le Studio propose de la rouvrir en brouillon. Émettre, enregistrer un paiement et relancer demandent le réseau.

**Importer les données locales.** À la première connexion, si IndexedDB contient des données, le Studio propose de les importer : entreprise, clients, catalogue, numérotation, historique. Les factures émises en local passent par l'Edge Function `importer`, qui les lit dans leur PDF (`extractInvoice`) et les enregistre avec `origine = 'importee'`, puisque leur numéro n'a pas été attribué par le serveur ; on peut y enregistrer des paiements et les relancer. Une facture datée après aujourd'hui (Paris) est refusée (422, anomalie `DATE`) : `emettre` n'admettant aucune date antérieure à la dernière facture, elle bloquerait toutes les émissions suivantes ; le bilan de l'import le dit, et elle reste dans le navigateur. La numérotation reprend au plus haut rang connu. Les données locales restent dans le navigateur tant que l'utilisateur ne demande pas à les effacer.

**Exporter.** « Exporter mes données » produit une archive : un JSON au format portable de la sauvegarde actuelle (`toPortableJson`), et tous les PDF.

**Langues.** Tout l'ajout existe en français et en anglais, comme le Studio.

## 11. Sécurité

- RLS sur chaque table, refus par défaut ; chaque règle passe par `membres`.
- Une Edge Function retrouve l'entreprise depuis le jeton, jamais depuis le corps de la requête.
- La clé de service n'existe que dans les secrets des fonctions.
- Buckets `factures` et `fichiers` privés, règles par préfixe `{entreprise_id}/`, URL signées de 60 secondes.
- Fichiers déposés : logo en PNG ou JPEG de 1 Mo et de 2000 × 2000 pixels au plus (dimensions lues dans l'en-tête, sans décoder l'image ; un PNG est parcouru bloc par bloc jusqu'à IEND, comme le décodeur de pdf-lib, et refusé s'il a un second IHDR, des blocs d'animation APNG, une profondeur de 16 bits ou un bloc qui déborde du fichier), police TTF de 2 Mo au plus, type vérifié à l'ouverture et non d'après l'extension.
- Limites de débit : `emettre` 60 par heure et par compte ; relances (§ 9) ; authentification selon les réglages de Supabase.
- Sauvegardes : les sauvegardes quotidiennes du plan Pro, plus un dump hebdomadaire chiffré, déposé chez un autre hébergeur européen, avec une restauration testée au moins une fois avant l'ouverture.
- Le site n'a aujourd'hui aucune CSP. Une session vit désormais dans le navigateur : une CSP est ajoutée à `docker/nginx.conf`, avec `connect-src` limité au site et au projet Supabase.

## 12. RGPD, conservation et textes

**Rôles.** facturx est responsable du traitement des données du compte, et sous-traitant de l'utilisateur pour les données de ses clients (article 28). Sous-traitants ultérieurs : Supabase (hébergement en UE, société américaine) et Brevo.

**Pendant la vie du compte**, une facture émise ne se modifie ni ne se supprime.

**À la suppression du compte.** L'obligation de conserver les factures dix ans pèse sur l'utilisateur, pas sur facturx ; en fin de contrat, facturx doit lui rendre ses données ou les effacer.

1. Le Studio impose de passer par l'export, et avertit que la conservation des factures est une obligation légale de l'utilisateur.
2. L'Edge Function `supprimer-compte` renseigne `suppression_demandee_le`. Dès lors, `emettre` et `relancer` refusent (403 `SUPPRESSION`), et le Studio, à la connexion, n'offre plus que l'export et « Annuler la suppression ».
3. Au bout de 30 jours, l'Edge Function `purger`, dans sa passe de chaque nuit, efface tout : PDF et fichiers par l'API Storage, puis les lignes de l'entreprise dans une transaction de purge (§ 6), puis l'utilisateur dans Supabase Auth.

**Textes à rédiger avant l'ouverture** : CGU, politique de confidentialité, accord de sous-traitance, en français et en anglais. Ils disent franchement que Supabase est une société américaine. Une relecture par un juriste est souhaitable.

## 13. Erreurs

Les fonctions répondent `{ code, message, details? }` avec ces statuts :

| Statut | `code` | Cas | Ce que fait le Studio |
|---|---|---|---|
| 401 | `SESSION` | jeton absent ou expiré | renvoie à la connexion, en gardant le brouillon |
| 403 | `DROITS`, `NON_CONFIRME`, `SUPPRESSION` | pas membre ; adresse non confirmée ; suppression du compte demandée | explique ; propose de renvoyer la confirmation, ou d'annuler la suppression |
| 409 | `BROUILLON_MODIFIE`, `DATE`, `DOUBLON`, `PDF_DEJA_DEPOSE` | version périmée ; date hors bornes (`details.min` et `details.max`) ; numéro déjà importé, ou déjà pris sans numéro libre dans les suivants (`emettre`) ; PDF déjà déposé (repli du § 7) | recharge le brouillon ; indique la date admise ; liste les doublons de l'import, ou invite à changer le gabarit |
| 413 | `ANOMALIES` | corps de la requête de plus de 10 Mio (`emettre`, `importer`) ; `details` porte une `Issue` de code `CORPS` | demande d'alléger les pièces jointes |
| 422 | `ANOMALIES` | `validateInvoice` refuse, ou un avoir n'est pas dans la devise de la facture qu'il cite (`AVOIR_DEVISE`) ; `details` porte les `Issue` | ouvre l'onglet Contrôle sur le champ en cause (`focusField`), ou le champ de la devise |
| 429 | `LIMITE` | limite de débit ; `details.reessayerApres` (date ISO) ; pour `relancer`, `details.cause` dit laquelle : `delai` (trois jours sur la facture), `jour` (vingt envois du jour), `tentatives` (soixante refus du jour) ou `verrou` (une autre relance de l'entreprise est en cours d'envoi) | indique quand réessayer, et pour une relance la limite en cause |
| 502 | `ENVOI` | Brevo refuse | dit que la relance n'est pas partie |
| 500 | `INTERNE` | le reste | message générique, identifiant de requête |

Une émission qui échoue laisse le brouillon intact et le dit : « aucun numéro n'a été consommé ».

## 14. Tests et intégration continue

- **Base de données** (pgTAP, `supabase test db`) :
  - un compte ne lit ni n'écrit les données d'un autre, table par table et bucket par bucket ;
  - une facture émise ne se modifie ni ne se supprime, même avec la clé de service, hors purge ;
  - un paiement au-delà du reste dû est refusé ; un paiement sur un avoir aussi ;
  - `suivi_factures` donne chaque statut, avoirs et acomptes compris ;
  - la numérotation : deux émissions simultanées obtiennent deux numéros consécutifs, sans doublon ni trou.
- **Fonctions** (tests Deno contre la pile locale) :
  - `emettre` : cas nominal, 422, double appel, version périmée, date future, date antérieure à la dernière facture, avoir dont l'origine est dans une autre entreprise ;
  - le PDF produit par `emettre` passe veraPDF, par le script de CI existant ;
  - `relancer` : cas nominal, limites, échappement, avec un client Brevo simulé ;
  - `supprimer-compte` et `purger` : refus d'émettre et de relancer pendant le délai, annulation de la suppression, purge complète à 30 jours (base, Storage, Auth), PDF orphelins effacés et PDF rattachés intacts.
- **Studio** (Vitest) :
  - les deux implémentations de `persistence.ts` passent une même suite de tests de contrat ;
  - l'import d'une sauvegarde locale ;
  - la correspondance entre codes d'erreur et réactions du Studio.
- **CI.** Un job GitHub Actions démarre la pile Supabase locale et lance les tests de base et de fonctions. `pnpm check` s'étend aux nouveaux tests du Studio. Les tests existants du SDK et du site ne changent pas.

## 15. Risques et vérifications préalables

1. **Budget de calcul des Edge Functions.** Première tâche du plan : mesurer `renderInvoicePdf` + `embedFacturX` dans le runtime edge de Supabase, sur la facture d'exemple et sur une facture de 50 lignes. Décide entre l'émission du § 7 et son repli.
2. **Délivrabilité.** Les relances partent de notre domaine : SPF, DKIM et DMARC configurés avant le premier envoi, limites du § 9 en place dès le départ.
3. **Coût avant revenu.** Le palier gratuit de Supabase est déjà occupé par deux projets actifs : le plan Pro (environ 25 $ par mois, à vérifier sur la grille du moment) est payé dès l'ouverture.
4. **Textes juridiques.** Ils bloquent l'ouverture au public, pas le développement.
5. **Acquisition.** La v1 ne crée pas d'usage ; elle donne une raison de revenir à ceux qui viennent.

## 16. Documentation à mettre à jour

- `docs/decisions.md` : une décision **D73**, « Les comptes : ce que devient "rien n'est transmis" ». Le validateur reste entièrement local, le Studio sans compte aussi ; avec un compte, les données sont sur un serveur, chiffrées au repos par l'hébergeur mais lisibles par le service, et c'est l'utilisateur qui fait ce choix.
- `README.md`, `README.en.md` et le site : la section Studio dit les deux modes ; la licence de `supabase/` est mentionnée.
- `supabase/LICENSE` (AGPL-3.0-or-later) et une ligne dans `LICENSE` à la racine pour dire quel dossier relève de quelle licence.
