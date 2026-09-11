import { el, elA, serializeXml } from '../xml/node.js';

/** Espace de noms de l'extension PDF/A Factur-X. */
export const FACTURX_XMP_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';

export interface XmpMetadata {
  title: string;
  author?: string | undefined;
  subject?: string | undefined;
  keywords?: string | undefined;
  creatorTool: string;
  producer: string;
  createDate: Date;
  modifyDate: Date;
  /** Nom du fichier XML joint (`factur-x.xml`). */
  documentFileName: string;
  /** Niveau de conformité Factur-X (`EN 16931`). */
  conformanceLevel: string;
}

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

function description(namespaces: Record<string, string>, ...children: Parameters<typeof el>[1][]) {
  return elA('rdf:Description', { 'rdf:about': '', ...namespaces }, ...children);
}

const altText = (name: string, value: string) =>
  el(name, el('rdf:Alt', elA('rdf:li', { 'xml:lang': 'x-default' }, value)));

function property(name: string, valueType: string, category: string, desc: string) {
  return elA(
    'rdf:li',
    { 'rdf:parseType': 'Resource' },
    el('pdfaProperty:name', name),
    el('pdfaProperty:valueType', valueType),
    el('pdfaProperty:category', category),
    el('pdfaProperty:description', desc),
  );
}

/**
 * Paquet XMP d'un PDF/A-3b Factur-X : identification PDF/A, Dublin Core, dates,
 * schéma d'extension déclarant le namespace `fx`, puis les propriétés Factur-X.
 * Les valeurs doivent rester alignées sur le dictionnaire `Info` du PDF (exigence PDF/A).
 */
export function buildXmp(meta: XmpMetadata): string {
  const root = elA(
    'x:xmpmeta',
    { 'xmlns:x': 'adobe:ns:meta/' },
    elA(
      'rdf:RDF',
      { 'xmlns:rdf': RDF },
      description(
        { 'xmlns:pdfaid': 'http://www.aiim.org/pdfa/ns/id/' },
        el('pdfaid:part', '3'),
        el('pdfaid:conformance', 'B'),
      ),
      description(
        { 'xmlns:dc': 'http://purl.org/dc/elements/1.1/' },
        altText('dc:title', meta.title),
        meta.author === undefined
          ? undefined
          : el('dc:creator', el('rdf:Seq', el('rdf:li', meta.author))),
        meta.subject === undefined ? undefined : altText('dc:description', meta.subject),
      ),
      description(
        { 'xmlns:xmp': 'http://ns.adobe.com/xap/1.0/' },
        el('xmp:CreatorTool', meta.creatorTool),
        el('xmp:CreateDate', meta.createDate.toISOString()),
        el('xmp:ModifyDate', meta.modifyDate.toISOString()),
        el('xmp:MetadataDate', meta.modifyDate.toISOString()),
      ),
      description(
        { 'xmlns:pdf': 'http://ns.adobe.com/pdf/1.3/' },
        el('pdf:Producer', meta.producer),
        meta.keywords === undefined ? undefined : el('pdf:Keywords', meta.keywords),
      ),
      description(
        {
          'xmlns:pdfaExtension': 'http://www.aiim.org/pdfa/ns/extension/',
          'xmlns:pdfaSchema': 'http://www.aiim.org/pdfa/ns/schema#',
          'xmlns:pdfaProperty': 'http://www.aiim.org/pdfa/ns/property#',
        },
        el(
          'pdfaExtension:schemas',
          el(
            'rdf:Bag',
            elA(
              'rdf:li',
              { 'rdf:parseType': 'Resource' },
              el('pdfaSchema:schema', 'Factur-X PDFA Extension Schema'),
              el('pdfaSchema:namespaceURI', FACTURX_XMP_NAMESPACE),
              el('pdfaSchema:prefix', 'fx'),
              el(
                'pdfaSchema:property',
                el(
                  'rdf:Seq',
                  property(
                    'DocumentFileName',
                    'Text',
                    'external',
                    'name of the embedded XML invoice file',
                  ),
                  property('DocumentType', 'Text', 'external', 'INVOICE'),
                  property(
                    'Version',
                    'Text',
                    'external',
                    'The actual version of the Factur-X XML schema',
                  ),
                  property(
                    'ConformanceLevel',
                    'Text',
                    'external',
                    'The conformance level of the embedded Factur-X data',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      description(
        { 'xmlns:fx': FACTURX_XMP_NAMESPACE },
        el('fx:DocumentType', 'INVOICE'),
        el('fx:DocumentFileName', meta.documentFileName),
        el('fx:Version', '1.0'),
        el('fx:ConformanceLevel', meta.conformanceLevel),
      ),
    ),
  );
  const body = serializeXml(root, { pretty: true, declaration: false });
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${body}<?xpacket end="w"?>`;
}

/** Lit une propriété simple (`<fx:Xxx>valeur</fx:Xxx>` ou attribut `fx:Xxx="valeur"`) dans un paquet XMP. */
export function readXmpProperty(xmp: string, qualifiedName: string): string | undefined {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const element = new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`).exec(xmp);
  if (element) return element[1]?.trim();
  const attribute = new RegExp(`\\s${escaped}="([^"]*)"`).exec(xmp);
  return attribute?.[1]?.trim();
}
