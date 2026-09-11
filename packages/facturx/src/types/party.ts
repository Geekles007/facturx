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

/**
 * Adresse électronique — BT-34/BT-34-1 (vendeur), BT-49/BT-49-1 (acheteur).
 * Règles FR : en e-invoicing, schéma `0225` et valeur `SIREN` ou `SIREN_XXX` (BR-FR-12/13/21/22, helper
 * `electronicAddress0225`) ; caractères `A-Z a-z 0-9 - _ .` en 0225 (BR-FR-23) ; 125 caractères max (BR-FR-25) ;
 * hors e-invoicing, tout schéma EAS, y compris un e-mail (`EM`).
 */
/** Identifiant qualifié ou non d'une partie (BT-29 / BT-46 / BT-60 et leurs schémas). */
export interface PartyIdentifier {
  value: string;
  /** Schéma ISO 6523 (ex. `0088` GLN, `0160` GTIN) ; absent pour un identifiant privé sans schéma. */
  scheme?: string;
}

export interface ElectronicAddress {
  /** BT-34 / BT-49 — Identifiant. */
  value: string;
  /** BT-34-1 / BT-49-1 — Schéma de l'identifiant (liste EAS ; `0225` en France, `EM` pour un e-mail). */
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
  /**
   * BT-29 / BT-46 — Code de routage (identifiant privé, schéma `0224`), ex. le service destinataire chez
   * l'acheteur. Règles FR : `A-Z a-z 0-9 - _ .` (BR-FR-24), 100 caractères max (BR-FR-26).
   */
  routingCode?: string;
  /** BT-29 / BT-46 — Autres identifiants privés (`ram:ID`, schéma optionnel), hors SIRET et code de routage. */
  identifiers?: PartyIdentifier[];
  /** BT-29-1 / BT-46-1 — Identifiants globaux (`ram:GlobalID`, schéma ISO 6523), hors SIRET (`0009`). */
  globalIds?: PartyIdentifier[];
  /**
   * (acheteur uniquement) `true` si l'acheteur est un particulier (B2C) : ni SIREN (BT-47) ni TVA (BT-48)
   * ne sont exigés. Règle FR : sans ce drapeau, un acheteur établi en France doit porter son SIREN
   * (mention obligatoire depuis la réforme ; art. 242 nonies A CGI).
   */
  consumer?: true;
}

/** Bénéficiaire du paiement si différent du vendeur — BG-10. */
export interface Payee {
  /** BT-59 — Nom du bénéficiaire. */
  name: string;
  /** BT-60 — Identifiant du bénéficiaire (ex. SIRET, schéma 0009). */
  id?: string;
  /** BT-61 — Identifiant d'enregistrement légal du bénéficiaire (ex. SIREN, schéma 0002). */
  legalId?: string;
  /** BT-60-1 — Identifiant global du bénéficiaire (`ram:GlobalID`, schéma ISO 6523). */
  globalId?: PartyIdentifier;
}
