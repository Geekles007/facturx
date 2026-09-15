import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CDV_PROFILES,
  cents,
  FacturXParseError,
  fromCdvXml,
  fromFormat204,
  type LifecycleStatus,
  parseCdvDocument,
  toCdvXml,
  toFormat204,
} from '../src/index.js';

const invoice = {
  id: 'F-2026-0042',
  issueDate: '2026-09-11' as const,
  sellerSiren: '443061841',
};

const options = {
  sender: { id: 'PDP0000001' },
  issuer: { id: '732829320', roleCode: 'BY' },
  recipient: { id: '443061841', roleCode: 'SE' },
  messageId: 'CDV-2026-0001',
  invoiceTypeCode: '380' as const,
  invoiceReceivedAt: '2026-09-12T09:15:00Z',
};

const depose: LifecycleStatus = {
  code: '200',
  dateTime: '2026-09-15T08:30:00Z',
  invoice,
};

const refuse: LifecycleStatus = {
  ...depose,
  code: '210',
  reasonCode: 'MONTANT_ERR',
  reasonLabel: 'Montant de la facture erroné',
  comment: 'Le total TTC ne correspond pas au bon de commande.',
};

const encaisse: LifecycleStatus = {
  ...depose,
  code: '212',
  amount: { code: 'MEN', value: cents(200243), currency: 'EUR' },
};

describe('format des dates (UNTDID 204)', () => {
  it('rend AAAAMMJJHHMMSS en UTC', () => {
    expect(toFormat204('2026-09-15T08:30:00Z')).toBe('20260915083000');
    // Un décalage explicite est ramené en UTC : 10 h 30 à Paris = 8 h 30 UTC.
    expect(toFormat204('2026-09-15T10:30:00+02:00')).toBe('20260915083000');
    // Une date seule vaut minuit UTC.
    expect(toFormat204('2026-09-11')).toBe('20260911000000');
  });

  it('refuse une date illisible plutôt que de produire un horodatage faux', () => {
    expect(() => toFormat204('hier')).toThrow(TypeError);
  });
});

describe('structure du message', () => {
  const xml = toCdvXml(depose, options);

  it('porte la racine CDAR et ses quatre espaces de noms', () => {
    expect(xml).toContain('<rsm:CrossDomainAcknowledgementAndResponse');
    expect(xml).toContain(
      'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100"',
    );
    expect(xml).toContain(
      'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    );
  });

  it("déclare le profil d'un CDV sur facture e-invoicing (G7.14), aux deux emplacements", () => {
    // MDT-3 dans le contexte, MDT-97 dans la référence : même urn, deux balises.
    const occurrences = xml.split(CDV_PROFILES.factureEinvoicing).length - 1;
    expect(occurrences).toBe(2);
  });

  it('identifie la plateforme émettrice par son matricule (MDT-18/21)', () => {
    expect(xml).toContain('<ram:GlobalID schemeID="0238">PDP0000001</ram:GlobalID>');
    expect(xml).toContain('<ram:RoleCode>WK</ram:RoleCode>');
  });

  it("n'écrit qu'un seul SIREN dans MDT-129, sous le qualifiant 0002 (G7.17)", () => {
    // La règle ne vise que l'émetteur de la facture référencée. Ailleurs dans le message, le même
    // SIREN peut légitimement réapparaître — ici comme destinataire — d'où le découpage.
    const bloc = xml.split('<ram:IssuerTradeParty>').at(-1) ?? '';
    const emetteurFacture = bloc.slice(0, bloc.indexOf('</ram:IssuerTradeParty>'));
    expect(emetteurFacture.split('<ram:GlobalID').length - 1).toBe(1);
    expect(emetteurFacture).toContain('schemeID="0002">443061841');
  });

  it('porte le code du statut dans ProcessConditionCode (MDT-105)', () => {
    expect(xml).toContain('<ram:ProcessConditionCode>200</ram:ProcessConditionCode>');
  });

  it('reprend le type de la facture visée (MDT-91, G7.15)', () => {
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
  });

  it('horodate au format 204', () => {
    expect(xml).toContain('<udt:DateTimeString format="204">20260915083000</udt:DateTimeString>');
  });

  it('valide le statut avant de sérialiser', () => {
    // Un refus sans motif ni commentaire enfreint G7.08 et G7.25.
    expect(() => toCdvXml({ ...depose, code: '210' }, options)).toThrow(/G7\.08/);
  });

  it('laisse passer un statut invalide quand on le demande explicitement', () => {
    expect(() =>
      toCdvXml({ ...depose, code: '210' }, { ...options, validate: false }),
    ).not.toThrow();
  });
});

describe('contenu propre à chaque statut', () => {
  it('un refus porte son motif, son libellé et son commentaire', () => {
    const xml = toCdvXml(refuse, options);
    expect(xml).toContain('<ram:ReasonCode>MONTANT_ERR</ram:ReasonCode>');
    expect(xml).toContain('<ram:Reason>Montant de la facture erroné</ram:Reason>');
    expect(xml).toContain('bon de commande');
  });

  it('un encaissement porte son montant et sa devise', () => {
    const xml = toCdvXml(encaisse, options);
    expect(xml).toContain('<ram:ValueAmount currencyID="EUR">2002.43</ram:ValueAmount>');
  });

  it("un dépôt n'invente ni motif ni montant", () => {
    const xml = toCdvXml(depose, options);
    expect(xml).not.toContain('ram:ReasonCode');
    expect(xml).not.toContain('ram:ValueAmount');
  });
});

/**
 * Conformité au XSD CDAR D22B d'UN/CEFACT, via `xmllint --schema`.
 * Ignoré proprement si le schéma n'a pas été récupéré (`pnpm schemas:fetch`) ou si xmllint manque.
 */
const schemasDir = new URL('./schemas/', import.meta.url).pathname;

function findCdarXsd(): string | undefined {
  if (!existsSync(schemasDir)) return undefined;
  for (const file of readdirSync(schemasDir)) {
    if (!file.endsWith('.xsd')) continue;
    const path = join(schemasDir, file);
    if (readFileSync(path, 'utf8').includes('name="CrossDomainAcknowledgementAndResponse"')) {
      return path;
    }
  }
  return undefined;
}

function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const xsd = findCdarXsd();
const available = xsd !== undefined && hasXmllint();

describe.skipIf(!available)('conformité au XSD CDAR D22B (xmllint)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdv-'));

  it.each([
    ['déposée', depose],
    ['refusée', refuse],
    ['encaissée', encaisse],
  ])('un statut %s valide le schéma', (nom, status) => {
    const file = join(dir, `${nom}.xml`);
    writeFileSync(file, toCdvXml(status, { ...options, pretty: true }));
    expect(() =>
      execFileSync('xmllint', ['--noout', '--schema', xsd as string, file], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});

describe('lecture (fromFormat204)', () => {
  it('est l’inverse exact de toFormat204', () => {
    expect(fromFormat204('20260915083000')).toBe('2026-09-15T08:30:00Z');
    expect(fromFormat204(toFormat204('2026-09-15T10:30:00+02:00'))).toBe('2026-09-15T08:30:00Z');
  });

  it('refuse une longueur ou un calendrier impossibles', () => {
    expect(() => fromFormat204('2026-09-15')).toThrow(TypeError);
    // Le 31 septembre n'existe pas : Date « déborde » en silence, ce qu'on refuse.
    expect(() => fromFormat204('20260931083000')).toThrow(TypeError);
  });
});

/**
 * L'aller-retour est ce que le XSD ne vérifie pas : qu'on ait mis la bonne valeur dans la bonne
 * balise. Un code écrit dans ReasonCode au lieu de ProcessConditionCode validerait le schéma et
 * échouerait ici.
 */
describe('aller-retour toCdvXml → parseCdvDocument', () => {
  const enveloppeAttendue = {
    profile: CDV_PROFILES.factureEinvoicing,
    messageId: options.messageId,
    messageName: 'Cycle de vie',
    sender: { id: 'PDP0000001', roleCode: 'WK' },
    issuer: { ...options.issuer, schemeId: '0002' },
    recipient: { ...options.recipient, schemeId: '0002' },
    invoiceTypeCode: '380',
    invoiceReceivedAt: options.invoiceReceivedAt,
    sequence: 1,
  };

  it.each([
    ['déposée', depose],
    ['refusée', refuse],
    ['encaissée', encaisse],
  ])('un statut %s revient identique, enveloppe comprise', (_nom, status) => {
    const lu = parseCdvDocument(toCdvXml(status, options));
    expect(lu.status).toEqual(status);
    expect(lu).toMatchObject({ ...enveloppeAttendue, messageDateTime: status.dateTime });
  });

  it('conserve le cadre de facturation, sans quoi G7.39 ne survivrait pas au transport', () => {
    const s6: LifecycleStatus = { ...refuse, reasonCode: 'ROUTAGE_ERR', businessProcess: 'S6' };
    const lu = parseCdvDocument(toCdvXml(s6, { ...options, sequence: 7, messageName: 'Refus' }));
    expect(lu.status).toEqual(s6);
    expect(lu.sequence).toBe(7);
    expect(lu.messageName).toBe('Refus');
  });

  it('fromCdvXml valide ce qu’il lit : un refus sans motif est refusé à la lecture', () => {
    const xml = toCdvXml({ ...depose, code: '210' }, { ...options, validate: false });
    expect(() => fromCdvXml(xml)).toThrow(/G7\.08/);
    expect(fromCdvXml(xml, { validate: false }).code).toBe('210');
  });
});

describe('lecture : erreurs localisées', () => {
  const codeDe = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof FacturXParseError) return { code: error.code, path: error.path };
      throw error;
    }
    throw new Error('attendu une FacturXParseError');
  };

  it('refuse un XML mal formé', () => {
    expect(codeDe(() => parseCdvDocument('<rsm:Cross')).code).toBe('MALFORMED');
  });

  it('refuse une racine qui n’est pas un CDAR — une facture CII, par exemple', () => {
    const cii =
      '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';
    expect(codeDe(() => parseCdvDocument(cii)).code).toBe('NOT_CDAR');
  });

  it('nomme la balise manquante par son chemin canonique', () => {
    const xml = toCdvXml(depose, options).replace(
      '<ram:ProcessConditionCode>200</ram:ProcessConditionCode>',
      '',
    );
    const e = codeDe(() => parseCdvDocument(xml));
    expect(e.code).toBe('MISSING');
    expect(e.path).toMatch(/ReferenceReferencedDocument\/ram:ProcessConditionCode$/);
  });

  it('refuse un émetteur qui n’est pas une plateforme (rôle ni WK ni DFH)', () => {
    const xml = toCdvXml(depose, options).replace(
      '<ram:RoleCode>WK</ram:RoleCode>',
      '<ram:RoleCode>BY</ram:RoleCode>',
    );
    const e = codeDe(() => parseCdvDocument(xml));
    expect(e.code).toBe('FORMAT');
    expect(e.path).toMatch(/SenderTradeParty\/ram:RoleCode$/);
  });

  it('refuse un horodatage qui n’est pas au format 204', () => {
    const xml = toCdvXml(depose, options).replace(
      'format="204">20260915083000',
      'format="102">20260915',
    );
    expect(codeDe(() => parseCdvDocument(xml)).code).toBe('FORMAT');
  });
});
