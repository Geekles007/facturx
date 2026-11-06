/**
 * Le corps d'une requête, lu avec un plafond : une fonction ne garde pas en mémoire un envoi sans
 * limite avant de le refuser. L'en-tête `content-length`, quand il est là, refuse d'emblée ; les
 * octets sont comptés en lisant de toute façon, car l'en-tête peut manquer (envoi par morceaux).
 * Puis le JSON portable du Studio (octets en base64 balisé), dont chaque fonction vérifie les champs.
 */
import { fromPortableJson } from '../_vendor/shared/portable.ts';
import { anomalies, erreur } from './erreurs.ts';

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

export const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Un identifiant `uuid`, tel que Postgres l'admet : un autre texte ferait lever la requête. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Le corps `texte` en JSON portable, qui doit être un objet ; sinon lève 422 `ANOMALIES` (`Issue` de
 * code `CORPS`, chemin vide) sous `message`, que chaque fonction rédige selon ce que le refus laisse
 * intact.
 */
export function lireObjetPortable(texte: string, message: string): Record<string, unknown> {
  const refus = (detail: string) =>
    anomalies([{ code: 'CORPS', path: '', message: detail }], message);
  let corps: unknown;
  try {
    corps = fromPortableJson(texte);
  } catch {
    throw refus('Le corps n’est pas du JSON.');
  }
  if (!estObjet(corps)) throw refus('Objet attendu.');
  return corps;
}
