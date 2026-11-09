# Le registre des traitements

Le registre des activités de traitement de facturx (RGPD, article 30). facturx traite des données personnelles à deux titres : comme **responsable** pour les comptes et les journaux du site (article 30, paragraphe 1), et comme **sous-traitant** de chaque utilisateur pour les données de ses clients (article 30, paragraphe 2). L'exemption des structures de moins de 250 personnes ne s'applique pas : ces traitements ne sont pas occasionnels.

Il décrit les textes de la version `2026-11` (CGU, [politique de confidentialité](../site/confidentialite/index.html), [accord de sous-traitance](../site/sous-traitance/index.html)), état au 9 novembre 2026. Il se reprend avec eux : nouvelle version, nouveau sous-traitant, nouvelle donnée, autre durée, reprise de la sauvegarde (D77).

**Qui tient le registre.** Ibird, particulier, éditeur du site et du service à titre non professionnel et gratuit. Contact : `hello@ibird.dev`. Aucun délégué à la protection des données n'est désigné : l'article 37 ne l'impose pas ici (ni autorité publique, ni suivi régulier et systématique à grande échelle, ni données sensibles à grande échelle).

## 1. Les traitements dont facturx est responsable

### 1.1 Les comptes du Studio

| | |
|---|---|
| Finalités | Créer et gérer le compte, connecter l'utilisateur, confirmer son adresse, réinitialiser son mot de passe, lui écrire dans sa langue ; garder la preuve de son acceptation des CGU ; établir ses factures à l'image de son entreprise ; compter, en totaux, les comptes créés et actifs, les factures émises et les relances envoyées |
| Bases légales | Exécution du contrat (article 6.1.b) ; intérêt légitime pour les totaux d'usage (article 6.1.f) |
| Personnes concernées | Les utilisateurs titulaires d'un compte |
| Données | Adresse e-mail, mot de passe (haché par Supabase Auth), langue de l'interface, version des CGU acceptée et date ; entreprise de l'utilisateur : nom, SIREN, adresse, numéro de TVA, coordonnées de paiement, apparence, logo et police déposés ; traces du serveur d'authentification (inscription, connexions, et pour certains évènements l'adresse IP) |
| Destinataires | Supabase (hébergement, authentification, stockage) ; Brevo (e-mails du compte : confirmation, mot de passe oublié, changement d'adresse) |
| Transferts hors de l'UE | Singapour (Supabase Pte. Ltd., la société avec laquelle facturx contracte) et États-Unis (Supabase Inc., support et exploitation), quand ces tâches l'exigent ; encadrés par les clauses contractuelles types de la décision 2021/914, reprises dans l'accord de traitement des données de Supabase |
| Durées | Tant que le compte existe ; à sa suppression, 30 jours de délai de grâce, puis effacement à la première passe de nuit qui suit ; journaux techniques de l'hébergeur : un jour ; aucune sauvegarde (D77) |
| Sécurité | Section 3 |

### 1.2 Le journal des statistiques du site

| | |
|---|---|
| Finalité | Mesurer la fréquentation du site (rapport GoAccess, sur le serveur de l'éditeur, protégé par un mot de passe), dont le décompte des PDF produits et des fichiers contrôlés |
| Base légale | Intérêt légitime (article 6.1.f) |
| Personnes concernées | Les visiteurs du site |
| Données | Adresse IP tronquée de son dernier octet à l'écriture, page demandée, page d'origine (referer), navigateur, date |
| Destinataires | Aucun : le serveur de l'éditeur, loué chez Hetzner Online GmbH à Falkenstein (Allemagne) |
| Transferts hors de l'UE | Aucun |
| Durée | 13 mois : les lignes plus anciennes sont effacées chaque nuit |

### 1.3 Le journal d'exploitation du site

| | |
|---|---|
| Finalité | Diagnostiquer le fonctionnement du site |
| Base légale | Intérêt légitime (article 6.1.f) |
| Personnes concernées | Les visiteurs du site |
| Données | Adresse IP complète, page demandée, page d'origine (referer), navigateur, date |
| Destinataires | Aucun : le serveur de l'éditeur, chez Hetzner (Allemagne) |
| Transferts hors de l'UE | Aucun |
| Durée | Effacé à chaque mise à jour du site |

## 2. Les traitements faits pour le compte des utilisateurs

| | |
|---|---|
| Responsables du traitement | Chaque utilisateur titulaire d'un compte, pour les données de ses clients. Leur liste (adresse du compte, entreprise) se lit dans la base de production, en lecture seule ; elle n'est pas recopiée ici, le dépôt étant public |
| Catégories de traitements | Héberger et conserver ; émettre les factures (numérotation, contrôle, production du PDF) ; calculer les statuts de paiement et le tableau de bord ; envoyer les relances que l'utilisateur demande ; exporter et supprimer |
| Personnes concernées | Les clients de l'utilisateur quand ce sont des particuliers ou des entrepreneurs individuels, et les interlocuteurs qu'il désigne chez ses clients |
| Données | Nom ou raison sociale, nom de l'interlocuteur, adresse postale, SIREN, SIRET et numéro de TVA, adresse e-mail et téléphone de contact ; contenu des factures (lignes et montants) ; paiements saisis ; relances envoyées (destinataire, objet, texte) |
| Sous-traitants ultérieurs | Supabase (hébergement, authentification, stockage, fonctions du Service ; région `eu-central-1`, Francfort) ; Brevo (envoi des relances ; hébergement dans l'UE) |
| Transferts hors de l'UE | Ceux de Supabase, comme en 1.1 |
| Durée | Celle du compte, jusqu'à l'effacement qui suit sa suppression (accord de sous-traitance, article 10) |
| Sécurité | Section 3 |

## 3. Les mesures de sécurité

Description générale (article 32, paragraphe 1), détaillée dans la politique de confidentialité (article 7) et l'accord de sous-traitance (article 6) :

- des règles d'accès sur chaque table, qui refusent par défaut : un compte ne lit ni n'écrit les données d'un autre ;
- les écritures qui engagent juridiquement (émission, relance) faites uniquement par des fonctions du serveur ; aucune facture émise ne se modifie ni ne se supprime depuis le navigateur ;
- des espaces de stockage privés, ouverts par des liens signés valables 60 secondes ;
- la clé de service de la base, gardée dans les secrets des fonctions du serveur, jamais envoyée au navigateur ;
- un chiffrement au repos par l'hébergeur (pas de chiffrement de bout en bout : le Service lit les factures pour les émettre et les relancer) ;
- **aucune sauvegarde à ce jour** (D77) : l'export est le moyen, pour l'utilisateur, d'en garder une copie. La capacité de rétablir les données après un incident (article 32, paragraphe 1, c) manque donc ; la sauvegarde prévue est décrite dans `docs/compte.md`, 1.12.

## 4. Les accords avec les sous-traitants ultérieurs

- **Supabase.** Son accord de traitement des données (*Data Processing Addendum*) fait partie de ses conditions d'utilisation et prend effet avec elles ; leur acceptation vaut signature des clauses contractuelles types (décision 2021/914 ; module 2 pour les données dont facturx est responsable, module 3, de sous-traitant à sous-traitant, pour celles des clients des utilisateurs). Le sous-traitant est Supabase Pte. Ltd. (Singapour). Supabase annonce ses propres changements de sous-traitants au moins 30 jours à l'avance, à qui s'est abonné à ces annonces (liste : `supabase.com/legal/customer-resources/subprocessor-list`) : s'y abonner, pour suivre qui traite les données en aval. Lu le 9 novembre 2026 sur `supabase.com/legal/customer-resources/data-processing-addendum` : en garder une copie datée.
- **Brevo.** À vérifier : que son accord de traitement des données s'applique au compte (en principe avec ses conditions d'utilisation), et où ses propres sous-traitants traitent les données.

## 5. Ce que les textes engagent à faire

- Annoncer par e-mail, à l'adresse de chaque compte, tout ajout ou remplacement d'un sous-traitant ultérieur au moins 30 jours avant qu'il prenne effet (accord de sous-traitance, article 7). La reprise de la sauvegarde chez Scaleway en est un.
- Prévenir l'utilisateur, par e-mail, d'une violation de données qui touche les données de ses clients au plus tard 48 heures après en avoir pris connaissance (accord de sous-traitance, article 9) ; pour les données dont facturx est responsable, notifier la CNIL dans les 72 heures si la violation présente un risque (article 33).
- Répondre aux demandes d'exercice des droits envoyées à `hello@ibird.dev` dans le mois (article 12, paragraphe 3) ; renvoyer vers l'utilisateur celles qui portent sur les données de ses clients.
