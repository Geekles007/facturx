/**
 * L'adresse du destinataire d'une relance, partagée entre le Studio et l'Edge Function `relancer` :
 * le Studio n'active « Envoyer » que sur ce qu'elle admet, et la fonction refuse le reste (422
 * `DESTINATAIRE`). Une seule règle, des deux côtés.
 *
 * Le module n'importe rien. `pnpm compte:preparer` le copie tel quel pour Deno, qui ne résout pas
 * un `./x.js` vers `./x.ts` comme esbuild ou vitest.
 */

/** Un segment de la partie locale d'une adresse : le sous-ensemble courant de la RFC 5322. */
const ATOME = "[A-Za-z0-9_%+'&=-]+";
const PARTIE_LOCALE = new RegExp(`^${ATOME}(?:\\.${ATOME})*$`);
const ETIQUETTE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SUFFIXE = /^(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]+)$/;

/**
 * Une seule adresse `local@domaine.suffixe` : ni espace, ni virgule, ni point-virgule, ni retour à la
 * ligne, ni chevron ni guillemet (rien qui nomme une deuxième adresse ou un en-tête), un domaine d'au
 * moins deux étiquettes, ASCII (un domaine accentué s'écrit en `xn--`). 254 caractères au plus, 64
 * pour la partie locale. L'adresse est jugée telle quelle : à l'appelant de la rogner s'il le veut.
 */
export function destinataireValide(adresse: string): boolean {
  if (adresse.length > 254) return false;
  const arobase = adresse.indexOf('@');
  if (arobase < 1 || arobase !== adresse.lastIndexOf('@')) return false;
  const local = adresse.slice(0, arobase);
  const etiquettes = adresse.slice(arobase + 1).split('.');
  return (
    local.length <= 64 &&
    PARTIE_LOCALE.test(local) &&
    etiquettes.length >= 2 &&
    etiquettes.every((etiquette) => ETIQUETTE.test(etiquette)) &&
    SUFFIXE.test(etiquettes[etiquettes.length - 1] as string)
  );
}
