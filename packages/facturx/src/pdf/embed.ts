import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { type Limits, resolveLimits } from '../limits.js';
import type { Invoice } from '../types/invoice.js';
import { toCiiXml } from '../xml/cii.js';
import { FacturXPdfError } from './errors.js';
import { fingerprint128 } from './hash.js';
import { FACTURX_FILENAME, filespecName, isKnownFilename, listEmbeddedFiles } from './names.js';
import { buildXmp } from './xmp.js';

/** Source du XML à embarquer : une facture (générée et validée) ou un XML déjà produit. */
export type FacturXSource =
  | { invoice: Invoice; xml?: undefined }
  | { xml: string | Uint8Array; invoice?: undefined };

export interface OutputIntentOptions {
  /** Profil ICC (ex. sRGB IEC61966-2.1) à déclarer comme intention de sortie GTS_PDFA1. */
  iccProfile: Uint8Array;
  /** Défaut : `sRGB IEC61966-2.1`. */
  outputConditionIdentifier?: string;
  /** Défaut : identique à `outputConditionIdentifier`. */
  info?: string;
  /** Défaut : `http://www.color.org`. */
  registryName?: string;
}

export interface EmbedOptions {
  /** Date de création/modification (PDF `Info`, XMP, pièce jointe). Défaut : maintenant. Fixer pour une sortie reproductible. */
  date?: Date;
  /** `Info/Title` et `dc:title`. Défaut : titre existant, sinon « Facture <BT-1> ». */
  title?: string;
  /** `Info/Author` et `dc:creator`. Défaut : auteur existant, sinon le nom du vendeur. */
  author?: string;
  /** `Info/Subject` et `dc:description`. Défaut : sujet existant. */
  subject?: string;
  /** `Info/Keywords` et `pdf:Keywords`. Défaut : mots-clés existants. */
  keywords?: string;
  /** `Info/Creator` et `xmp:CreatorTool` (application d'origine). Défaut : valeur existante, sinon `facturx-sdk`. */
  creator?: string;
  /** `Info/Producer` et `pdf:Producer`. Défaut : `facturx-sdk`. */
  producer?: string;
  /** Ajoute un `OutputIntent` PDF/A si le PDF n'en a pas (souvent la seule pièce manquante pour PDF/A-3b). */
  outputIntent?: OutputIntentOptions;
  /** Limites de taille (défaut : `DEFAULT_LIMITS`). */
  limits?: Partial<Limits>;
}

const PRODUCER = 'facturx-sdk';
const encoder = new TextEncoder();

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function resolveXml(source: FacturXSource): Uint8Array {
  if (source.invoice !== undefined) return encoder.encode(toCiiXml(source.invoice));
  const bytes = typeof source.xml === 'string' ? encoder.encode(source.xml) : source.xml;
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  while (
    start < bytes.length &&
    (bytes[start] === 0x20 ||
      bytes[start] === 0x0a ||
      bytes[start] === 0x0d ||
      bytes[start] === 0x09)
  ) {
    start++;
  }
  if (bytes[start] !== 0x3c) {
    throw new FacturXPdfError(
      'INVALID_XML',
      'La source XML est vide ou ne commence pas par « < ».',
    );
  }
  return bytes;
}

/** Charge un PDF avec des erreurs typées (PDF illisible, chiffré). */
export async function loadPdf(
  input: Uint8Array | ArrayBuffer,
  limits: Partial<Limits> = {},
): Promise<PDFDocument> {
  const max = resolveLimits(limits).pdfBytes;
  if (input.byteLength > max) {
    throw new FacturXPdfError(
      'TOO_LARGE',
      `PDF de ${input.byteLength} octets au-delà de la limite \`pdfBytes\` (${max}).`,
    );
  }
  try {
    return await PDFDocument.load(toBytes(input), { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new FacturXPdfError(
        'ENCRYPTED',
        'Le PDF est chiffré : un PDF/A-3 ne peut pas l’être.',
        { cause: error },
      );
    }
    throw new FacturXPdfError('INVALID_PDF', 'Impossible de lire le PDF fourni.', { cause: error });
  }
}

/** Retire les pièces jointes Factur-X existantes (arbre de noms et tableau `/AF`) et renvoie les entrées conservées. */
function removeExistingFacturX(
  doc: PDFDocument,
): { key: PDFObject; value: PDFObject; name: string }[] {
  const kept = listEmbeddedFiles(doc).filter((entry) => !isKnownFilename(entry.name));
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af) {
    const remaining = af.asArray().filter((item) => {
      const spec = item instanceof PDFRef ? doc.context.lookupMaybe(item, PDFDict) : item;
      const name = spec instanceof PDFDict ? filespecName(spec) : undefined;
      return name === undefined || !isKnownFilename(name);
    });
    doc.catalog.set(PDFName.of('AF'), doc.context.obj(remaining));
  }
  return kept;
}

/**
 * Embarque le XML Factur-X (profil EN 16931) dans un PDF et écrit les métadonnées PDF/A-3 associées :
 * pièce jointe `factur-x.xml` (`/AFRelationship /Alternative`), tableau `/AF`, XMP (`pdfaid`, schéma `fx`),
 * dictionnaire `Info` aligné, identifiant de fichier. Idempotent : une pièce Factur-X existante est remplacée.
 *
 * Le PDF fourni doit déjà respecter PDF/A (polices embarquées, pas de chiffrement, etc.) :
 * cette fonction ne convertit pas un PDF quelconque en PDF/A.
 */
export async function embedFacturX(
  pdf: Uint8Array | ArrayBuffer,
  source: FacturXSource,
  options: EmbedOptions = {},
): Promise<Uint8Array> {
  const xmlBytes = resolveXml(source);
  const doc = await loadPdf(pdf, options.limits);
  const { context, catalog } = doc;
  const date = options.date ?? new Date();

  // 1. Pièce jointe
  const kept = removeExistingFacturX(doc);
  const fileStream = context.flateStream(xmlBytes, {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
    Params: {
      Size: xmlBytes.length,
      CreationDate: PDFString.fromDate(date),
      ModDate: PDFString.fromDate(date),
    },
  });
  const fileStreamRef = context.register(fileStream);
  const filespec = context.obj({
    Type: 'Filespec',
    F: PDFString.of(FACTURX_FILENAME),
    UF: PDFHexString.fromText(FACTURX_FILENAME),
    Desc: PDFHexString.fromText('Factur-X invoice (EN 16931)'),
    EF: { F: fileStreamRef, UF: fileStreamRef },
    AFRelationship: 'Alternative',
  });
  const filespecRef = context.register(filespec);

  const entries = [
    ...kept,
    { key: PDFHexString.fromText(FACTURX_FILENAME), value: filespecRef, name: FACTURX_FILENAME },
  ];
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const namesArray = context.obj([]);
  for (const entry of entries) {
    namesArray.push(entry.key);
    namesArray.push(entry.value);
  }
  if (!catalog.has(PDFName.of('Names'))) catalog.set(PDFName.of('Names'), context.obj({}));
  const names = catalog.lookup(PDFName.of('Names'), PDFDict);
  names.set(PDFName.of('EmbeddedFiles'), context.obj({ Names: namesArray }));

  if (!catalog.has(PDFName.of('AF'))) catalog.set(PDFName.of('AF'), context.obj([]));
  catalog.lookup(PDFName.of('AF'), PDFArray).push(filespecRef);

  // 2. Métadonnées Info + XMP (alignées)
  const invoice = source.invoice;
  const title = options.title ?? doc.getTitle() ?? (invoice ? `Facture ${invoice.id}` : 'Facture');
  const author = options.author ?? doc.getAuthor() ?? invoice?.seller.name;
  const subject = options.subject ?? doc.getSubject();
  const keywords = options.keywords ?? doc.getKeywords();
  const creator = options.creator ?? doc.getCreator() ?? PRODUCER;
  const producer = options.producer ?? PRODUCER;

  doc.setTitle(title);
  if (author !== undefined) doc.setAuthor(author);
  if (subject !== undefined) doc.setSubject(subject);
  if (keywords !== undefined) doc.setKeywords([keywords]);
  doc.setCreator(creator);
  doc.setProducer(producer);
  doc.setCreationDate(date);
  doc.setModificationDate(date);

  const xmp = buildXmp({
    title,
    author,
    subject,
    keywords,
    creatorTool: creator,
    producer,
    createDate: date,
    modifyDate: date,
    documentFileName: FACTURX_FILENAME,
    conformanceLevel: 'EN 16931',
  });
  const metadataStream = context.stream(encoder.encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), context.register(metadataStream));

  // 3. OutputIntent (optionnel, seulement s'il n'y en a pas)
  if (options.outputIntent && !catalog.has(PDFName.of('OutputIntents'))) {
    const oi = options.outputIntent;
    const identifier = oi.outputConditionIdentifier ?? 'sRGB IEC61966-2.1';
    const profileRef = context.register(context.flateStream(oi.iccProfile, { N: 3 }));
    const intent = context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of(identifier),
      Info: PDFString.of(oi.info ?? identifier),
      RegistryName: PDFString.of(oi.registryName ?? 'http://www.color.org'),
      DestOutputProfile: profileRef,
    });
    catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(intent)]));
  }

  // 4. Identifiant de fichier (trailer /ID), reproductible à date fixée
  const id = fingerprint128([toBytes(pdf), xmlBytes, encoder.encode(date.toISOString())]);
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  return doc.save({ updateFieldAppearances: false });
}
