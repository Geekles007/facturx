/**
 * La conservation du mode compte : ce que le Studio enregistre va sur le serveur (Supabase, sous
 * RLS), derrière la même interface que la conservation locale (`persistence.ts`).
 *
 * Correspondances :
 *   - `company` → `entreprises.profil`, `appearance-default` → `entreprises.apparence_defaut`, les
 *     deux seules colonnes qu'un compte peut modifier ;
 *   - `numbering` → `numerotation` : `gabarit`, `annuelle`, et `prochain` quand le Studio l'a changé
 *     (un rang périmé, lu avant une émission, ne repart pas). Jamais `annee` : seule l'émission
 *     change d'année ;
 *   - `draft` → le brouillon ouvert (`brouillons`), dont l'identifiant reste dans ce navigateur
 *     (`brouillon-courant-<entreprise>`) ; sans lui, une écriture insère un brouillon, sous un
 *     identifiant tiré d'avance (rejouée après une réponse perdue, elle retrouve sa ligne). La
 *     saisie est recopiée dans IndexedDB (`draft-compte-<entreprise>`) avant l'envoi : ce miroir la
 *     garde quand le serveur ne la prend pas (réseau, session expirée, conflit). La mise à jour ne
 *     passe que sur la version lue (`update … where id and version`) : si un autre onglet a
 *     enregistré entre-temps, rien n'est écrasé et l'écriture lève `BROUILLON_MODIFIE`. Une facture
 *     émise ou l'exemple affichés sont une vue, gardée à part (`vue-compte-<entreprise>`) : ils ne
 *     touchent ni au brouillon ouvert ni à son miroir. On ne change de brouillon (nouveau, ouvrir)
 *     qu'une fois la saisie du brouillon ouvert sur le serveur : sinon `EN_ATTENTE`, et rien ne
 *     bouge ;
 *   - `clients` et `products` → `clients` et `produits`, de clé `(entreprise_id, id)` : l'`uid`
 *     devient `id`, `nom` et `email` sont tirés de la fiche ;
 *   - `invoices` → `factures`, en lecture : une facture s'émet par le serveur ;
 *   - fichiers → bucket `fichiers`, sous `<entreprise>/<clé>`, avec le type lu dans les octets ;
 *     `pdf-<id>` → bucket `factures`, en lecture ;
 *   - toute autre clé de `kv` n'a pas de place sur le serveur : elle reste dans ce navigateur.
 *
 * Les JSON passent par le format portable (`{ $bytes }`) : un `Uint8Array` (pièce jointe) n'a pas
 * de forme JSON, et `emettre` recopie le formulaire du brouillon tel quel dans la facture.
 *
 * Les erreurs sont des `ErreurConservation` : `store.ts` réagit à leur code (hors ligne, session
 * expirée, conflit, refus). Le Studio n'y arrive que par `import()`, avec le reste du compte.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { fromBase64, toBase64 } from '../../shared/portable.js';
import type {
  Appearance,
  ClientRecord,
  CompanyProfile,
  Numbering,
  ProductRecord,
  SavedInvoice,
} from '../library.js';
import type { InvoiceForm } from '../model.js';
import {
  type CodeConservation,
  type ConservationDuCompte,
  ErreurConservation,
  type Persistence,
} from '../persistence.js';
import { indexedDbPersistence as local } from '../storage.js';
import type { Loaded } from '../store.js';

/** Le brouillon tel que le Studio l'enregistre sous `draft`. */
export type Brouillon = NonNullable<Loaded['draft']>;

/**
 * Le miroir local du brouillon ouvert : la dernière saisie, le brouillon du serveur et la version
 * sur lesquels elle repose (ou l'identifiant prévu, s'il n'est pas encore créé), et si le serveur
 * l'a reçue.
 */
export type Miroir = Brouillon & {
  brouillon?: { id: string; version: number } | undefined;
  idPrevu?: string | undefined;
  envoye: boolean;
};

/** Une ligne de la liste des brouillons. */
export interface ResumeBrouillon {
  id: string;
  /** Le numéro proposé et le client, tels que saisis (souvent vides au début). */
  numero: string;
  client: string;
  modifieLe: string;
  version: number;
}

/** La conservation du compte, avec de quoi tenir plusieurs brouillons. */
export interface PersistenceCompte extends Persistence, ConservationDuCompte {
  readonly entrepriseId: string;
  /** Le brouillon ouvert sur le serveur, et la version lue ; rien tant qu'il n'est pas créé. */
  brouillonCourant(): { id: string; version: number } | undefined;
  /** Les brouillons de l'entreprise, le plus récemment modifié d'abord. */
  brouillons(): Promise<ResumeBrouillon[]>;
  /**
   * Ouvre un brouillon : il devient le brouillon ouvert, rien s'il n'existe plus. Le brouillon déjà
   * ouvert (sous une vue) revient avec sa saisie. Pour un autre, la bascule se fait après la lecture,
   * sans attendre, si ce que l'écran montre (`affiche()`, lu à ce moment) est sur le serveur ; sinon
   * `EN_ATTENTE` (`EN_COURS`) et rien ne change. L'appelant affiche le résultat aussitôt.
   */
  ouvrirBrouillon(id: string, affiche: () => unknown): Promise<Brouillon | undefined>;
  /**
   * Supprime un brouillon. Si c'est l'ouvert, sa saisie s'en va avec lui (c'est voulu) : jusqu'au
   * prochain document, ce qui s'écrit encore pour lui ne part plus nulle part.
   */
  supprimerBrouillon(id: string): Promise<void>;
  /** Après un conflit : la version du serveur, qui devient celle sur laquelle on écrit. */
  rechargerBrouillon(): Promise<Brouillon | undefined>;
  /** Après un conflit : `b` remplace la version du serveur, relue juste avant. */
  imposerBrouillon(b: Brouillon): Promise<void>;
}

export function estPersistenceCompte(p: Persistence): p is PersistenceCompte {
  return typeof (p as Partial<PersistenceCompte>).brouillonCourant === 'function';
}

// ---------- JSON portable ----------

/** La valeur en JSON simple : les octets deviennent `{ $bytes }` (base64). */
function versPortable(valeur: unknown): unknown {
  if (valeur === undefined) return null;
  return JSON.parse(
    JSON.stringify(valeur, (_, v) => (v instanceof Uint8Array ? { $bytes: toBase64(v) } : v)),
  );
}

/** L'inverse : les `{ $bytes }` redeviennent des octets. */
function depuisPortable<T>(valeur: unknown): T {
  return JSON.parse(JSON.stringify(valeur), (_, v) =>
    v && typeof v === 'object' && typeof (v as { $bytes?: unknown }).$bytes === 'string'
      ? fromBase64((v as { $bytes: string }).$bytes)
      : v,
  ) as T;
}

/** Texte canonique (clés triées) : Postgres réordonne les clés d'un `jsonb`. */
function canonique(valeur: unknown): string {
  return JSON.stringify(valeur, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

// ---------- erreurs ----------

/** Les réponses de PostgREST, réussies ou non. */
interface Reponse {
  error: PostgrestError | null;
  status: number;
}

/**
 * Le code d'une réponse en échec : 0 (pas de réponse) et 5xx disent que le serveur n'a pas pu
 * traiter la requête, 401 qu'il refuse le jeton, le reste qu'il refuse la valeur.
 */
function code(status: number): CodeConservation {
  if (status === 0 || status >= 500) return 'RESEAU';
  if (status === 401) return 'SESSION';
  return 'REFUS';
}

const echec = (r: Reponse): ErreurConservation =>
  new ErreurConservation(code(r.status), r.error?.message);

/** Une erreur du Storage (`StorageApiError` ou `StorageUnknownError`), sans importer leur module. */
interface ErreurStockage {
  message: string;
  status?: unknown;
}
const estErreurStockage = (e: unknown): e is ErreurStockage =>
  typeof e === 'object' && e !== null && '__isStorageError' in e;

/** Un objet absent du Storage : l'API répond 400, avec 404 et ce message dans le corps. */
const absent = (e: ErreurStockage): boolean => /object not found/i.test(e.message);

/**
 * Le Storage dit un jeton refusé en 400 ou 403 : on le reconnaît à son message. « Bucket not
 * found » en est un aussi : les buckets existent toujours, et c'est ce que répond une lecture
 * faite avec un jeton que le serveur ne reconnaît pas.
 */
const JETON_REFUSE = /jwt|token|signature|unauthori[sz]ed|bucket not found/i;

// ---------- fichiers ----------

/** Signatures des fichiers que le bucket `fichiers` accepte, et le type annoncé au dépôt. */
const SIGNATURES: { type: 'image/png' | 'image/jpeg' | 'font/ttf'; octets: number[] }[] = [
  { type: 'image/png', octets: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', octets: [0xff, 0xd8, 0xff] },
  // TrueType : la version 1.0 de la table, ou la balise `true` des polices Apple.
  { type: 'font/ttf', octets: [0x00, 0x01, 0x00, 0x00] },
  { type: 'font/ttf', octets: [0x74, 0x72, 0x75, 0x65] },
];

const MIO = 1024 * 1024;
/** Spec § 11 : un logo de 1 Mo au plus, une police de 2 Mo (la limite du bucket). */
const PLAFONDS = { 'image/png': MIO, 'image/jpeg': MIO, 'font/ttf': 2 * MIO };

function typeDe(octets: Uint8Array): keyof typeof PLAFONDS | undefined {
  return SIGNATURES.find((s) => s.octets.every((o, i) => octets[i] === o))?.type;
}

// ---------- lignes ----------

interface LigneBrouillon {
  id: string;
  form: unknown;
  appearance: unknown;
  version: number;
}

interface LigneNumerotation {
  gabarit: string;
  prochain: number;
  annuelle: boolean;
  annee: number;
}

interface LigneFacture {
  id: string;
  numero: string;
  type_code: string;
  date_emission: string;
  client_nom: string;
  devise: string;
  ttc: number;
  net_a_payer: number;
  form: unknown;
  appearance: unknown;
  emise_le: string;
}

const versNumerotation = (l: LigneNumerotation): Numbering => ({
  pattern: l.gabarit,
  next: l.prochain,
  yearly: l.annuelle,
  year: l.annee,
});

/** Une date conservée (`timestamptz`) au format du Studio : `2026-11-04T09:30:00.000Z`. */
const iso = (horodatage: string): string => new Date(horodatage).toISOString();

/** Ce qu'une date du Studio donne à `modifie_le`, ou rien (valeur par défaut) si elle n'en est pas une. */
const modifieLe = (texte: unknown): string | undefined =>
  typeof texte === 'string' && !Number.isNaN(Date.parse(texte)) ? texte : undefined;

/** PostgREST rend 1 000 lignes au plus par requête (`max_rows`) : on lit page par page. */
const PAGE = 1000;

async function toutLire<T>(
  page: (
    debut: number,
    fin: number,
  ) => PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>,
): Promise<T[]> {
  const lignes: T[] = [];
  for (let debut = 0; ; debut += PAGE) {
    const r = await page(debut, debut + PAGE - 1);
    if (r.error) throw echec(r);
    const lot = (r.data ?? []) as T[];
    lignes.push(...lot);
    if (lot.length < PAGE) return lignes;
  }
}

// ---------- la conservation ----------

/**
 * Un document : le brouillon du serveur auquel la saisie appartient (`id`, et la version sur
 * laquelle la prochaine écriture passe), ou celui qu'on va créer sous `idPrevu`. Une écriture
 * emporte son document : partie en retard, elle va au bon brouillon, jamais à celui qu'on a ouvert
 * entre-temps.
 */
interface Document {
  idPrevu: string;
  id?: string | undefined;
  version?: number | undefined;
  /** Texte canonique de ce que le serveur en a : un contenu identique ne repart pas. */
  surLeServeur?: string | undefined;
  /**
   * Le formulaire et l'apparence (les objets mêmes du magasin) dont le serveur a reçu le contenu :
   * l'écran qui montre ces objets-là n'a rien que le serveur n'ait.
   */
  confirme?: { form: unknown; appearance: unknown } | undefined;
  /** La dernière saisie reçue pour ce document, et si le serveur l'a. */
  derniere?: Brouillon | undefined;
  envoye: boolean;
  /** Supprimé par l'utilisateur, ou sa saisie abandonnée : rien ne part plus pour lui. */
  supprime?: boolean;
}

const documentNeuf = (): Document => ({ idPrevu: crypto.randomUUID(), envoye: true });

/** Une facture émise ou l'exemple : ce qui s'affiche à la place d'un brouillon, sans en être un. */
const estUneVue = (b: Brouillon): boolean => b.issued !== undefined || b.sample === true;

const corps = (b: Brouillon) => ({
  form: versPortable(b.form),
  appearance: versPortable(b.appearance),
});

/** Les mêmes objets (formulaire, apparence) : rien n'a changé entre-temps, sans rien comparer. */
const memesObjets = (
  a: { form: unknown; appearance: unknown } | undefined,
  b: { form: unknown; appearance: unknown },
): boolean => a !== undefined && a.form === b.form && a.appearance === b.appearance;

const saisieDu = (m: Miroir): Brouillon => {
  const { brouillon: _b, idPrevu: _i, envoye: _e, ...b } = m;
  return b;
};

const documentDu = (m: Miroir): Document => ({
  idPrevu: m.idPrevu ?? crypto.randomUUID(),
  id: m.brouillon?.id,
  version: m.brouillon?.version,
  derniere: saisieDu(m),
  envoye: m.envoye,
});

export function supabasePersistence(sb: SupabaseClient, entrepriseId: string): PersistenceCompte {
  const E = entrepriseId;
  const cleCourant = `brouillon-courant-${E}`;
  const cleMiroir = `draft-compte-${E}`;
  const cleVue = `vue-compte-${E}`;
  /** Les clés de `kv` sans place sur le serveur : un objet, dans ce navigateur. */
  const cleLocale = `kv-compte-${E}`;

  /** Le document ouvert dans l'éditeur (ou sous la vue affichée). */
  let doc: Document = documentNeuf();
  /** Le document de chaque saisie reçue : rejouée plus tard, elle n'en change pas. */
  const documents = new WeakMap<Brouillon, Document>();
  /** La numérotation telle que le serveur l'a rendue en dernier. */
  let numerotation: Numbering | undefined;

  /**
   * Les envois de brouillon passent un à un : deux écritures simultanées partiraient sur la même
   * version, et la seconde se croirait en conflit avec la première.
   */
  let file: Promise<unknown> = Promise.resolve();
  function enFile<T>(operation: () => Promise<T>): Promise<T> {
    const suite = file.then(operation, operation);
    file = suite.catch(() => undefined);
    return suite;
  }

  /** Une écriture locale (miroir, identifiant) qui échoue ne retient pas celle du serveur. */
  const auMieux = (p: Promise<unknown>): Promise<void> =>
    p.then(
      () => undefined,
      () => undefined,
    );

  /** Le miroir du document ouvert, tel qu'il est maintenant. */
  function ecrireMiroir(): Promise<void> {
    const d = doc;
    if (!d.derniere || d.supprime) return Promise.resolve();
    const miroir: Miroir = {
      ...d.derniere,
      brouillon:
        d.id !== undefined && d.version !== undefined
          ? { id: d.id, version: d.version }
          : undefined,
      idPrevu: d.idPrevu,
      envoye: d.envoye,
    };
    return auMieux(local.set(cleMiroir, miroir));
  }

  /** `brouillon-courant` suit le document ouvert. */
  async function suivreCourant(d: Document): Promise<void> {
    if (d !== doc) return;
    await auMieux(d.id ? local.set(cleCourant, d.id) : local.remove('kv', cleCourant));
  }

  async function lireLigne(id: string): Promise<LigneBrouillon | undefined> {
    const r = await sb
      .from('brouillons')
      .select('id, form, appearance, version')
      .eq('entreprise_id', E)
      .eq('id', id)
      .maybeSingle<LigneBrouillon>();
    if (r.error) throw echec(r);
    return r.data ?? undefined;
  }

  /**
   * Ouvre la ligne lue : elle devient le document ouvert, tout de suite. Les recopies locales
   * (identifiant, miroir) partent dans l'ordre, sans être attendues : l'appelant affiche le
   * brouillon dans le même temps, sans frappe intercalée.
   */
  function adopter(l: LigneBrouillon): Brouillon {
    const d = documentDeLigne(l);
    ouvrir(d, true);
    return d.derniere as Brouillon;
  }

  /** Le document d'une ligne lue, sans rien ouvrir. */
  function documentDeLigne(l: LigneBrouillon): Document {
    const b: Brouillon = {
      form: depuisPortable<InvoiceForm>(l.form),
      appearance: depuisPortable<Appearance>(l.appearance),
    };
    return {
      idPrevu: l.id,
      id: l.id,
      version: l.version,
      surLeServeur: canonique({ form: l.form, appearance: l.appearance }),
      confirme: { form: b.form, appearance: b.appearance },
      derniere: b,
      envoye: true,
    };
  }

  /**
   * `d` devient le document ouvert, tout de suite ; ses recopies locales (identifiant, miroir, vue
   * retirée si l'éditeur montre un brouillon) partent dans l'ordre, sans être attendues.
   */
  function ouvrir(d: Document, retirerLaVue: boolean): void {
    doc = d;
    if (d.derniere) documents.set(d.derniere, d);
    void suivreCourant(d);
    void ecrireMiroir();
    if (retirerLaVue) void auMieux(local.remove('kv', cleVue));
  }

  /** Recopie `b` sans l'envoyer : la vue à part, la saisie d'un brouillon dans son miroir. */
  async function garder(b: Brouillon): Promise<void> {
    if (estUneVue(b)) {
      await auMieux(local.set(cleVue, b));
      return;
    }
    const d = doc;
    // Le brouillon ouvert a été supprimé : ce que l'éditeur en montre encore ne se garde plus.
    if (d.supprime) return;
    d.derniere = b;
    documents.set(b, d);
    // Par identité, sans rien recalculer : ce qui a changé depuis la dernière confirmation repart.
    d.envoye = memesObjets(d.confirme, b);
    // Le miroir d'abord (à la fermeture de la page, c'est lui qui compte), puis la vue retirée :
    // l'éditeur montre un brouillon, la vue gardée ne s'affichera plus au démarrage.
    await ecrireMiroir();
    await auMieux(local.remove('kv', cleVue));
  }

  /**
   * Envoie `b`, la saisie du document `d` : insertion sous `idPrevu` s'il n'est pas créé, puis
   * mise à jour sur la version lue si le serveur n'a pas déjà ce contenu. Une ligne déjà là sous
   * `idPrevu` est la nôtre (une insertion dont la réponse s'est perdue) si elle est encore en
   * version 1 ou porte notre contenu ; sinon quelqu'un l'a modifiée depuis : conflit.
   */
  async function envoyer(b: Brouillon, d: Document): Promise<void> {
    if (d.supprime) return;
    const c = corps(b);
    const texte = canonique(c);
    if (d.id !== undefined && d.version === undefined) {
      // Ouvert sans avoir été lu (sous une vue, au démarrage) : sa version d'abord.
      const l = await lireLigne(d.id);
      if (l) {
        d.version = l.version;
        d.surLeServeur = canonique({ form: l.form, appearance: l.appearance });
      } else Object.assign(d, { idPrevu: crypto.randomUUID(), id: undefined });
    }
    if (d.id === undefined) {
      const r = await sb
        .from('brouillons')
        .insert({ id: d.idPrevu, entreprise_id: E, ...c })
        .select('id, version')
        .single<{ id: string; version: number }>();
      if (!r.error) {
        Object.assign(d, { id: r.data.id, version: r.data.version, surLeServeur: texte });
      } else if (r.status === 409) {
        const l = await lireLigne(d.idPrevu);
        if (!l) throw echec(r);
        const serveur = canonique({ form: l.form, appearance: l.appearance });
        if (l.version !== 1 && serveur !== texte) throw new ErreurConservation('BROUILLON_MODIFIE');
        Object.assign(d, { id: l.id, version: l.version, surLeServeur: serveur });
      } else throw echec(r);
      await suivreCourant(d);
    }
    if (texte !== d.surLeServeur) {
      const r = await sb
        .from('brouillons')
        .update(c)
        .eq('entreprise_id', E)
        .eq('id', d.id as string)
        .eq('version', d.version as number)
        .select('version');
      if (r.error) throw echec(r);
      const [ligne] = r.data as { version: number }[];
      if (!ligne) {
        // Aucune ligne touchée : la version a changé, ou le brouillon n'existe plus (supprimé
        // ailleurs, `SUPPRIME`). Rien d'écrasé ; l'utilisateur choisit.
        const existe = await lireLigne(d.id as string).then(
          (l) => l !== undefined,
          () => true,
        );
        throw new ErreurConservation('BROUILLON_MODIFIE', existe ? undefined : 'SUPPRIME');
      }
      d.version = ligne.version;
      d.surLeServeur = texte;
    }
    d.confirme = { form: b.form, appearance: b.appearance };
    if (d.derniere === undefined || memesObjets(d.derniere, b)) d.envoye = true;
    if (d === doc) await ecrireMiroir();
  }

  async function enregistrer(b: Brouillon): Promise<void> {
    // Une vue reste dans ce navigateur : le brouillon ouvert et son miroir n'en savent rien.
    if (estUneVue(b)) {
      await auMieux(local.set(cleVue, b));
      return;
    }
    // Une saisie déjà reçue (rejouée par le magasin) va au document où elle a été tapée, sans rien
    // changer au miroir ni à la vue affichée ; une saisie nouvelle vient de l'éditeur.
    const connue = documents.get(b);
    const d = connue ?? doc;
    if (d.supprime) return;
    // La saisie rejoint son document et son miroir part tout de suite ; l'envoi prend sa place
    // dans la file dans le même temps (`envoisTermines` l'attend donc aussi).
    const garde = connue ? Promise.resolve() : garder(b);
    const envoi = enFile(async () => {
      // Rien n'est sauté : part la saisie la plus récente de ce document (celle-ci, ou une plus
      // neuve arrivée entre-temps, peut-être seulement recopiée dans le miroir) ; la suivante
      // trouvera le serveur à jour et n'enverra rien.
      if (d.supprime) return;
      await envoyer(d.derniere ?? b, d);
    });
    await garde;
    await envoi;
  }

  /**
   * Peut-on quitter le document ouvert sans rien perdre, l'écran montrant `affiche` ? Oui s'il a
   * été supprimé, si l'écran montre une vue et que la saisie du brouillon dessous est sur le
   * serveur, ou si l'écran montre les objets mêmes dont le serveur a reçu le contenu.
   */
  function quittable(affiche: Brouillon): boolean {
    const d = doc;
    if (d.supprime) return true;
    if (estUneVue(affiche)) return d.envoye || !d.derniere;
    if (memesObjets(d.confirme, affiche)) return true;
    // L'écran montre souvent des copies de ce qui a été lu (le démarrage complète le formulaire,
    // `hydrateForm`) : même contenu que le serveur, rien à perdre. Calculé seulement ici, au moment
    // de quitter, jamais à chaque frappe.
    return d.surLeServeur !== undefined && canonique(corps(affiche)) === d.surLeServeur;
  }

  /**
   * Au démarrage, une saisie que le serveur n'a pas reçue : est-elle toujours en avance sur lui ?
   * Même version : elle s'y applique. Même contenu sur une autre version : c'est notre propre
   * écriture, dont la réponse s'est perdue, et rien n'est en conflit. Brouillon disparu (émis ou
   * supprimé ailleurs) : elle repartira en nouveau brouillon, sous un nouvel identifiant (l'ancien a
   * pu nommer une facture émise). Sinon le serveur a changé depuis : elle reste sur son ancienne
   * version, et son envoi signalera le conflit sans rien écraser.
   */
  async function verifier(d: Document): Promise<void> {
    if (d.id === undefined || !d.derniere) return;
    const l = await lireLigne(d.id);
    if (!l) {
      Object.assign(d, {
        idPrevu: crypto.randomUUID(),
        id: undefined,
        version: undefined,
        surLeServeur: undefined,
      });
      return;
    }
    const serveur = canonique({ form: l.form, appearance: l.appearance });
    const identique = serveur === canonique(corps(d.derniere));
    if (l.version === d.version || identique) {
      d.version = l.version;
      d.surLeServeur = serveur;
      if (identique) {
        d.envoye = true;
        d.confirme = { form: d.derniere.form, appearance: d.derniere.appearance };
      }
    }
  }

  /** Le brouillon modifié le plus récemment, lu sans rien ouvrir. */
  async function lirePlusRecent(): Promise<LigneBrouillon | undefined> {
    const r = await sb
      .from('brouillons')
      .select('id, form, appearance, version')
      .eq('entreprise_id', E)
      .order('modifie_le', { ascending: false })
      .limit(1)
      .maybeSingle<LigneBrouillon>();
    if (r.error) throw echec(r);
    return r.data ?? undefined;
  }

  /**
   * Ce qui s'affiche au démarrage, lu sans rien changer ; `appliquer` l'ouvre ensuite, sans attendre
   * (l'appelant peut ainsi renoncer, si l'éditeur a changé pendant la lecture, ou si une lecture a
   * échoué : rien n'est ouvert à moitié). Une saisie que le serveur n'a pas reçue désigne le document
   * ouvert, quoi que dise `brouillon-courant` : le magasin la renvoie aussitôt (`saisieEnAttente`).
   * Une vue gardée (facture émise, exemple) s'affiche de nouveau — l'exemple, jamais par-dessus une
   * telle saisie ; sinon le brouillon courant, ou le plus récent du serveur.
   */
  async function preparerBrouillon(): Promise<{
    brouillon: Brouillon | undefined;
    appliquer: () => void;
  }> {
    const [id, miroir, vue] = await Promise.all([
      local.get<string>(cleCourant).catch(() => undefined),
      local.get<Miroir>(cleMiroir).catch(() => undefined),
      local.get<Brouillon>(cleVue).catch(() => undefined),
    ]);
    if (miroir && !miroir.envoye) {
      const d = documentDu(miroir);
      await verifier(d);
      const montre = montrer(vue, miroir);
      return { brouillon: montre ?? d.derniere, appliquer: () => ouvrir(d, montre === undefined) };
    }
    if (vue) {
      // Le brouillon courant reste celui de la liste ; sa version se lira à sa réouverture.
      const d = id ? { idPrevu: crypto.randomUUID(), id, envoye: true } : documentNeuf();
      return {
        brouillon: vue,
        appliquer: () => {
          doc = d;
        },
      };
    }
    const l = (id ? await lireLigne(id) : undefined) ?? (await lirePlusRecent());
    if (!l) return { brouillon: undefined, appliquer: () => ouvrir(documentNeuf(), false) };
    const d = documentDeLigne(l);
    return { brouillon: d.derniere, appliquer: () => ouvrir(d, true) };
  }

  /**
   * La vue gardée à afficher au démarrage. L'exemple ne recouvre jamais une saisie que le serveur
   * n'a pas reçue : on y taperait sans la voir. Une facture émise, si : on n'y tape pas, et la
   * liste des brouillons propose de reprendre la saisie cachée.
   */
  function montrer(vue: Brouillon | undefined, miroir: Miroir | undefined): Brouillon | undefined {
    return vue?.sample === true && miroir !== undefined && !miroir.envoye ? undefined : vue;
  }

  /** Le brouillon courant tel que le serveur l'a, sans rien changer : pour la sauvegarde. */
  async function brouillonPourSauvegarde(): Promise<Brouillon | undefined> {
    const id = doc.id ?? (await local.get<string>(cleCourant).catch(() => undefined));
    if (!id) return undefined;
    const l = await lireLigne(id);
    return l
      ? {
          form: depuisPortable<InvoiceForm>(l.form),
          appearance: depuisPortable<Appearance>(l.appearance),
        }
      : undefined;
  }

  // ---------- kv : entreprise, apparence, numérotation, et ce qui reste local ----------

  async function lireEntreprise(): Promise<{ profil: unknown; apparence_defaut: unknown }> {
    const r = await sb
      .from('entreprises')
      .select('profil, apparence_defaut')
      .eq('id', E)
      .single<{ profil: unknown; apparence_defaut: unknown }>();
    if (r.error) throw echec(r);
    return r.data;
  }

  async function ecrireEntreprise(colonnes: {
    profil?: unknown;
    apparence_defaut?: unknown;
  }): Promise<void> {
    const r = await sb.from('entreprises').update(colonnes).eq('id', E).select('id');
    if (r.error) throw echec(r);
    // Sans ligne touchée, ce compte n'est pas (ou plus) membre de l'entreprise.
    if ((r.data as unknown[]).length === 0) throw new ErreurConservation('REFUS', 'DROITS');
  }

  async function lireNumerotation(): Promise<Numbering> {
    const r = await sb
      .from('numerotation')
      .select('gabarit, prochain, annuelle, annee')
      .eq('entreprise_id', E)
      .single<LigneNumerotation>();
    if (r.error) throw echec(r);
    numerotation = versNumerotation(r.data);
    return numerotation;
  }

  async function ecrireNumerotation(n: Numbering): Promise<void> {
    const colonnes: Partial<LigneNumerotation> = { gabarit: n.pattern, annuelle: n.yearly };
    if (!numerotation || n.next !== numerotation.next) colonnes.prochain = n.next;
    const r = await sb
      .from('numerotation')
      .update(colonnes)
      .eq('entreprise_id', E)
      .select('gabarit, prochain, annuelle, annee');
    if (r.error) throw echec(r);
    const [ligne] = r.data as LigneNumerotation[];
    if (!ligne) throw new ErreurConservation('REFUS', 'DROITS');
    numerotation = versNumerotation(ligne);
  }

  /** Les valeurs locales : un objet sous une seule clé, lu et réécrit une opération à la fois. */
  let fileLocale: Promise<unknown> = Promise.resolve();
  function changerLocal(change: (valeurs: Record<string, unknown>) => void): Promise<void> {
    const suite = fileLocale.then(async () => {
      const valeurs = (await local.get<Record<string, unknown>>(cleLocale)) ?? {};
      change(valeurs);
      await local.set(cleLocale, valeurs);
    });
    fileLocale = suite.catch(() => undefined);
    return suite;
  }
  const lireLocal = async (): Promise<Record<string, unknown>> => {
    await fileLocale;
    return (await local.get<Record<string, unknown>>(cleLocale)) ?? {};
  };

  // ---------- fichiers ----------

  /** Le bucket et le chemin d'un fichier : un PDF émis, ou un fichier de l'utilisateur. */
  const emplacement = (cle: string): { bucket: 'factures' | 'fichiers'; chemin: string } =>
    cle.startsWith('pdf-')
      ? { bucket: 'factures', chemin: `${E}/${cle.slice('pdf-'.length)}.pdf` }
      : { bucket: 'fichiers', chemin: `${E}/${cle}` };

  /** L'erreur d'un appel au Storage, traduite : le jeton refusé est reconnu à son message. */
  async function echecStockage(e: unknown): Promise<ErreurConservation> {
    // Sans statut, la requête n'a pas eu de réponse (`StorageUnknownError` : réseau).
    if (!estErreurStockage(e)) return new ErreurConservation('RESEAU', String(e));
    const status = Number(e.status);
    if (!Number.isFinite(status) || status >= 500)
      return new ErreurConservation('RESEAU', e.message);
    // Le Storage répond 400 ou 403 au jeton refusé ; une session absente (`supabase-js` l'a retirée
    // après un renouvellement refusé) rend le compte anonyme, que les règles refusent aussi.
    const sansSession = !(await sb.auth.getSession()).data.session;
    if (status === 401 || JETON_REFUSE.test(e.message) || sansSession)
      return new ErreurConservation('SESSION', e.message);
    return new ErreurConservation('REFUS', e.message);
  }

  /** Tous les fichiers de l'entreprise (logos, polices), sous-dossiers compris. */
  async function listerFichiers(dossier: string): Promise<string[]> {
    const chemins: string[] = [];
    for (let debut = 0; ; debut += PAGE) {
      const { data, error } = await sb.storage
        .from('fichiers')
        .list(dossier, { limit: PAGE, offset: debut, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw await echecStockage(error);
      for (const objet of data) {
        const chemin = `${dossier}/${objet.name}`;
        // Un dossier n'a pas d'identifiant.
        if (objet.id === null) chemins.push(...(await listerFichiers(chemin)));
        else chemins.push(chemin);
      }
      if (data.length < PAGE) return chemins;
    }
  }

  const persistance: PersistenceCompte = {
    entrepriseId: E,

    /** Vrai si le serveur répond et reconnaît la session. */
    async available(): Promise<boolean> {
      const r = await sb.from('entreprises').select('id').eq('id', E).maybeSingle();
      return !r.error && r.data !== null;
    },

    async get<T>(key: string): Promise<T | undefined> {
      switch (key) {
        case 'company':
          return depuisPortable<T>((await lireEntreprise()).profil);
        case 'appearance-default': {
          const { apparence_defaut } = await lireEntreprise();
          return apparence_defaut === null ? undefined : depuisPortable<T>(apparence_defaut);
        }
        case 'numbering':
          return (await lireNumerotation()) as T;
        case 'draft':
          return (await enFile(async () => {
            const lecture = await preparerBrouillon();
            lecture.appliquer();
            return lecture.brouillon;
          })) as T | undefined;
        default:
          return (await lireLocal())[key] as T | undefined;
      }
    },

    async set(key: string, value: unknown): Promise<IDBValidKey> {
      switch (key) {
        case 'company':
          await ecrireEntreprise({ profil: versPortable(value as CompanyProfile) });
          break;
        case 'appearance-default':
          await ecrireEntreprise({ apparence_defaut: versPortable(value) });
          break;
        case 'numbering':
          await ecrireNumerotation(value as Numbering);
          break;
        case 'draft':
          await enregistrer(value as Brouillon);
          break;
        default:
          await changerLocal((valeurs) => {
            valeurs[key] = value;
          });
      }
      return key;
    },

    async list<T>(store: 'invoices' | 'clients' | 'products'): Promise<T[]> {
      if (store === 'clients') {
        const lignes = await toutLire<{ id: string; party: unknown; modifie_le: string }>((a, b) =>
          sb
            .from('clients')
            .select('id, party, modifie_le')
            .eq('entreprise_id', E)
            .order('id')
            .range(a, b),
        );
        return lignes.map(
          (l): ClientRecord => ({
            uid: l.id,
            party: depuisPortable(l.party),
            updatedAt: iso(l.modifie_le),
          }),
        ) as T[];
      }
      if (store === 'products') {
        const lignes = await toutLire<{ id: string; fiche: unknown }>((a, b) =>
          sb.from('produits').select('id, fiche').eq('entreprise_id', E).order('id').range(a, b),
        );
        return lignes.map(
          (l): ProductRecord => ({
            ...depuisPortable<Omit<ProductRecord, 'uid'>>(l.fiche),
            uid: l.id,
          }),
        ) as T[];
      }
      const lignes = await toutLire<LigneFacture>((a, b) =>
        sb
          .from('factures')
          .select(
            'id, numero, type_code, date_emission, client_nom, devise, ttc, net_a_payer, form, appearance, emise_le',
          )
          .eq('entreprise_id', E)
          .order('emise_le')
          .order('id')
          .range(a, b),
      );
      return lignes.map(
        (l): SavedInvoice => ({
          uid: l.id,
          status: 'issued',
          form: depuisPortable(l.form),
          appearance: depuisPortable(l.appearance),
          summary: {
            id: l.numero,
            typeCode: l.type_code,
            issueDate: l.date_emission,
            buyerName: l.client_nom,
            currency: l.devise,
            total: Number(l.ttc),
            due: Number(l.net_a_payer),
          },
          issuedAt: iso(l.emise_le),
        }),
      ) as T[];
    },

    async put<T extends { uid: string }>(
      store: 'invoices' | 'clients' | 'products',
      value: T,
    ): Promise<IDBValidKey> {
      if (store === 'invoices') throw new ErreurConservation('EMISSION_SERVEUR');
      if (store === 'clients') {
        const { party, updatedAt } = value as unknown as ClientRecord;
        const r = await sb.from('clients').upsert(
          {
            entreprise_id: E,
            id: value.uid,
            party: versPortable(party),
            nom: party.name ?? '',
            email: party.contact?.email?.trim() || null,
            modifie_le: modifieLe(updatedAt),
          },
          { onConflict: 'entreprise_id,id' },
        );
        if (r.error) throw echec(r);
        return value.uid;
      }
      const { uid, ...fiche } = value as unknown as ProductRecord;
      const r = await sb.from('produits').upsert(
        {
          entreprise_id: E,
          id: uid,
          fiche: versPortable(fiche),
          nom: fiche.name ?? '',
          modifie_le: modifieLe(fiche.updatedAt),
        },
        { onConflict: 'entreprise_id,id' },
      );
      if (r.error) throw echec(r);
      return uid;
    },

    async remove(store, key): Promise<undefined> {
      if (store === 'invoices') throw new ErreurConservation('EMISSION_SERVEUR');
      if (store === 'clients' || store === 'products') {
        const table = store === 'clients' ? 'clients' : 'produits';
        const r = await sb.from(table).delete().eq('entreprise_id', E).eq('id', key);
        if (r.error) throw echec(r);
        return undefined;
      }
      if (store === 'files') {
        if (key.startsWith('pdf-')) throw new ErreurConservation('EMISSION_SERVEUR');
        const { error } = await sb.storage.from('fichiers').remove([emplacement(key).chemin]);
        if (error) throw await echecStockage(error);
        return undefined;
      }
      switch (key) {
        case 'appearance-default':
          await ecrireEntreprise({ apparence_defaut: null });
          break;
        case 'draft': {
          const id = doc.id;
          if (id) await persistance.supprimerBrouillon(id);
          break;
        }
        case 'company':
        case 'numbering':
          // L'entreprise et sa numérotation vivent autant que le compte.
          throw new ErreurConservation('REFUS', 'SUPPRESSION_INTERDITE');
        default:
          await changerLocal((valeurs) => {
            delete valeurs[key];
          });
      }
      return undefined;
    },

    async getFile(key: string): Promise<Uint8Array | undefined> {
      const { bucket, chemin } = emplacement(key);
      const { data, error } = await sb.storage.from(bucket).download(chemin);
      if (error) {
        if (absent(error)) return undefined;
        throw await echecStockage(error);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    /**
     * Dépose un logo ou une police. Le type annoncé est celui que disent les octets (un navigateur
     * annonce mal un `.ttf`, et le bucket n'accepte que PNG, JPEG et TTF) ; un logo de plus de
     * 1 Mio est refusé ici, avant le serveur. Un PDF ne se dépose que par l'émission.
     */
    async setFile(key: string, bytes: Uint8Array): Promise<IDBValidKey> {
      if (key.startsWith('pdf-')) throw new ErreurConservation('EMISSION_SERVEUR');
      const type = typeDe(bytes);
      if (!type) throw new ErreurConservation('FICHIER', 'TYPE');
      if (bytes.length > PLAFONDS[type]) throw new ErreurConservation('FICHIER', 'TAILLE');
      const { error } = await sb.storage
        .from('fichiers')
        .upload(emplacement(key).chemin, bytes, { contentType: type, upsert: true });
      if (error) throw await echecStockage(error);
      return key;
    },

    /** Même forme que la sauvegarde locale (`kv`, `files`, et trois listes), sans les PDF. */
    async dump(): Promise<Record<string, unknown>> {
      const [invoices, clients, products, entreprise, numbering, draft, locales] =
        await Promise.all([
          persistance.list('invoices'),
          persistance.list('clients'),
          persistance.list('products'),
          lireEntreprise(),
          lireNumerotation(),
          brouillonPourSauvegarde(),
          lireLocal(),
        ]);
      const kv: Record<string, unknown> = {
        ...locales,
        company: depuisPortable(entreprise.profil),
        numbering,
      };
      if (entreprise.apparence_defaut !== null)
        kv['appearance-default'] = depuisPortable(entreprise.apparence_defaut);
      if (draft) kv.draft = draft;
      const files: Record<string, Uint8Array> = {};
      for (const chemin of await listerFichiers(E)) {
        const cle = chemin.slice(E.length + 1);
        const octets = await persistance.getFile(cle);
        if (octets) files[cle] = octets;
      }
      return { invoices, clients, products, kv, files };
    },

    // ---------- plusieurs brouillons ----------

    garderBrouillon: (valeur) => garder(valeur as Brouillon),

    saisieEnAttente: () => (doc.envoye || doc.supprime ? undefined : doc.derniere),

    async brouillonLocal(): Promise<Brouillon | undefined> {
      const [id, miroir, gardee] = await Promise.all([
        local.get<string>(cleCourant).catch(() => undefined),
        local.get<Miroir>(cleMiroir).catch(() => undefined),
        local.get<Brouillon>(cleVue).catch(() => undefined),
      ]);
      const vue = montrer(gardee, miroir);
      // Le document ouvert : celui du miroir quand sa saisie s'affiche ou attend le serveur ; sous
      // une vue, le brouillon courant — jamais celui d'un miroir déjà envoyé, qui peut être un
      // brouillon quitté depuis (« Nouvel exemple »). Jamais un brouillon lu à moitié.
      if (miroir && (!miroir.envoye || !vue)) doc = documentDu(miroir);
      else doc = vue && id ? { idPrevu: crypto.randomUUID(), id, envoye: true } : documentNeuf();
      if (doc.derniere) documents.set(doc.derniere, doc);
      return vue ?? (miroir ? saisieDu(miroir) : undefined);
    },

    preparerBrouillon: () => enFile(preparerBrouillon),

    brouillonCourant: () =>
      doc.id !== undefined && doc.version !== undefined && !doc.supprime
        ? { id: doc.id, version: doc.version }
        : undefined,

    envoisTermines: () => enFile(async () => undefined),

    quitterBrouillon(affiche) {
      if (!quittable(affiche as Brouillon)) return false;
      doc = documentNeuf();
      void suivreCourant(doc);
      return true;
    },

    saisieSurLExemple() {
      // Encore vierge (« Nouvel exemple » vient de l'ouvrir) : c'est déjà un nouveau document.
      if (doc.id === undefined && doc.derniere === undefined && !doc.supprime) return;
      doc = documentNeuf();
      void suivreCourant(doc);
    },

    async brouillons(): Promise<ResumeBrouillon[]> {
      const lignes = await toutLire<{
        id: string;
        numero: string | null;
        client: string | null;
        modifie_le: string;
        version: number;
      }>((a, b) =>
        sb
          .from('brouillons')
          .select('id, version, modifie_le, numero:form->>id, client:form->buyer->>name')
          .eq('entreprise_id', E)
          .order('modifie_le', { ascending: false })
          .order('id')
          .range(a, b),
      );
      return lignes.map((l) => ({
        id: l.id,
        numero: l.numero ?? '',
        client: l.client ?? '',
        modifieLe: iso(l.modifie_le),
        version: l.version,
      }));
    },

    async ouvrirBrouillon(id, affiche) {
      if (id === doc.id && doc.derniere && !doc.supprime) {
        // Le document déjà ouvert (sous une vue, peut-être) : sa saisie, envoyée ou non.
        void auMieux(local.remove('kv', cleVue));
        return doc.derniere;
      }
      const enCours = () => new ErreurConservation('EN_ATTENTE', 'EN_COURS');
      if (!quittable(affiche() as Brouillon)) throw enCours();
      const l = await lireLigne(id);
      if (!l) return undefined;
      // Après la lecture, sans rien attendre : l'écran de ce moment-là doit être sur le serveur.
      if (!quittable(affiche() as Brouillon)) throw enCours();
      return adopter(l);
    },

    supprimerBrouillon: (id) =>
      enFile(async () => {
        const r = await sb.from('brouillons').delete().eq('entreprise_id', E).eq('id', id);
        if (r.error) throw echec(r);
        if (doc.id === id) {
          // Le document reste ouvert, supprimé : ce que l'éditeur en montre encore, minuteries
          // comprises, ne part plus nulle part, jusqu'au prochain document.
          doc.supprime = true;
          await auMieux(local.remove('kv', cleCourant));
          await auMieux(local.remove('kv', cleMiroir));
        }
      }),

    abandonnerSaisie: () =>
      enFile(async () => {
        const d = doc;
        // La lecture d'abord : si elle échoue, rien n'a changé (la saisie reste, avec son bandeau).
        const l = d.id !== undefined ? await lireLigne(d.id) : undefined;
        // Puis, sans rien attendre : la saisie abandonnée ne repart plus, même rejouée.
        d.supprime = true;
        if (l) return adopter(l);
        // Jamais enregistré (ou disparu) : plus rien d'ouvert. Les recopies locales ne sont pas
        // attendues : l'appelant change l'éditeur dans le même temps.
        doc = documentNeuf();
        void suivreCourant(doc);
        void auMieux(local.remove('kv', cleMiroir));
        return undefined;
      }),

    rechargerBrouillon: () =>
      enFile(async () => {
        if (doc.id === undefined) return undefined;
        const l = await lireLigne(doc.id);
        return l ? adopter(l) : undefined;
      }),

    imposerBrouillon: (b) =>
      enFile(async () => {
        const d = doc;
        d.derniere = b;
        documents.set(b, d);
        d.envoye = false;
        await ecrireMiroir();
        if (d.id !== undefined) {
          const l = await lireLigne(d.id);
          // Supprimé ailleurs entre-temps : la saisie devient un nouveau brouillon.
          if (l) Object.assign(d, { version: l.version, surLeServeur: undefined });
          else
            Object.assign(d, { idPrevu: crypto.randomUUID(), id: undefined, version: undefined });
        }
        await envoyer(b, d);
      }),
  };
  return persistance;
}
