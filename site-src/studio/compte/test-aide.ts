/**
 * Aides des tests du compte contre la pile Supabase locale : un compte neuf, le client de service,
 * un jeton que le serveur refuse, une facture insérée comme `emettre` l'enregistre. Et, sans pile,
 * ce que les tests de la relance partagent : un refus d'Edge Function, une facture en retard.
 *
 * Les variables sont celles de `supabase status -o env`, que le job CI `compte` pose sans les
 * afficher : `SUPABASE_URL` (`API_URL`), `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Chaque
 * appel de `compteDeTest` crée son propre compte, sous une adresse unique : aucun test ne dépend
 * d'un autre, ni de l'ordre, ni de ce que la pile contient déjà.
 *
 * Seuls des tests importent ce module : il n'entre pas dans le bundle du Studio.
 */

import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { defaultAppearance, defaultNumbering, type Numbering } from '../library.js';
import { ErreurConservation, type Persistence } from '../persistence.js';
import type { DonneesRelance } from './relances.js';
import { aujourdhuiParis, type LigneSuivi } from './suivi.js';

function variable(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} : à définir (voir supabase status -o env).`);
  return valeur;
}

const sansSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Client de service de la pile : il passe outre la RLS, pour préparer et vérifier. */
export function adminDeTest(): SupabaseClient {
  return createClient(variable('SUPABASE_URL'), variable('SUPABASE_SERVICE_ROLE_KEY'), sansSession);
}

/** Où `supabase-js` range la session des clients de test : une mémoire par client. */
const CLE_SESSION = 'sb-essai-auth-token';
const memoires = new WeakMap<SupabaseClient, Map<string, string>>();

/**
 * Un compte confirmé, qui a accepté les CGU (sans quoi l'inscription est refusée), connecté par un
 * client à lui, et l'entreprise que l'inscription lui a créée. Le client ne renouvelle pas son
 * jeton de lui-même : un test ne laisse aucune minuterie derrière lui.
 */
export async function compteDeTest(): Promise<{ sb: SupabaseClient; entrepriseId: string }> {
  const email = `essai-${crypto.randomUUID()}@facturx.test`;
  const password = crypto.randomUUID();
  const cree = await adminDeTest().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { cgu: '2026-11' },
  });
  if (cree.error) throw new Error(`création du compte : ${cree.error.message}`);

  const memoire = new Map<string, string>();
  const sb = createClient(variable('SUPABASE_URL'), variable('SUPABASE_ANON_KEY'), {
    auth: {
      storageKey: CLE_SESSION,
      storage: {
        getItem: (cle) => memoire.get(cle) ?? null,
        setItem: (cle, valeur) => {
          memoire.set(cle, valeur);
        },
        removeItem: (cle) => {
          memoire.delete(cle);
        },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const connexion = await sb.auth.signInWithPassword({ email, password });
  if (connexion.error) throw new Error(`connexion : ${connexion.error.message}`);
  memoires.set(sb, memoire);

  const membre = await sb
    .from('membres')
    .select('entreprise_id')
    .eq('user_id', cree.data.user.id)
    .single<{ entreprise_id: string }>();
  if (membre.error) throw new Error(`membre : ${membre.error.message}`);
  return { sb, entrepriseId: membre.data.entreprise_id };
}

/** Une partie d'un JWT, décodée. */
const decoder = (partie: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(partie, 'base64url').toString('utf8'));
const encoder = (valeur: unknown): string =>
  Buffer.from(JSON.stringify(valeur), 'utf8').toString('base64url');

/**
 * Remplace le jeton de la session du client par un jeton expiré depuis une heure : un onglet resté
 * ouvert pendant que la session prenait fin. La session conservée garde son `expires_at`, de sorte
 * que `supabase-js` croit le jeton bon, ne tente aucun renouvellement et l'envoie ; le serveur le
 * refuse (401). La pile ne donne pas de quoi signer un jeton : celui-ci garde la signature de
 * l'ancien, qui ne correspond plus, et le serveur le refuse de la même façon.
 *
 * Rend de quoi rétablir la session d'avant, comme une reconnexion.
 */
export function perimerJeton(sb: SupabaseClient): () => void {
  const memoire = memoires.get(sb);
  const texte = memoire?.get(CLE_SESSION);
  if (!memoire || !texte) throw new Error('perimerJeton : client sans session de test');
  const session = JSON.parse(texte) as { access_token: string };
  const [entete = '', charge = '', signature = ''] = session.access_token.split('.');
  const perime = { ...decoder(charge), exp: Math.floor(Date.now() / 1000) - 3600 };
  session.access_token = `${entete}.${encoder(perime)}.${signature}`;
  memoire.set(CLE_SESSION, JSON.stringify(session));
  return () => memoire.set(CLE_SESSION, texte);
}

/** Un PDF de test : `relancer` le joint tel quel, et le simulateur d'envoi vérifie seulement `%PDF`. */
const PDF_DE_TEST = new TextEncoder().encode('%PDF-1.7\n% essai\n%%EOF\n');

/**
 * Une facture insérée comme `emettre` l'enregistre, par la clé de service. Rend son identifiant.
 * Sans PDF, sauf `pdf` (déposé au chemin de la facture : la relance le joint à son e-mail).
 *
 * Son numéro est unique sur toute la pile : ces lignes y restent (une facture ne se supprime pas), à
 * côté des jeux de données des tests de la base (supabase/tests/), qui numérotent les leurs `F-1`,
 * `A-1`… (03-suivi.test.sql les retrouve par entreprise, et s'assure que des factures d'une autre
 * entreprise aux mêmes numéros ne le gênent pas).
 */
export async function insererFacture(
  entrepriseId: string,
  options: {
    prefixe: string;
    /** Le numéro, s'il doit être celui-là ; sinon un numéro unique tiré du préfixe. */
    numero?: string;
    typeCode?: string;
    ht?: number;
    ttc?: number;
    devise?: string;
    /** Dates `AAAA-MM-JJ` : émise aujourd'hui (à Paris) et sans échéance, sauf mention contraire. */
    emission?: string;
    echeance?: string;
    origine?: string;
    pdfChemin?: (id: string) => string;
    clientEmail?: string;
    form?: unknown;
    appearance?: unknown;
    pdf?: boolean;
  },
): Promise<string> {
  const admin = adminDeTest();
  const membre = await admin.from('membres').select('user_id').eq('entreprise_id', entrepriseId);
  const id = crypto.randomUUID();
  const ttc = options.ttc ?? 12000;
  const pdfChemin = options.pdfChemin?.(id) ?? `${entrepriseId}/${id}.pdf`;
  const { error } = await admin.from('factures').insert({
    id,
    entreprise_id: entrepriseId,
    numero: options.numero ?? `${options.prefixe}-SUIVI-${id.slice(0, 8)}`,
    type_code: options.typeCode ?? '380',
    date_emission: options.emission ?? aujourdhuiParis(),
    date_echeance: options.echeance ?? null,
    client_nom: 'Client',
    client_email: options.clientEmail ?? null,
    devise: options.devise ?? 'EUR',
    ht: options.ht ?? 10000,
    ttc,
    net_a_payer: ttc,
    invoice: {},
    form: options.form ?? {},
    appearance: options.appearance ?? defaultAppearance(),
    pdf_chemin: pdfChemin,
    sdk_version: 'essai',
    origine: 'emise',
    facture_origine_id: options.origine ?? null,
    emise_par: membre.data?.[0]?.user_id,
  });
  if (error) throw new Error(`facture : ${error.message}`);
  if (options.pdf) {
    const depot = await admin.storage
      .from('factures')
      .upload(pdfChemin, PDF_DE_TEST, { contentType: 'application/pdf' });
    if (depot.error) throw new Error(`PDF de test : ${depot.error.message}`);
  }
  return id;
}

// ---------- une conservation en mémoire, sans pile ----------

/**
 * Une conservation en mémoire, et le journal de ses écritures (import, restauration d'un export).
 * `compte` (par défaut) : comme celle du compte, elle refuse d'écrire une facture ou un PDF (seul le
 * serveur émet et importe) et, comme le déclencheur de la base, de faire reculer la numérotation ;
 * elle part d'une numérotation initiale de 2026. `local` : comme IndexedDB, elle prend tout.
 */
export function conservationEnMemoire(
  options: { mode?: 'compte' | 'local'; numerotation?: Numbering } = {},
) {
  const compte = (options.mode ?? 'compte') === 'compte';
  const kv = new Map<string, unknown>();
  if (compte) kv.set('numbering', options.numerotation ?? { ...defaultNumbering(), year: 2026 });
  const listes = {
    invoices: new Map<string, unknown>(),
    clients: new Map<string, unknown>(),
    products: new Map<string, unknown>(),
  };
  const fichiers = new Map<string, Uint8Array>();
  const journal: string[] = [];
  const p: Persistence = {
    available: async () => true,
    get: async <T>(cle: string) => structuredClone(kv.get(cle)) as T | undefined,
    async set(cle, valeur) {
      const avant = kv.get('numbering') as Numbering | undefined;
      if (compte && cle === 'numbering' && avant && (valeur as Numbering).next < avant.next) {
        throw new ErreurConservation('REFUS', 'NUMEROTATION_RECUL');
      }
      journal.push(`set ${cle}`);
      kv.set(cle, structuredClone(valeur));
      return cle;
    },
    list: async <T>(magasin: 'invoices' | 'clients' | 'products') =>
      [...listes[magasin].values()] as T[],
    async put(magasin, valeur) {
      if (compte && magasin === 'invoices') throw new ErreurConservation('EMISSION_SERVEUR');
      journal.push(`put ${magasin} ${valeur.uid}`);
      listes[magasin].set(valeur.uid, structuredClone(valeur));
      return valeur.uid;
    },
    async remove(magasin, cle) {
      journal.push(`remove ${magasin} ${cle}`);
      if (magasin !== 'kv' && magasin !== 'files') listes[magasin].delete(cle);
      return undefined;
    },
    getFile: async (cle) => fichiers.get(cle),
    async setFile(cle, octets) {
      if (compte && cle.startsWith('pdf-')) throw new ErreurConservation('EMISSION_SERVEUR');
      journal.push(`setFile ${cle}`);
      fichiers.set(cle, octets);
      return cle;
    },
    dump: async () => ({}),
  };
  return { p, kv, listes, fichiers, journal };
}

// ---------- la relance, sans pile ----------

/** Un refus d'Edge Function, tel que `functions.invoke` le rend (`corps` : un objet, ou du texte brut). */
export const refusDeFonction = (statut: number, corps: unknown) => ({
  data: null,
  error: new FunctionsHttpError(
    new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), {
      status: statut,
      headers: { 'content-type': 'application/json' },
    }),
  ),
});

/** Une facture en retard, telle que la vue de suivi la rend. */
export const LIGNE_EN_RETARD: LigneSuivi = {
  factureId: 'f-1',
  entrepriseId: 'e-1',
  numero: 'F-2026-0042',
  typeCode: '380',
  dateEmission: '2026-09-11',
  dateEcheance: '2026-10-11',
  clientId: null,
  clientNom: 'Client Démo SARL',
  clientEmail: 'compta@client-demo.fr',
  devise: 'EUR',
  ht: 102880,
  ttc: 123456,
  netAPayer: 123456,
  encaisse: 0,
  avoirs: 0,
  resteDu: 123456,
  statut: 'en_retard',
  joursRetard: 27,
};

/** Les données d'une relance à un professionnel, avec tout ce que la facture peut porter. */
export const DONNEES_DE_TEST: DonneesRelance = {
  numero: 'F-2026-0042',
  echeance: '2026-10-11',
  resteDu: 123456,
  devise: 'EUR',
  entreprise: 'Atelier Exemple SAS',
  iban: 'FR7630006000011234567890189',
  reference: 'F-2026-0042',
  penalites: '10',
  indemnite: 4000,
};
