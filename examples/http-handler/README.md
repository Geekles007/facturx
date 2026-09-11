# Exemple — handler HTTP Web standard

Un seul fichier, [src/handler.ts](src/handler.ts), qui n'utilise que `Request` / `Response` / `FormData` : **aucune dépendance de framework**. Copiez-le dans votre projet :

```ts
// Next.js — app/api/facturx/[action]/route.ts
import { handleFacturX } from '@/lib/facturx-handler';
export const POST = (request: Request) => handleFacturX(request);
```

```ts
// Hono
app.post('/api/facturx/*', (c) => handleFacturX(c.req.raw));
```

```ts
// Cloudflare Workers / Deno / Bun
export default { fetch: handleFacturX };
```

| Route | Entrée | Sortie |
|---|---|---|
| `POST …/emit` | `multipart/form-data` : `pdf` (fichier), `invoice` (JSON `Invoice`) | `application/pdf` Factur-X, ou `422 { issues[] }` |
| `POST …/receive` | `application/pdf` | `200 { invoice, filename, conformanceLevel }`, `404` sans Factur-X, `422 { issues[] }` si incohérente |

```bash
pnpm --filter example-http-handler start
# POST /emit    → 200 application/pdf attachment; filename="API-2026-007.pdf"
# POST /receive → 200 API-2026-007 EN 16931 588 EUR
# POST /emit    → 422 BR-CO-15@totals.taxInclusiveAmount, BR-CO-16@totals.amountDueForPayment
```

> `embedFacturX` tourne dans un runtime edge (pas d'API Node) ; le handler aussi.
