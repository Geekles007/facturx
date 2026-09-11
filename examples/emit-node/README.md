# Exemple — émission (Node)

Votre application a déjà un modèle de facture et un générateur de PDF. Cet exemple montre les **trois lignes** qui manquent pour émettre un Factur-X conforme :

1. `toFacturX(app)` — traduire votre modèle en `Invoice` typée ([src/to-facturx.ts](src/to-facturx.ts)). Les montants arrivent en **chaînes décimales** (`"800.00"`) et sont convertis sans flottant ; les totaux sont calculés explicitement avec `computeTotals`.
2. `validateInvoice(invoice)` — toutes les anomalies avec leur chemin (`lines[1].netAmount`), à afficher dans votre formulaire.
3. `embedFacturX(pdf, { invoice })` — votre PDF + le XML → PDF/A-3 Factur-X.

```bash
pnpm --filter example-emit-node start
# ✓ F-2026-0042 : HT 1685.00 €, TVA 317.43 €, TTC 2002.43 €
#   → out/F-2026-0042.pdf + .xml
```

Modifiez [data/invoice.json](data/invoice.json) (par ex. un SIREN faux, un taux à 0 sur une ligne `S`) pour voir les erreurs typées.

> Le PDF visuel est généré ici avec pdf-lib pour que l'exemple soit autonome ; en production, gardez votre outil de rendu — il doit produire un PDF conforme PDF/A (polices embarquées).
