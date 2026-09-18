/**
 * Décompte des contrôles.
 *
 * Le validateur s'exécute entièrement dans le navigateur : sans cet appel, rien ne dirait s'il
 * sert à quelqu'un. Ce qui part tient donc tout entier dans la requête elle-même — son chemin,
 * et rien d'autre : aucun octet du fichier, aucun nom, aucun verdict, aucun cookie, aucun
 * identifiant. Le serveur répond 204, sans corps, et n'en garde qu'une ligne de journal dont
 * l'adresse est déjà tronquée à l'écriture (docker/nginx.conf).
 *
 * Le compteur n'est pas le service rendu : il échoue en silence plutôt que de gêner un contrôle.
 */

/**
 * Chemin du compteur, résolu comme les autres ressources du validateur : la page anglaise partage
 * celles de la page française, les deux comptent donc au même endroit, sous un seul chemin.
 */
export const CHEMIN_COMPTEUR = 'compteur/controle';

/**
 * Signale un contrôle de plus. À appeler une fois par fichier soumis, quel qu'en soit le sort :
 * un fichier illisible a tout autant servi l'outil qu'une facture conforme.
 */
export function compterControle(url: string, fetcher: typeof fetch = fetch): void {
  try {
    // `no-store` : une réponse gardée en cache ne repasserait pas par le journal, donc ne
    // compterait pas le contrôle suivant. Le serveur pose la même consigne de son côté.
    void fetcher(url, { method: 'GET', cache: 'no-store', keepalive: true }).catch(() => {
      // Réseau coupé, requête bloquée : un contrôle non compté ne vaut pas un message d'erreur.
    });
  } catch {
    // Même chose pour un `fetch` absent ou entravé : le contrôle passe avant le décompte.
  }
}
