import type { ElectronicAddress } from './types/party.js';

/** BR-FR-23 / BR-FR-24 — caractères autorisés dans une adresse 0225 et un code de routage 0224. */
export const ROUTING_CHARS = /^[A-Za-z0-9._-]+$/;
/** BR-FR-25 — longueur maximale d'une adresse électronique. */
export const ELECTRONIC_ADDRESS_MAX_LENGTH = 125;
/** BR-FR-26 — longueur maximale d'un code de routage. */
export const ROUTING_CODE_MAX_LENGTH = 100;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adresse électronique française (schéma `0225`) : `SIREN` ou `SIREN_XXX` (BR-FR-12/13).
 * Le suffixe identifie un service ou un site chez le destinataire.
 */
export function electronicAddress0225(siren: string, suffix?: string): ElectronicAddress {
  return {
    value: suffix === undefined || suffix === '' ? siren : `${siren}_${suffix}`,
    scheme: '0225',
  };
}

/** Format d'une adresse e-mail (schéma `EM`), contrôle structurel. */
export function isValidEmailAddress(value: string): boolean {
  return EMAIL.test(value);
}
