import type { CountryCode } from './codes.js';

/**
 * Adresse postale — BG-5 (vendeur), BG-8 (acheteur), BG-15 (livraison).
 * Les numéros BT indiqués suivent l'ordre vendeur / acheteur / livraison.
 */
export interface Address {
  /** BT-35 / BT-50 / BT-75 — Ligne d'adresse 1. */
  line1?: string;
  /** BT-36 / BT-51 / BT-76 — Ligne d'adresse 2. */
  line2?: string;
  /** BT-162 / BT-163 / BT-165 — Ligne d'adresse 3. */
  line3?: string;
  /** BT-37 / BT-52 / BT-77 — Ville. */
  city?: string;
  /** BT-38 / BT-53 / BT-78 — Code postal. */
  postCode?: string;
  /** BT-39 / BT-54 / BT-79 — Subdivision de pays (région, département). */
  countrySubdivision?: string;
  /**
   * BT-40 / BT-55 / BT-80 — Code pays ISO 3166-1 alpha-2.
   * Obligatoire (BR-09 vendeur, BR-11 acheteur).
   */
  countryCode: CountryCode;
}
