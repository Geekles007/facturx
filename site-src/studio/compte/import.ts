/**
 * Importer les données locales (spec § 10) : ce que le Studio a gardé dans ce navigateur, sans
 * compte, entre dans le compte — l'entreprise, l'apparence par défaut et ses fichiers (logo,
 * polices), les clients, le catalogue, les factures émises avec leur PDF, la numérotation ; et le
 * brouillon en cours devient un brouillon du compte. Les données locales ne sont jamais effacées.
 *
 * L'import ne fait qu'ajouter (Ruling 57) : ce que l'utilisateur a mis dans le compte l'emporte
 * toujours. Un client ou un article déjà dans le compte (même identifiant) est laissé tel quel ;
 * l'entreprise, l'apparence par défaut, le gabarit et la remise à zéro de la numérotation ne sont
 * repris du navigateur que si ceux du compte sont encore à leur état initial ; le rang, lui, monte au
 * plus haut connu, jamais plus bas. Le bilan dit ce qui a été gardé.
 *
 * Les factures passent une à une par l'Edge Function `importer`, qui les lit dans leur PDF
 * Factur-X. Elle est idempotente par numéro (un numéro déjà là : 409 `DOUBLON`, avant même le
 * plafond) : un import repris, ou refait, ne crée rien en double. Un numéro déjà pris est dit
 * « déjà dans le compte » si la facture du compte est la même (date, total TTC, devise), sinon
 * « numéro pris par une autre facture ». Les factures passent avant les avoirs, dans l'ordre des
 * dates, pour qu'un avoir trouve la facture qu'il cite (le serveur ne l'y rattache que dans la même
 * devise, Ruling 49). Un refus (PDF illisible, trop lourd, valeurs inadmissibles) ne retient pas les
 * autres. Ce qui empêche de continuer — le plafond de 500 imports par heure (429, `reessayerApres`,
 * Ruling 34), la session, le compte, le réseau — arrête la passe : ce qui reste attend une reprise,
 * qui n'envoie que lui. Rien n'est envoyé deux fois dans une passe.
 *
 * La numérotation n'est levée qu'après les factures ; seuls le gabarit, la remise à zéro annuelle et
 * le rang partent (la conservation du compte n'envoie jamais l'année).
 *
 * Chargé par `import()` avec le reste du compte.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { isCreditNoteType } from 'facturx-sdk';
import { toPortableJson } from '../../shared/portable.js';
import { t } from '../i18n.js';
import {
  type ClientRecord,
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  fill,
  hydrateForm,
  type InvoiceSummary,
  type Numbering,
  type ProductRecord,
  rankOf,
  type SavedInvoice,
} from '../library.js';
import { ErreurConservation, type Persistence } from '../persistence.js';
import { indexedDbPersistence, storage } from '../storage.js';
import { enregistrerMaintenant, type Loaded, loadPersisted, store } from '../store.js';
import { startDraft } from '../workflows.js';
import { client } from './client.js';
import { PLAFOND_CORPS } from './emission.js';
import { finDAttente, reaction } from './erreurs.js';
import { canonique, estPersistenceCompte, estUnPdf } from './persistence.js';
import {
  brouillonSaisi,
  entrepriseRenseignee,
  lireMarqueImport,
  retenirImport,
} from './proposition.js';
import { sessionRefusee } from './suivi.js';

/** Le plus long qu'on attend la réponse d'`importer` (lecture du PDF, dépôt, enregistrement). */
const DELAI_IMPORT_MS = 60_000;

/** Après une limite de débit : une marge après l'heure dite, et un plancher qui double à chaque essai. */
const MARGE_REPRISE_MS = 5_000;
const PLAFOND_REPRISE_MS = 15 * 60_000;

/** Ce que dit `importer` d'une facture. Les raisons sont des phrases de l'interface. */
export type IssueDImport =
  | { kind: 'importee' }
  /** Le numéro est déjà dans le compte : laissée telle quelle. */
  | { kind: 'doublon' }
  /** Refusée (PDF illisible, trop lourd…) : les autres continuent. */
  | { kind: 'refusee'; raison: string }
  /** L'import ne peut pas continuer maintenant (limite, session, compte, réseau) : la passe s'arrête. */
  | { kind: 'arret'; raison: string; reessayerApres?: string | undefined };

export type Importer = (s: SavedInvoice, pdf: Uint8Array) => Promise<IssueDImport>;

/** Ce que le compte avait déjà, et que l'import a laissé tel quel. */
export type Conserve = 'entreprise' | 'apparence' | 'numerotation';

export interface RapportImport {
  /** Les clients et articles ajoutés au compte. */
  clients: number;
  produits: number;
  /** Ceux qui y étaient déjà (même identifiant) : laissés tels quels. */
  clientsDejaLa: number;
  produitsDejaLa: number;
  /** Les réglages du compte gardés à la place de ceux du navigateur. */
  conserves: Conserve[];
  /** Les factures importées. */
  factures: number;
  /** Les numéros déjà dans le compte, pour la même facture (date, total TTC, devise). */
  doublons: string[];
  /** Les numéros pris par une autre facture du compte : ces factures ne sont pas dans le compte. */
  numerosPris: string[];
  refusees: { numero: string; raison: string }[];
  /** Les factures que la passe n'a pas envoyées : la reprise les enverra, elles seules. */
  enAttente: { uid: string; numero: string }[];
  /** Pourquoi la passe s'est arrêtée avant la fin, à quelle étape, et quand reprendre. */
  arret?: { raison: string; reessayerApres?: string; etape: 'bibliotheque' | 'factures' };
  /** Ce qui, de l'entreprise, de l'apparence, des fichiers, clients, produits ou de la numérotation, n'a pas été repris. */
  echecs: { element: string; raison: string }[];
  /** La numérotation du compte après l'import. */
  numerotation?: Numbering;
  /**
   * La numérotation est annuelle et les rangs du navigateur sont d'une année plus récente que la
   * sienne : son rang ne vaut pas pour eux, et la prochaine émission de cette année-là prendra le
   * premier numéro libre après les factures importées (`emettre`, Ruling 55).
   */
  numerotationEnAvance?: boolean;
}

export interface OptionsImport {
  /** Reprendre : n'envoyer que ces factures (des `uid`), sans rien reprendre d'autre. */
  reprise?: readonly string[] | undefined;
  /** À chaque facture : son rang, et combien la passe en envoie. */
  progression?: ((n: number, total: number) => void) | undefined;
}

// ---------- la sauvegarde locale ----------

/** `indexedDbPersistence.dump()`, lu sans rien supposer de ce qu'un ancien Studio y a laissé. */
interface Sauvegarde {
  kv: Record<string, unknown>;
  files: Record<string, unknown>;
  factures: SavedInvoice[];
  clients: ClientRecord[];
  produits: ProductRecord[];
}

const objet = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Les enregistrements d'un magasin à clé `uid` ; ce qui n'en a pas est écarté. */
const enregistrements = <T>(v: unknown): T[] =>
  Array.isArray(v) ? (v.filter((e) => typeof objet(e).uid === 'string') as T[]) : [];

function lire(dump: Record<string, unknown>): Sauvegarde {
  return {
    kv: objet(dump.kv),
    files: objet(dump.files),
    factures: enregistrements<SavedInvoice>(dump.invoices),
    clients: enregistrements<ClientRecord>(dump.clients),
    produits: enregistrements<ProductRecord>(dump.products),
  };
}

const estNumerotation = (v: unknown): v is Numbering => {
  const n = objet(v);
  return (
    typeof n.pattern === 'string' &&
    Number.isInteger(n.next) &&
    (n.next as number) >= 1 &&
    typeof n.yearly === 'boolean' &&
    Number.isInteger(n.year)
  );
};

/** Le numéro d'une facture locale, tel que son résumé le garde. */
const numeroDe = (s: SavedInvoice): string => s.summary?.id || s.form?.id || s.uid;
const dateDe = (s: SavedInvoice): string => s.summary?.issueDate || s.form?.issueDate || '';
const typeDe = (s: SavedInvoice): string => s.summary?.typeCode || s.form?.typeCode || '';

const comparer = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Les factures dans l'ordre de l'import : les factures, puis les avoirs ; chacun dans l'ordre des
 * dates (puis de l'émission). Chaque facture une fois.
 */
function ordonner(factures: readonly SavedInvoice[]): SavedInvoice[] {
  const vues = new Set<string>();
  const avoir = (s: SavedInvoice) => (isCreditNoteType(typeDe(s)) ? 1 : 0);
  return factures
    .filter((s) => !vues.has(s.uid) && Boolean(vues.add(s.uid)))
    .sort(
      (a, b) =>
        avoir(a) - avoir(b) ||
        comparer(dateDe(a), dateDe(b)) ||
        comparer(a.issuedAt ?? '', b.issuedAt ?? '') ||
        comparer(a.uid, b.uid),
    );
}

/** Deux résumés de la même facture : même date d'émission, même total TTC, même devise. */
const memeFacture = (a: InvoiceSummary, b: InvoiceSummary | undefined): boolean =>
  b !== undefined &&
  a.issueDate === b.issueDate &&
  a.total === b.total &&
  a.currency === b.currency;

// ---------- le compte, avant la passe ----------

/** Ce que le compte a déjà : de quoi ne rien écraser et reconnaître un doublon. */
interface Compte {
  entreprise: unknown;
  apparence: unknown;
  numerotation: Numbering | undefined;
  clients: Set<string>;
  produits: Set<string>;
  /** Les factures du compte par numéro (résumé) ; celles de la passe s'y ajoutent. */
  factures: Map<string, InvoiceSummary>;
}

async function lireLeCompte(cible: Persistence): Promise<Compte> {
  const [entreprise, apparence, numerotation, clients, produits, factures] = await Promise.all([
    cible.get('company'),
    cible.get('appearance-default'),
    cible.get<Numbering>('numbering'),
    cible.list<ClientRecord>('clients'),
    cible.list<ProductRecord>('products'),
    cible.list<SavedInvoice>('invoices'),
  ]);
  return {
    entreprise,
    apparence,
    numerotation,
    clients: new Set(clients.map((c) => c.uid)),
    produits: new Set(produits.map((p) => p.uid)),
    factures: new Map(factures.map((f) => [f.summary.id, f.summary])),
  };
}

/**
 * La numérotation du compte est-elle encore à son état initial ? Le gabarit et la remise à zéro que
 * l'inscription pose (ceux de `defaultNumbering`, migration 000100), et aucune facture dans le
 * compte, émise ou importée, avant cette passe. Alors seulement ceux du navigateur les remplacent.
 */
function numerotationInitiale(compte: Compte): boolean {
  const initiale = defaultNumbering();
  const n = compte.numerotation;
  return (
    n !== undefined &&
    n.pattern === initiale.pattern &&
    n.yearly === initiale.yearly &&
    compte.factures.size === 0
  );
}

/** Deux valeurs au même contenu (clés triées : Postgres réordonne celles d'un `jsonb`). */
const memes = (a: unknown, b: unknown): boolean => canonique(a) === canonique(b);

// ---------- la numérotation ----------

/**
 * La numérotation du compte après l'import. Le gabarit et la remise à zéro : ceux du navigateur si
 * `reglagesLocaux` (le compte est à son état initial), sinon ceux du compte. Le rang : le plus haut
 * connu — celui du serveur, celui de la numérotation locale s'il est de la même suite (même
 * gabarit), celui qui suit chaque facture locale de ce gabarit (un rang baissé à la main ne fait pas
 * réutiliser un numéro) ; un rang d'une autre suite ne lève pas celle du compte, qui aurait un trou.
 * En remise à zéro annuelle, seuls comptent les rangs de l'année du serveur (`annee`, qu'un compte
 * ne change pas : seule une émission la fait avancer) ; des rangs d'une année plus récente la
 * mettent « en avance » (`enAvance`). Jamais plus bas que le serveur.
 */
export function numerotationReprise(
  serveur: Numbering,
  locale: Numbering | undefined,
  factures: readonly SavedInvoice[],
  reglagesLocaux = true,
): { numerotation: Numbering; enAvance: boolean } {
  const pattern = (reglagesLocaux ? locale?.pattern : undefined) ?? serveur.pattern;
  const yearly = (reglagesLocaux ? locale?.yearly : undefined) ?? serveur.yearly;
  let next = serveur.next;
  let enAvance = false;
  const compter = (rang: number, annee: number) => {
    if (!yearly || annee === serveur.year) next = Math.max(next, rang);
    else if (annee > serveur.year) enAvance = true;
  };
  // Un rang local de 1 n'a rien attribué : il ne dit rien de son année.
  if (locale && locale.pattern === pattern && locale.next > 1) compter(locale.next, locale.year);
  for (const s of factures) {
    const rang = rankOf(pattern, numeroDe(s));
    if (rang !== undefined) compter(rang + 1, Number(dateDe(s).slice(0, 4)));
  }
  return { numerotation: { pattern, yearly, next, year: serveur.year }, enAvance };
}

/** Ce que le bilan dit de la numérotation : son prochain rang, ou le premier numéro libre. */
export function messageNumerotation(rapport: RapportImport): string | undefined {
  const bilan = t.compte.importation.bilan;
  if (!rapport.numerotation) return undefined;
  return rapport.numerotationEnAvance
    ? bilan.numerotationEnAvance
    : bilan.numerotation(rapport.numerotation.next);
}

// ---------- l'import ----------

const nouveauRapport = (): RapportImport => ({
  clients: 0,
  produits: 0,
  clientsDejaLa: 0,
  produitsDejaLa: 0,
  conserves: [],
  factures: 0,
  doublons: [],
  numerosPris: [],
  refusees: [],
  enAttente: [],
  echecs: [],
});

/** La raison d'une écriture qui n'a pas abouti, dans le bilan. */
function raisonDe(erreur: unknown): string {
  const raisons = t.compte.importation.raisons;
  if (!(erreur instanceof ErreurConservation)) return raisons.refus;
  switch (erreur.code) {
    case 'FICHIER':
      return t.compte.conservation.fichier;
    case 'SESSION':
      sessionRefusee(401);
      return raisons.session;
    case 'RESEAU':
      return raisons.reseau;
    default:
      return raisons.refus;
  }
}

/** L'arrêt d'une passe qui ne peut pas continuer : sans session, ou sans réponse du serveur. */
function arretDe(erreur: unknown): NonNullable<RapportImport['arret']> {
  const arrets = t.compte.importation.arrets;
  const session = erreur instanceof ErreurConservation && erreur.code === 'SESSION';
  if (session) sessionRefusee(401);
  return { raison: session ? arrets.session : arrets.reseau, etape: 'bibliotheque' };
}

/**
 * L'entreprise, les fichiers, l'apparence par défaut, les clients et le catalogue, sans rien écraser
 * de ce que le compte a déjà. Une écriture refusée est dite et les autres continuent ; sans session
 * ni réseau, l'import s'arrête là. Faux s'il s'est arrêté.
 */
async function importerBibliotheque(
  d: Sauvegarde,
  compte: Compte,
  cible: Persistence,
  rapport: RapportImport,
): Promise<boolean> {
  const elements = t.compte.importation.elements;
  const ecritures: { element: string; faire: () => Promise<unknown>; compter?: () => void }[] = [];
  // L'entreprise du navigateur, si elle est renseignée, et seulement si celle du compte ne l'est pas.
  const company = d.kv.company;
  if (entrepriseRenseignee(company)) {
    if (!entrepriseRenseignee(compte.entreprise)) {
      ecritures.push({ element: elements.entreprise, faire: () => cible.set('company', company) });
    } else if (!memes(company, compte.entreprise)) {
      rapport.conserves.push('entreprise');
    }
  }
  // Les fichiers avant l'apparence qui les nomme ; les PDF passent par `importer`. Leur clé est tirée
  // au hasard à leur dépôt (`logo-<uid>`, `font-<uid>`) : la même clé dans le compte, c'est le même
  // fichier, déjà importé.
  for (const [cle, octets] of Object.entries(d.files)) {
    if (cle.startsWith('pdf-') || !(octets instanceof Uint8Array)) continue;
    ecritures.push({ element: elements.fichier(cle), faire: () => cible.setFile(cle, octets) });
  }
  const apparence = d.kv['appearance-default'];
  if (apparence !== undefined && apparence !== null) {
    if (compte.apparence === undefined || compte.apparence === null) {
      ecritures.push({
        element: elements.apparence,
        faire: () => cible.set('appearance-default', apparence),
      });
    } else if (!memes(apparence, compte.apparence)) {
      rapport.conserves.push('apparence');
    }
  }
  // Clients et articles : ceux que le compte n'a pas (un supprimé depuis revient, c'est voulu).
  for (const c of d.clients) {
    if (compte.clients.has(c.uid)) {
      rapport.clientsDejaLa++;
      continue;
    }
    ecritures.push({
      element: elements.client(c.party?.name || c.uid),
      faire: () => cible.put('clients', c),
      compter: () => rapport.clients++,
    });
  }
  for (const p of d.produits) {
    if (compte.produits.has(p.uid)) {
      rapport.produitsDejaLa++;
      continue;
    }
    ecritures.push({
      element: elements.produit(p.name || p.uid),
      faire: () => cible.put('products', p),
      compter: () => rapport.produits++,
    });
  }
  for (const { element, faire, compter } of ecritures) {
    try {
      await faire();
      compter?.();
    } catch (erreur) {
      const code = erreur instanceof ErreurConservation ? erreur.code : undefined;
      if (code === 'SESSION' || code === 'RESEAU') {
        rapport.arret = arretDe(erreur);
        return false;
      }
      rapport.echecs.push({ element, raison: raisonDe(erreur) });
    }
  }
  return true;
}

/**
 * Lève la numérotation du compte au plus haut rang connu, après les factures ; le gabarit et la
 * remise à zéro du navigateur seulement si `reglagesLocaux`. Une émission a pu la lever entre la
 * lecture et l'écriture (le déclencheur refuse alors le recul) : on relit, une fois.
 */
async function reprendreNumerotation(
  d: Sauvegarde,
  cible: Persistence,
  rapport: RapportImport,
  reglagesLocaux: boolean,
): Promise<void> {
  const locale = estNumerotation(d.kv.numbering) ? d.kv.numbering : undefined;
  if (!locale && d.factures.length === 0) return;
  for (let essai = 1; ; essai++) {
    try {
      const serveur = await cible.get<Numbering>('numbering');
      if (!serveur) return;
      const { numerotation, enAvance } = numerotationReprise(
        serveur,
        locale,
        d.factures,
        reglagesLocaux,
      );
      const change =
        numerotation.pattern !== serveur.pattern ||
        numerotation.yearly !== serveur.yearly ||
        numerotation.next !== serveur.next;
      if (change) await cible.set('numbering', numerotation);
      rapport.numerotation = numerotation;
      rapport.numerotationEnAvance = enAvance;
      const differents =
        locale !== undefined &&
        (locale.pattern !== numerotation.pattern || locale.yearly !== numerotation.yearly);
      if (!reglagesLocaux && differents) rapport.conserves.push('numerotation');
      return;
    } catch (erreur) {
      const recul = erreur instanceof ErreurConservation && erreur.detail === 'NUMEROTATION_RECUL';
      if (!recul || essai === 2) {
        rapport.echecs.push({
          element: t.compte.importation.elements.numerotation,
          raison: raisonDe(erreur),
        });
        return;
      }
    }
  }
}

/**
 * Importe la sauvegarde locale `dump` dans `cible` (la conservation du compte), sans rien écraser de
 * ce qu'il a : l'entreprise, l'apparence par défaut et ses fichiers, les clients et le catalogue ;
 * puis chaque facture, avec son PDF `pdf-<uid>`, par `importer` ; puis la numérotation. Avec
 * `reprise`, seulement ces factures, et la numérotation. Ne touche jamais à `dump` ni aux données
 * locales. Ne lève pas : le rapport dit ce qui est passé, ce qui a été gardé, ce qui est refusé et
 * pourquoi, ce qui attend.
 */
export async function importerLocal(
  dump: Awaited<ReturnType<typeof indexedDbPersistence.dump>>,
  cible: Persistence,
  importer: Importer,
  options: OptionsImport = {},
): Promise<RapportImport> {
  const phrases = t.compte.importation;
  const d = lire(dump);
  const rapport = nouveauRapport();
  const { reprise } = options;
  const factures = ordonner(
    reprise ? d.factures.filter((s) => reprise.includes(s.uid)) : d.factures,
  );
  const enAttente = (depuis: number) =>
    factures.slice(depuis).map((s) => ({ uid: s.uid, numero: numeroDe(s) }));

  // Ce que le compte a déjà, lu avant d'écrire quoi que ce soit : sans cela, rien ne part.
  let compte: Compte;
  try {
    compte = await lireLeCompte(cible);
  } catch (erreur) {
    rapport.arret = arretDe(erreur);
    rapport.enAttente = enAttente(0);
    return rapport;
  }
  const reglagesLocaux = numerotationInitiale(compte);

  if (!reprise && !(await importerBibliotheque(d, compte, cible, rapport))) {
    rapport.enAttente = enAttente(0);
    return rapport;
  }

  for (const [i, s] of factures.entries()) {
    options.progression?.(i + 1, factures.length);
    const numero = numeroDe(s);
    const pdf = d.files[`pdf-${s.uid}`];
    if (!(pdf instanceof Uint8Array)) {
      rapport.refusees.push({ numero, raison: phrases.raisons.pdfAbsent });
      continue;
    }
    if (!estUnPdf(pdf)) {
      rapport.refusees.push({ numero, raison: phrases.raisons.pdfIllisible });
      continue;
    }
    const issue = await importer(s, pdf).catch(
      (): IssueDImport => ({ kind: 'arret', raison: phrases.arrets.reseau }),
    );
    if (issue.kind === 'importee') {
      rapport.factures++;
      if (s.summary && !compte.factures.has(numero)) compte.factures.set(numero, s.summary);
    } else if (issue.kind === 'doublon') {
      // La même facture, ou une autre sous le même numéro : celle-ci n'est alors pas dans le compte.
      const sienne = compte.factures.get(numero);
      if (s.summary && memeFacture(s.summary, sienne)) rapport.doublons.push(numero);
      else rapport.numerosPris.push(numero);
    } else if (issue.kind === 'refusee') {
      rapport.refusees.push({ numero, raison: issue.raison });
    } else {
      rapport.arret = {
        raison: issue.raison,
        etape: 'factures',
        ...(issue.reessayerApres ? { reessayerApres: issue.reessayerApres } : {}),
      };
      rapport.enAttente = enAttente(i);
      break;
    }
  }

  // Après les factures, même arrêtées : les numéros locaux sont pris, qu'ils soient importés ou non.
  await reprendreNumerotation(d, cible, rapport, reglagesLocaux);
  return rapport;
}

/** Deux passes (la première, puis une reprise) en un seul bilan. */
export function cumuler(avant: RapportImport, apres: RapportImport): RapportImport {
  const cumul: RapportImport = {
    clients: avant.clients + apres.clients,
    produits: avant.produits + apres.produits,
    clientsDejaLa: avant.clientsDejaLa + apres.clientsDejaLa,
    produitsDejaLa: avant.produitsDejaLa + apres.produitsDejaLa,
    conserves: [...new Set([...avant.conserves, ...apres.conserves])],
    factures: avant.factures + apres.factures,
    doublons: [...avant.doublons, ...apres.doublons],
    numerosPris: [...avant.numerosPris, ...apres.numerosPris],
    refusees: [...avant.refusees, ...apres.refusees],
    enAttente: apres.enAttente,
    echecs: [...avant.echecs, ...apres.echecs],
  };
  if (apres.arret) cumul.arret = apres.arret;
  const derniere = apres.numerotation ? apres : avant;
  if (derniere.numerotation) {
    cumul.numerotation = derniere.numerotation;
    cumul.numerotationEnAvance = derniere.numerotationEnAvance ?? false;
  }
  return cumul;
}

/**
 * Le délai avant de reprendre après une limite de débit : l'heure que le serveur a dite, plus une
 * marge ; et jamais moins qu'un plancher qui double à chaque reprise qui retombe sur la limite
 * (`essai`, à partir de 0), jusqu'à 15 minutes. Si l'horloge de ce navigateur est en avance sur
 * celle du serveur, l'heure dite paraît passée : le plancher évite de renvoyer un PDF toutes les
 * cinq secondes.
 */
export function delaiDeReprise(quand: string, maintenant: number, essai: number): number {
  const plancher = Math.min(MARGE_REPRISE_MS * 2 ** essai, PLAFOND_REPRISE_MS);
  const dite = Date.parse(quand);
  const attente = Number.isNaN(dite) ? 0 : dite - maintenant + MARGE_REPRISE_MS;
  return Math.max(attente, plancher);
}

// ---------- l'appel à `importer` ----------

/** Le refus d'`importer`, de statut `statut`, en issue. */
function issueDuRefus(
  statut: number,
  corps: { code: string; message: string; details?: unknown },
): IssueDImport {
  const phrases = t.compte.importation;
  if (statut === 413) return { kind: 'refusee', raison: phrases.raisons.tropLourde };
  if (corps.code === 'DOUBLON') return { kind: 'doublon' };
  const r = reaction(statut, corps);
  if (r.kind === 'connexion') return { kind: 'arret', raison: phrases.arrets.session };
  if (r.kind === 'controle' || r.kind === 'devise') {
    return { kind: 'refusee', raison: phrases.raisons.facturx(r.issues[0]?.message) };
  }
  if (r.kind !== 'message') return { kind: 'refusee', raison: t.compte.erreurs.inconnue };
  switch (corps.code) {
    case 'LIMITE': {
      const quand = objet(corps.details).reessayerApres;
      return {
        kind: 'arret',
        raison: phrases.arrets.limite(finDAttente(corps.details)),
        ...(typeof quand === 'string' && !Number.isNaN(Date.parse(quand))
          ? { reessayerApres: quand }
          : {}),
      };
    }
    // Le compte ne peut pas importer maintenant : aucune autre facture ne passerait.
    case 'NON_CONFIRME':
    case 'SUPPRESSION':
    case 'DROITS':
      return { kind: 'arret', raison: r.texte };
    case 'INTERNE':
      return { kind: 'refusee', raison: r.texte };
    default:
      return { kind: 'refusee', raison: t.compte.erreurs.inconnue };
  }
}

/**
 * Importe une facture locale par `importer` : son formulaire et son apparence, que le serveur garde
 * tels quels, et son PDF, d'où il lit la facture. Ne lève jamais. Un corps de plus de 10 Mio ne part
 * pas (le serveur le refuserait). Une session refusée ouvre la connexion. Sans réponse, ou après une
 * panne hors de la fonction, la facture a pu être importée : la passe s'arrête, et la reprise le
 * dira (doublon).
 */
export async function importerSurServeur(s: SavedInvoice, pdf: Uint8Array): Promise<IssueDImport> {
  const phrases = t.compte.importation;
  const texte = toPortableJson(
    { form: s.form, appearance: s.appearance ?? defaultAppearance(), pdf },
    { compact: true },
  );
  const corps = new Blob([texte], { type: 'application/json' });
  if (corps.size > PLAFOND_CORPS) return { kind: 'refusee', raison: phrases.raisons.tropLourde };
  const sansReponse: IssueDImport = { kind: 'arret', raison: phrases.arrets.reseau };
  let reponse: { error: unknown };
  try {
    reponse = await client().functions.invoke('importer', {
      body: corps,
      timeout: DELAI_IMPORT_MS,
    });
  } catch {
    return sansReponse;
  }
  const { error } = reponse;
  if (!error) return { kind: 'importee' };
  if (!(error instanceof FunctionsHttpError)) return sansReponse;
  const http = error.context as Response;
  const lu = objet(await http.json().catch(() => undefined));
  const code = typeof lu.code === 'string' ? lu.code : '';
  // `INTERNE` vient de la fonction, qui a tout annulé ; une autre panne ne dit rien de l'import.
  if (http.status >= 500 && code !== 'INTERNE') return sansReponse;
  sessionRefusee(http.status);
  return issueDuRefus(http.status, {
    code,
    message: typeof lu.message === 'string' ? lu.message : '',
    details: lu.details,
  });
}

// ---------- ce navigateur ----------

/** Ce que l'import de ce navigateur a fait du brouillon local. */
export type IssueDuBrouillon = 'repris' | 'nonRepris' | 'dejaRepris';

export type RapportNavigateur = RapportImport & { brouillon?: IssueDuBrouillon };

/** L'empreinte d'un brouillon : le même brouillon local ne devient pas deux fois un brouillon du compte. */
async function empreinteDe(b: NonNullable<Loaded['draft']>): Promise<string> {
  const texte = toPortableJson({ form: b.form, appearance: b.appearance }, { compact: true });
  const hache = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(hache), (o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * Le Studio montre ce que le compte a désormais : entreprise, numérotation, clients, catalogue,
 * historique. Sans quoi une numérotation périmée, renvoyée plus tard, voudrait reculer.
 */
async function rafraichir(rapport: RapportImport): Promise<void> {
  const lu = await loadPersisted({ brouillon: false }).catch(() => undefined);
  if (lu) {
    store.set({
      company: fill(defaultCompany(), lu.company),
      numbering: fill(defaultNumbering(), lu.numbering),
      clients: lu.clients,
      products: lu.products,
      history: lu.history,
    });
  } else if (rapport.numerotation) {
    store.set({ numbering: rapport.numerotation });
  }
}

/**
 * Le brouillon local en cours devient un brouillon du compte, par le chemin d'un nouveau document
 * (`startDraft`) : le brouillon ouvert part d'abord au serveur et reste dans la liste, rien n'est
 * écrasé. Un brouillon déjà repris (même empreinte), ou où rien n'est saisi, ne l'est pas.
 */
async function reprendreBrouillon(
  kv: Record<string, unknown>,
): Promise<{ issue?: IssueDuBrouillon; empreinte?: string }> {
  const local = kv.draft;
  if (!brouillonSaisi(local)) return {};
  const empreinte = await empreinteDe(local);
  if ((await lireMarqueImport().catch(() => undefined))?.brouillon === empreinte) {
    return { issue: 'dejaRepris' };
  }
  const ouvert = await startDraft(
    hydrateForm(local.form),
    fill(defaultAppearance(), local.appearance),
  );
  return ouvert ? { issue: 'repris', empreinte } : { issue: 'nonRepris' };
}

/**
 * Importe ce que ce navigateur garde du Studio sans compte dans le compte connecté (la conservation
 * derrière `storage`), puis montre ce que le compte a désormais, ouvre le brouillon repris et retient
 * l'issue pour la proposition de la première connexion : `fait`, ou `partiel` avec les factures qui
 * attendent (s'il s'est arrêté pendant elles). Avec `reprise`, seulement ces factures. Lève si le
 * compte ou IndexedDB ne répond pas avant de commencer.
 */
export async function importerCeNavigateur(
  options: OptionsImport = {},
): Promise<RapportNavigateur> {
  const p = storage;
  if (!estPersistenceCompte(p)) throw new Error(t.compte.importation.erreur);
  // Ce qui attendait le délai d'enregistrement part d'abord : l'import lit le compte ensuite.
  await enregistrerMaintenant();
  const dump = await indexedDbPersistence.dump();
  const rapport: RapportNavigateur = await importerLocal(dump, p, importerSurServeur, options);
  await rafraichir(rapport);
  let empreinte: string | undefined;
  if (!options.reprise && rapport.arret?.etape !== 'bibliotheque') {
    const repris = await reprendreBrouillon(objet(dump.kv));
    if (repris.issue) rapport.brouillon = repris.issue;
    empreinte = repris.empreinte;
  }
  const enAttente =
    rapport.arret?.etape === 'factures' ? rapport.enAttente.map((f) => f.uid) : undefined;
  await retenirImport(rapport.arret ? 'partiel' : 'fait', { brouillon: empreinte, enAttente });
  return rapport;
}
