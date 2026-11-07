/**
 * Exporter les données du compte (spec § 10 et § 12) : une archive zip que l'utilisateur garde où il
 * veut. C'est aussi l'export imposé avant une demande de suppression du compte : il est complet et
 * fidèle.
 *
 *   donnees.json           en JSON portable (`toPortableJson`, les octets en `{ $bytes }`) :
 *                          l'entreprise, la numérotation, les clients, le catalogue, les brouillons,
 *                          les factures sans leur PDF (formulaire, apparence, facture lue, montants,
 *                          origine…), les paiements (annulés compris), les relances, les fichiers de
 *                          l'utilisateur (logo, polices) et les PDF manquants ;
 *   factures/<numéro>.pdf  le PDF de chaque facture, tel que le serveur le garde.
 *
 * Les lignes sont celles de la base, toutes colonnes (spec § 6), lues page par page. Deux numéros
 * qui donnent le même nom de fichier (`fileStem`) ne s'écrasent pas : le suivant prend un suffixe
 * tiré de l'identifiant de sa facture. Un PDF absent du Storage, ou qui n'est pas un PDF, ne fait pas
 * échouer l'export : il est listé dans `pdfManquants`. Toute autre erreur (session, réseau, après un
 * second essai) le fait échouer : une archive à qui manqueraient des PDF sans le dire ne vaudrait rien.
 *
 * L'archive se construit au fil de l'eau (`Zip` de fflate) : les PDF sont lus quatre à la fois et
 * rangés tels quels (ils sont déjà compressés), et les morceaux du zip rejoignent un `Blob` par
 * paquets de 8 Mio, que le navigateur peut garder hors de la mémoire du script. Seul `donnees.json`
 * est tenu en entier, et compressé.
 *
 * fflate n'entre que dans ce fragment, chargé par `import()` à la demande d'un export.
 */

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { toPortableJson } from '../../shared/portable.js';
import { t } from '../i18n.js';
import { isoToday } from '../model.js';
import { ErreurConservation } from '../persistence.js';
import { download, fileStem } from '../pipeline.js';
import { storage } from '../storage.js';
import { toast } from '../store.js';
import { client } from './client.js';
import { estPersistenceCompte, estUnPdf, type PersistenceCompte, toutLire } from './persistence.js';
import { sessionRefusee } from './suivi.js';

/** Le format de `donnees.json`, et sa version. */
export const FORMAT_EXPORT = 'facturx-compte';
export const VERSION_EXPORT = 1;

/** Les PDF lus en même temps. */
const LOT_PDF = 4;

/** Les morceaux du zip rejoignent l'archive par paquets de cette taille. */
const PAQUET = 8 * 1024 * 1024;

type Ligne = Record<string, unknown>;

/** Un PDF qui manque à l'archive, et pourquoi : absent du Storage, ou pas un PDF. */
export interface PdfManquant {
  factureId: string;
  numero: string;
  raison: 'absent' | 'illisible';
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
 * L'archive en construction : chaque entrée est poussée d'un coup, et ce que le zip produit
 * rejoint un `Blob` par paquets.
 */
function archive() {
  let blob = new Blob([], { type: 'application/zip' });
  let paquet: Uint8Array[] = [];
  let taille = 0;
  let erreur: Error | null = null;
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
    if (taille >= PAQUET || dernier) verser();
  });
  const verifier = () => {
    if (erreur) throw erreur;
  };
  return {
    /** Une entrée : compressée (le JSON), ou rangée telle quelle (un PDF). */
    ajouter(nom: string, octets: Uint8Array, compresser: boolean): void {
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

/** L'archive du compte, avec ce qu'il faut en dire : combien de PDF, et lesquels manquent. */
export async function construireArchive(): Promise<{
  archive: Blob;
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

  const [entreprise, numerotation, clients, produits, brouillons, factures, paiements, relances] =
    await Promise.all([
      ligne('entreprises', 'id'),
      ligne('numerotation', 'entreprise_id'),
      lignes('clients'),
      lignes('produits'),
      lignes('brouillons', 'modifie_le'),
      lignes('factures', 'emise_le'),
      lignes('paiements', 'cree_le'),
      lignes('relances', 'envoyee_le'),
    ]);
  const fichiers = await p.fichiers();

  const zip = archive();
  const noms = nomsDesPdf(factures.map((f) => ({ id: String(f.id), numero: String(f.numero) })));
  const pdfManquants: PdfManquant[] = [];
  const exportees: Ligne[] = [];
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
    format: FORMAT_EXPORT,
    version: VERSION_EXPORT,
    exporteLe: new Date().toISOString(),
    entreprise,
    numerotation,
    clients,
    produits,
    brouillons,
    factures: exportees,
    paiements,
    relances,
    fichiers,
    pdfManquants,
  };
  zip.ajouter('donnees.json', strToU8(toPortableJson(donnees)), true);
  return { archive: zip.fermer(), pdf, pdfManquants };
}

/** L'archive zip du compte connecté : `donnees.json` et `factures/*.pdf`. Lève si elle n'aboutit pas. */
export async function exporterArchive(): Promise<Blob> {
  return (await construireArchive()).archive;
}

/** Ce que l'interface dit d'un export qui n'aboutit pas. */
function messageDExport(erreur: unknown): string {
  const phrases = t.compte.export;
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
let enCours: Promise<void> | undefined;

/**
 * « Exporter mes données » : construit l'archive et la télécharge (`facturx-export-<date>.zip`),
 * en disant combien de PDF elle contient et combien manquent. Ne lève pas.
 */
export function telechargerExport(): Promise<void> {
  enCours ??= (async () => {
    const phrases = t.compte.export;
    toast(phrases.enCours, 'info', 120_000);
    try {
      const { archive: zip, pdf, pdfManquants } = await construireArchive();
      download(zip, `facturx-export-${isoToday()}.zip`, 'application/zip');
      toast(phrases.fait(pdf, pdfManquants.length), 'ok', 9000);
    } catch (erreur) {
      toast(messageDExport(erreur), 'error', 9000);
    }
  })().finally(() => {
    enCours = undefined;
  });
  return enCours;
}
