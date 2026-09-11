import type { Party } from '../../src/index.js';

/** SIREN valide (Luhn), SIRET dérivé valide, clé TVA FR = 64. */
export const SELLER_SIREN = '443061841';
export const SELLER_SIRET = '44306184110004';
export const SELLER_VAT = 'FR64443061841';

export const seller = (): Party => ({
  name: 'Atelier Exemple SAS',
  siren: SELLER_SIREN,
  siret: SELLER_SIRET,
  vatId: SELLER_VAT,
  legalInfo: 'SAS au capital de 10 000 € — RCS Paris 443 061 841',
  address: {
    line1: '12 rue de la Facture',
    postCode: '75011',
    city: 'Paris',
    countryCode: 'FR',
  },
  contact: { email: 'facturation@exemple.fr' },
  electronicAddress: { value: SELLER_SIRET, scheme: '0225' },
});

export const buyer = (): Party => ({
  name: 'Client Démo SARL',
  siren: '732829320',
  vatId: 'FR44732829320',
  address: {
    line1: '5 avenue du Client',
    postCode: '69002',
    city: 'Lyon',
    countryCode: 'FR',
  },
});
