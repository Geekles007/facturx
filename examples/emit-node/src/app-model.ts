/**
 * Le modèle « applicatif » : ce que votre base de données ou votre API vous donne déjà.
 * Les montants sont des chaînes décimales (jamais des flottants) — c'est le format le plus sûr
 * pour transporter de l'argent en JSON.
 */
export interface AppAddress {
  street: string;
  zip: string;
  city: string;
  country: string;
}

export interface AppInvoice {
  number: string;
  /** Nature de l'opération (mention obligatoire depuis la réforme). */
  operation: 'goods' | 'services' | 'mixed';
  issuedOn: string;
  deliveredOn: string;
  dueOn: string;
  seller: {
    name: string;
    siren: string;
    siret?: string;
    vat: string;
    legal?: string;
    address: AppAddress;
    iban: string;
    bic?: string;
  };
  buyer: { name: string; siren?: string; vat?: string; address: AppAddress; reference?: string };
  lines: { sku: string; label: string; qty: string; unit: string; price: string; vat: string }[];
  discount?: { amount: string; label: string; vat: string } | null;
  terms: {
    latePenaltyPercent: string;
    recoveryIndemnity: string;
    earlyDiscount: { percent: string; days: number } | null;
  };
}
