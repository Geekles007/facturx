# Sécurité

## Signaler une vulnérabilité

Utilisez le **signalement privé de vulnérabilité** de GitHub : [Security → Report a vulnerability](https://github.com/Geekles007/facturx/security/advisories/new). Ne créez pas d'issue publique. Réponse sous 7 jours ouvrés ; correctif publié sur npm avec une entrée CHANGELOG et un avis GitHub.

## Versions supportées

La dernière version mineure publiée sur npm (`facturx-sdk`). Avant 1.0, les versions antérieures ne reçoivent pas de correctif.

## Modèle de menace

Le SDK traite des **entrées non fiables** : un XML CII ou un PDF reçu d'un tiers (`fromCiiXml`, `parseCiiDocument`, `readCiiGuideline`, `extractFacturX`, `extractInvoice`). Ce qu'il garantit :

| Risque | Garantie |
|---|---|
| XXE, expansion d'entités (« billion laughs »), DTD externes | tout `<!DOCTYPE` est refusé ; seules les entités prédéfinies et numériques sont décodées ; aucun accès réseau ni fichier |
| Épuisement mémoire par la taille | limites en octets, vérifiées **avant** lecture : XML 64 Mio, pièce jointe 20 Mio, pièces cumulées 100 Mo (BR-FR-19), PDF 100 Mio — `DEFAULT_LIMITS`, surchargeables par `{ limits }` ; refus typé (`TOO_LARGE`) |
| Récursion par imbrication | profondeur XML bornée (256) |
| Contenu actif | le SDK n'exécute rien : pas de XSLT, de JavaScript PDF ni de macro ; les pièces jointes sont des octets opaques, jamais interprétés |
| Injection XML à l'écriture | échappement systématique du texte et des attributs ; caractères interdits XML 1.0 refusés |
| Nombres | entiers uniquement (centimes, points de base), pas de flottant ; parsing décimal strict, jamais d'arrondi silencieux |

Ce qui reste à la charge de l'application : l'analyse antivirus des pièces jointes et des PDF, les quotas par utilisateur, l'authentification des échanges avec la plateforme agréée, l'archivage à valeur probante.

## Dépendances

Une seule dépendance runtime, `pdf-lib`, chargée uniquement par l'entrée `facturx-sdk/pdf`. Les publications npm portent une attestation de provenance (trusted publishing OIDC).
