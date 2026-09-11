import {
  cents,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  type PaymentMeans,
  percent,
  quantity,
  unitPrice,
} from '../../src/index.js';
import { buyer, seller } from './parties.js';

const paymentTerms: Invoice['paymentTerms'] = {
  dueDate: '2026-10-11',
  latePenaltyRate: percent('10'),
  recoveryIndemnity: cents(4000),
  earlyPaymentDiscount: 'none',
};

const paymentMeans = (invoiceId: string): PaymentMeans[] => [
  {
    typeCode: '58',
    creditTransfer: { iban: 'FR7630006000011234567890189', bic: 'BNPAFRPP' },
    remittanceInformation: invoiceId,
  },
];

/** Facture simple : 1 ligne, 2 × 100,00 € à 20 % → HT 200,00, TVA 40,00, TTC 240,00. */
export function simpleDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0001',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'services',
    seller: seller(),
    buyer: buyer(),
    delivery: { date: '2026-09-10' },
    lines: [
      {
        id: '1',
        name: 'Prestation de conseil',
        quantity: quantity(20000),
        unitCode: 'DAY',
        unitPrice: unitPrice(1000000),
        netAmount: cents(20000),
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms,
    paymentMeans: paymentMeans('F-2026-0001'),
  };
}

export function simpleInvoice(): Invoice {
  const draft = simpleDraft();
  return { ...draft, ...computeTotals(draft) };
}

/**
 * Facture multi-taux avec remises :
 * - ligne 1 : 3 × 50,00 à 20 % avec remise de ligne 10,00 → 140,00
 * - ligne 2 : 1,5 × 20,00 à 5,5 %                          →  30,00
 * - remise document 5,00 (20 %), frais de port 2,00 (20 %)
 * → S 20 % : base 137,00, TVA 27,40 ; S 5,5 % : base 30,00, TVA 1,65
 * → lignes 170,00 ; HT 167,00 ; TVA 29,05 ; TTC 196,05
 */
export function multiRateDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0002',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'mixed',
    vatOnDebits: true,
    buyerReference: 'PO-4587',
    seller: seller(),
    buyer: buyer(),
    delivery: { period: { start: '2026-09-01', end: '2026-09-30' } },
    references: { purchaseOrder: 'PO-4587' },
    lines: [
      {
        id: '1',
        name: 'Licence logicielle',
        quantity: quantity(30000),
        unitCode: 'C62',
        unitPrice: unitPrice(500000),
        allowances: [{ amount: cents(1000), reason: 'Remise fidélité', reasonCode: '95' }],
        netAmount: cents(14000),
        tax: { category: 'S', rate: percent('20') },
      },
      {
        id: '2',
        name: 'Livres',
        quantity: quantity(15000),
        unitCode: 'KGM',
        unitPrice: unitPrice(200000),
        netAmount: cents(3000),
        tax: { category: 'S', rate: percent('5.5') },
      },
    ],
    allowances: [
      {
        amount: cents(500),
        reason: 'Remise commerciale',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    charges: [
      {
        amount: cents(200),
        reason: 'Frais de port',
        reasonCode: 'FC',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: { ...paymentTerms, earlyPaymentDiscount: { rate: percent('2'), withinDays: 10 } },
    paymentMeans: paymentMeans('F-2026-0002'),
  };
}

export function multiRateInvoice(): Invoice {
  const draft = multiRateDraft();
  return { ...draft, ...computeTotals(draft) };
}

/**
 * Facture « complète » : exerce tous les champs optionnels du modèle pour verrouiller
 * l'ordre des éléments CII (prix brut + remise sur prix, quantité de base, période et note de ligne,
 * article GTIN, notes document, payee, livraison avec adresse, prélèvement SEPA, factures antérieures,
 * références BT-11…19, autoliquidation + taux normal, acompte et arrondi).
 */
export function fullDraft(): InvoiceDraft {
  return {
    id: 'F-2026-0003',
    issueDate: '2026-09-11',
    typeCode: '380',
    currency: 'EUR',
    operationCategory: 'mixed',
    processing: 'B2B',
    taxPointDate: '2026-09-10',
    buyerReference: 'SERVICE-COMPTA-42',
    notes: [
      {
        text: "Membre d'une association agréée, le règlement par chèque est accepté.",
        subjectCode: 'REG',
      },
      { text: 'Merci pour votre confiance.' },
    ],
    seller: {
      ...seller(),
      tradingName: 'Atelier Exemple',
      taxRegistrationId: 'FR-FC-123',
      contact: { name: 'Jeanne Dupont', phone: '+33 1 23 45 67 89', email: 'jeanne@exemple.fr' },
    },
    buyer: {
      ...buyer(),
      siret: '73282932010008',
      tradingName: 'Client Démo',
      electronicAddress: { value: '732829320_COMPTA', scheme: '0225' },
      routingCode: 'SERVICE-COMPTA-42',
      contact: { email: 'achats@client.fr' },
    },
    payee: { name: "Société d'affacturage", id: '12345678900012', legalId: '123456789' },
    delivery: {
      date: '2026-09-05',
      period: { start: '2026-08-01', end: '2026-08-31' },
      partyName: 'Entrepôt Client',
      locationId: 'ENT-LYON-2',
      address: {
        line1: 'ZI des Docks',
        line2: 'Bâtiment C',
        postCode: '69007',
        city: 'Lyon',
        countrySubdivision: 'Auvergne-Rhône-Alpes',
        countryCode: 'FR',
      },
    },
    references: {
      project: 'PROJ-2026-07',
      contract: 'CT-2025-118',
      purchaseOrder: 'PO-9001',
      salesOrder: 'SO-4410',
      receivingAdvice: 'RA-77',
      despatchAdvice: 'DA-78',
      tenderOrLot: 'LOT-3',
      invoicedObject: 'ABO-55512',
      buyerAccountingReference: '706100',
      precedingInvoices: [{ id: 'F-2026-0000', issueDate: '2026-08-01' }, { id: 'F-2025-0999' }],
    },
    attachments: [
      {
        id: 'PO-9001',
        description: 'BON_COMMANDE',
        file: {
          filename: 'bon-de-commande.csv',
          mimeType: 'text/csv',
          bytes: new TextEncoder().encode('ref;qty\nCAB-2MM;250\n'),
        },
      },
      { id: 'RIB-2026', description: 'RIB', uri: 'https://exemple.fr/rib/443061841.pdf' },
    ],
    lines: [
      {
        id: 'L1',
        note: 'Tarif négocié',
        orderLineReference: 'PO-9001-1',
        buyerAccountingReference: '706100',
        period: { start: '2026-08-01', end: '2026-08-31' },
        name: 'Câbles <2 mm> & "fixations"',
        description: 'Lot de câbles, vendu par 100',
        sellerItemId: 'CAB-2MM',
        buyerItemId: 'ACH-0042',
        standardItemId: { value: '3760123456789', scheme: '0160' },
        originCountry: 'DE',
        quantity: quantity(2500000), // 250
        unitCode: 'C62',
        grossUnitPrice: unitPrice(150000), // 15,00 pour 100
        priceDiscount: unitPrice(30000), // −3,00
        unitPrice: unitPrice(120000), // 12,00 pour 100
        baseQuantity: quantity(1000000), // 100
        baseQuantityUnitCode: 'C62',
        charges: [{ amount: cents(150), reason: 'Conditionnement', reasonCode: 'PC' }],
        allowances: [
          {
            amount: cents(200),
            baseAmount: cents(3000),
            percentage: percent('6.67'),
            reason: 'Remise volume',
          },
        ],
        netAmount: cents(2950), // 30,00 + 1,50 − 2,00
        tax: { category: 'S', rate: percent('20') },
      },
      {
        id: 'L2',
        name: 'Prestation sous-traitée (autoliquidation)',
        quantity: quantity(10000),
        unitCode: 'E48',
        unitPrice: unitPrice(5000000),
        netAmount: cents(50000),
        tax: { category: 'AE', rate: percent('0') },
      },
    ],
    allowances: [
      {
        amount: cents(100),
        baseAmount: cents(2950),
        percentage: percent('3.39'),
        reasonCode: '95',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    charges: [
      {
        amount: cents(900),
        reason: 'Transport',
        reasonCode: 'FC',
        tax: { category: 'S', rate: percent('20') },
      },
    ],
    paymentTerms: {
      ...paymentTerms,
      text: "Prélèvement SEPA à 30 jours. Pénalités de retard : 10 % l'an. Indemnité forfaitaire de recouvrement : 40 €. Pas d'escompte.",
    },
    paymentMeans: [
      {
        typeCode: '59',
        text: 'Prélèvement SEPA',
        remittanceInformation: 'F-2026-0003',
        directDebit: {
          mandateReference: 'RUM-2026-000123',
          creditorId: 'FR12ZZZ123456',
          debitedIban: 'DE89370400440532013000',
        },
      },
      { typeCode: '58', creditTransfer: { iban: 'FR7630006000011234567890189', bic: 'BNPAFRPP' } },
    ],
  };
}

export function fullInvoice(): Invoice {
  const draft = fullDraft();
  return {
    ...draft,
    ...computeTotals(draft, {
      prepaidAmount: cents(10000),
      roundingAmount: cents(1),
      exemptions: { AE: { code: 'VATEX-EU-AE', reason: 'Autoliquidation' } },
    }),
  };
}
