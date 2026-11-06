/**
 * Ce que le Studio fait d'un refus des Edge Functions (spec § 13). Chaque réponse
 * `{ code, message, details? }` devient une réaction : renvoyer à la connexion, dire quelque chose,
 * recharger le brouillon, ouvrir l'onglet Contrôle sur les anomalies, ou indiquer les dates admises.
 *
 * Les phrases sont celles de l'interface (`i18n.ts`), jamais le `message` du serveur, qui n'est
 * qu'en français ; les détails utiles (dates, numéro, identifiant de requête, heure) y passent. Un
 * code inconnu, ou des détails mal formés, donnent un message générique : jamais une exception.
 * Chaque parcours (émettre, relancer, importer) dit en plus ce que le refus laisse intact.
 */

import type { Issue as IssueDuSdk } from 'facturx-sdk';
import { t } from '../i18n.js';

/**
 * Une anomalie au format des `Issue` du SDK, que le serveur rend dans `details` (422) ; il y ajoute
 * ses propres codes (`CORPS`, `ORIGINE`, `FICHIER`…) et des chemins hors de la facture
 * (`appearance.*`, `brouillonId`, `''`).
 */
export type Issue = Pick<IssueDuSdk, 'path' | 'message'> & { code: string };

export type Reaction =
  | { kind: 'connexion' }
  | { kind: 'message'; texte: string }
  | { kind: 'recharger'; texte: string }
  | { kind: 'controle'; issues: Issue[] }
  | { kind: 'date'; min?: string; max: string };

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Le champ texte `cle` des détails, s'il y en a un. */
function texteDe(details: unknown, cle: string): string | undefined {
  const valeur = estObjet(details) ? details[cle] : undefined;
  return typeof valeur === 'string' && valeur !== '' ? valeur : undefined;
}

/** Les anomalies lisibles de `details` ; une entrée qui n'a pas la forme d'une `Issue` est écartée. */
function anomalies(details: unknown): Issue[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((d): Issue[] =>
    estObjet(d) &&
    typeof d.code === 'string' &&
    typeof d.path === 'string' &&
    typeof d.message === 'string'
      ? [{ code: d.code, path: d.path, message: d.message }]
      : [],
  );
}

/** L'heure de la fin d'attente (`reessayerApres`, ISO), dans la langue de l'interface. */
function heure(details: unknown): string | undefined {
  const iso = texteDe(details, 'reessayerApres');
  const date = iso ? new Date(iso) : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString(t.lang === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** La réaction du Studio au refus `corps`, de statut `statut`. Ne lève jamais. */
export function reaction(
  statut: number,
  corps: { code: string; message: string; details?: unknown },
): Reaction {
  const phrases = t.compte.erreurs;
  const message = (texte: string): Reaction => ({ kind: 'message', texte });
  const { code, details } = corps;
  if (statut === 401 || code === 'SESSION') return { kind: 'connexion' };
  // Le corps trop grand (`ANOMALIES`, chemin vide) : ce qui se corrige, ce sont les pièces jointes.
  if (statut === 413) return message(phrases.tropGros);
  switch (code) {
    case 'NON_CONFIRME':
      return message(phrases.nonConfirme);
    case 'SUPPRESSION':
      return message(phrases.suppression);
    case 'DROITS':
      return message(phrases.droits);
    case 'BROUILLON_MODIFIE':
      return { kind: 'recharger', texte: phrases.brouillonModifie };
    case 'DATE': {
      const max = texteDe(details, 'max');
      const min = texteDe(details, 'min');
      if (!max || !DATE_ISO.test(max)) return message(phrases.date);
      return min && DATE_ISO.test(min) ? { kind: 'date', min, max } : { kind: 'date', max };
    }
    case 'DOUBLON':
      return message(phrases.doublon(texteDe(details, 'numero') ?? ''));
    case 'PDF_DEJA_DEPOSE':
      return message(phrases.pdfDejaDepose);
    case 'ANOMALIES':
      return { kind: 'controle', issues: anomalies(details) };
    case 'LIMITE':
      return message(phrases.limite(heure(details)));
    case 'ENVOI':
      return message(phrases.envoi);
    case 'INTERNE':
      return message(phrases.interne(texteDe(details, 'requete')));
    default:
      return message(phrases.inconnue);
  }
}
