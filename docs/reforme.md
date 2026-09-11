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
| **Adresse de livraison** si différente de l'adresse du client | BG-15 | `delivery.address` ✅ |
| **Nature de l'opération** : livraison de biens / prestation de services / mixte | cadre de facturation BT-23 (`B1` / `S1` / `M1`) | `operationCategory` ✅ — exigée (`FR-OPERATION-CATEGORY`), écrite en BT-23 et relue ; `businessProcessId` explicite pour les autres cadres (autofacturation…) — mapping **à confirmer** contre les spécifications externes en vigueur |
| **Option pour le paiement de la TVA d'après les débits** | BT-8 `DueDateTypeCode` = `5` | `vatOnDebits: true` ✅ — écrit dans chaque ventilation, relu, exclusif de `taxPointDate` (BR-CO-03) ; la mention lisible est à imprimer par votre PDF |
| Mentions FR classiques : SIREN/SIRET vendeur, TVA intracom, date de livraison ou période, pénalités de retard, indemnité forfaitaire de 40 €, escompte | BT-30, BT-31, BT-72/73/74, BT-20 | ✅ validées (`FR-*`), texte BT-20 généré depuis les champs structurés |

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

## Écarts du modèle : couverts

Les quatre écarts identifiés en session 5 sont traités (voir [decisions.md](decisions.md), D30–D33) :

1. **Nature de l'opération** — `operationCategory` exigée, portée par le cadre de facturation BT-23 (`B1`/`S1`/`M1`). Le mapping repose sur les spécifications externes DGFiP telles que comprises à la date de rédaction : **à confirmer** contre la version en vigueur avant mise en production ; `businessProcessId` permet d'imposer toute autre valeur sans attendre une nouvelle version du SDK.
2. **Option TVA sur les débits** — `vatOnDebits`, BT-8 = 5.
3. **SIREN acheteur** — exigé pour un acheteur professionnel établi en France ; `buyer.consumer` pour le B2C.
4. **Avoirs (381)** — lus et écrits avec la même structure.

Restent hors périmètre : autofacturation (cadres `*2`), e-reporting, statuts, UBL.
