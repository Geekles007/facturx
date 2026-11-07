/**
 * Exporter les données du compte (spec § 10 et § 12) : une archive zip que l'utilisateur garde où il
 * veut. C'est aussi l'export imposé avant une demande de suppression du compte : il est complet et
 * fidèle, et il se restaure dans le Studio sans compte (Ruling 56).
 *
 *   donnees.json           une sauvegarde du Studio (`{ format: 'facturx-studio-backup', version: 1,
 *                          data }`, JSON portable) : « Restaurer une sauvegarde » la reprend telle
 *                          quelle — entreprise, numérotation à jour (revenu au Studio sans compte, on
 *                          ne réutilise aucun numéro émis), apparence, brouillon, clients, catalogue,
 *                          factures et leurs PDF (`pdf-<id>`), logo et polices. Et, sous `compte`, ce
 *                          que la sauvegarde ne porte pas : les lignes de la base (factures avec le
 *                          chemin de leur PDF dans l'archive, paiements annulés compris, relances,
 *                          brouillons, entreprise, numérotation), la ligne `membres` de l'utilisateur
 *                          (version et date d'acceptation des CGU), l'adresse du compte, les PDF
 *                          manquants et la date de l'export ;
 *   factures/<numéro>.pdf  le PDF de chaque facture, tel que le serveur le garde, pour qu'on le lise
 *                          sans rien restaurer.
 *
 * Deux numéros qui donnent le même nom de fichier (`fileStem`) ne s'écrasent pas : le suivant prend
 * un suffixe tiré de l'identifiant de sa facture. Un PDF absent du Storage, ou qui n'est pas un PDF,
 * ne fait pas échouer l'export : il est listé dans `compte.pdfManquants`. Toute autre erreur
 * (session, réseau après un second essai) le fait échouer : une archive à qui manqueraient des PDF
 * sans le dire ne vaudrait rien.
 *
 * Les PDF sont lus quatre à la fois et rangés tels quels (ils sont déjà compressés) ; les morceaux du
 * zip rejoignent un `Blob` par paquets de 8 Mio, que le navigateur peut garder hors de la mémoire du
 * script. Mais `donnees.json`, qui porte aussi les PDF (en base64, pour la restauration), est tenu en
 * entier : la mémoire, et la longueur d'une chaîne JavaScript (environ 512 Mio), bornent l'export à
 * quelques centaines de Mio de PDF ; au-delà, l'export le dit au lieu d'échouer en silence. fflate
 * n'écrit pas de Zip64 : 65 535 entrées et 4 Gio au plus, vérifiés avant chaque entrée.
 *
 * fflate n'entre que dans ce fragment, chargé par `import()` à la demande d'un export.
 */

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { toPortableJson } from '../../shared/portable.js';
import { t } from '../i18n.js';
import { type DonneesSauvegarde, FORMAT_SAUVEGARDE } from '../library.js';
import { isoToday } from '../model.js';
import { ErreurConservation } from '../persistence.js';
import { download, fileStem } from '../pipeline.js';
import { storage } from '../storage.js';
import { toast } from '../store.js';
import { client } from './client.js';
import { estPersistenceCompte, estUnPdf, type PersistenceCompte, toutLire } from './persistence.js';
import { sessionRefusee } from './suivi.js';
import { retenirExport } from './suppression.js';

/** Les PDF lus en même temps. */
const LOT_PDF = 4;

/** Les morceaux du zip rejoignent l'archive par paquets de cette taille. */
const PAQUET = 8 * 1024 * 1024;

/**
 * Ce qu'un zip sans Zip64 peut contenir : le répertoire central compte ses entrées sur 16 bits, et
 * les tailles et positions tiennent sur 32 bits. Au-delà, fflate écrirait une archive illisible.
 */
const LIMITES_ZIP = { entrees: 0xffff, octets: 0xffffffff };

type Ligne = Record<string, unknown>;

/** Un PDF qui manque à l'archive, et pourquoi : absent du Storage, ou pas un PDF. */
export interface PdfManquant {
  factureId: string;
  numero: string;
  raison: 'absent' | 'illisible';
}

/** Un compte trop grand pour une archive zip simple (ou pour une chaîne JavaScript). */
export class ErreurExport extends Error {
  override name = 'ErreurExport';
  constructor() {
    super(t.compte.export.tropGrand);
  }
}

/**
 * Le chemin de chaque PDF dans l'archive, par identifiant de facture : `factures/<fileStem(numéro)>.pdf`.
 * Un nom déjà pris — sans tenir compte de la casse, qu'un système de fichiers peut ignorer — prend
 * le début de l'identifiant de la facture en suffixe : il ne dépend que d'elle, et ne change donc
 * pas d'un export à l'autre ; les factures sont dans l'ordre de leur émission, et la première garde
 * le nom simple.
 */
export function nomsDesPdf(
  factures: readonly { id: string; numero: string }[],
): Map<string, string> {
  const pris = new Set<string>();
  const noms = new Map<string, string>();
  const libre = (nom: string) => !pris.has(nom.toLowerCase());
  for (const { id, numero } of factures) {
    const base = fileStem(numero);
    let nom = libre(base) ? base : `${base}-${id.slice(0, 8)}`;
    for (let n = 2; !libre(nom); n++) nom = `${base}-${id.slice(0, 8)}-${n}`;
    pris.add(nom.toLowerCase());
    noms.set(id, `factures/${nom}.pdf`);
  }
  return noms;
}

/**
 * Une archive en construction : chaque entrée est poussée d'un coup, et ce que le zip produit
 * rejoint un `Blob` par paquets. Une entrée qui ferait dépasser `limites` (par défaut, celles d'un
 * zip sans Zip64) lève `ErreurExport` avant d'être écrite.
 */
export function nouvelleArchive(limites: { entrees: number; octets: number } = LIMITES_ZIP) {
  let blob = new Blob([], { type: 'application/zip' });
  let paquet: Uint8Array[] = [];
  let taille = 0;
  let erreur: Error | null = null;
  let entrees = 0;
  /** Les octets déjà produits, et ce que le répertoire central de la fin prendra. */
  let ecrits = 0;
  let centrale = 22;
  const verser = () => {
    blob = new Blob([blob, ...(paquet as BlobPart[])], { type: 'application/zip' });
    paquet = [];
    taille = 0;
  };
  const zip = new Zip((e, morceau, dernier) => {
    if (e) {
      erreur = e;
      return;
    }
    paquet.push(morceau);
    taille += morceau.length;
    ecrits += morceau.length;
    if (taille >= PAQUET || dernier) verser();
  });
  const verifier = () => {
    if (erreur) throw erreur;
  };
  return {
    /** Une entrée : compressée (le JSON), ou rangée telle quelle (un PDF). */
    ajouter(nom: string, octets: Uint8Array, compresser: boolean): void {
      // Au plus : les octets (la compression ne les grossit que de quelques pour mille), l'en-tête
      // local et le descripteur de l'entrée, puis son entrée du répertoire central.
      const enTete = 30 + 16 + nom.length;
      const repertoire = 46 + nom.length;
      const auPlus = octets.length + Math.ceil(octets.length / 200) + enTete;
      if (
        entrees + 1 > limites.entrees ||
        ecrits + auPlus + centrale + repertoire > limites.octets
      ) {
        throw new ErreurExport();
      }
      entrees++;
      centrale += repertoire;
      const entree = compresser ? new ZipDeflate(nom, { level: 6 }) : new ZipPassThrough(nom);
      zip.add(entree);
      entree.push(octets, true);
      verifier();
    },
    fermer(): Blob {
      zip.end();
      verifier();
      return blob;
    },
  };
}

/**
 * Le PDF d'une facture, ou pourquoi il manque. Une erreur du réseau est retentée une fois ; toute
 * autre erreur (session) remonte.
 */
async function lirePdf(
  p: PersistenceCompte,
  chemin: string,
): Promise<Uint8Array | PdfManquant['raison']> {
  for (let essai = 1; ; essai++) {
    try {
      const octets = await p.pdfDeFacture(chemin);
      if (!octets) return 'absent';
      return estUnPdf(octets) ? octets : 'illisible';
    } catch (erreur) {
      if (essai === 2 || !(erreur instanceof ErreurConservation) || erreur.code !== 'RESEAU') {
        throw erreur;
      }
    }
  }
}

/**
 * L'archive du compte, avec ce qu'il faut en dire : combien de factures elle contient, combien de
 * PDF, et lesquels manquent.
 */
export async function construireArchive(): Promise<{
  archive: Blob;
  factures: number;
  pdf: number;
  pdfManquants: PdfManquant[];
}> {
  const p = storage;
  if (!estPersistenceCompte(p)) throw new Error(t.compte.export.sansCompte);
  const sb = client();
  const E = p.entrepriseId;
  /** Toutes les lignes de `table` pour l'entreprise, dans l'ordre de `ordre`, puis de l'identifiant. */
  const lignes = (table: string, ordre?: string) =>
    toutLire<Ligne>((debut, fin) => {
      const q = sb.from(table).select('*').eq('entreprise_id', E);
      return (ordre ? q.order(ordre) : q).order('id').range(debut, fin);
    });
  /** La ligne unique de `table` dont `colonne` est l'entreprise. */
  const ligne = async (table: string, colonne: string): Promise<Ligne> => {
    const [l] = await toutLire<Ligne>((debut, fin) =>
      sb.from(table).select('*').eq(colonne, E).range(debut, fin),
    );
    // Sans ligne, ce compte n'est pas (ou plus) membre de l'entreprise.
    if (!l) throw new ErreurConservation('REFUS', 'DROITS');
    return l;
  };
  const utilisateur = (await sb.auth.getSession()).data.session?.user;

  const [sauvegarde, entreprise, numerotation, brouillons, factures, paiements, relances] =
    await Promise.all([
      p.dump() as Promise<DonneesSauvegarde>,
      ligne('entreprises', 'id'),
      ligne('numerotation', 'entreprise_id'),
      lignes('brouillons', 'modifie_le'),
      lignes('factures', 'emise_le'),
      lignes('paiements', 'cree_le'),
      lignes('relances', 'envoyee_le'),
    ]);
  // La ligne `membres` de l'utilisateur : la trace de son acceptation des CGU.
  const membres = utilisateur
    ? await toutLire<Ligne>((debut, fin) =>
        sb
          .from('membres')
          .select('*')
          .eq('entreprise_id', E)
          .eq('user_id', utilisateur.id)
          .range(debut, fin),
      )
    : [];

  const zip = nouvelleArchive();
  const noms = nomsDesPdf(factures.map((f) => ({ id: String(f.id), numero: String(f.numero) })));
  const pdfManquants: PdfManquant[] = [];
  const exportees: Ligne[] = [];
  /** Les PDF, sous la clé où le Studio sans compte les range : `pdf-<uid>`. */
  const pdfs: Record<string, Uint8Array> = {};
  let pdf = 0;
  for (let debut = 0; debut < factures.length; debut += LOT_PDF) {
    const lot = factures.slice(debut, debut + LOT_PDF);
    const lus = await Promise.all(lot.map((f) => lirePdf(p, String(f.pdf_chemin))));
    for (const [n, f] of lot.entries()) {
      const id = String(f.id);
      const lu = lus[n];
      const nom = noms.get(id);
      if (lu instanceof Uint8Array && nom) {
        zip.ajouter(nom, lu, false);
        pdfs[`pdf-${id}`] = lu;
        exportees.push({ ...f, pdf: nom });
        pdf++;
      } else {
        const raison = typeof lu === 'string' ? lu : 'absent';
        pdfManquants.push({ factureId: id, numero: String(f.numero), raison });
        exportees.push({ ...f, pdf: null });
      }
    }
  }

  const donnees = {
    format: FORMAT_SAUVEGARDE,
    version: 1,
    data: { ...sauvegarde, files: { ...sauvegarde.files, ...pdfs } },
    compte: {
      exporteLe: new Date().toISOString(),
      email: utilisateur?.email ?? null,
      membres,
      entreprise,
      numerotation,
      brouillons,
      factures: exportees,
      paiements,
      relances,
      pdfManquants,
    },
  };
  let texte: string;
  try {
    texte = toPortableJson(donnees);
  } catch (erreur) {
    // Une chaîne plus longue que ce que le moteur JavaScript admet.
    if (erreur instanceof RangeError) throw new ErreurExport();
    throw erreur;
  }
  zip.ajouter('donnees.json', strToU8(texte), true);
  return { archive: zip.fermer(), factures: factures.length, pdf, pdfManquants };
}

/** L'archive zip du compte connecté : `donnees.json` et `factures/*.pdf`. Lève si elle n'aboutit pas. */
export async function exporterArchive(): Promise<Blob> {
  return (await construireArchive()).archive;
}

/** Ce que l'interface dit d'un export qui n'aboutit pas. */
function messageDExport(erreur: unknown): string {
  const phrases = t.compte.export;
  if (erreur instanceof ErreurExport) return phrases.tropGrand;
  if (erreur instanceof ErreurConservation) {
    if (erreur.code === 'SESSION') {
      sessionRefusee(401);
      return phrases.session;
    }
    if (erreur.code === 'RESEAU') return phrases.reseau;
  }
  if (erreur instanceof Error && erreur.message === phrases.sansCompte) return phrases.sansCompte;
  return phrases.echec;
}

/** L'export en cours : un second clic l'attend, sans en lancer un autre. */
let enCours: Promise<boolean> | undefined;

/**
 * « Exporter mes données » : construit l'archive et la télécharge (`facturx-export-<date>.zip`),
 * en disant combien de PDF elle contient et combien manquent. Vrai si le téléchargement a été lancé
 * sans erreur : c'est l'export que la suppression du compte exige d'abord (`suppression.ts` le
 * retient). Ne lève pas.
 */
export function telechargerExport(): Promise<boolean> {
  enCours ??= (async () => {
    const phrases = t.compte.export;
    toast(phrases.enCours, 'info', 120_000);
    try {
      const { archive: zip, factures, pdf, pdfManquants } = await construireArchive();
      download(zip, `facturx-export-${isoToday()}.zip`, 'application/zip');
      retenirExport({ factures, pdfManquants: pdfManquants.length });
      toast(phrases.fait(pdf, pdfManquants.length), 'ok', 9000);
      return true;
    } catch (erreur) {
      toast(messageDExport(erreur), 'error', 9000);
      return false;
    }
  })().finally(() => {
    enCours = undefined;
  });
  return enCours;
}
