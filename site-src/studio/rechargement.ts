/**
 * Recharger la page quand un fragment du Studio (navigation, connexion, brouillons, émission) ne s'est
 * pas chargé. Un nouvel `import()` de la même adresse échouerait aussitôt, sans requête : le
 * navigateur garde l'échec. Seul un rechargement de la page le refait ; le message le propose.
 *
 * Dans le bundle principal : ce sont les fragments qui peuvent manquer, pas lui.
 */

import { t } from './i18n.js';
import { enregistrerMaintenant, toast } from './store.js';

/** Au-delà, le rechargement n'attend plus l'enregistrement : le miroir local garde la saisie. */
const ATTENTE_AVANT_RECHARGEMENT_MS = 5_000;

/**
 * Recharge la page, une fois partie la dernière frappe (attente bornée : en mode compte, la saisie
 * est aussi dans le miroir local, que le démarrage reprend).
 */
export async function rechargerLaPage(): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    enregistrerMaintenant().catch(() => false),
    new Promise((fin) => {
      minuterie = setTimeout(fin, ATTENTE_AVANT_RECHARGEMENT_MS);
    }),
  ]);
  clearTimeout(minuterie);
  location.reload();
}

/** Dit qu'un fragment ne s'est pas chargé (`texte` le nomme), et propose de recharger la page. */
export function fragmentNonCharge(texte: string): void {
  toast(texte, 'error', 15_000, {
    label: t.compte.conservation.rechargerPage,
    run: rechargerLaPage,
  });
}
