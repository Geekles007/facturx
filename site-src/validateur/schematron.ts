/**
 * Exécution des schematrons officiels dans le navigateur, via le runtime XSLT Saxon-JS
 * (chargé par une balise <script>, redistribué sans modification avec sa licence).
 *
 * Les jeux de règles compilés (SEF) sont servis compressés : ~0,1 Mo chacun au lieu de ~5 Mo,
 * sans dépendre de la configuration gzip du serveur.
 */
import type { FailedAssert, SchematronId } from './analyze.js';
import { assetUrl } from './base.js';

interface SaxonTransform {
  transform(options: Record<string, unknown>, mode: 'async'): Promise<{ principalResult: string }>;
}

declare global {
  interface Window {
    SaxonJS?: SaxonTransform;
  }
}

/** Le runtime XSLT (~160 Ko compressé) n'est chargé qu'au premier contrôle demandé. */
let saxonLoading: Promise<SaxonTransform> | undefined;

function ensureSaxon(): Promise<SaxonTransform> {
  if (window.SaxonJS) return Promise.resolve(window.SaxonJS);
  saxonLoading ??= new Promise<SaxonTransform>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl('vendor/SaxonJS2.rt.js');
    script.addEventListener('load', () => {
      const saxon = window.SaxonJS;
      if (saxon) resolve(saxon);
      else reject(new Error("le moteur XSLT s'est chargé sans s'enregistrer"));
    });
    script.addEventListener('error', () =>
      reject(new Error('moteur XSLT introuvable — lancer `pnpm validator:fetch`')),
    );
    document.head.append(script);
  });
  return saxonLoading;
}

const FILES: Record<SchematronId, string> = {
  cen: 'EN16931-CII-validation.sef.json.gz',
  facturx: 'FACTUR-X_EN16931.sef.json.gz',
  brfr: 'BR-FR-Flux2-CII.sef.json.gz',
};

const cache = new Map<SchematronId, unknown>();

const schemasBase = () => assetUrl('schemas/');

/** Décompresse si le corps est gzippé ; certains serveurs le font déjà pour un `.gz`. */
async function readMaybeGzip(response: Response): Promise<string> {
  const buffer = new Uint8Array(await response.arrayBuffer());
  const gzipped = buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!gzipped) return new TextDecoder('utf-8').decode(buffer);
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'Ce navigateur ne sait pas décompresser les jeux de règles (DecompressionStream absent) ; essayez une version plus récente.',
    );
  }
  const stream = new Blob([buffer as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function loadSef(id: SchematronId): Promise<unknown> {
  const cached = cache.get(id);
  if (cached) return cached;
  const url = new URL(FILES[id], schemasBase()).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `jeu de règles indisponible (${response.status}) — lancer \`pnpm validator:fetch\``,
    );
  }
  const sef = JSON.parse(await readMaybeGzip(response));
  cache.set(id, sef);
  return sef;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Extrait les assertions en échec d'un rapport SVRL, sans dépendre de l'ordre des attributs. */
export function parseSvrl(svrl: string): FailedAssert[] {
  const matches = svrl.matchAll(/<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g);
  return [...matches].map((match) => {
    const tag = match[1] ?? '';
    const body = match[2] ?? '';
    const text = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(body)?.[1] ?? '';
    return {
      id: attr(tag, 'id'),
      flag: attr(tag, 'flag'),
      test: attr(tag, 'test'),
      location: attr(tag, 'location'),
      text: unescapeXml(text.replace(/\s+/g, ' ').trim()),
    };
  });
}

/** Charge le jeu de règles si besoin, puis valide le XML et renvoie les assertions en échec. */
export async function runSchematron(id: SchematronId, xml: string): Promise<FailedAssert[]> {
  const [saxon, sef] = await Promise.all([ensureSaxon(), loadSef(id)]);
  const result = await saxon.transform(
    {
      stylesheetInternal: sef,
      stylesheetBaseURI: schemasBase(),
      sourceText: xml,
      destination: 'serialized',
    },
    'async',
  );
  return parseSvrl(result.principalResult);
}
