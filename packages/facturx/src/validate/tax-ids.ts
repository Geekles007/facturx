import type { TaxCategoryCode } from '../types/codes.js';
import type { Invoice } from '../types/invoice.js';
import { isNonEmptyString } from './formats.js';
import { declaresFranchise } from './french.js';
import type { IssueCode, IssueCollector, TaxIdRuleFamily } from './issues.js';

/**
 * Identifiants fiscaux exigés ou interdits selon la catégorie de TVA : règles 02 (lignes), 03 (remises)
 * et 04 (frais de document) de chaque famille EN 16931, sous leur nom officiel. Le schematron les
 * déclenche par élément ; leur remède est sur une partie, donc une anomalie par règle, sur le champ
 * à corriger. Le représentant fiscal (BT-63) n'est pas modélisé : il n'entre pas dans les conditions.
 */
const FAMILY: Record<TaxCategoryCode, TaxIdRuleFamily> = {
  S: 'S',
  Z: 'Z',
  E: 'E',
  AE: 'AE',
  K: 'IC',
  G: 'G',
  O: 'O',
  L: 'AF',
  M: 'AG',
};

/** BT-31 ou BT-32 suffit. */
const SELLER_VAT_OR_TAX_REGISTRATION: ReadonlySet<TaxCategoryCode> = new Set([
  'S',
  'Z',
  'E',
  'AE',
  'L',
  'M',
]);
/** BT-31 exigé : un identifiant fiscal local (BT-32) ne suffit pas. */
const SELLER_VAT: ReadonlySet<TaxCategoryCode> = new Set(['K', 'G']);

const LABEL: Record<TaxCategoryCode, string> = {
  S: 'au taux normal (S)',
  Z: 'au taux zéro (Z)',
  E: 'exonérée (E)',
  AE: 'en autoliquidation (AE)',
  K: 'en livraison intracommunautaire (K)',
  G: 'à l’exportation (G)',
  O: 'hors du champ de la TVA (O)',
  L: 'à l’IGIC (L)',
  M: 'à l’IPSI (M)',
};

export function checkTaxIdentifiers(inv: Invoice, c: IssueCollector): void {
  const seller = inv.seller;
  const buyer = inv.buyer;
  if (!seller || !buyer) return;

  // Les catégories présentes, par emplacement : lignes (02), remises (03), frais (04).
  const used = new Map<TaxCategoryCode, Set<'02' | '03' | '04'>>();
  const note = (category: unknown, suffix: '02' | '03' | '04') => {
    if (typeof category !== 'string' || !(category in FAMILY)) return;
    const key = category as TaxCategoryCode;
    used.set(key, (used.get(key) ?? new Set()).add(suffix));
  };
  for (const line of Array.isArray(inv.lines) ? inv.lines : []) note(line?.tax?.category, '02');
  for (const a of inv.allowances ?? []) note(a?.tax?.category, '03');
  for (const ch of inv.charges ?? []) note(ch?.tax?.category, '04');

  const sellerVat = isNonEmptyString(seller.vatId);
  const sellerTaxRegistration = isNonEmptyString(seller.taxRegistrationId);
  const buyerVat = isNonEmptyString(buyer.vatId);
  const buyerLegal = isNonEmptyString(buyer.siren);

  for (const [category, suffixes] of used) {
    for (const suffix of suffixes) {
      const code = `BR-${FAMILY[category]}-${suffix}` as IssueCode;
      const what = `Une facture ${LABEL[category]}`;

      // En franchise en base, BR-FR-CO-16 dit déjà quoi porter en BT-32 : pas d'anomalie en double.
      const franchise = category === 'E' && declaresFranchise(inv);
      if (SELLER_VAT_OR_TAX_REGISTRATION.has(category) && !franchise) {
        if (!sellerVat && !sellerTaxRegistration) {
          c.add(
            code,
            'seller.vatId',
            `${what} porte le numéro de TVA du vendeur (BT-31) ou son identifiant fiscal (BT-32).`,
          );
        }
      }
      if (SELLER_VAT.has(category) && !sellerVat) {
        c.add(code, 'seller.vatId', `${what} porte le numéro de TVA du vendeur (BT-31).`);
      }
      if (category === 'AE' && !buyerVat && !buyerLegal) {
        c.add(
          code,
          'buyer.vatId',
          `${what} porte le numéro de TVA de l’acheteur (BT-48) ou son SIREN (BT-47).`,
        );
      }
      if (category === 'K' && !buyerVat) {
        c.add(code, 'buyer.vatId', `${what} porte le numéro de TVA de l’acheteur (BT-48).`);
      }
      if (category === 'O') {
        if (sellerVat)
          c.add(code, 'seller.vatId', `${what} ne porte pas le numéro de TVA du vendeur (BT-31).`);
        if (buyerVat)
          c.add(
            code,
            'buyer.vatId',
            `${what} ne porte pas le numéro de TVA de l’acheteur (BT-48).`,
          );
      }
    }
  }
}
