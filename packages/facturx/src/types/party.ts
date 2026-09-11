import type { Address } from './address.js';
import type { ElectronicAddressScheme } from './codes.js';

/** Contact — BG-6 (vendeur) / BG-9 (acheteur). */
export interface Contact {
  /** BT-41 / BT-56 — Nom du point de contact. */
  name?: string;
  /** BT-42 / BT-57 — Téléphone du contact. */
  phone?: string;
  /** BT-43 / BT-58 — E-mail du contact. */
  email?: string;
}

/** Adresse électronique — BT-34/BT-35 (vendeur), BT-49/BT-50 (acheteur). */
export interface ElectronicAddress {
  /** BT-34 / BT-49 — Identifiant (ex. SIRET pour le routage sur la plateforme). */
  value: string;
  /** BT-34-1 / BT-49-1 — Schéma de l'identifiant (liste EAS ; `0225` = FRCTC en France). */
  scheme: ElectronicAddressScheme;
}

/**
 * Partie (vendeur BG-4 ou acheteur BG-7).
 * Les numéros BT sont indiqués sous la forme vendeur / acheteur.
 */
export interface Party {
  /** BT-27 / BT-44 — Raison sociale. Obligatoire (BR-06 / BR-07). */
  name: string;
  /** BT-28 / BT-45 — Nom commercial, si différent de la raison sociale. */
  tradingName?: string;
  /**
   * BT-30 / BT-47 — Identifiant d'enregistrement légal, schéma `0002` = SIREN (9 chiffres, clé Luhn).
   * Règle FR : obligatoire pour un vendeur établi en France (art. L441-9 C. com. ; contrôle Luhn).
   * Recommandé pour l'acheteur assujetti établi en France.
   */
  siren?: string;
  /**
   * BT-29 / BT-46 — Identifiant de la partie, schéma `0009` = SIRET (14 chiffres, clé Luhn).
   * Règle FR : recommandé ; sert de base au routage sur les plateformes (Chorus Pro, PDP).
   */
  siret?: string;
  /**
   * BT-31 / BT-48 — Numéro de TVA intracommunautaire (préfixe pays ISO 3166-1, BR-CO-09).
   * Règle FR : obligatoire pour le vendeur assujetti (art. 242 nonies A CGI) ;
   * pour un `FR` la clé de contrôle et le SIREN sont vérifiés.
   */
  vatId?: string;
  /** BT-32 — (vendeur uniquement) Identifiant d'enregistrement fiscal local, si différent de la TVA. */
  taxRegistrationId?: string;
  /**
   * BT-33 — (vendeur uniquement) Informations légales complémentaires.
   * Règle FR : forme juridique, capital social, RCS/RM, ex. « SAS au capital de 10 000 € — RCS Paris 443 061 841 ».
   */
  legalInfo?: string;
  /** BG-5 / BG-8 — Adresse postale. Obligatoire (BR-08 / BR-10). */
  address: Address;
  /** BG-6 / BG-9 — Contact. */
  contact?: Contact;
  /** BT-34 / BT-49 — Adresse électronique pour le routage. */
  electronicAddress?: ElectronicAddress;
}

/** Bénéficiaire du paiement si différent du vendeur — BG-10. */
export interface Payee {
  /** BT-59 — Nom du bénéficiaire. */
  name: string;
  /** BT-60 — Identifiant du bénéficiaire (ex. SIRET, schéma 0009). */
  id?: string;
  /** BT-61 — Identifiant d'enregistrement légal du bénéficiaire (ex. SIREN, schéma 0002). */
  legalId?: string;
}
