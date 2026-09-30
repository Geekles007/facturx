/**
 * La facture d'exemple de la première visite : un aperçu vivant plutôt qu'une page blanche.
 *
 * Noms et numéros fictifs, repris des jeux d'essai du SDK (SIREN et IBAN à clé valide) : l'exemple
 * est conforme de bout en bout, et le Studio le montre dès l'ouverture.
 */

import type { CompanyProfile } from './library.js';
import {
  addDays,
  blankForm,
  blankLine,
  blankPaymentMeans,
  type InvoiceForm,
  isoToday,
  uid,
} from './model.js';

export function sampleCompany(): CompanyProfile['seller'] {
  return {
    name: 'Atelier Exemple SAS',
    tradingName: '',
    siren: '443061841',
    siret: '44306184110004',
    vatId: 'FR64443061841',
    taxRegistrationId: '',
    legalInfo: 'SAS au capital de 10 000 € — RCS Paris 443 061 841',
    address: {
      line1: '12 rue de la Facture',
      line2: '',
      line3: '',
      postCode: '75011',
      city: 'Paris',
      countrySubdivision: '',
      countryCode: 'FR',
    },
    contact: { name: '', phone: '01 23 45 67 89', email: 'facturation@exemple.fr' },
    electronicAddress: { value: '443061841', scheme: '0225' },
    routingCode: '',
    consumer: false,
  };
}

export function sampleForm(today = isoToday()): InvoiceForm {
  const form = blankForm(today);
  const year = today.slice(0, 4);
  form.id = `F-${year}-0042`;
  form.remittanceInformation = form.id;
  form.operationCategory = 'services';
  form.seller = sampleCompany();
  form.buyer = {
    ...form.buyer,
    name: 'Client Démo SARL',
    siren: '732829320',
    vatId: 'FR44732829320',
    address: {
      line1: '5 avenue du Client',
      line2: '',
      line3: '',
      postCode: '69002',
      city: 'Lyon',
      countrySubdivision: '',
      countryCode: 'FR',
    },
    contact: { name: 'Service comptabilité', phone: '', email: 'compta@client-demo.fr' },
    electronicAddress: { value: '732829320', scheme: '0225' },
  };
  form.delivery = { ...form.delivery, mode: 'date', date: today };
  form.references.purchaseOrder = `BC-${year}-118`;
  form.lines = [
    {
      ...blankLine('S:20'),
      name: "Atelier de cadrage et conception d'identité visuelle",
      description: 'Deux demi-journées avec votre équipe, synthèse et pistes graphiques.',
      quantity: '2',
      unitCode: 'DAY',
      unitPrice: '720',
    },
    {
      ...blankLine('S:20'),
      name: 'Déclinaison des supports',
      description: 'Cartes de visite, papier à en-tête, gabarits de présentation.',
      quantity: '1',
      unitCode: 'LS',
      unitPrice: '1450',
      sellerItemId: 'DECL-01',
    },
    {
      ...blankLine('S:20'),
      name: 'Hébergement et maintenance du site',
      quantity: '12',
      unitCode: 'MON',
      unitPrice: '29,90',
    },
  ];
  form.allowances = [
    {
      uid: uid(),
      reason: 'Remise fidélité',
      reasonCode: '95',
      mode: 'percent',
      value: '5',
      vat: 'auto',
    },
  ];
  form.paymentTerms = {
    ...form.paymentTerms,
    dueDate: addDays(today, 30),
    latePenaltyRate: '10',
    recoveryIndemnity: '40',
    discount: 'none',
  };
  form.paymentMeans = [
    { ...blankPaymentMeans('58'), iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'BNPAFRPP' },
  ];
  form.notes = [{ uid: uid(), subjectCode: 'AAI', text: 'Merci pour votre confiance.' }];
  return form;
}
