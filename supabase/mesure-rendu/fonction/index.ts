/**
 * MESURE JETABLE (D74, docs/compte.md, « Confirmer D74 ») : le rendu PDF + l'embarquement Factur-X,
 * chronométrés dans le runtime des Edge Functions. Ce fichier n'est jamais déployé d'ici : on le
 * copie en `supabase/functions/mesure-rendu/index.ts` (dossier non versionné) le temps de la mesure,
 * on déploie, on mesure, puis on supprime la fonction du projet et le dossier. Rangé dans
 * `supabase/mesure-rendu/` (AGPL-3.0-or-later, comme le code qu'il importe), hors de
 * `supabase/functions/` et absent de `config.toml`, il n'est déployé ni par `compte-deploy.yml` ni
 * par un `functions deploy`.
 *
 * C'est la fonction de la mesure locale (tâche 2), avec trois ajouts : le logo, le temps de démarrage
 * du worker et d'import des modules (`modules_ms`), et les mêmes modules que `emettre`, importés pour
 * que ce temps soit le sien.
 *
 * POST { regular, bold: <TTF en base64>, logo?: { base64, type: 'png' | 'jpeg' }, lignes?: 50, runs?: 1 }
 * Rend `runs` fois la facture d'exemple à `lignes` lignes, et renvoie :
 *   - requete : le numéro de la requête dans la vie du worker (1 = worker neuf) ;
 *   - rang_premier : le nombre de rendus que le worker avait déjà faits avant ce lot (0 = le premier
 *     rendu du lot est à froid) ; le rendu i du lot a le rang rang_premier + i ;
 *   - modules_ms : le temps écoulé de la naissance du worker à la fin de l'import des modules (lu une
 *     fois, quand ce module s'évalue) ; il compte à la première requête d'un worker neuf ;
 *   - rendus : les durées brutes (ms) de chaque rendu, dans l'ordre ; l'agrégation se fait hors d'ici ;
 *   - pdf_octets, pages : de quoi s'assurer que le PDF mesuré est celui qu'on croit ;
 *   - decodage_ms, total_ms, memoire (`Deno.memoryUsage()`, si le runtime la donne).
 */

// Les modules de `emettre`, pour que le démarrage d'un worker coûte ici ce qu'il coûte là : le client
// Postgres et supabase-js sont créés sans connexion, rien n'est appelé.
import '../_shared/contexte.ts';
import '../_shared/factures.ts';
import '../_shared/pdf.ts';
import '../_vendor/shared/numerotation.ts';
import {
  assertValidInvoice,
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  percent,
  quantity,
  unitPrice,
} from 'facturx-sdk';
import { embedFacturX, loadPdf, renderInvoicePdf } from 'facturx-sdk/pdf';
import { renderOptions } from '../_vendor/shared/rendu.ts';
import { SRGB_ICC_BASE64 } from '../_vendor/srgb.ts';

/** Évalué une fois, après tous les imports : le temps depuis l'origine du worker. */
const MODULES_MS = performance.now();

let requetes = 0;
/** Rendus déjà faits par ce worker : 0 = le prochain est à froid. */
let rendus = 0;

const octets = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** La facture d'exemple de scripts/example-invoice.mjs, ses deux lignes répétées jusqu'à `lignes`. */
function factureExemple(lignes: number): Invoice {
  const modeles = [
    {
      name: "Conception d'identité visuelle",
      description: 'Logotype, palette, règles typographiques',
      quantity: quantity(40000),
      unitCode: 'DAY',
      unitPrice: unitPrice(7200000),
      netAmount: cents(288000),
      tax: { category: 'S' as const, rate: percent('20') },
    },
    {
      name: 'Déclinaison des supports imprimés',
      quantity: quantity(20000),
      unitCode: 'DAY',
      unitPrice: unitPrice(7200000),
      netAmount: cents(144000),
      tax: { category: 'S' as const, rate: percent('20') },
    },
  ];
  const brouillon = {
    id: 'FA-2026-0042',
    remittanceInformation: 'FA-2026-0042',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'services',
    buyerReference: 'BC-2026-118',
    seller: {
      name: 'Atelier Exemple SAS',
      siren: '443061841',
      siret: '44306184110004',
      vatId: 'FR64443061841',
      legalInfo: 'SAS au capital de 10 000 € — RCS Paris 443 061 841',
      address: {
        line1: '12 rue de la Facture',
        postCode: '75011',
        city: 'Paris',
        countryCode: 'FR',
      },
      contact: { email: 'facturation@exemple.fr' },
      electronicAddress: { value: '443061841', scheme: '0225' },
    },
    buyer: {
      name: 'Client Démo SARL',
      siren: '732829320',
      vatId: 'FR44732829320',
      address: { line1: '5 avenue du Client', postCode: '69002', city: 'Lyon', countryCode: 'FR' },
      electronicAddress: { value: '732829320', scheme: '0225' },
    },
    delivery: { date: '2026-09-10' },
    references: { purchaseOrder: 'BC-2026-118' },
    lines: Array.from({ length: lignes }, (_, i) => ({ ...modeles[i % 2], id: String(i + 1) })),
    paymentTerms: {
      dueDate: '2026-10-11',
      latePenaltyRate: percent('10'),
      recoveryIndemnity: cents(4000),
      earlyPaymentDiscount: 'none',
    },
    paymentMeans: [
      { typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189', bic: 'BNPAFRPP' } },
    ],
  } as InvoiceDraft;
  return assertValidInvoice({ ...brouillon, ...computeTotals(brouillon) });
}

const arrondi = (ms: number) => Math.round(ms * 10) / 10;

Deno.serve(async (req) => {
  const requete = ++requetes;
  const debut = performance.now();
  const { regular, bold, logo, lignes = 50, runs = 1 } = await req.json();
  const t0 = performance.now();
  const assets = {
    fonts: { regular: octets(regular), bold: octets(bold) },
    ...(logo ? { logo: { bytes: octets(logo.base64), type: logo.type } } : {}),
  };
  const icc = octets(SRGB_ICC_BASE64);
  const decodage = performance.now() - t0;

  // Les options de rendu du Studio par défaut : modèle classic, A4, français ; le logo, s'il est
  // envoyé, à gauche sur 44 points, comme le Studio le place par défaut.
  const options = renderOptions(
    {
      template: 'classic',
      accent: '#111111',
      style: {},
      language: 'fr',
      labels: {},
      footer: '',
      display: { facturxNotice: true },
      pageSize: 'A4',
    },
    assets,
  );

  const facture = factureExemple(lignes);
  const rangPremier = rendus;
  const durees: number[] = [];
  let pdf: Uint8Array = new Uint8Array();
  for (let i = 0; i < runs; i++) {
    const debutRendu = performance.now();
    const page = await renderInvoicePdf(facture, options);
    pdf = await embedFacturX(
      page,
      { invoice: facture },
      { creator: 'facturx-sdk mesure', outputIntent: { iccProfile: icc } },
    );
    durees.push(performance.now() - debutRendu);
    rendus++;
  }
  // Hors chronomètre.
  const pages = (await loadPdf(pdf)).getPageCount();

  let memoire: unknown;
  try {
    memoire = Deno.memoryUsage();
  } catch {
    memoire = 'indisponible';
  }
  return Response.json({
    requete,
    rang_premier: rangPremier,
    modules_ms: arrondi(MODULES_MS),
    lignes,
    rendus: durees.map(arrondi),
    pdf_octets: pdf.length,
    pages,
    decodage_ms: arrondi(decodage),
    total_ms: arrondi(performance.now() - debut),
    memoire,
  });
});
