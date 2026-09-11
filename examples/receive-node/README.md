# Exemple — réception (Node)

À partir du 1er septembre 2026, **toute entreprise** doit pouvoir recevoir des factures électroniques. Cet exemple lit un dossier de PDF reçus et, pour chacun :

- `extractInvoice(bytes)` → la facture typée si le PDF contient un Factur-X (validé EN 16931 + règles FR), `undefined` sinon ;
- `FacturXValidationError` → facture **incohérente** (un TTC qui ne correspond pas à HT + TVA, par ex.) : elle est listée avec le chemin exact de chaque anomalie, jamais « corrigée » ;
- `FacturXParseError` / `FacturXPdfError` → fichier illisible, avec un code.

```bash
pnpm --filter example-receive-node start -- --demo
# ┌─────┬────────────────────────┬───────────────┬──────────────────┬───────────────────────────────┬────────────┬───────────────┐
# │     │ file                   │ status        │ number           │ seller                        │ due        │ amount        │
# │ 0   │ FOURN-2026-101.pdf     │ ok            │ FOURN-2026-101   │ Fournisseur SAS (443061841)   │ 2026-10-11 │ 1440.00 EUR   │
# │ 1   │ FOURN-2026-102.pdf     │ invalide      │                  │                               │            │               │
# │ 2   │ bon-de-livraison.pdf   │ sans-facturx  │                  │                               │            │               │
# └─────┴────────────────────────┴───────────────┴──────────────────┴───────────────────────────────┴────────────┴───────────────┘
#   FOURN-2026-102.pdf: [BR-CO-15] totals.taxInclusiveAmount: Total TTC (BT-112) ≠ BT-109 + BT-110 : attendu 1440.00.
```

`--demo` fabrique trois fichiers dans `inbox/` ; sans l'option, passez le chemin de votre dossier. Le résultat est aussi écrit dans `inbox/received.json`.
