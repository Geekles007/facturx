/**
 * Supprimer le compte en deux temps (spec § 12) : l'export d'abord, imposé, puis la demande, que
 * l'Edge Function `supprimer-compte` enregistre. Pendant les 30 jours de grâce, le compte ne sert
 * plus qu'à exporter et à annuler (`emettre`, `importer` et `relancer` répondent 403 `SUPPRESSION`,
 * et le Studio n'ouvre que l'écran d'annulation) ; au-delà, la purge de la nuit efface tout, et
 * l'annulation est refusée (409 `SUPPRESSION`).
 *
 * L'export qui ouvre la demande est celui de cette page, réussi : son téléchargement a été lancé
 * sans erreur (`telechargerExport` le retient ici). Un rechargement repart sans export.
 *
 * Chargé par `import()` avec le reste du compte ; `export.ts`, son propre fragment, y retient
 * l'export réussi.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { formatDate, t } from '../i18n.js';
import { store, ui } from '../store.js';
import { client } from './client.js';
import { reaction } from './erreurs.js';
import { aujourdhuiParis, sessionRefusee } from './suivi.js';

/** Le délai de grâce d'une suppression (spec § 12), en jours : celui de `supprimer-compte` et `purger`. */
export const DELAI_GRACE_JOURS = 30;

const JOUR_MS = 86_400_000;

/** La date de l'export réussi pendant cette session (ISO), s'il y en a eu un. */
let exportFaitLe: string | undefined;

/** Retient qu'un export vient d'aboutir : la suppression peut se demander. */
export function retenirExport(): void {
  exportFaitLe = new Date().toISOString();
}

/** Ce que cette session sait de l'export : sa date, s'il a abouti. */
export function exportDeLaSession(): { exportFaitLe?: string } {
  return exportFaitLe ? { exportFaitLe } : {};
}

/** Vrai seulement si un export a abouti pendant cette session : sans lui, pas de demande. */
export function peutSupprimer(etat: { exportFaitLe?: string | undefined }): boolean {
  return typeof etat.exportFaitLe === 'string' && etat.exportFaitLe !== '';
}

/** Le jour (à Paris, `AAAA-MM-JJ`) où la purge peut effacer le compte : 30 jours après la demande. */
export function datePurge(demandeeLe: string): string {
  return aujourdhuiParis(new Date(Date.parse(demandeeLe) + DELAI_GRACE_JOURS * JOUR_MS));
}

/** Le jour d'une date ISO, à Paris, dans la langue de l'interface. */
const jourDe = (iso: string): string => formatDate(aujourdhuiParis(new Date(iso)));

/** Le refus de `supprimer-compte`, en une phrase de l'interface. */
async function refus(erreur: unknown): Promise<Error> {
  const phrases = t.compte.suppression;
  if (!(erreur instanceof FunctionsHttpError)) return new Error(phrases.reseau);
  const http = erreur.context as Response;
  const lu: unknown = await http.json().catch(() => undefined);
  const corps = (typeof lu === 'object' && lu !== null ? lu : {}) as Record<string, unknown>;
  const code = typeof corps.code === 'string' ? corps.code : '';
  if (http.status === 401) {
    sessionRefusee(401);
    return new Error(phrases.session);
  }
  // Une annulation trop tardive : la purge a pu commencer.
  if (http.status === 409 && code === 'SUPPRESSION') {
    const details = corps.details as { suppressionDemandeeLe?: unknown } | undefined;
    const le = details?.suppressionDemandeeLe;
    const date = typeof le === 'string' && !Number.isNaN(Date.parse(le)) ? jourDe(le) : '';
    return new Error(phrases.tropTard(date));
  }
  // Une panne hors de la fonction (passerelle, worker arrêté) ne dit rien de plus qu'une absence.
  if (http.status >= 500 && code !== 'INTERNE') return new Error(phrases.reseau);
  const r = reaction(http.status, {
    code,
    message: typeof corps.message === 'string' ? corps.message : '',
    details: corps.details,
  });
  return new Error(r.kind === 'message' ? r.texte : t.compte.erreurs.inconnue);
}

/**
 * Appelle `supprimer-compte` ; rend la date de la demande en vigueur après l'appel, ou rien. Lève
 * une erreur dont le message est la phrase de l'interface.
 */
async function supprimerCompte(action: 'demander' | 'annuler'): Promise<string | undefined> {
  let reponse: { data: unknown; error: unknown };
  try {
    reponse = await client().functions.invoke('supprimer-compte', { body: { action } });
  } catch {
    throw new Error(t.compte.suppression.reseau);
  }
  if (reponse.error) throw await refus(reponse.error);
  const le = (reponse.data as { suppressionDemandeeLe?: unknown } | null)?.suppressionDemandeeLe;
  const date = typeof le === 'string' ? le : undefined;
  const compte = store.get().ui.compte;
  if (compte) ui({ compte: { ...compte, suppressionDemandeeLe: date } });
  return date;
}

/**
 * Demande la suppression du compte : rend sa date (une seconde demande ne la repousse pas). À
 * n'appeler qu'après un export réussi (`peutSupprimer`), et la confirmation de l'utilisateur.
 */
export async function demanderSuppression(): Promise<string> {
  const date = await supprimerCompte('demander');
  if (!date) throw new Error(t.compte.erreurs.inconnue);
  return date;
}

/** Annule la suppression demandée ; passé 30 jours, le serveur refuse, et l'erreur le dit. */
export async function annulerSuppression(): Promise<void> {
  await supprimerCompte('annuler');
}
