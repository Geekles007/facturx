import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FacturXParseError,
  fromCiiXml,
  fromUblXml,
  parseUblDocument,
  UBL_NAMESPACES,
} from '../src/index.js';
import {
  blockingFailures,
  describeFailures,
  runSchematron,
  schemasDir,
} from './helpers/schematron.js';

const ubl = readFileSync(new URL('./golden/ubl/simple.xml', import.meta.url).pathname, 'utf8');
const cii = readFileSync(new URL('./golden/simple.xml', import.meta.url).pathname, 'utf8');

/**
 * Le socle de la réforme accepte trois syntaxes pour un seul modèle sémantique. La preuve que la
 * lecture UBL est juste n'est donc pas qu'elle « produit quelque chose », mais qu'elle produit
 * **exactement** ce que produit la lecture CII de la même facture.
 */
describe('UBL et CII décrivent la même facture', () => {
  it('les deux lectures rendent un objet identique', () => {
    expect(parseUblDocument(ubl).invoice).toEqual(fromCiiXml(cii, { validate: false }));
  });

  it('la facture UBL est valide au sens EN 16931 et des règles françaises', () => {
    expect(() => fromUblXml(ubl)).not.toThrow();
  });

  it('expose le profil et le cadre de facturation', () => {
    const { guidelineId, businessProcessId } = parseUblDocument(ubl);
    expect(guidelineId).toBe('urn:cen.eu:en16931:2017');
    expect(businessProcessId).toBe('S1');
  });
});

/**
 * Sans ce contrôle, rien ne garantirait que le fichier de référence est une vraie facture UBL :
 * un lecteur qui lit correctement un fichier invalide ne prouve rien.
 */
const sefUbl = join(schemasDir, 'EN16931-UBL-validation.sef.json');
describe.skipIf(!existsSync(sefUbl))(
  'le fichier de référence est conforme (schematron CEN UBL)',
  () => {
    it('zéro assertion en échec', () => {
      const failures = blockingFailures(runSchematron(sefUbl, ubl));
      expect(failures, describeFailures(failures)).toEqual([]);
    }, 60_000);

    it('le harnais détecte bien une violation (contrôle négatif)', () => {
      const casse = ubl.replace(
        '<cbc:TaxInclusiveAmount currencyID="EUR">240.00</cbc:TaxInclusiveAmount>',
        '<cbc:TaxInclusiveAmount currencyID="EUR">240.01</cbc:TaxInclusiveAmount>',
      );
      expect(blockingFailures(runSchematron(sefUbl, casse)).length).toBeGreaterThan(0);
    }, 60_000);
  },
);

describe('correspondances propres à UBL', () => {
  it('déduit le SIREN du SIRET quand seul le SIRET est déclaré', () => {
    // UBL porte les deux dans cbc:CompanyID, séparés par leur schemeID.
    const { invoice } = parseUblDocument(ubl);
    expect(invoice.seller.siret).toBe('44306184110004');
    expect(invoice.seller.siren).toBe('443061841');
  });

  it("lit le code de sujet d'une note depuis le préfixe #CODE#", () => {
    // UBL n'a pas de balise dédiée à BT-21 : la norme préfixe le texte.
    const libre = ubl.replace(
      "<cbc:Note>#AAB#Pas d'escompte pour paiement anticipé.</cbc:Note>",
      "<cbc:Note>#AAB#Pas d'escompte pour paiement anticipé.</cbc:Note><cbc:Note>Livraison en une fois.</cbc:Note>",
    );
    const { invoice } = parseUblDocument(libre);
    expect(invoice.notes).toEqual([{ text: 'Livraison en une fois.' }]);
  });

  it('convertit les notes légales françaises en conditions structurées', () => {
    const { invoice } = parseUblDocument(ubl);
    expect(invoice.paymentTerms).toMatchObject({
      dueDate: '2026-10-11',
      latePenaltyRate: 1000,
      recoveryIndemnity: 4000,
      earlyPaymentDiscount: 'none',
    });
  });

  it('expose les espaces de noms UBL 2.1', () => {
    expect(UBL_NAMESPACES.invoice).toBe('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
  });
});

describe('erreurs de lecture, localisées', () => {
  const erreur = (xml: string) => {
    try {
      parseUblDocument(xml);
    } catch (error) {
      if (error instanceof FacturXParseError) return { code: error.code, path: error.path };
      throw error;
    }
    throw new Error('attendu une FacturXParseError');
  };

  it('refuse un XML mal formé', () => {
    expect(erreur('<Invoice').code).toBe('MALFORMED');
  });

  it("refuse une racine qui n'est pas UBL — du CII, par exemple", () => {
    expect(erreur(cii).code).toBe('NOT_UBL');
  });

  it('nomme la balise manquante par son chemin', () => {
    const e = erreur(ubl.replace(/<cbc:DocumentCurrencyCode>EUR<\/cbc:DocumentCurrencyCode>/, ''));
    expect(e.code).toBe('MISSING');
    expect(e.path).toBe('Invoice/cbc:DocumentCurrencyCode');
  });

  it('localise une valeur manquante au fond de la structure', () => {
    const e = erreur(ubl.replace('<cbc:Name>Prestation de conseil</cbc:Name>', ''));
    expect(e.code).toBe('MISSING');
    expect(e.path).toMatch(/cac:InvoiceLine\/cac:Item\/cbc:Name$/);
  });

  it('refuse une date qui ne respecte pas le format ISO', () => {
    const e = erreur(
      ubl.replace(
        '<cbc:IssueDate>2026-09-11</cbc:IssueDate>',
        '<cbc:IssueDate>11/09/2026</cbc:IssueDate>',
      ),
    );
    expect(e.code).toBe('FORMAT');
  });

  it('refuse un montant illisible', () => {
    const e = erreur(
      ubl.replace(
        '<cbc:PayableAmount currencyID="EUR">240.00<',
        '<cbc:PayableAmount currencyID="EUR">deux cent<',
      ),
    );
    expect(e.code).toBe('FORMAT');
  });

  it('valide par défaut : une facture incohérente est refusée à la lecture', () => {
    const faux = ubl.replace(
      '<cbc:TaxInclusiveAmount currencyID="EUR">240.00</cbc:TaxInclusiveAmount>',
      '<cbc:TaxInclusiveAmount currencyID="EUR">999.00</cbc:TaxInclusiveAmount>',
    );
    expect(() => fromUblXml(faux)).toThrow(/BR-CO-15/);
    expect(fromUblXml(faux, { validate: false }).totals.taxInclusiveAmount).toBe(99900);
  });
});
