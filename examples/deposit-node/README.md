# Exemple — acomptes → facture définitive

Le cas d'usage « acompte » de la réforme (XP Z12-014) : une prestation de 10 000 € HT, un acompte de 30 % à la commande, un de 40 % à mi-parcours, puis la facture définitive.

- **Factures d'acompte** : `typeCode: '386'`, une ligne forfaitaire, TVA exigible au versement, cadre `S1`.
- **Facture définitive** : `typeCode: '380'`, lignes complètes, **`withDeposits(draft, deposits)`** pose le cadre **`S4`** (définitive après acompte), référence les acomptes (BT-25/26) et renvoie `prepaidAmount` = Σ TTC des acomptes, passé à `computeTotals` : le net à payer est TTC − acomptes (BT-113, BR-CO-16).

```bash
pnpm --filter example-deposit-node start
# ┌───┬────────────────┬──────────────────────────┬────────────────────────────────────────────┬──────────┬───────────┬──────────────────┬──────────┬────────────────────────────┐
# │   │ numéro         │ type                     │ cadre                                      │ HT       │ TTC       │ acomptes déduits │ à payer  │ références                 │
# │ 0 │ AC-2026-0001   │ 386 Facture d'acompte    │ S1 — Dépôt d'une facture de prestation …   │ 3000.00  │ 3600.00   │ 0.00             │ 3600.00  │ -                          │
# │ 1 │ AC-2026-0002   │ 386 Facture d'acompte    │ S1 — …                                     │ 4000.00  │ 4800.00   │ 0.00             │ 4800.00  │ -                          │
# │ 2 │ F-2026-0050    │ 380 Facture commerciale  │ S4 — Dépôt d'une facture définitive …      │ 10000.00 │ 12000.00  │ 8400.00          │ 3600.00  │ AC-2026-0001, AC-2026-0002 │
# └───┴────────────────┴──────────────────────────┴────────────────────────────────────────────┴──────────┴───────────┴──────────────────┴──────────┴────────────────────────────┘
# Définitive sans référence aux acomptes → [FR-DEPOSIT-REFERENCE] references.precedingInvoices
```

Les trois Factur-X (PDF + XML) sont écrits dans `out/`, puis relus avec `extractInvoice` pour afficher le tableau — c'est ce que verra la comptabilité du client.
