# La réforme de la facturation électronique, vue d'un·e dev

> Ce document est un **guide technique**, pas un avis juridique. Les textes (art. 289 bis CGI, décrets et arrêtés d'application, spécifications externes DGFiP) évoluent : vérifiez toujours la version en vigueur sur [impots.gouv.fr](https://www.impots.gouv.fr) (rubrique « Facturation électronique ») et les spécifications Factur-X du [FNFE-MPE](https://fnfe-mpe.org). Dernière relecture : septembre 2026.

## En une phrase

Toutes les entreprises assujetties à la TVA établies en France devront **recevoir** leurs factures B2B domestiques sous forme électronique structurée dès le **1er septembre 2026**, et les **émettre** ainsi selon leur taille (2026 ou 2027), via des **plateformes agréées** — le PDF « image » envoyé par e-mail ne suffit plus.

## Calendrier

| Date | Obligation | Qui |
|---|---|---|
| **1er septembre 2026** | **Réception** des factures électroniques | **Toutes** les entreprises assujetties, quelle que soit leur taille |
| 1er septembre 2026 | Émission des factures électroniques + e-reporting | Grandes entreprises et ETI |
| **1er septembre 2027** | Émission des factures électroniques + e-reporting | PME, TPE et micro-entreprises |

Conséquence pour une app : la **réception** est le premier chantier, et il concerne tous vos clients dès 2026 — même un indépendant qui n'émettra qu'en 2027 doit pouvoir lire ce qu'il reçoit.

## Les acteurs

- **Plateforme agréée (PA)** — anciennement « PDP » (plateforme de dématérialisation partenaire). Opérateur privé immatriculé par l'administration, obligatoire pour **émettre et recevoir** : votre client en choisit une (ou plusieurs). C'est la PA qui transmet à la PA du destinataire, remonte les données à l'administration, gère les statuts du cycle de vie et l'e-reporting.
- **PPF (portail public de facturation)** — depuis l'annonce d'octobre 2024, le PPF n'est **plus une plateforme d'échange gratuite** : il se limite à l'**annuaire** des destinataires et au **concentrateur** qui reçoit les données des PA pour la DGFiP.
- **Votre application** — elle produit et consomme les factures au bon format, et parle à la PA choisie par son client via l'API de celle-ci.

```
Votre app ──(Factur-X / UBL / CII)──▶ PA émettrice ──▶ PA réceptrice ──▶ App du client
                                          │                 │
                                          └──▶ concentrateur (DGFiP) ◀──┘
```

## Les formats du « socle »

Trois formats sont acceptés entre plateformes : **Factur-X** (PDF/A-3 lisible + XML CII embarqué), **UBL** (XML pur, norme OASIS) et **CII** (XML pur, UN/CEFACT). Tous trois implémentent le modèle sémantique **EN 16931**.

Factur-X est le choix naturel pour une app qui produit déjà des PDF : le document reste lisible par un humain, et le XML porte les données structurées. **Ce SDK ne fait que Factur-X, au profil EN 16931** (voir [decisions.md](decisions.md), D1).

## Ce que la réforme change dans le contenu des factures

Nouvelles mentions obligatoires (en plus de celles de l'art. L441-9 C. com.) :

| Mention | Où dans Factur-X | Dans le SDK |
|---|---|---|
| **SIREN** du client | BT-47 (`0002`) | `buyer.siren` ✅ — **exigé** pour un acheteur professionnel établi en France (`FR-BUYER-SIREN`), clé de Luhn vérifiée ; `buyer.consumer: true` pour un particulier (B2C) |
| **Adresse de livraison** si différente de l'adresse du client | BG-15, règle **BR-FR-14** | `delivery.address` ✅ — si fournie : ligne 1, ville, code postal, pays exigés ; refusée pour une prestation de services |
| **Nature de l'opération** : livraison de biens / prestation de services / mixte | cadre de facturation BT-23 (`B1` / `S1` / `M1`), règle **BR-FR-08** | `operationCategory` ✅ — exigée, écrite en BT-23 et relue ; `businessProcess` pour les 12 autres cadres (`*2` déjà payée, `*4` définitive après acompte, `S5`/`S6` sous-/cotraitance, `*7` déjà e-reportée). **Mapping confirmé** par la norme AFNOR XP Z12-012 |
| **Option pour le paiement de la TVA d'après les débits** | BT-8 `DueDateTypeCode` = `5` (CII), règle **BR-FR-MAP-03** | `vatOnDebits: true` ✅ — écrit dans chaque ventilation, relu, exclusif de `taxPointDate` (BR-CO-03). **Confirmé** par XP Z12-012 (« valeurs 5 en CII et 3 en UBL ») ; la mention lisible est à imprimer par votre PDF |
| Pénalités de retard, indemnité forfaitaire de 40 €, escompte | **notes BG-1 codées `PMD`, `PMT`, `AAB`** (règles **BR-FR-05/06** : une fois chacune) + texte BT-20 | ✅ générées depuis `paymentTerms` (`latePenaltyRate`, `recoveryIndemnity`, `earlyPaymentDiscount`) ou fournies dans `notes` ; validées |
| SIREN/SIRET vendeur, TVA intracom, date de livraison ou période | BT-30/BT-29 (**BR-FR-09/10**), BT-31, BT-72/73/74 | ✅ validées |
| Numéro de facture, années, catégories et taux de TVA français | **BR-FR-01/02** (≤ 35 caractères, `A-Z a-z 0-9 - + _ /`), **BR-FR-03** (2000–2099), **BR-FR-15** (S, E, AE, K, G, O, Z), **BR-FR-16** (liste fermée des taux) | ✅ validées |

## E-reporting

En parallèle des factures B2B domestiques, les entreprises transmettent à l'administration (via leur PA) des **données de transaction** pour les opérations hors champ de la facturation électronique (B2C, international) et des **données de paiement** pour les prestations de services. C'est un flux distinct, porté par la PA. **Hors périmètre du SDK.**

## Statuts du cycle de vie

Chaque facture suit un cycle de statuts échangés entre plateformes : *déposée*, *rejetée* (par la plateforme), *refusée* (par le client), *encaissée*… Certains sont obligatoires. Ils sont **gérés par la PA** ; votre app les consomme via l'API de la PA. **Hors périmètre du SDK.**

## Sanctions

À titre indicatif (art. 1737 CGI, à vérifier) : **15 € par facture** non émise sous forme électronique, plafonnés à **15 000 € par an** ; **250 € par transmission** d'e-reporting manquante, plafonnés à **45 000 € par an**. Une tolérance est prévue pour une première infraction. Au-delà des amendes, une facture non conforme peut être **refusée par le client** — c'est le vrai risque opérationnel : le paiement ne part pas.

## Ce que le SDK fait / ne fait pas

| Besoin | `facturx-sdk` |
|---|---|
| Produire le XML CII EN 16931 et l'embarquer dans un PDF/A-3 | ✅ `toCiiXml`, `embedFacturX` |
| Vérifier avant d'émettre (totaux, TVA, SIREN, IBAN, mentions FR) sans jamais « corriger » en silence | ✅ `validateInvoice` — erreurs typées avec chemin de champ |
| Lire une facture reçue (PDF ou XML) en objet typé | ✅ `extractInvoice`, `fromCiiXml` |
| Fonctionner en edge / serverless / navigateur | ✅ zéro dépendance native ; `pdf-lib` uniquement dans `./pdf` |
| Produire un PDF/A à partir de n'importe quel PDF | ❌ votre outil de rendu doit produire un PDF/A (polices embarquées) ; le SDK ajoute la couche Factur-X |
| Avoirs (381) | ✅ même structure, montants positifs, facture d'origine dans `references.precedingInvoices` |
| UBL, CII nu, autres profils Factur-X (MINIMUM, BASIC, EXTENDED) | ❌ (lecture tolérante des autres profils, écriture EN 16931 seulement) |
| Envoyer à une PA, statuts, e-reporting, annuaire | ❌ API de la PA |
| Archivage à valeur probante | ❌ votre stockage (ou la PA) |

## Checklist « mon app est-elle prête ? »

**Réception (tous, 1er septembre 2026)**
- [ ] Je reçois les factures depuis l'API de la PA de mon client (webhook ou polling).
- [ ] Je lis chaque PDF/XML en objet typé : `extractInvoice(pdf)` / `fromCiiXml(xml)` — [exemple](../examples/receive-node).
- [ ] Une facture incohérente est **mise en anomalie** avec le détail (`FacturXValidationError.issues`), pas intégrée telle quelle.
- [ ] Je conserve le fichier original (archivage) et je remonte les statuts à la PA.

**Émission (2026 ou 2027 selon la taille)**
- [ ] Mon modèle porte les nouvelles mentions : `buyer.siren` (ou `buyer.consumer`), `delivery.address`, `operationCategory`, `vatOnDebits` si l'option est exercée.
- [ ] Je produis l'`Invoice` avec des **montants entiers** (`centsFromDecimal`, jamais de float) et des totaux calculés explicitement (`computeTotals`) — [exemple](../examples/emit-node).
- [ ] `validateInvoice` est branché dans mon formulaire : les erreurs sont affichées **avant** l'envoi, par champ.
- [ ] Mon générateur de PDF produit du PDF/A (polices embarquées, pas de chiffrement), puis `embedFacturX` — [handler HTTP](../examples/http-handler).
- [ ] J'envoie le fichier à la PA et je stocke l'identifiant retourné.

## Adresses électroniques et routage

Pour qu'une plateforme agréée route la facture, l'acheteur porte une **adresse électronique** (BT-49) au schéma **0225** : `SIREN` ou `SIREN_XXX` (`electronicAddress0225(siren, suffixe)`), et éventuellement un **code de routage** (BT-46, schéma 0224, `routingCode`) désignant un service. Le champ `processing` (note `BAR`, BR-FR-20) dit à la plateforme quel traitement attendre ; en `B2B` (e-invoicing), le SDK exige l'adresse 0225 du destinataire et vérifie qu'elle commence par son SIREN (BR-FR-21/22) — en autofacturation, c'est celle du vendeur. Hors e-invoicing, tout schéma EAS est accepté, e-mail compris (`EM`).

## Pièces jointes

Un bon de commande, un RIB, un bordereau : `attachments` (BG-24) les embarque en base64 dans le XML (`file: { filename, mimeType, bytes }`, types MIME de BR-CL-24 : PDF, PNG, JPEG, CSV, XLSX, ODS) ou les référence par URI (`uri`). La description BT-123 prend de préférence un qualificatif de BR-FR-17 (`BON_COMMANDE`, `RIB`, `LISIBLE`, `ETAT_ACOMPTE`…) ; une seule pièce `LISIBLE` par facture (BR-FR-18). Les octets reviennent à l'identique à la lecture.

## Acomptes

Cas d'usage fréquent (XP Z12-014) : un ou plusieurs **acomptes** puis une **facture définitive**.

- Chaque acompte est une facture à part entière, `typeCode: '386'`, avec sa ligne (« Acompte 30 % sur … ») et sa TVA — exigible au versement, pour les biens comme pour les services.
- La facture définitive reprend les **lignes complètes**, porte le cadre **`B4` / `S4` / `M4`** (définitive après acompte), **référence** chaque acompte (BT-25/26) et **déduit** leur TTC via BT-113 : `net à payer = TTC − acomptes` (BR-CO-16).

```ts
import { computeTotals, withDeposits } from 'facturx-sdk';

const { draft, prepaidAmount } = withDeposits(finalDraft, [deposit1, deposit2]); // cadre *4 + références
const finalInvoice = { ...draft, ...computeTotals(draft, { prepaidAmount }) };   // BT-113 et net à payer
```

`withDeposits` refuse un acompte qui n'est pas de type 386 ou dans une autre devise ; la validation refuse une définitive `*4` sans référence (`FR-DEPOSIT-REFERENCE`) et un net à payer qui n'a pas déduit les acomptes (BR-CO-16). Exemple complet : [examples/deposit-node](../examples/deposit-node).

## Conformité AFNOR XP Z12-012 : ce qui est vérifié

La norme **AFNOR XP Z12-012** (formats et profils du socle, juillet 2025) fixe les règles françaises `BR-FR-xx` que les plateformes agréées appliquent. Le SDK en implémente le noyau applicable à une facture EN 16931, avec les identifiants officiels comme codes d'anomalie. **Chaque fichier de référence du SDK est validé en CI par les schematrons officiels** — CEN EN 16931 (syntaxe CII), profil Factur-X EN 16931 et **BR-FR Flux 2 V1.3.0** — exécutés avec Saxon-JS (`test/schematron.test.ts`), en plus du XSD et de veraPDF :

| Règle | Objet | Dans le SDK |
|---|---|---|
| BR-FR-01 / 02 | numéro de facture : 35 caractères max, `A-Z a-z 0-9 - + _ /` | `id` |
| BR-FR-03 | années entre 2000 et 2099 | toutes les dates |
| BR-FR-04 | types de document : 380, 384, 386, 389, 393, 381, 261, 262, 396 (les 7 codes « en attente d'intégration EN 16931 » restent refusés) | `typeCode` |
| BR-FR-05 / 06 | notes `PMD`, `PMT`, `AAB` obligatoires, une fois chacune (+ `TXD` au plus une fois) | générées depuis `paymentTerms` ou fournies dans `notes` |
| BR-FR-08 | cadre de facturation BT-23 ∈ {B1, S1, M1, B2, S2, M2, B4, S4, M4, S5, S6, B7, S7}, cohérent avec la nature de l'opération | `operationCategory`, `businessProcess` |
| BR-FR-09 | SIRET cohérent avec le SIREN | `siret` / `siren` |
| BR-FR-10 / 11 | SIREN vendeur obligatoire ; SIREN acheteur obligatoire (e-invoicing) | `seller.siren`, `buyer.siren` (`buyer.consumer` pour le B2C) |
| BR-FR-12 / 13 / 21 / 22 | adresse électronique de l'acheteur (BT-49) obligatoire (sauf `buyer.consumer`) ; en e-invoicing (`processing: 'B2B'`), schéma 0225 commençant par le SIREN — du vendeur en autofacturation | `electronicAddress`, `processing` |
| BR-FR-14 | adresse de livraison fournie ⇒ BT-75/77/78/80 présents ; jamais pour une prestation de services | `delivery.address` |
| BR-FR-15 / 16 | catégories de TVA S, E, AE, K, G, O, Z ; taux dans la liste française | `tax.category`, `tax.rate` |
| BR-FR-17 / 18 | pièces jointes BG-24 : qualificatifs (`BON_COMMANDE`, `RIB`, `LISIBLE`…), une seule `LISIBLE` | `attachments` |
| BR-FR-20 | traitement attendu (note `BAR` : B2B, B2BINT, B2C, OUTOFSCOPE, ARCHIVEONLY) | `processing` |
| BR-FR-23 / 25 | adresse 0225 : `A-Z a-z 0-9 - _ .` ; toute adresse ≤ 125 caractères | `electronicAddress` |
| BR-FR-24 / 26 | code de routage 0224 : mêmes caractères, ≤ 100 | `routingCode` |
| BR-FR-MAP-03 | TVA sur les débits : BT-8 = 5 en CII | `vatOnDebits` |

Non implémentées : BR-FR-07 (codes de notes libres — disponibles dans `NoteSubjectCode`, aucune contrainte à vérifier), BR-FR-10/11 « présent et actif dans l'annuaire » (vérification en ligne, rôle de la plateforme agréée), BR-FR-19 (100 Mo par facture, contrôle de la plateforme). **Toutes les règles vérifiables hors ligne sur le contenu d'une facture sont couvertes.** Règle maison en complément : `FR-DEPOSIT-REFERENCE` — une facture définitive après acompte (cadre `*4`) doit référencer ses factures d'acompte (BT-25).

## Écarts du modèle : couverts

Les quatre écarts identifiés en session 5 sont traités et, depuis la session 10, **confirmés contre la norme AFNOR** (voir [decisions.md](decisions.md), D30–D33 et D39–D41) :

1. **Nature de l'opération** — `operationCategory` exigée, portée par le cadre de facturation BT-23 (`B1`/`S1`/`M1`, règle BR-FR-08) ; `businessProcess` pour les autres cadres.
2. **Option TVA sur les débits** — `vatOnDebits`, BT-8 = 5 (règle BR-FR-MAP-03).
3. **SIREN acheteur** — exigé pour un acheteur professionnel établi en France (BR-FR-11) ; `buyer.consumer` pour le B2C.
4. **Avoirs (381)** — lus et écrits avec la même structure ; depuis 0.3.0, aussi les acomptes (386), rectificatives (384), documents auto-facturés (389, 261), affacturés (393, 396) et avoirs pour remise globale (262).

Restent hors périmètre : e-reporting, statuts, UBL.
