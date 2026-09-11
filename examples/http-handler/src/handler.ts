/**
 * Handler HTTP **Web standard** : ne dépend que de `Request`, `Response`, `FormData`.
 * Il fonctionne tel quel dans :
 *   - Next.js (app router)  : `export const POST = (req: Request) => handleFacturX(req)`
 *   - Hono                  : `app.post('/facturx/*', (c) => handleFacturX(c.req.raw))`
 *   - Cloudflare Workers    : `export default { fetch: handleFacturX }`
 *   - Deno / Bun            : `Deno.serve(handleFacturX)` / `Bun.serve({ fetch: handleFacturX })`
 *
 * Routes :
 *   POST …/emit     multipart/form-data { pdf: File, invoice: JSON (Invoice) }  → application/pdf (Factur-X)
 *   POST …/receive  application/pdf                                             → JSON { invoice, filename, conformanceLevel }
 */
import {
  FacturXParseError,
  FacturXValidationError,
  type Invoice,
  type Issue,
  validateInvoice,
} from '@geekles/facturx';
import { embedFacturX, extractInvoice, FacturXPdfError } from '@geekles/facturx/pdf';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const problem = (status: number, title: string, detail?: unknown) =>
  json({ status, title, detail }, status);

function issuesResponse(issues: readonly Issue[]): Response {
  return json({ status: 422, title: 'Facture invalide', issues }, 422);
}

async function emit(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => undefined);
  const pdf = form?.get('pdf');
  const raw = form?.get('invoice');
  if (!(pdf instanceof Blob) || typeof raw !== 'string') {
    return problem(
      400,
      'Attendu : multipart/form-data avec « pdf » (fichier) et « invoice » (JSON).',
    );
  }
  let invoice: Invoice;
  try {
    invoice = JSON.parse(raw) as Invoice;
  } catch {
    return problem(400, '« invoice » n’est pas un JSON valide.');
  }
  const result = validateInvoice(invoice);
  if (!result.ok) return issuesResponse(result.issues);

  try {
    const bytes = await embedFacturX(await pdf.arrayBuffer(), { invoice });
    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${encodeURIComponent(invoice.id)}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof FacturXPdfError)
      return problem(422, `PDF refusé (${error.code})`, error.message);
    throw error;
  }
}

async function receive(request: Request): Promise<Response> {
  try {
    const found = await extractInvoice(await request.arrayBuffer());
    if (!found) return problem(404, 'Aucune pièce Factur-X dans ce PDF.');
    const { bytes: _bytes, xml: _xml, ...rest } = found;
    return json(rest);
  } catch (error) {
    if (error instanceof FacturXValidationError) return issuesResponse(error.issues);
    if (error instanceof FacturXParseError || error instanceof FacturXPdfError) {
      return problem(422, `Factur-X illisible (${error.code})`, error.message);
    }
    throw error;
  }
}

export async function handleFacturX(request: Request): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'Méthode non autorisée');
  const path = new URL(request.url).pathname;
  if (path.endsWith('/emit')) return emit(request);
  if (path.endsWith('/receive')) return receive(request);
  return problem(404, 'Routes : POST …/emit, POST …/receive');
}
