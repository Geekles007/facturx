/**
 * Le corps d'une requête, lu avec un plafond : une fonction ne garde pas en mémoire un envoi sans
 * limite avant de le refuser. L'en-tête `content-length`, quand il est là, refuse d'emblée ; les
 * octets sont comptés en lisant de toute façon, car l'en-tête peut manquer (envoi par morceaux).
 */
import { erreur } from './erreurs.ts';

/** 10 Mio : bien au-delà d'une facture et de ses pièces jointes ordinaires. */
export const PLAFOND_CORPS = 10 * 1024 * 1024;

function tropGros(plafond: number): Response {
  const mio = Math.round((plafond / (1024 * 1024)) * 10) / 10;
  return erreur(413, 'ANOMALIES', `La requête dépasse ${mio} Mo.`, [
    { code: 'CORPS', path: '', message: `Le corps de la requête dépasse ${mio} Mo.` },
  ]);
}

/** Le corps de `req` en texte UTF-8 ; lève 413 `ANOMALIES` (`Issue` de code `CORPS`) au-delà de `plafond`. */
export async function lireTexte(req: Request, plafond = PLAFOND_CORPS): Promise<string> {
  const annonce = Number(req.headers.get('content-length'));
  if (Number.isFinite(annonce) && annonce > plafond) throw tropGros(plafond);
  if (!req.body) return '';

  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > plafond) {
      await lecteur.cancel();
      throw tropGros(plafond);
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    octets.set(morceau, position);
    position += morceau.byteLength;
  }
  return new TextDecoder().decode(octets);
}
