/**
 * Aides des tests des Edge Functions, contre la pile locale (`pnpm compte:test`) : un compte neuf,
 * l'appel d'une fonction, une facture et un brouillon d'essai, une connexion directe à la base.
 *
 * `pnpm compte:test` place dans l'environnement l'adresse de la pile et ses clés (`SUPABASE_URL`,
 * `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`). Chaque test crée ses propres
 * comptes, sous une adresse unique : aucun ne dépend d'un autre, ni de l'ordre, ni de ce que la
 * pile contient déjà.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import postgres from 'postgres';
import { toPortableJson } from '../_vendor/shared/portable.ts';
import { aujourdhuiParis } from '../emettre/regles.ts';

/** Le numéro que le Studio propose : le serveur le remplace par celui qu'il attribue. */
export const NUMERO_PROPOSE = 'F-0000-0000';

function env(nom: string): string {
  const valeur = Deno.env.get(nom);
  if (!valeur) throw new Error(`${nom} : à définir (pnpm compte:test le fait).`);
  return valeur;
}

const sansSession = { auth: { persistSession: false, autoRefreshToken: false } };
let client: SupabaseClient | undefined;

/** Client de service de la pile : il passe outre la RLS, pour préparer et vérifier. */
export function admin(): SupabaseClient {
  client ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), sansSession);
  return client;
}

/**
 * Une connexion directe à la base (rôle `postgres`), le temps de `f` : elle est fermée ensuite, de
 * sorte que le test ne laisse aucune opération en cours (contrôle de `deno test`).
 */
export async function base<T>(f: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(env('SUPABASE_DB_URL'), { max: 1, onnotice: () => {} });
  try {
    return await f(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Un compte confirmé, qui a accepté les CGU (sans quoi l'inscription est refusée), et sa session.
 * Le déclencheur de l'inscription lui a créé son entreprise, son membre et sa numérotation.
 */
export async function creerCompte(
  email = `essai-${crypto.randomUUID()}@facturx.test`,
): Promise<{ jwt: string; userId: string; entrepriseId: string }> {
  const password = crypto.randomUUID();
  const cree = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { cgu: '2026-11' },
  });
  if (cree.error) throw new Error(`création du compte : ${cree.error.message}`);
  const userId = cree.data.user.id;

  const anonyme = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), sansSession);
  const connexion = await anonyme.auth.signInWithPassword({ email, password });
  if (connexion.error || !connexion.data.session) {
    throw new Error(`connexion : ${connexion.error?.message ?? 'pas de session'}`);
  }

  const membre = await admin()
    .from('membres')
    .select('entreprise_id')
    .eq('user_id', userId)
    .single();
  if (membre.error) throw new Error(`membre : ${membre.error.message}`);
  return {
    jwt: connexion.data.session.access_token,
    userId,
    entrepriseId: membre.data.entreprise_id,
  };
}

/**
 * Appelle une Edge Function comme le Studio : POST, corps en JSON portable, jeton de la session (un
 * jeton vide n'envoie pas d'en-tête `Authorization`). `enTetes` s'ajoute aux en-têtes.
 */
export function appeler(
  fonction: string,
  jwt: string,
  corps: unknown,
  enTetes: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    apikey: env('SUPABASE_ANON_KEY'),
    ...enTetes,
  };
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  return fetch(`${env('SUPABASE_URL')}/functions/v1/${fonction}`, {
    method: 'POST',
    headers,
    body: toPortableJson(corps),
  });
}

/** `iso` décalée de `jours` jours (dates d'affaires, sans heure). */
export function decaler(iso: string, jours: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

/**
 * La facture d'exemple du site (scripts/example-invoice.mjs), ses lignes répétées jusqu'à `lignes`,
 * totaux par `computeTotals`. Elle est datée de `issueDate` (aujourd'hui à Paris par défaut), livrée
 * le même jour et payable à 30 jours ; elle porte le numéro proposé `NUMERO_PROPOSE`, rappelé en
 * référence de paiement.
 */
export function factureDeTest(lignes = 1, issueDate = aujourdhuiParis(new Date())): Invoice {
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
    id: NUMERO_PROPOSE,
    remittanceInformation: NUMERO_PROPOSE,
    issueDate,
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
    delivery: { date: issueDate },
    references: { purchaseOrder: 'BC-2026-118' },
    lines: Array.from({ length: lignes }, (_, i) => ({ ...modeles[i % 2], id: String(i + 1) })),
    paymentTerms: {
      dueDate: decaler(issueDate, 30),
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

/** L'apparence par défaut du Studio (`defaultAppearance()`), Geist sans logo. */
export function apparenceDeTest(): Record<string, unknown> {
  return {
    template: 'classic',
    accent: '#111111',
    style: {},
    font: 'geist',
    language: 'fr',
    labels: {},
    footer: '',
    display: { facturxNotice: true },
    pageSize: 'A4',
  };
}

/** Un brouillon de l'entreprise, tel que le Studio l'enregistre (version 1). */
export async function brouillonDeTest(
  entrepriseId: string,
): Promise<{ id: string; version: number }> {
  const { data, error } = await admin()
    .from('brouillons')
    .insert({
      entreprise_id: entrepriseId,
      form: { id: NUMERO_PROPOSE },
      appearance: apparenceDeTest(),
    })
    .select('id, version')
    .single();
  if (error) throw new Error(`brouillon : ${error.message}`);
  return data;
}
