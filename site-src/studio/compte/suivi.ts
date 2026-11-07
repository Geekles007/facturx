/**
 * Le suivi des factures du compte : la liste avec leur statut de paiement, les paiements et les
 * relances d'une facture, l'enregistrement et l'annulation d'un paiement, et le PDF.
 *
 * La base calcule : statut, encaissé, avoirs et reste dû viennent de la vue `suivi_factures`
 * (migration 000300), jamais d'une addition faite ici. Les écritures passent par les règles de la
 * base (déclencheurs de la migration 000200) : un paiement ne dépasse pas le reste dû, ne vise pas
 * un avoir ni une date future, et ne vise jamais la facture d'une autre entreprise (42501, sans rien
 * en révéler) ; une annulation pose `annule_le` à l'heure du serveur, une seule fois. Leurs refus
 * deviennent des phrases de l'interface (`t.compte.suivi.erreurs`), jamais des exceptions : les
 * écritures rendent un `Resultat`. Les lectures lèvent une `ErreurSuivi`, dont le message est déjà
 * une phrase de l'interface.
 *
 * Montants en centimes, comme en base. Chargé par `import()` avec le reste du compte.
 */

import { t } from '../i18n.js';
import { type InputError, parseScaled } from '../model.js';
import { store, ui } from '../store.js';
import { client } from './client.js';

export type Statut = 'payee' | 'a_rembourser' | 'en_retard' | 'payee_en_partie' | 'a_payer';

/** Les statuts, dans l'ordre où le filtre les propose : du plus courant au plus rare. */
export const STATUTS: readonly Statut[] = [
  'a_payer',
  'payee_en_partie',
  'en_retard',
  'payee',
  'a_rembourser',
];

export type Moyen = 'virement' | 'cheque' | 'especes' | 'carte' | 'prelevement' | 'autre';
export const MOYENS: readonly Moyen[] = [
  'virement',
  'cheque',
  'especes',
  'carte',
  'prelevement',
  'autre',
];

/** Une ligne de `suivi_factures`, en camelCase : une facture qui n'est pas un avoir. */
export interface LigneSuivi {
  factureId: string;
  entrepriseId: string;
  numero: string;
  typeCode: string;
  dateEmission: string;
  dateEcheance: string | null;
  clientId: string | null;
  clientNom: string;
  clientEmail: string | null;
  devise: string;
  ht: number;
  ttc: number;
  netAPayer: number;
  /** Les paiements non annulés. */
  encaisse: number;
  /** Le TTC des avoirs qui citent la facture. */
  avoirs: number;
  /** `netAPayer − encaisse − avoirs` ; négatif quand on a trop reçu. */
  resteDu: number;
  statut: Statut;
  /** L'âge de l'échéance, pour une facture `en_retard` seulement. */
  joursRetard: number | null;
}

export interface Paiement {
  id: string;
  factureId: string;
  date: string;
  montant: number;
  moyen: Moyen;
  note: string | null;
  creeLe: string;
  /** L'heure de l'annulation, posée par le serveur ; rien pour un paiement actif. */
  annuleLe: string | null;
}

export interface Relance {
  id: string;
  factureId: string;
  niveau: number;
  envoyeeLe: string;
  destinataire: string;
  objet: string;
  /** `envoyee` : le service d'envoi l'a acceptée (rien ne dit qu'elle a été lue). */
  etat: 'envoyee' | 'refusee';
}

export interface FiltresSuivi {
  statut?: Statut | undefined;
  clientId?: string | undefined;
  /** Bornes de la date d'émission, incluses (`AAAA-MM-JJ`). */
  debut?: string | undefined;
  fin?: string | undefined;
}

/** L'issue d'une écriture : faite, ou refusée avec la phrase à afficher. */
export type Resultat = { ok: true } | { ok: false; message: string };

/** Une lecture qui n'a pas abouti ; le message est une phrase de l'interface. */
export class ErreurSuivi extends Error {
  override name = 'ErreurSuivi';
}

// ---------- erreurs ----------

/** Ce que PostgREST, le Storage ou `fetch` rendent d'un échec. */
interface Echec {
  code?: string | undefined;
  message?: string | undefined;
}

/**
 * La phrase de l'interface pour un échec de statut `statut` (0 : pas de réponse). Les codes que
 * lèvent les déclencheurs des paiements (`PAIEMENT_…`) ont chacun la leur ; 42501 est le refus de la
 * base (la facture n'est pas de l'entreprise du compte, ou plus du tout de droits). Ne lève jamais.
 */
export function messageDErreur(echec: Echec | null | undefined, statut: number): string {
  const phrases = t.compte.suivi.erreurs;
  const message = echec?.message ?? '';
  if (statut === 401) return phrases.session;
  switch (message) {
    case 'PAIEMENT_EXCESSIF':
      return phrases.excessif;
    case 'PAIEMENT_DATE':
      return phrases.date;
    case 'PAIEMENT_AVOIR':
      return phrases.avoir;
    case 'PAIEMENT_ANNULATION':
      return phrases.annulation;
  }
  if (echec?.code === '42501' || statut === 403) return phrases.droits;
  if (statut === 0) return phrases.reseau;
  if (statut >= 500) return phrases.serveur;
  // Contraintes de la table (montant positif, moyen connu) ou valeur illisible (date, identifiant).
  if (echec?.code === '23514' || echec?.code === '22P02' || echec?.code === '22007')
    return phrases.invalide;
  return phrases.autre;
}

/**
 * La session est refusée (401) : comme pour l'émission, le Studio la dit expirée et ouvre la
 * connexion ; la saisie en cours reste où elle est.
 */
function sessionRefusee(statut: number): void {
  if (statut !== 401) return;
  const compte = store.get().ui.compte;
  if (compte) ui({ compte: { ...compte, session: 'expiree' }, connexion: 'connexion' });
}

/** Le refus d'une écriture, dit. */
function refus(echec: Echec | null | undefined, statut: number): Resultat {
  sessionRefusee(statut);
  return { ok: false, message: messageDErreur(echec, statut) };
}

/** L'échec d'une lecture, levé. */
function echecDeLecture(echec: Echec | null | undefined, statut: number): ErreurSuivi {
  sessionRefusee(statut);
  return new ErreurSuivi(messageDErreur(echec, statut));
}

/** Le statut d'une réponse de PostgREST : 0 quand rien n'est revenu (réseau). */
const statutDe = (r: { status: number }): number => (Number.isFinite(r.status) ? r.status : 0);

// ---------- contexte ----------

/** Le client et l'entreprise du compte connecté ; sans compte, rien ne part. */
function contexte() {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (!entrepriseId) throw new ErreurSuivi(t.compte.suivi.erreurs.sansCompte);
  return { sb: client(), E: entrepriseId };
}

/** Aujourd'hui à Paris (`AAAA-MM-JJ`), comme la base le compte pour les dates des paiements. */
export function aujourdhuiParis(maintenant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenant);
}

// ---------- montants ----------

/**
 * Le montant saisi, en centimes, lu par l'analyseur de l'éditeur (`parseScaled`, deux décimales) :
 * un montant vide, illisible, nul ou négatif est refusé ici, avec sa phrase, sans appel au serveur.
 */
export function lireMontant(
  texte: string,
): { ok: true; montant: number } | { ok: false; message: string } {
  const phrases = t.compte.suivi.montant;
  const erreurs: InputError[] = [];
  const montant = parseScaled(texte, 2, 'montant', erreurs);
  const erreur = erreurs[0];
  if (erreur?.kind === 'decimals') return { ok: false, message: phrases.decimales };
  if (erreur?.kind === 'negative') return { ok: false, message: phrases.positif };
  if (erreur) return { ok: false, message: phrases.illisible };
  if (montant === undefined) return { ok: false, message: phrases.vide };
  if (montant <= 0) return { ok: false, message: phrases.positif };
  return { ok: true, montant };
}

/** Un montant en centimes, tel qu'on le saisit dans la langue de l'interface (`1234,56`). */
export function montantSaisi(centimes: number): string {
  const abs = Math.abs(centimes);
  const signe = centimes < 0 ? '-' : '';
  const decimales = String(abs % 100).padStart(2, '0');
  return `${signe}${Math.trunc(abs / 100)}${t.lang === 'fr' ? ',' : '.'}${decimales}`;
}

// ---------- lectures ----------

/** PostgREST rend 1 000 lignes au plus par requête : on lit page par page. */
const PAGE = 1000;

const COLONNES_SUIVI =
  'facture_id, entreprise_id, numero, type_code, date_emission, date_echeance, client_id, client_nom, client_email, devise, ht, ttc, net_a_payer, encaisse, avoirs, reste_du, statut, jours_retard';

interface LigneVue {
  facture_id: string;
  entreprise_id: string;
  numero: string;
  type_code: string;
  date_emission: string;
  date_echeance: string | null;
  client_id: string | null;
  client_nom: string;
  client_email: string | null;
  devise: string;
  ht: number | string;
  ttc: number | string;
  net_a_payer: number | string;
  encaisse: number | string;
  avoirs: number | string;
  reste_du: number | string;
  statut: Statut;
  jours_retard: number | null;
}

const versLigne = (l: LigneVue): LigneSuivi => ({
  factureId: l.facture_id,
  entrepriseId: l.entreprise_id,
  numero: l.numero,
  typeCode: l.type_code,
  dateEmission: l.date_emission,
  dateEcheance: l.date_echeance,
  clientId: l.client_id,
  clientNom: l.client_nom,
  clientEmail: l.client_email,
  devise: l.devise,
  // `bigint` : un nombre JSON, ou un texte selon le réglage du serveur.
  ht: Number(l.ht),
  ttc: Number(l.ttc),
  netAPayer: Number(l.net_a_payer),
  encaisse: Number(l.encaisse),
  avoirs: Number(l.avoirs),
  resteDu: Number(l.reste_du),
  statut: l.statut,
  joursRetard: l.jours_retard === null ? null : Number(l.jours_retard),
});

/** Ce que les filtres demandent à une requête de PostgREST. */
interface Filtrable {
  eq(colonne: string, valeur: string): Filtrable;
  gte(colonne: string, valeur: string): Filtrable;
  lte(colonne: string, valeur: string): Filtrable;
}

/**
 * Les filtres de la liste, appliqués à la requête : seuls ceux qui sont renseignés. Chaque filtre
 * rend une requête du même type (celui des requêtes de PostgREST, trop profond pour être déduit).
 */
export function filtrer<Q>(requete: Q, f: FiltresSuivi): Q {
  let q = requete as unknown as Filtrable;
  if (f.statut) q = q.eq('statut', f.statut);
  if (f.clientId) q = q.eq('client_id', f.clientId);
  if (f.debut) q = q.gte('date_emission', f.debut);
  if (f.fin) q = q.lte('date_emission', f.fin);
  return q as unknown as Q;
}

/**
 * Les factures de l'entreprise (avoirs exceptés : ils n'ont pas de statut de paiement), filtrées,
 * la plus récemment émise d'abord.
 */
export async function listerSuivi(f: FiltresSuivi): Promise<LigneSuivi[]> {
  const { sb, E } = contexte();
  const lignes: LigneSuivi[] = [];
  for (let debut = 0; ; debut += PAGE) {
    const r = await filtrer(
      sb.from('suivi_factures').select(COLONNES_SUIVI).eq('entreprise_id', E),
      f,
    )
      .order('date_emission', { ascending: false })
      .order('numero', { ascending: false })
      .range(debut, debut + PAGE - 1);
    if (r.error) throw echecDeLecture(r.error, statutDe(r));
    const lot = (r.data ?? []) as unknown as LigneVue[];
    lignes.push(...lot.map(versLigne));
    if (lot.length < PAGE) return lignes;
  }
}

/** La ligne de suivi d'une facture, relue ; rien si elle n'en a pas (un avoir, une autre entreprise). */
export async function ligneSuivi(factureId: string): Promise<LigneSuivi | undefined> {
  const { sb, E } = contexte();
  const r = await sb
    .from('suivi_factures')
    .select(COLONNES_SUIVI)
    .eq('entreprise_id', E)
    .eq('facture_id', factureId)
    .maybeSingle();
  if (r.error) throw echecDeLecture(r.error, statutDe(r));
  return r.data ? versLigne(r.data as unknown as LigneVue) : undefined;
}

/** Les paiements actifs d'abord, du plus ancien au plus récent, puis les annulés, dans le même ordre. */
export function ordonnerPaiements(paiements: readonly Paiement[]): Paiement[] {
  const chrono = (a: Paiement, b: Paiement) =>
    a.date.localeCompare(b.date) || a.creeLe.localeCompare(b.creeLe);
  return [
    ...paiements.filter((p) => p.annuleLe === null).sort(chrono),
    ...paiements.filter((p) => p.annuleLe !== null).sort(chrono),
  ];
}

interface LignePaiement {
  id: string;
  facture_id: string;
  date: string;
  montant: number | string;
  moyen: Moyen;
  note: string | null;
  cree_le: string;
  annule_le: string | null;
}

/** Les paiements de la facture, annulés compris (ils restent visibles, barrés). */
export async function paiementsDe(factureId: string): Promise<Paiement[]> {
  const { sb, E } = contexte();
  const r = await sb
    .from('paiements')
    .select('id, facture_id, date, montant, moyen, note, cree_le, annule_le')
    .eq('entreprise_id', E)
    .eq('facture_id', factureId)
    .order('cree_le');
  if (r.error) throw echecDeLecture(r.error, statutDe(r));
  return ordonnerPaiements(
    ((r.data ?? []) as LignePaiement[]).map((l) => ({
      id: l.id,
      factureId: l.facture_id,
      date: l.date,
      montant: Number(l.montant),
      moyen: l.moyen,
      note: l.note,
      creeLe: l.cree_le,
      annuleLe: l.annule_le,
    })),
  );
}

interface LigneRelance {
  id: string;
  facture_id: string;
  niveau: number;
  envoyee_le: string;
  destinataire: string;
  objet: string;
  etat: 'envoyee' | 'refusee';
}

/** Les relances de la facture, la plus récente d'abord. */
export async function relancesDe(factureId: string): Promise<Relance[]> {
  const { sb, E } = contexte();
  const r = await sb
    .from('relances')
    .select('id, facture_id, niveau, envoyee_le, destinataire, objet, etat')
    .eq('entreprise_id', E)
    .eq('facture_id', factureId)
    .order('envoyee_le', { ascending: false });
  if (r.error) throw echecDeLecture(r.error, statutDe(r));
  return ((r.data ?? []) as LigneRelance[]).map((l) => ({
    id: l.id,
    factureId: l.facture_id,
    niveau: l.niveau,
    envoyeeLe: l.envoyee_le,
    destinataire: l.destinataire,
    objet: l.objet,
    etat: l.etat,
  }));
}

// ---------- écritures ----------

/**
 * Enregistre un paiement. Un montant qui n'est pas un nombre entier positif de centimes est refusé
 * ici, sans appel ; le reste (reste dû, date, avoir, entreprise) est jugé par la base. Ne lève pas.
 */
export async function enregistrerPaiement(p: {
  factureId: string;
  date: string;
  montant: number;
  moyen: Moyen;
  note?: string | undefined;
}): Promise<Resultat> {
  if (!Number.isSafeInteger(p.montant) || p.montant <= 0)
    return { ok: false, message: t.compte.suivi.montant.positif };
  try {
    const { sb, E } = contexte();
    const r = await sb.from('paiements').insert({
      entreprise_id: E,
      facture_id: p.factureId,
      date: p.date,
      montant: p.montant,
      moyen: p.moyen,
      note: p.note?.trim() || null,
    });
    return r.error ? refus(r.error, statutDe(r)) : { ok: true };
  } catch (erreur) {
    return { ok: false, message: messageDe(erreur) };
  }
}

/**
 * « Marquer comme payée » : enregistre `attendu`, le reste dû que l'utilisateur a vu et confirmé, à
 * la date `aujourdhui`. Le reste dû est d'abord relu dans la base : s'il n'est plus `attendu` (un
 * paiement ou un avoir enregistré ailleurs entre-temps), rien ne part, et le Studio le dit — jamais
 * un autre montant que celui confirmé. Une facture qui n'a plus rien à payer n'appelle rien non plus.
 * Le moyen n'est pas demandé : `autre`. Ne lève pas.
 */
export async function marquerPayee(
  factureId: string,
  aujourdhui: string,
  attendu: number,
): Promise<Resultat> {
  let ligne: LigneSuivi | undefined;
  try {
    ligne = await ligneSuivi(factureId);
  } catch (erreur) {
    return { ok: false, message: messageDe(erreur) };
  }
  const erreurs = t.compte.suivi.erreurs;
  if (!ligne) return { ok: false, message: erreurs.introuvable };
  if (ligne.resteDu <= 0) return { ok: false, message: erreurs.rienAPayer };
  if (ligne.resteDu !== attendu) return { ok: false, message: erreurs.resteChange };
  return enregistrerPaiement({ factureId, date: aujourdhui, montant: attendu, moyen: 'autre' });
}

/**
 * Annule le paiement `id`, et lui seul : `annule_le` passe de rien à l'heure du serveur (que le
 * déclencheur impose). Un paiement déjà annulé, ou introuvable, ne bouge pas : la requête ne touche
 * aucune ligne, et c'est un message, pas une erreur. Ne lève pas.
 */
export async function annulerPaiement(id: string): Promise<Resultat> {
  try {
    const { sb, E } = contexte();
    const r = await sb
      .from('paiements')
      .update({ annule_le: new Date().toISOString() })
      .eq('entreprise_id', E)
      .eq('id', id)
      .is('annule_le', null)
      .select('id');
    if (r.error) return refus(r.error, statutDe(r));
    return (r.data ?? []).length === 1
      ? { ok: true }
      : { ok: false, message: t.compte.suivi.erreurs.dejaAnnule };
  } catch (erreur) {
    return { ok: false, message: messageDe(erreur) };
  }
}

/**
 * Ce que lève `fetch` quand la requête n'a pas pu partir ou revenir, selon le navigateur : Chrome
 * (« Failed to fetch »), Firefox (« NetworkError… »), Safari (« Load failed »), Node (« fetch
 * failed »). Toujours un `TypeError`, mais toute `TypeError` n'en est pas une.
 */
const ERREUR_RESEAU =
  /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;

/**
 * La phrase d'une exception attrapée : la sienne si c'est une `ErreurSuivi`, celle du réseau pour
 * un `fetch` qui n'a pas abouti ; toute autre (une erreur du Studio) n'est pas dite « réseau » : un
 * message générique, et le détail dans la console.
 */
export function messageDe(erreur: unknown): string {
  if (erreur instanceof ErreurSuivi) return erreur.message;
  if (erreur instanceof TypeError && ERREUR_RESEAU.test(erreur.message))
    return t.compte.suivi.erreurs.reseau;
  console.error(erreur);
  return t.compte.suivi.erreurs.inattendue;
}

// ---------- PDF ----------

/** Les URL signées des PDF valent 60 secondes : le temps de les lire, pas de les partager. */
export const DUREE_URL_PDF_S = 60;

/** Le Storage dit un objet absent par ce message (en 400, ou en 404 selon la route). */
const OBJET_ABSENT = /object not found|not_found/i;

/**
 * L'URL signée (60 secondes) du PDF de la facture, dans le bucket `factures`, au chemin enregistré
 * avec elle (`pdf_chemin`). Une facture sans fichier déposé : « PDF indisponible ».
 */
export async function urlPdf(factureId: string): Promise<string> {
  const { sb, E } = contexte();
  const lue = await sb
    .from('factures')
    .select('pdf_chemin')
    .eq('entreprise_id', E)
    .eq('id', factureId)
    .maybeSingle<{ pdf_chemin: string }>();
  if (lue.error) throw echecDeLecture(lue.error, statutDe(lue));
  if (!lue.data) throw new ErreurSuivi(t.compte.suivi.erreurs.introuvable);
  const { data, error } = await sb.storage
    .from('factures')
    .createSignedUrl(lue.data.pdf_chemin, DUREE_URL_PDF_S);
  if (error && OBJET_ABSENT.test(error.message))
    throw new ErreurSuivi(t.compte.suivi.erreurs.pdfIndisponible);
  if (error || !data?.signedUrl) {
    const statut = Number((error as { status?: unknown } | null)?.status);
    throw echecDeLecture(error, Number.isFinite(statut) ? statut : 0);
  }
  return data.signedUrl;
}

/** Le PDF de la facture, lu par son URL signée. */
export async function pdfDe(factureId: string): Promise<Blob> {
  const url = await urlPdf(factureId);
  let reponse: Response;
  try {
    reponse = await fetch(url);
  } catch {
    throw new ErreurSuivi(t.compte.suivi.erreurs.reseau);
  }
  if (!reponse.ok) {
    // Effacé entre la signature et la lecture : le Storage le dit dans le corps.
    const corps = await reponse.text().catch(() => '');
    if (OBJET_ABSENT.test(corps)) throw new ErreurSuivi(t.compte.suivi.erreurs.pdfIndisponible);
    throw echecDeLecture(undefined, reponse.status);
  }
  const octets = await reponse.arrayBuffer();
  return new Blob([octets], { type: 'application/pdf' });
}
