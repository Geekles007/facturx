import { decodePDFRawStream, PDFContext, PDFRawStream } from 'pdf-lib';

/**
 * Plafond de décompression des flux PDF.
 *
 * pdf-lib décompresse un flux en entier avant qu'on en voie la taille, et un seul bloc deflate peut
 * gonfler plus de mille fois : quelques Ko de pièce jointe ou de flux d'objets suffisent à épuiser
 * la mémoire avant tout contrôle. Tous ses décodeurs (FlateDecode, LZW, RunLength, ASCII85,
 * ASCIIHex, portés de pdf.js) agrandissent leur tampon par une seule méthode, `ensureBuffer`, de
 * leur classe commune : on l'intercepte le temps d'une lecture et on refuse un tampon plus grand
 * que le plafond. Le décodage lui-même ne change pas (même tolérance qu'avant) ; la mémoire reste
 * bornée à deux fois le plafond, le tampon grandissant par puissances de deux.
 *
 * L'analyseur de pdf-lib rattrape les erreurs d'un objet illisible et continue : un dépassement
 * pendant `PDFDocument.load` est donc noté, et c'est l'appelant qui le signale.
 */

interface Reading {
  cap: number;
  exceeded: boolean;
}

type EnsureBuffer = (this: unknown, requested: number) => Uint8Array;
type DecoderPrototype = { ensureBuffer: EnsureBuffer };

/** Levée dans le décodeur quand un tampon dépasserait tous les plafonds en cours. */
export class DecodeCapExceeded extends Error {
  constructor(readonly requested: number) {
    super(`Flux décompressé au-delà de ${requested} octets.`);
  }
}

let decoderPrototype: DecoderPrototype | undefined;
let unpatched: EnsureBuffer | undefined;
const active = new Set<Reading>();

/** La classe commune des décodeurs de pdf-lib, trouvée par un flux vide (elle n'est pas exportée). */
function findDecoderPrototype(): DecoderPrototype {
  if (decoderPrototype) return decoderPrototype;
  const stream = decodePDFRawStream(
    PDFRawStream.of(PDFContext.create().obj({ Filter: 'ASCIIHexDecode' }), new Uint8Array(0)),
  );
  let proto = Object.getPrototypeOf(stream);
  while (proto && !Object.hasOwn(proto, 'ensureBuffer')) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto)
    throw new Error('pdf-lib : décodeurs sans ensureBuffer, le plafond ne peut pas tenir.');
  decoderPrototype = proto as DecoderPrototype;
  return decoderPrototype;
}

function enter(reading: Reading): void {
  const proto = findDecoderPrototype();
  if (active.size === 0) {
    // La méthode en place à cet instant, pas une copie prise au chargement du module.
    const current = proto.ensureBuffer;
    unpatched = current;
    proto.ensureBuffer = function (this: unknown, requested: number) {
      // Lectures simultanées (un serveur qui en sert plusieurs) : on ne refuse qu'au-delà du plus
      // large plafond en cours, et chaque lecture plus stricte est marquée pour être refusée après.
      let widest = 0;
      for (const r of active) {
        if (requested > r.cap) r.exceeded = true;
        widest = Math.max(widest, r.cap);
      }
      if (requested > widest) throw new DecodeCapExceeded(requested);
      return current.call(this, requested);
    };
  }
  active.add(reading);
}

function leave(reading: Reading): void {
  active.delete(reading);
  if (active.size === 0 && decoderPrototype && unpatched) {
    decoderPrototype.ensureBuffer = unpatched;
    unpatched = undefined;
  }
}

/**
 * Lance `run` (synchrone) avec un plafond de `cap` octets décompressés par flux. Rend `{ value }`,
 * ou `{ exceeded: true }` si un flux l'a dépassé, que pdf-lib ait levé ou non.
 */
export function withDecodeCap<T>(cap: number, run: () => T): { value: T } | { exceeded: true } {
  const reading: Reading = { cap, exceeded: false };
  enter(reading);
  try {
    const value = run();
    return reading.exceeded ? { exceeded: true } : { value };
  } catch (error) {
    if (reading.exceeded || error instanceof DecodeCapExceeded) return { exceeded: true };
    throw error;
  } finally {
    leave(reading);
  }
}

/** `withDecodeCap` pour une lecture asynchrone (le chargement d'un document). */
export async function withDecodeCapAsync<T>(
  cap: number,
  run: () => Promise<T>,
): Promise<{ value: T } | { exceeded: true }> {
  const reading: Reading = { cap, exceeded: false };
  enter(reading);
  try {
    const value = await run();
    return reading.exceeded ? { exceeded: true } : { value };
  } catch (error) {
    if (reading.exceeded || error instanceof DecodeCapExceeded) return { exceeded: true };
    throw error;
  } finally {
    leave(reading);
  }
}
