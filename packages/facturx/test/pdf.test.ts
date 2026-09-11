import {
  AFRelationship,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFStream,
  type PDFString,
  StandardFonts,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { toCiiXml } from '../src/index.js';
import {
  buildXmp,
  embedFacturX,
  extractFacturX,
  extractInvoice,
  FacturXPdfError,
  readXmp,
  readXmpProperty,
} from '../src/pdf/index.js';
import { multiRateInvoice, simpleInvoice } from './fixtures/invoices.js';

const FIXED_DATE = new Date('2026-09-11T10:00:00.000Z');

async function makePdf(
  options: { title?: string; attachments?: Record<string, string> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Facture F-2026-0001', { x: 50, y: 780, size: 18, font });
  if (options.title !== undefined) doc.setTitle(options.title);
  for (const [name, content] of Object.entries(options.attachments ?? {})) {
    await doc.attach(new TextEncoder().encode(content), name, {
      mimeType: 'text/plain',
      afRelationship: AFRelationship.Data,
    });
  }
  return doc.save({ updateFieldAppearances: false });
}

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  const names = doc.catalog
    .lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const namesArray = names?.lookupMaybe(PDFName.of('Names'), PDFArray);
  return { doc, af, namesArray };
}

describe('embedFacturX — structure PDF/A-3', () => {
  it('écrit la pièce jointe, /AF, l’arbre de noms, le XMP, Info et /ID', async () => {
    const invoice = simpleInvoice();
    const out = await embedFacturX(await makePdf(), { invoice }, { date: FIXED_DATE });
    const { doc, af, namesArray } = await inspect(out);

    // /AF → Filespec
    expect(af?.size()).toBe(1);
    const spec = af?.lookup(0, PDFDict) as PDFDict;
    expect(spec.lookup(PDFName.of('Type'))?.toString()).toBe('/Filespec');
    expect((spec.lookup(PDFName.of('F')) as PDFString).decodeText()).toBe('factur-x.xml');
    expect((spec.lookup(PDFName.of('UF')) as PDFHexString).decodeText()).toBe('factur-x.xml');
    expect(spec.lookup(PDFName.of('AFRelationship'))?.toString()).toBe('/Alternative');
    expect((spec.lookup(PDFName.of('Desc')) as PDFHexString).decodeText()).toContain('Factur-X');

    // EF → flux EmbeddedFile
    const ef = spec.lookup(PDFName.of('EF'), PDFDict);
    const stream = ef.lookup(PDFName.of('F'), PDFStream);
    expect(ef.get(PDFName.of('UF'))?.toString()).toBe(ef.get(PDFName.of('F'))?.toString());
    expect(stream.dict.lookup(PDFName.of('Type'))?.toString()).toBe('/EmbeddedFile');
    expect(stream.dict.lookup(PDFName.of('Subtype'))?.toString()).toBe(
      PDFName.of('text/xml').toString(),
    );
    const params = stream.dict.lookup(PDFName.of('Params'), PDFDict);
    expect(params.lookup(PDFName.of('Size'))?.toString()).toBe(
      String(new TextEncoder().encode(toCiiXml(invoice)).length),
    );
    expect((params.lookup(PDFName.of('ModDate')) as PDFString).decodeDate().toISOString()).toBe(
      FIXED_DATE.toISOString(),
    );

    // Arbre de noms
    expect(namesArray?.size()).toBe(2);
    expect((namesArray as PDFArray).lookup(0, PDFHexString).decodeText()).toBe('factur-x.xml');

    // XMP
    const xmp = readXmp(doc) as string;
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(xmp).toContain(
      '<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>',
    );
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Facture F-2026-0001</rdf:li>');
    expect(xmp).toContain('<xmp:CreateDate>2026-09-11T10:00:00.000Z</xmp:CreateDate>');
    expect(
      doc.catalog.lookup(PDFName.of('Metadata'), PDFStream).dict.lookup(PDFName.of('Filter')),
    ).toBeUndefined();

    // Info aligné sur le XMP
    expect(doc.getTitle()).toBe('Facture F-2026-0001');
    expect(doc.getAuthor()).toBe('Atelier Exemple SAS');
    expect(doc.getProducer()).toBe('facturx-sdk');
    expect(doc.getCreator()).toBe('facturx-sdk');
    expect(doc.getCreationDate()?.toISOString()).toBe(FIXED_DATE.toISOString());
    expect(doc.getModificationDate()?.toISOString()).toBe(FIXED_DATE.toISOString());

    // Identifiant de fichier
    const id = doc.context.trailerInfo.ID as PDFArray;
    expect(id.size()).toBe(2);
    expect((id.lookup(0) as PDFHexString).asBytes().length).toBe(16);
  });

  it('respecte les options de métadonnées et conserve le titre existant par défaut', async () => {
    const base = await makePdf({ title: 'Mon titre' });
    const kept = await inspect(
      await embedFacturX(base, { invoice: simpleInvoice() }, { date: FIXED_DATE }),
    );
    expect(kept.doc.getTitle()).toBe('Mon titre');
    const forced = await inspect(
      await embedFacturX(
        base,
        { invoice: simpleInvoice() },
        {
          date: FIXED_DATE,
          title: 'Titre forcé',
          author: 'Moi',
          subject: 'Sujet',
          creator: 'MonApp',
        },
      ),
    );
    expect(forced.doc.getTitle()).toBe('Titre forcé');
    expect(forced.doc.getAuthor()).toBe('Moi');
    expect(forced.doc.getSubject()).toBe('Sujet');
    expect(forced.doc.getCreator()).toBe('MonApp');
    const xmp = readXmp(forced.doc) as string;
    expect(xmp).toContain('<rdf:li>Moi</rdf:li>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Sujet</rdf:li>');
    expect(xmp).toContain('<xmp:CreatorTool>MonApp</xmp:CreatorTool>');
  });

  it('ajoute un OutputIntent si demandé et absent', async () => {
    const icc = new Uint8Array(64).fill(7);
    const out = await embedFacturX(
      await makePdf(),
      { invoice: simpleInvoice() },
      { date: FIXED_DATE, outputIntent: { iccProfile: icc } },
    );
    const { doc } = await inspect(out);
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    expect(intents.size()).toBe(1);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.lookup(PDFName.of('S'))?.toString()).toBe('/GTS_PDFA1');
    expect((intent.lookup(PDFName.of('OutputConditionIdentifier')) as PDFString).decodeText()).toBe(
      'sRGB IEC61966-2.1',
    );
    expect(
      intent
        .lookup(PDFName.of('DestOutputProfile'), PDFStream)
        .dict.lookup(PDFName.of('N'))
        ?.toString(),
    ).toBe('3');
  });

  it('est idempotent : une seconde incorporation remplace la première', async () => {
    const first = await embedFacturX(
      await makePdf(),
      { invoice: simpleInvoice() },
      { date: FIXED_DATE },
    );
    const second = await embedFacturX(first, { invoice: multiRateInvoice() }, { date: FIXED_DATE });
    const { af, namesArray } = await inspect(second);
    expect(af?.size()).toBe(1);
    expect(namesArray?.size()).toBe(2);
    expect((await extractFacturX(second))?.xml).toBe(toCiiXml(multiRateInvoice()));
  });

  it('conserve les autres pièces jointes, triées', async () => {
    const base = await makePdf({ attachments: { 'notes.txt': 'hello', 'a.txt': 'first' } });
    const out = await embedFacturX(base, { invoice: simpleInvoice() }, { date: FIXED_DATE });
    const { af, namesArray } = await inspect(out);
    const names = [0, 2, 4].map((i) =>
      (namesArray as PDFArray).lookup(i, PDFHexString).decodeText(),
    );
    expect(names).toEqual(['a.txt', 'factur-x.xml', 'notes.txt']);
    expect(af?.size()).toBe(3);
    expect((await extractFacturX(out))?.filename).toBe('factur-x.xml');
  });

  it('est déterministe à date fixée', async () => {
    const base = await makePdf();
    const a = await embedFacturX(base, { invoice: simpleInvoice() }, { date: FIXED_DATE });
    const b = await embedFacturX(base, { invoice: simpleInvoice() }, { date: FIXED_DATE });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('accepte un XML fourni (chaîne ou octets avec BOM) et refuse une source vide', async () => {
    const xml = toCiiXml(simpleInvoice());
    const fromString = await extractFacturX(
      await embedFacturX(await makePdf(), { xml }, { date: FIXED_DATE }),
    );
    expect(fromString?.xml).toBe(xml);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(xml)]);
    const fromBytes = await extractFacturX(
      await embedFacturX(await makePdf(), { xml: withBom }, { date: FIXED_DATE }),
    );
    expect(fromBytes?.xml).toBe(xml);
    expect(fromBytes?.bytes.length).toBe(withBom.length);
    await expect(embedFacturX(await makePdf(), { xml: '   ' })).rejects.toMatchObject({
      name: 'FacturXPdfError',
      code: 'INVALID_XML',
    });
    await expect(embedFacturX(await makePdf(), { xml: 'pas du xml' })).rejects.toBeInstanceOf(
      FacturXPdfError,
    );
  });

  it('valide la facture avant d’embarquer', async () => {
    const invoice = simpleInvoice();
    invoice.totals.taxInclusiveAmount = 1 as never;
    await expect(embedFacturX(await makePdf(), { invoice })).rejects.toMatchObject({
      name: 'FacturXValidationError',
    });
  });

  it('refuse un PDF illisible', async () => {
    await expect(
      embedFacturX(new TextEncoder().encode('not a pdf'), { invoice: simpleInvoice() }),
    ).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });
});

describe('extractFacturX', () => {
  it('fait l’aller-retour octet pour octet avec les métadonnées XMP', async () => {
    const invoice = multiRateInvoice();
    const xml = toCiiXml(invoice);
    const out = await embedFacturX(await makePdf(), { invoice }, { date: FIXED_DATE });
    const extracted = await extractFacturX(out);
    expect(extracted).toMatchObject({
      filename: 'factur-x.xml',
      conformanceLevel: 'EN 16931',
      documentType: 'INVOICE',
    });
    expect(extracted?.xml).toBe(xml);
    expect(
      Buffer.from(extracted?.bytes ?? []).equals(Buffer.from(new TextEncoder().encode(xml))),
    ).toBe(true);
  });

  it('renvoie undefined sans pièce Factur-X et une erreur typée sur un non-PDF', async () => {
    expect(
      await extractFacturX(await makePdf({ attachments: { 'notes.txt': 'x' } })),
    ).toBeUndefined();
    await expect(extractFacturX(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'INVALID_PDF',
    });
  });

  it('retrouve une pièce ZUGFeRD en repli, sans niveau de conformité', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    const xml = '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:x"/>';
    await doc.attach(new TextEncoder().encode(xml), 'ZUGFeRD-invoice.xml', {
      mimeType: 'text/xml',
      afRelationship: AFRelationship.Alternative,
    });
    const extracted = await extractFacturX(await doc.save());
    expect(extracted?.filename).toBe('ZUGFeRD-invoice.xml');
    expect(extracted?.xml).toBe(xml);
    expect(extracted?.conformanceLevel).toBeUndefined();
  });
});

describe('extractInvoice', () => {
  it('renvoie la facture typée depuis un PDF Factur-X, undefined sinon', async () => {
    const invoice = multiRateInvoice();
    const out = await embedFacturX(await makePdf(), { invoice }, { date: FIXED_DATE });
    const result = await extractInvoice(out);
    expect(result?.filename).toBe('factur-x.xml');
    expect(result?.invoice.id).toBe('F-2026-0002');
    expect(result?.invoice.totals).toEqual(invoice.totals);
    expect(result?.invoice.lines).toEqual(invoice.lines);
    expect(await extractInvoice(await makePdf())).toBeUndefined();
  });
});

describe('XMP', () => {
  it('buildXmp produit un paquet complet et readXmpProperty lit éléments et attributs', () => {
    const xmp = buildXmp({
      title: 'T & <U>',
      creatorTool: 'app',
      producer: 'prod',
      createDate: FIXED_DATE,
      modifyDate: FIXED_DATE,
      documentFileName: 'factur-x.xml',
      conformanceLevel: 'EN 16931',
    });
    expect(xmp.startsWith('<?xpacket begin="')).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(xmp).toContain('<rdf:li xml:lang="x-default">T &amp; &lt;U&gt;</rdf:li>');
    expect(xmp).not.toContain('dc:creator');
    expect(readXmpProperty(xmp, 'fx:ConformanceLevel')).toBe('EN 16931');
    expect(readXmpProperty(xmp, 'pdfaid:part')).toBe('3');
    expect(
      readXmpProperty('<rdf:Description fx:ConformanceLevel="BASIC"/>', 'fx:ConformanceLevel'),
    ).toBe('BASIC');
    expect(readXmpProperty(xmp, 'fx:Missing')).toBeUndefined();
  });
});
