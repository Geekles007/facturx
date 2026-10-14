import { cents, computeTotals, type Invoice, type InvoiceDraft } from '../../src/index.js';
import { simpleDraft } from './invoices.js';

/**
 * Règles du schematron BR-FR v1.4.0.04 que le SDK applique depuis D71 : notes `BAR` (BR-FR-31),
 * identifiants à 9 chiffres (BR-FR-32), avoirs (BR-FR-CO-03 et 05), échéance (BR-FR-CO-07), cadres
 * de facturation (BR-FR-CO-08 et 09) et identifiants globaux (BR-FR-CO-10). Les mêmes cas servent
 * au SDK (test/validate.test.ts) et à la chaîne officielle (test/schematron.test.ts) : les verdicts
 * attendus, écrits à la main, sont ainsi confrontés au validateur de référence.
 */

/** Codes de ces règles, tels que le SDK les émet ; le schematron les suffixe (`BR-FR-CO-09_BT-23-1`). */
export const V14_RULE = /^BR-FR-(31|32|CO-03|CO-05|CO-07|CO-08|CO-09|CO-10)(?![0-9])/;

/** La facture de référence variée par `setup`, avec `prepaid` déjà réglé (BT-113). */
function variant(setup: (d: InvoiceDraft) => void, prepaid?: number): Invoice {
  // `simpleDraft` partage ses conditions de paiement d'un appel à l'autre : on travaille sur une copie.
  const draft = structuredClone(simpleDraft());
  setup(draft);
  return {
    ...draft,
    ...computeTotals(draft, prepaid === undefined ? {} : { prepaidAmount: cents(prepaid) }),
  };
}

/** TTC de la facture de référence : 2 × 100,00 € à 20 %. */
const TTC = 24000;
const DATED_REFERENCE = {
  precedingInvoices: [{ id: 'F-2026-0000', issueDate: '2026-08-01' as const }],
};
const GLN = (n: number) => ({ scheme: '0088', value: `301234567890${n}` });

/**
 * Cas : libellé, facture, anomalies attendues du SDK pour ces règles (« code @ chemin »), et, quand
 * ils diffèrent, les codes que relève la chaîne officielle.
 */
export const V14_CASES: [string, () => Invoice, string[], string[]?][] = [
  [
    'deux notes BAR portant un traitement',
    () =>
      variant((d) => {
        d.notes = [
          { subjectCode: 'BAR', text: 'B2B' },
          { subjectCode: 'BAR', text: 'B2C' },
        ];
      }),
    ['BR-FR-31 @ notes'],
  ],
  [
    'une note BAR fournie, et le traitement attendu',
    () =>
      variant((d) => {
        d.processing = 'B2B';
        d.notes = [{ subjectCode: 'BAR', text: 'B2B' }];
      }),
    [],
  ],
  [
    'SIREN de 8 chiffres en identifiant global 0002',
    () =>
      variant((d) => {
        d.seller.globalIds = [{ scheme: '0002', value: '12345678' }];
      }),
    ['BR-FR-32 @ seller.globalIds[0].value'],
  ],
  [
    'identifiant global 0231 non numérique',
    () =>
      variant((d) => {
        d.buyer.globalIds = [{ scheme: '0231', value: 'ABC123456' }];
      }),
    ['BR-FR-32 @ buyer.globalIds[0].value'],
  ],
  [
    'SIREN du bénéficiaire de 8 chiffres',
    () =>
      variant((d) => {
        d.payee = { name: 'Affactureur SA', legalId: '12345678' };
      }),
    ['BR-FR-32 @ payee.legalId'],
  ],
  [
    'identifiant global 0002 du bénéficiaire non numérique',
    () =>
      variant((d) => {
        d.payee = { name: 'Affactureur SA', globalId: { scheme: '0002', value: 'AB' } };
      }),
    ['BR-FR-32 @ payee.globalId.value'],
  ],
  [
    'SIREN de 9 chiffres en identifiant global 0002',
    () =>
      variant((d) => {
        d.buyer.globalIds = [{ scheme: '0002', value: '732829320' }];
      }),
    [],
  ],
  [
    'avoir remise globale (262) sans contrat ni période',
    () =>
      variant((d) => {
        d.typeCode = '262';
        d.references = DATED_REFERENCE;
      }),
    ['BR-FR-CO-03 @ references.contract', 'BR-FR-CO-03 @ delivery.period'],
  ],
  [
    'avoir remise globale (262) dont la période n’a pas de fin',
    () =>
      variant((d) => {
        d.typeCode = '262';
        d.references = { ...DATED_REFERENCE, contract: 'CT-2026-04' };
        d.delivery = { period: { start: '2026-08-01' } };
      }),
    ['BR-FR-CO-03 @ delivery.period'],
  ],
  [
    'avoir remise globale (262) avec contrat et période',
    () =>
      variant((d) => {
        d.typeCode = '262';
        d.references = { ...DATED_REFERENCE, contract: 'CT-2026-04' };
        d.delivery = { period: { start: '2026-08-01', end: '2026-08-31' } };
      }),
    [],
  ],
  [
    'avoir (381) sans facture antérieure',
    () =>
      variant((d) => {
        d.typeCode = '381';
      }),
    ['BR-FR-CO-05 @ references.precedingInvoices'],
  ],
  [
    'avoir (381) citant une facture antérieure sans sa date',
    () =>
      variant((d) => {
        d.typeCode = '381';
        d.references = { precedingInvoices: [{ id: 'F-2026-0000' }] };
      }),
    ['BR-FR-CO-05 @ references.precedingInvoices'],
  ],
  [
    'avoir (261) sans facture antérieure',
    () =>
      variant((d) => {
        d.typeCode = '261';
      }),
    ['BR-FR-CO-05 @ references.precedingInvoices'],
  ],
  [
    'avoir (396) sans facture antérieure',
    () =>
      variant((d) => {
        d.typeCode = '396';
      }),
    ['BR-FR-CO-05 @ references.precedingInvoices'],
  ],
  [
    'avoir (381) citant une facture antérieure datée',
    () =>
      variant((d) => {
        d.typeCode = '381';
        d.references = DATED_REFERENCE;
      }),
    [],
  ],
  [
    'échéance antérieure à la date de facture',
    () =>
      variant((d) => {
        d.paymentTerms.dueDate = '2026-09-01';
      }),
    ['BR-FR-CO-07 @ paymentTerms.dueDate'],
  ],
  [
    'échéance le jour de la facture',
    () =>
      variant((d) => {
        d.paymentTerms.dueDate = '2026-09-11';
      }),
    [],
  ],
  [
    'facture d’acompte (386) à échéance antérieure',
    () =>
      variant((d) => {
        d.typeCode = '386';
        d.paymentTerms.dueDate = '2026-09-01';
      }),
    [],
  ],
  [
    'facture déjà payée (S2) à échéance antérieure : la date du paiement',
    () =>
      variant((d) => {
        d.businessProcess = 'S2';
        d.paymentTerms.dueDate = '2026-09-01';
      }, TTC),
    [],
  ],
  [
    'facture d’acompte (386) en cadre définitif après acompte (S4)',
    () =>
      variant((d) => {
        d.businessProcess = 'S4';
        d.typeCode = '386';
        d.references = DATED_REFERENCE;
      }),
    ['BR-FR-CO-08 @ typeCode'],
  ],
  [
    'facture définitive (380) en cadre S4',
    () =>
      variant((d) => {
        d.businessProcess = 'S4';
        d.references = DATED_REFERENCE;
      }),
    [],
  ],
  [
    'facture déjà payée (S2) sans montant payé',
    () =>
      variant((d) => {
        d.businessProcess = 'S2';
      }),
    ['BR-FR-CO-09 @ totals.prepaidAmount', 'BR-FR-CO-09 @ totals.amountDueForPayment'],
  ],
  [
    'facture déjà payée (S2) en partie seulement',
    () =>
      variant((d) => {
        d.businessProcess = 'S2';
      }, 10000),
    ['BR-FR-CO-09 @ totals.prepaidAmount', 'BR-FR-CO-09 @ totals.amountDueForPayment'],
  ],
  [
    'facture déjà payée (S2) sans échéance',
    () =>
      variant((d) => {
        d.businessProcess = 'S2';
        delete d.paymentTerms.dueDate;
      }, TTC),
    ['BR-FR-CO-09 @ paymentTerms.dueDate'],
  ],
  [
    'facture déjà payée (S2) en entier, échéance à la date du paiement',
    () =>
      variant((d) => {
        d.businessProcess = 'S2';
      }, TTC),
    [],
  ],
  [
    'deux identifiants globaux du vendeur au même schéma',
    () =>
      variant((d) => {
        d.seller.globalIds = [GLN(1), GLN(2)];
      }),
    ['BR-FR-CO-10 @ seller.globalIds[1].scheme'],
  ],
  [
    'identifiant global 0009 du vendeur, en plus de son SIRET',
    () =>
      variant((d) => {
        d.seller.globalIds = [{ scheme: '0009', value: '44306184100047' }];
      }),
    ['BR-FR-CO-10 @ seller.globalIds[0].scheme'],
  ],
  [
    'deux identifiants globaux de l’acheteur au même schéma',
    () =>
      variant((d) => {
        d.buyer.globalIds = [GLN(1), GLN(2)];
      }),
    ['BR-FR-CO-10 @ buyer.globalIds[1].scheme'],
  ],
  [
    'identifiant global du vendeur sans schéma',
    () =>
      variant((d) => {
        d.seller.globalIds = [{ value: '3012345678901' }];
      }),
    ['BR-FR-CO-10 @ seller.globalIds[0].scheme'],
    // Écrit avec un schemeID vide, que BR-FR-CO-10 laisse passer : le CEN le refuse avant (BR-CL-10).
    ['BR-CL-10'],
  ],
  [
    'identifiant global du bénéficiaire sans schéma',
    () =>
      variant((d) => {
        d.payee = { name: 'Affactureur SA', globalId: { value: '3012345678901' } };
      }),
    ['BR-FR-CO-10 @ payee.globalId.scheme'],
    ['BR-CL-10'],
  ],
  [
    'identifiants globaux du vendeur à des schémas distincts',
    () =>
      variant((d) => {
        d.seller.globalIds = [GLN(1), { scheme: '0002', value: '443061841' }];
      }),
    [],
  ],
];
