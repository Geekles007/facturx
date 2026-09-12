/**
 * Facture d'exemple : un PDF/A-3 Factur-X complet, produit par le SDK lui-même.
 *
 *   node scripts/example-invoice.mjs [chemin.pdf]
 *
 * Sert à deux choses : le bouton « essayer un PDF Factur-X » du validateur, et un fichier
 * téléchargeable pour qui veut essayer une chaîne de réception. Sortie déterministe (date fixée).
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {
  assertValidInvoice,
  cents,
  centsToString,
  computeTotals,
  percent,
  quantity,
  unitPrice,
} from 'facturx-sdk';
import { embedFacturX } from 'facturx-sdk/pdf';
import { PDFDocument, rgb } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Date fixe : deux constructions successives produisent le même octet. */
const DATE = new Date('2026-09-11T10:00:00Z');

/** Noms et numéros volontairement fictifs, repris des jeux d'essai du SDK. */
export function exampleInvoice() {
  const draft = {
    id: 'FA-2026-0042',
    remittanceInformation: 'FA-2026-0042',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'services',
    buyerReference: 'BC-2026-118',
    seller: {
      name: 'Atelier Exemple SAS',
      siren: '443061841',
      siret: '44306184110004',
      vatId: 'FR64443061841',
      legalInfo: 'SAS au capital de 10 000 € — RCS Paris 443 061 841',
      address: {
        line1: '12 rue de la Facture',
        postCode: '75011',
        city: 'Paris',
        countryCode: 'FR',
      },
      contact: { email: 'facturation@exemple.fr' },
      electronicAddress: { value: '443061841', scheme: '0225' },
    },
    buyer: {
      name: 'Client Démo SARL',
      siren: '732829320',
      vatId: 'FR44732829320',
      address: { line1: '5 avenue du Client', postCode: '69002', city: 'Lyon', countryCode: 'FR' },
      electronicAddress: { value: '732829320', scheme: '0225' },
    },
    delivery: { date: '2026-09-10' },
    references: { purchaseOrder: 'BC-2026-118' },
    lines: [
      {
        id: '1',
        name: "Conception d'identité visuelle",
        description: 'Logotype, palette, règles typographiques',
        quantity: quantity(40000),
        unitCode: 'DAY',
        unitPrice: unitPrice(7200000),
        netAmount: cents(288000),
        tax: { category: 'S', rate: percent('20') },
      },
      {
        id: '2',
        name: 'Déclinaison des supports imprimés',
        quantity: quantity(20000),
        unitCode: 'DAY',
        unitPrice: unitPrice(7200000),
        netAmount: cents(144000),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: {
      dueDate: '2026-10-11',
      latePenaltyRate: percent('10'),
      recoveryIndemnity: cents(4000),
      earlyPaymentDiscount: 'none',
    },
    paymentMeans: [
      { typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189', bic: 'BNPAFRPP' } },
    ],
  };
  return assertValidInvoice({ ...draft, ...computeTotals(draft) });
}

/** 288000 → « 2 880,00 € » (espaces insécables : l'espace fine U+202F n'existe pas dans Geist). */
const euros = (value) => {
  const [whole, decimals] = centsToString(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decimals} €`;
};
const day = (iso) => iso.split('-').reverse().join('/');

const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.85, 0.85, 0.85);

/** Le PDF « visuel », tel que votre application le produit déjà. Polices embarquées (PDF/A). */
async function renderInvoicePdf(invoice) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts = join(root, 'node_modules/geist/dist/fonts/geist-sans');
  // Polices entières : le sous-ensemble de pdf-lib laisse une référence au glyphe .notdef,
  // que veraPDF refuse en PDF/A-3 (ISO 19005-3 6.2.11.8-1).
  const regularBytes = readFileSync(join(fonts, 'Geist-Regular.ttf'));
  const boldBytes = readFileSync(join(fonts, 'Geist-SemiBold.ttf'));
  // Ligatures et alternatives contextuelles désactivées : pdf-lib écrit les glyphes substitués
  // sans reprendre leurs avances, ce qui ouvre des trous dans certains mots (« palette »).
  const features = { liga: false, clig: false, calt: false, rlig: false };
  const regular = await doc.embedFont(regularBytes, { features });
  const bold = await doc.embedFont(boldBytes, { features });
  // Un caractère absent de la police devient .notdef, ce que veraPDF refuse (ISO 19005-3 6.2.11.8-1)
  // sans rien montrer à l'écran : on préfère casser la construction.
  const outlines = new Map([
    [regular, fontkit.create(regularBytes)],
    [bold, fontkit.create(boldBytes)],
  ]);
  const assertDrawable = (value, font) => {
    const outline = outlines.get(font);
    for (const char of value) {
      if (!outline.hasGlyphForCodePoint(char.codePointAt(0))) {
        const code = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        throw new Error(`U+${code} absent de la police, dans ${JSON.stringify(value)}`);
      }
    }
  };

  const page = doc.addPage([595, 842]);
  const M = 48;
  const right = 595 - M;
  let y = 842 - M;

  const text = (value, x, size = 9.5, font = regular, color = INK) => {
    assertDrawable(value, font);
    page.drawText(value, { x, y, size, font, color });
  };
  const textRight = (value, x, size = 9.5, font = regular, color = INK) => {
    assertDrawable(value, font);
    page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y, size, font, color });
  };
  const rule = (offset = 0) =>
    page.drawLine({
      start: { x: M, y: y - offset },
      end: { x: right, y: y - offset },
      thickness: 0.75,
      color: RULE,
    });

  // En-tête : émetteur à gauche, facture à droite
  text(invoice.seller.name, M, 15, bold);
  textRight('FACTURE', right, 15, bold);
  y -= 16;
  text(invoice.seller.address.line1, M, 9, regular, MUTED);
  textRight(`N° ${invoice.id}`, right, 10, bold);
  y -= 12;
  text(`${invoice.seller.address.postCode} ${invoice.seller.address.city}`, M, 9, regular, MUTED);
  textRight(`Émise le ${day(invoice.issueDate)}`, right, 9, regular, MUTED);
  y -= 12;
  text(`SIRET ${invoice.seller.siret} — TVA ${invoice.seller.vatId}`, M, 9, regular, MUTED);
  textRight(`Échéance le ${day(invoice.paymentTerms.dueDate)}`, right, 9, regular, MUTED);

  // Destinataire
  y -= 44;
  text('FACTURÉ À', M, 8, bold, MUTED);
  y -= 15;
  text(invoice.buyer.name, M, 11, bold);
  textRight(`Référence commande : ${invoice.references.purchaseOrder}`, right, 9, regular, MUTED);
  y -= 13;
  text(invoice.buyer.address.line1, M, 9, regular, MUTED);
  y -= 12;
  text(`${invoice.buyer.address.postCode} ${invoice.buyer.address.city}`, M, 9, regular, MUTED);
  y -= 12;
  text(
    `SIREN ${invoice.buyer.siren} — adresse électronique ${invoice.buyer.electronicAddress.value} (0225)`,
    M,
    9,
    regular,
    MUTED,
  );

  // Lignes
  y -= 36;
  const COL = { qty: 320, unit: 400, vat: 452, total: right };
  text('DÉSIGNATION', M, 8, bold, MUTED);
  textRight('QTÉ', COL.qty, 8, bold, MUTED);
  textRight('P.U. HT', COL.unit, 8, bold, MUTED);
  textRight('TVA', COL.vat, 8, bold, MUTED);
  textRight('MONTANT HT', COL.total, 8, bold, MUTED);
  rule(8);
  y -= 22;

  for (const line of invoice.lines) {
    text(line.name, M, 10, bold);
    textRight((line.quantity / 10000).toFixed(2).replace('.', ','), COL.qty, 9.5);
    textRight(euros(Math.round(line.unitPrice / 100)), COL.unit, 9.5);
    textRight('20 %', COL.vat, 9.5);
    textRight(euros(line.netAmount), COL.total, 9.5);
    if (line.description) {
      y -= 12;
      text(line.description, M, 8.5, regular, MUTED);
    }
    y -= 18;
  }

  // Totaux
  rule(0);
  y -= 20;
  const totalLine = (label, value, strong = false) => {
    textRight(label, COL.unit, strong ? 10 : 9.5, strong ? bold : regular, strong ? INK : MUTED);
    textRight(value, COL.total, strong ? 10 : 9.5, strong ? bold : regular);
    y -= strong ? 18 : 15;
  };
  totalLine('Total HT', euros(invoice.totals.taxExclusiveAmount));
  totalLine('TVA 20 %', euros(invoice.totals.taxTotalAmount));
  totalLine('Total TTC', euros(invoice.totals.taxInclusiveAmount));
  totalLine('Net à payer', euros(invoice.totals.amountDueForPayment), true);

  // Mentions
  y -= 24;
  rule(0);
  y -= 18;
  const mention = (value) => {
    text(value, M, 8.5, regular, MUTED);
    y -= 12;
  };
  mention(
    `Virement sur ${invoice.paymentMeans[0].creditTransfer.iban} (${invoice.paymentMeans[0].creditTransfer.bic}) — référence ${invoice.remittanceInformation}.`,
  );
  mention(
    "Pénalités de retard : 10,00 % l'an, exigibles sans rappel dès le lendemain de l'échéance (art. L441-10 C. com.).",
  );
  mention('Indemnité forfaitaire pour frais de recouvrement : 40,00 € (art. D441-5 C. com.).');
  mention("Pas d'escompte pour paiement anticipé.");
  mention(invoice.seller.legalInfo);

  y = M + 18;
  text(
    'Facture électronique Factur-X (profil EN 16931) : les données structurées sont dans la pièce jointe factur-x.xml.',
    M,
    8,
    regular,
    MUTED,
  );

  return await doc.save({ updateFieldAppearances: false });
}

/** Le PDF/A-3 Factur-X complet : visuel + XML embarqué + OutputIntent sRGB. */
export async function buildExampleFacturX() {
  const invoice = exampleInvoice();
  const icc = readFileSync(join(root, 'packages/facturx/test/fixtures/sRGB.icc'));
  return await embedFacturX(
    await renderInvoicePdf(invoice),
    { invoice },
    {
      date: DATE,
      title: `Facture ${invoice.id}`,
      subject: 'Facture d’exemple Factur-X — profil EN 16931',
      outputIntent: { iccProfile: new Uint8Array(icc) },
    },
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ?? join(root, 'facture-exemple-facturx.pdf');
  const pdf = await buildExampleFacturX();
  writeFileSync(target, pdf);
  console.log(`${target} — ${(pdf.length / 1024).toFixed(0)} Ko`);
  if (!existsSync(target)) process.exit(1);
}
