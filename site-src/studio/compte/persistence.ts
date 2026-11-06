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
 *   - `draft` → le brouillon courant (`brouillons`), dont l'identifiant reste dans ce navigateur
 *     (`brouillon-courant-<entreprise>`) ; sans lui, une écriture insère un brouillon. Chaque
 *     écriture est d'abord recopiée dans IndexedDB (`draft-compte-<entreprise>`) : ce miroir garde
 *     la saisie quand le serveur ne la prend pas (réseau, session expirée, conflit). La mise à jour
 *     ne passe que sur la version lue (`update … where id and version`) : si un autre onglet a
 *     enregistré entre-temps, rien n'est écrasé et l'écriture lève `BROUILLON_MODIFIE` ;
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
import { type CodeConservation, ErreurConservation, type Persistence } from '../persistence.js';
import { indexedDbPersistence as local } from '../storage.js';
import type { Loaded } from '../store.js';

/** Le brouillon tel que le Studio l'enregistre sous `draft`. */
export type Brouillon = NonNullable<Loaded['draft']>;

/**
 * Le miroir local du brouillon : la dernière saisie, le brouillon du serveur et la version sur
 * lesquels elle repose, et si le serveur l'a reçue.
 */
export type Miroir = Brouillon & {
  brouillon?: { id: string; version: number } | undefined;
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
export interface PersistenceCompte extends Persistence {
  readonly entrepriseId: string;
  /** Le brouillon ouvert sur le serveur, et la version lue ; rien tant qu'il n'est pas créé. */
  brouillonCourant(): { id: string; version: number } | undefined;
  /** Les brouillons de l'entreprise, le plus récemment modifié d'abord. */
  brouillons(): Promise<ResumeBrouillon[]>;
  /** Ouvre un brouillon : il devient le brouillon courant. Rien s'il n'existe plus. */
  ouvrirBrouillon(id: string): Promise<Brouillon | undefined>;
  supprimerBrouillon(id: string): Promise<void>;
  /** Plus de brouillon courant : la prochaine écriture en crée un. */
  nouveauBrouillon(): Promise<void>;
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

export function supabasePersistence(sb: SupabaseClient, entrepriseId: string): PersistenceCompte {
  const E = entrepriseId;
  const cleCourant = `brouillon-courant-${E}`;
  const cleMiroir = `draft-compte-${E}`;
  /** Les clés de `kv` sans place sur le serveur : un objet, dans ce navigateur. */
  const cleLocale = `kv-compte-${E}`;

  /** Le brouillon ouvert sur le serveur, et la version sur laquelle la prochaine écriture passe. */
  let courant: { id: string; version: number } | undefined;
  /** Texte canonique de ce que le serveur a de ce brouillon : un contenu identique ne repart pas. */
  let surLeServeur: string | undefined;
  /** La dernière saisie reçue : une écriture dépassée par une plus récente ne part pas. */
  let derniere: Brouillon | undefined;
  /** La numérotation telle que le serveur l'a rendue en dernier. */
  let numerotation: Numbering | undefined;

  /**
   * Les opérations sur le brouillon passent une à une : deux écritures simultanées partiraient
   * sur la même version, et la seconde se croirait en conflit avec la première.
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

  function ecrireMiroir(b: Brouillon, envoye: boolean): Promise<void> {
    const miroir: Miroir = { ...b, brouillon: courant && { ...courant }, envoye };
    return auMieux(local.set(cleMiroir, miroir));
  }

  /** Le brouillon courant : celui-ci désormais, ou plus aucun. */
  async function suivre(ligne: { id: string; version: number } | undefined): Promise<void> {
    courant = ligne && { id: ligne.id, version: ligne.version };
    await auMieux(ligne ? local.set(cleCourant, ligne.id) : local.remove('kv', cleCourant));
  }

  const lireLigne = (l: LigneBrouillon): Brouillon => ({
    form: depuisPortable<InvoiceForm>(l.form),
    appearance: depuisPortable<Appearance>(l.appearance),
  });

  /** Ouvre la ligne lue : elle devient le brouillon courant, et le miroir la recopie. */
  async function adopter(l: LigneBrouillon): Promise<Brouillon> {
    const b = lireLigne(l);
    await suivre(l);
    surLeServeur = canonique({ form: l.form, appearance: l.appearance });
    derniere = b;
    await ecrireMiroir(b, true);
    return b;
  }

  /** Envoie `b` : insertion sans brouillon courant, sinon mise à jour sur la version lue. */
  async function envoyer(b: Brouillon): Promise<void> {
    const corps = { form: versPortable(b.form), appearance: versPortable(b.appearance) };
    const texte = canonique(corps);
    if (!courant) {
      const r = await sb
        .from('brouillons')
        .insert({ entreprise_id: E, ...corps })
        .select('id, version')
        .single<{ id: string; version: number }>();
      if (r.error) throw echec(r);
      await suivre(r.data);
    } else if (texte !== surLeServeur) {
      const r = await sb
        .from('brouillons')
        .update(corps)
        .eq('entreprise_id', E)
        .eq('id', courant.id)
        .eq('version', courant.version)
        .select('version');
      if (r.error) throw echec(r);
      const [ligne] = r.data as { version: number }[];
      // Aucune ligne touchée : la version a changé (ou le brouillon n'existe plus). Rien d'écrasé.
      if (!ligne) throw new ErreurConservation('BROUILLON_MODIFIE');
      courant = { ...courant, version: ligne.version };
    }
    surLeServeur = texte;
    // Le miroir suit : la saisie la plus récente, sur la version qu'on vient d'obtenir.
    if (derniere) await ecrireMiroir(derniere, derniere === b);
  }

  /**
   * Une saisie que le serveur n'a pas reçue : on la renvoie, sans rien lever si elle échoue encore
   * (le miroir la garde, la prochaine écriture réessaie). Appelée depuis une opération de la file.
   */
  const rattraper = (b: Brouillon): Promise<void> => auMieux(envoyer(b));

  async function enregistrerBrouillon(b: Brouillon): Promise<void> {
    derniere = b;
    if (b.issued !== undefined || b.sample) {
      // Une facture émise affichée, ou l'exemple pas encore modifié : ce n'est pas un brouillon
      // du serveur. Le brouillon courant y reste, dans la liste ; le miroir garde la vue.
      await enFile(async () => {
        await suivre(undefined);
        surLeServeur = undefined;
        await ecrireMiroir(b, true);
      });
      return;
    }
    // Le miroir d'abord, sans attendre le serveur : c'est lui qui garde la saisie.
    await ecrireMiroir(b, false);
    await enFile(async () => {
      if (derniere !== b) return; // Une saisie plus récente part après celle-ci.
      await envoyer(b);
    });
  }

  /**
   * Le brouillon à afficher au démarrage. S'il a une saisie que le serveur n'a pas reçue (réseau,
   * session expirée) et qui repose sur la version du serveur, c'est la plus récente : elle est
   * affichée et rejouée. Si le serveur a changé depuis, le Studio affiche la saisie locale, sur
   * son ancienne version : rien n'est écrasé, et le prochain enregistrement signale le conflit.
   */
  async function lireBrouillon(): Promise<Brouillon | undefined> {
    const [id, miroir] = await Promise.all([
      local.get<string>(cleCourant).catch(() => undefined),
      local.get<Miroir>(cleMiroir).catch(() => undefined),
    ]);
    const saisie = (m: Miroir): Brouillon => {
      const { brouillon: _, envoye: __, ...b } = m;
      return b;
    };
    /** Rien d'ouvert dans ce navigateur : le brouillon modifié le plus récemment, s'il y en a un. */
    const plusRecent = async (): Promise<Brouillon | undefined> => {
      const r = await sb
        .from('brouillons')
        .select('id, form, appearance, version')
        .eq('entreprise_id', E)
        .order('modifie_le', { ascending: false })
        .limit(1)
        .maybeSingle<LigneBrouillon>();
      if (r.error) throw echec(r);
      return r.data ? adopter(r.data) : undefined;
    };
    if (!id) {
      if (miroir && !miroir.brouillon) {
        // Une facture émise ou l'exemple affiché, ou un brouillon jamais parvenu au serveur.
        const b = saisie(miroir);
        derniere = b;
        if (!miroir.envoye) await rattraper(b);
        return b;
      }
      return plusRecent();
    }

    const r = await sb
      .from('brouillons')
      .select('id, form, appearance, version')
      .eq('entreprise_id', E)
      .eq('id', id)
      .maybeSingle<LigneBrouillon>();
    if (r.error) throw echec(r);
    const enAttente = miroir && miroir.brouillon?.id === id && !miroir.envoye ? miroir : undefined;
    if (!r.data) {
      // Émis ou supprimé ailleurs. Une saisie qui n'y était pas arrivée repart en nouveau brouillon.
      await suivre(undefined);
      if (!enAttente) return plusRecent();
      const b = saisie(enAttente);
      derniere = b;
      await rattraper(b);
      return b;
    }
    if (!enAttente) return adopter(r.data);

    const b = saisie(enAttente);
    derniere = b;
    surLeServeur = canonique({ form: r.data.form, appearance: r.data.appearance });
    if (enAttente.brouillon?.version === r.data.version) {
      await suivre(r.data);
      await rattraper(b);
    } else {
      courant = enAttente.brouillon && { ...enAttente.brouillon };
    }
    return b;
  }

  /** Le brouillon courant tel que le serveur l'a, sans rien changer : pour la sauvegarde. */
  async function brouillonPourSauvegarde(): Promise<Brouillon | undefined> {
    const id = courant?.id ?? (await local.get<string>(cleCourant).catch(() => undefined));
    if (!id) return undefined;
    const r = await sb
      .from('brouillons')
      .select('id, form, appearance, version')
      .eq('entreprise_id', E)
      .eq('id', id)
      .maybeSingle<LigneBrouillon>();
    if (r.error) throw echec(r);
    return r.data ? lireLigne(r.data) : undefined;
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
          return (await enFile(lireBrouillon)) as T | undefined;
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
          await enregistrerBrouillon(value as Brouillon);
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
          const id = courant?.id;
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

    brouillonCourant: () => courant && { ...courant },

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

    ouvrirBrouillon: (id) =>
      enFile(async () => {
        const r = await sb
          .from('brouillons')
          .select('id, form, appearance, version')
          .eq('entreprise_id', E)
          .eq('id', id)
          .maybeSingle<LigneBrouillon>();
        if (r.error) throw echec(r);
        return r.data ? adopter(r.data) : undefined;
      }),

    supprimerBrouillon: (id) =>
      enFile(async () => {
        const r = await sb.from('brouillons').delete().eq('entreprise_id', E).eq('id', id);
        if (r.error) throw echec(r);
        if (courant?.id === id) {
          await suivre(undefined);
          surLeServeur = undefined;
          derniere = undefined;
          await auMieux(local.remove('kv', cleMiroir));
        }
      }),

    nouveauBrouillon: () =>
      enFile(async () => {
        await suivre(undefined);
        surLeServeur = undefined;
      }),

    rechargerBrouillon: () =>
      enFile(async () => {
        if (!courant) return undefined;
        const r = await sb
          .from('brouillons')
          .select('id, form, appearance, version')
          .eq('entreprise_id', E)
          .eq('id', courant.id)
          .maybeSingle<LigneBrouillon>();
        if (r.error) throw echec(r);
        return r.data ? adopter(r.data) : undefined;
      }),

    imposerBrouillon: (b) =>
      enFile(async () => {
        derniere = b;
        await ecrireMiroir(b, false);
        if (courant) {
          const r = await sb
            .from('brouillons')
            .select('version')
            .eq('entreprise_id', E)
            .eq('id', courant.id)
            .maybeSingle<{ version: number }>();
          if (r.error) throw echec(r);
          // Supprimé ailleurs entre-temps : la saisie devient un nouveau brouillon.
          if (r.data) courant = { ...courant, version: r.data.version };
          else await suivre(undefined);
        }
        surLeServeur = undefined;
        await envoyer(b);
      }),
  };
  return persistance;
}
