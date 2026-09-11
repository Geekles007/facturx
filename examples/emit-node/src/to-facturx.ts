import {
  type Address,
  centsFromDecimal,
  computeLineNetAmount,
  computeTotals,
  type Invoice,
  type InvoiceDraft,
  type IsoDate,
  type Line,
  percent,
  quantityFromDecimal,
  unitPriceFromDecimal,
} from 'facturx-sdk';
import type { AppAddress, AppInvoice } from './app-model.ts';

const address = (a: AppAddress): Address => ({
  line1: a.street,
  postCode: a.zip,
  city: a.city,
  countryCode: a.country,
});

/**
 * Traduit le modèle applicatif en `Invoice` Factur-X.
 * Les montants de ligne et les totaux sont calculés EXPLICITEMENT (computeLineNetAmount / computeTotals) :
 * le SDK les vérifiera ensuite et refusera toute incohérence.
 */
export function toFacturX(app: AppInvoice): Invoice {
  const lines: Line[] = app.lines.map((l, i) => {
    const base = {
      id: String(i + 1),
      name: l.label,
      sellerItemId: l.sku,
      quantity: quantityFromDecimal(l.qty),
      unitCode: l.unit,
      unitPrice: unitPriceFromDecimal(l.price),
      tax: { category: 'S' as const, rate: percent(l.vat) },
    };
    return {
      ...base,
      netAmount: computeLineNetAmount({ ...base, netAmount: centsFromDecimal('0') }),
    };
  });

  const draft: InvoiceDraft = {
    id: app.number,
    issueDate: app.issuedOn as IsoDate,
    typeCode: '380',
    currency: 'EUR',
    operationCategory: app.operation,
    seller: {
      name: app.seller.name,
      siren: app.seller.siren,
      ...(app.seller.siret ? { siret: app.seller.siret } : {}),
      vatId: app.seller.vat,
      ...(app.seller.legal ? { legalInfo: app.seller.legal } : {}),
      address: address(app.seller.address),
    },
    buyer: {
      name: app.buyer.name,
      ...(app.buyer.siren ? { siren: app.buyer.siren } : {}),
      ...(app.buyer.vat ? { vatId: app.buyer.vat } : {}),
      address: address(app.buyer.address),
    },
    ...(app.buyer.reference
      ? { buyerReference: app.buyer.reference, references: { purchaseOrder: app.buyer.reference } }
      : {}),
    delivery: { date: app.deliveredOn as IsoDate },
    lines,
    ...(app.discount
      ? {
          allowances: [
            {
              amount: centsFromDecimal(app.discount.amount),
              reason: app.discount.label,
              tax: { category: 'S', rate: percent(app.discount.vat) },
            },
          ],
        }
      : {}),
    paymentTerms: {
      dueDate: app.dueOn as IsoDate,
      latePenaltyRate: percent(app.terms.latePenaltyPercent),
      recoveryIndemnity: centsFromDecimal(app.terms.recoveryIndemnity),
      earlyPaymentDiscount: app.terms.earlyDiscount
        ? {
            rate: percent(app.terms.earlyDiscount.percent),
            withinDays: app.terms.earlyDiscount.days,
          }
        : 'none',
    },
    paymentMeans: [
      {
        typeCode: '58',
        creditTransfer: {
          iban: app.seller.iban,
          ...(app.seller.bic ? { bic: app.seller.bic } : {}),
        },
        remittanceInformation: app.number,
      },
    ],
  };

  return { ...draft, ...computeTotals(draft) };
}
