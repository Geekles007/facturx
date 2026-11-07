/**
 * Importer les données locales (spec § 10) : ce que le Studio a gardé dans ce navigateur, sans
 * compte, entre dans le compte — l'entreprise, l'apparence par défaut et ses fichiers (logo,
 * polices), les clients, le catalogue, les factures émises avec leur PDF, la numérotation ; et le
 * brouillon en cours devient un brouillon du compte. Les données locales ne sont jamais effacées.
 *
 * Les factures passent une à une par l'Edge Function `importer`, qui les lit dans leur PDF
 * Factur-X. Elle est idempotente par numéro (un numéro déjà là : 409 `DOUBLON`, avant même le
 * plafond) : un import repris, ou refait, ne crée rien en double. Les factures passent avant les
 * avoirs, dans l'ordre des dates, pour qu'un avoir trouve la facture qu'il cite (le serveur ne l'y
 * rattache que dans la même devise, Ruling 49). Un refus (PDF illisible, trop lourd, valeurs
 * inadmissibles) ne retient pas les autres. Ce qui empêche de continuer — le plafond de 500 imports
 * par heure (429, `reessayerApres`, Ruling 34), la session, le compte, le réseau — arrête la passe :
 * ce qui reste attend une reprise, qui n'envoie que lui. Rien n'est envoyé deux fois dans une passe.
 *
 * La numérotation n'est levée qu'après les factures, au plus haut rang connu, jamais plus bas que
 * celle du serveur (le déclencheur refuse un recul) ; seuls le gabarit, la remise à zéro annuelle et
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
import { brouillonSaisi, entrepriseRenseignee, lireMarqueImport, retenirImport } from './index.js';
import { estPersistenceCompte, estUnPdf } from './persistence.js';
import { sessionRefusee } from './suivi.js';

/** Le plus long qu'on attend la réponse d'`importer` (lecture du PDF, dépôt, enregistrement). */
const DELAI_IMPORT_MS = 60_000;

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

export interface RapportImport {
  clients: number;
  produits: number;
  /** Les factures importées. */
  factures: number;
  /** Les numéros déjà dans le compte. */
  doublons: string[];
  refusees: { numero: string; raison: string }[];
  /** Les factures que la passe n'a pas envoyées : la reprise les enverra, elles seules. */
  enAttente: { uid: string; numero: string }[];
  /** Pourquoi la passe s'est arrêtée avant la fin, à quelle étape, et quand reprendre. */
  arret?: { raison: string; reessayerApres?: string; etape: 'bibliotheque' | 'factures' };
  /** Ce qui, de l'entreprise, de l'apparence, des fichiers, clients, produits ou de la numérotation, n'a pas été repris. */
  echecs: { element: string; raison: string }[];
  /** La numérotation du compte après l'import. */
  numerotation?: Numbering;
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

// ---------- la numérotation ----------

/**
 * La numérotation du compte après l'import : le gabarit et la remise à zéro du Studio, et le plus
 * haut rang connu — celui du serveur, celui de la numérotation locale, celui qui suit chaque facture
 * locale (un rang baissé à la main ne fait pas réutiliser un numéro). En remise à zéro annuelle,
 * seuls comptent les rangs de l'année du serveur (`annee`, qu'un compte ne change pas : seule une
 * émission la fait avancer). Jamais plus bas que le serveur.
 */
export function numerotationReprise(
  serveur: Numbering,
  locale: Numbering | undefined,
  factures: readonly SavedInvoice[],
): Numbering {
  const pattern = locale?.pattern ?? serveur.pattern;
  const yearly = locale?.yearly ?? serveur.yearly;
  const compte = (annee: number) => !yearly || annee === serveur.year;
  let next = serveur.next;
  if (locale && compte(locale.year)) next = Math.max(next, locale.next);
  for (const s of factures) {
    const rang = rankOf(pattern, numeroDe(s));
    if (rang !== undefined && compte(Number(dateDe(s).slice(0, 4)))) {
      next = Math.max(next, rang + 1);
    }
  }
  return { pattern, yearly, next, year: serveur.year };
}

// ---------- l'import ----------

const nouveauRapport = (): RapportImport => ({
  clients: 0,
  produits: 0,
  factures: 0,
  doublons: [],
  refusees: [],
  enAttente: [],
  echecs: [],
});

/** La raison d'une écriture refusée, dans le bilan. */
const raisonDe = (erreur: unknown): string =>
  erreur instanceof ErreurConservation && erreur.code === 'FICHIER'
    ? t.compte.conservation.fichier
    : t.compte.importation.raisons.refus;

/**
 * L'entreprise, les fichiers, l'apparence par défaut, les clients et le catalogue. Une écriture
 * refusée est dite et les autres continuent ; sans session ni réseau, l'import s'arrête là. Faux
 * s'il s'est arrêté.
 */
async function importerBibliotheque(
  d: Sauvegarde,
  cible: Persistence,
  rapport: RapportImport,
): Promise<boolean> {
  const elements = t.compte.importation.elements;
  const ecritures: { element: string; faire: () => Promise<unknown>; compter?: () => void }[] = [];
  // Une entreprise vide (celle par défaut) ne remplace pas celle du compte.
  if (entrepriseRenseignee(d.kv.company)) {
    const company = d.kv.company;
    ecritures.push({ element: elements.entreprise, faire: () => cible.set('company', company) });
  }
  // Les fichiers avant l'apparence qui les nomme ; les PDF passent par `importer`.
  for (const [cle, octets] of Object.entries(d.files)) {
    if (cle.startsWith('pdf-') || !(octets instanceof Uint8Array)) continue;
    ecritures.push({ element: elements.fichier(cle), faire: () => cible.setFile(cle, octets) });
  }
  const apparence = d.kv['appearance-default'];
  if (apparence !== undefined && apparence !== null) {
    ecritures.push({
      element: elements.apparence,
      faire: () => cible.set('appearance-default', apparence),
    });
  }
  for (const c of d.clients) {
    ecritures.push({
      element: elements.client(c.party?.name || c.uid),
      faire: () => cible.put('clients', c),
      compter: () => rapport.clients++,
    });
  }
  for (const p of d.produits) {
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
        if (code === 'SESSION') sessionRefusee(401);
        const arrets = t.compte.importation.arrets;
        rapport.arret = {
          raison: code === 'SESSION' ? arrets.session : arrets.reseau,
          etape: 'bibliotheque',
        };
        return false;
      }
      rapport.echecs.push({ element, raison: raisonDe(erreur) });
    }
  }
  return true;
}

/**
 * Lève la numérotation du compte au plus haut rang connu, après les factures. Une émission a pu la
 * lever entre la lecture et l'écriture (le déclencheur refuse alors le recul) : on relit, une fois.
 */
async function reprendreNumerotation(
  d: Sauvegarde,
  cible: Persistence,
  rapport: RapportImport,
): Promise<void> {
  const locale = estNumerotation(d.kv.numbering) ? d.kv.numbering : undefined;
  if (!locale && d.factures.length === 0) return;
  for (let essai = 1; ; essai++) {
    try {
      const serveur = await cible.get<Numbering>('numbering');
      if (!serveur) return;
      const reprise = numerotationReprise(serveur, locale, d.factures);
      const change =
        reprise.pattern !== serveur.pattern ||
        reprise.yearly !== serveur.yearly ||
        reprise.next !== serveur.next;
      if (change) await cible.set('numbering', reprise);
      rapport.numerotation = reprise;
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
 * Importe la sauvegarde locale `dump` dans `cible` (la conservation du compte) : l'entreprise,
 * l'apparence par défaut et ses fichiers, les clients et le catalogue ; puis chaque facture, avec son
 * PDF `pdf-<uid>`, par `importer` ; puis la numérotation. Avec `reprise`, seulement ces factures, et
 * la numérotation. Ne touche jamais à `dump` ni aux données locales. Ne lève pas : le rapport dit
 * ce qui est passé, ce qui est refusé et pourquoi, ce qui attend.
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

  if (!reprise && !(await importerBibliotheque(d, cible, rapport))) {
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
    if (issue.kind === 'importee') rapport.factures++;
    else if (issue.kind === 'doublon') rapport.doublons.push(numero);
    else if (issue.kind === 'refusee') rapport.refusees.push({ numero, raison: issue.raison });
    else {
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
  await reprendreNumerotation(d, cible, rapport);
  return rapport;
}

/** Deux passes (la première, puis une reprise) en un seul bilan. */
export function cumuler(avant: RapportImport, apres: RapportImport): RapportImport {
  const cumul: RapportImport = {
    clients: avant.clients + apres.clients,
    produits: avant.produits + apres.produits,
    factures: avant.factures + apres.factures,
    doublons: [...avant.doublons, ...apres.doublons],
    refusees: [...avant.refusees, ...apres.refusees],
    enAttente: apres.enAttente,
    echecs: [...avant.echecs, ...apres.echecs],
  };
  if (apres.arret) cumul.arret = apres.arret;
  const numerotation = apres.numerotation ?? avant.numerotation;
  if (numerotation) cumul.numerotation = numerotation;
  return cumul;
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
 * écrasé. Un brouillon déjà repris (même empreinte) ne l'est pas de nouveau.
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
 * l'issue pour la proposition de la première connexion (`fait`, ou `partiel` si des factures
 * attendent). Avec `reprise`, seulement ces factures. Lève si le compte ou IndexedDB ne répond pas
 * avant de commencer.
 */
export async function importerCeNavigateur(
  options: OptionsImport = {},
): Promise<RapportNavigateur> {
  const p = storage;
  if (!estPersistenceCompte(p)) throw new Error(t.compte.importation.erreur);
  // Ce qui attendait le délai d'enregistrement part d'abord : l'import écrit par-dessus.
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
  await retenirImport(rapport.arret ? 'partiel' : 'fait', empreinte);
  return rapport;
}
