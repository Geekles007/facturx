/**
 * Les fichiers de l'entreprise que le PDF embarque (bucket privé `fichiers`, sous
 * `{entreprise_id}/<clé>`) : le logo et la police importée.
 *
 * Le type se vérifie par la signature des octets, jamais d'après l'extension ni d'après le type
 * annoncé à l'envoi, le seul que l'API Storage contrôle ; la taille, par les plafonds de la spec
 * (§ 11 : logo de 1 Mo, police de 2 Mo, en Mio comme la limite du bucket). Un fichier refusé est une
 * anomalie de l'apparence (422), pas une erreur du serveur.
 */
import { admin } from './db.ts';
import { anomalies } from './erreurs.ts';

type Attendu = 'png' | 'jpeg' | 'ttf';

const SIGNATURES: Record<Attendu, number[][]> = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpeg: [[0xff, 0xd8, 0xff]],
  // TrueType : la version 1.0 de la table, ou la balise `true` des polices Apple.
  ttf: [
    [0x00, 0x01, 0x00, 0x00],
    [0x74, 0x72, 0x75, 0x65],
  ],
};

const MIO = 1024 * 1024;
const PLAFONDS: Record<Attendu, number> = { png: MIO, jpeg: MIO, ttf: 2 * MIO };
const NOMS: Record<Attendu, string> = {
  png: 'une image PNG',
  jpeg: 'une image JPEG',
  ttf: 'une police TTF',
};

/**
 * Les clés que le Studio donne aux fichiers (`logo-…`, `font-…`) : un seul segment. Le client de
 * service passe outre la RLS : une clé `../<autre entreprise>/logo`, que l'URL normaliserait, lirait
 * le fichier d'une autre entreprise.
 */
const CLE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Les octets du fichier `cle` de l'entreprise, s'il est bien du type `attendu` et sous son plafond ;
 * sinon lève 422 `ANOMALIES` avec `[{ code: 'FICHIER', path: 'appearance.logo' }]` (ou
 * `appearance.customFont` pour une police).
 */
export async function lireFichier(
  entrepriseId: string,
  cle: string,
  attendu: Attendu,
): Promise<Uint8Array> {
  const path = attendu === 'ttf' ? 'appearance.customFont' : 'appearance.logo';
  const refus = (message: string) =>
    anomalies(
      [{ code: 'FICHIER', path, message }],
      'Un fichier de l’apparence est refusé : aucun numéro n’a été consommé.',
    );

  if (!CLE.test(cle)) throw refus(`Nom de fichier invalide : ${JSON.stringify(cle)}.`);
  const { data, error } = await admin().storage.from('fichiers').download(`${entrepriseId}/${cle}`);
  if (error) {
    const absent =
      (error as { statusCode?: unknown }).statusCode === '404' &&
      /object not found/i.test(error.message);
    if (absent) throw refus(`Fichier introuvable : ${cle}. Importez-le de nouveau.`);
    throw error;
  }
  if (data.size > PLAFONDS[attendu]) {
    throw refus(`Le fichier ${cle} dépasse ${PLAFONDS[attendu] / MIO} Mo.`);
  }
  const octets = new Uint8Array(await data.arrayBuffer());
  const reconnu = SIGNATURES[attendu].some((signature) =>
    signature.every((octet, i) => octets[i] === octet),
  );
  if (!reconnu) throw refus(`Le fichier ${cle} n’est pas ${NOMS[attendu]}.`);
  return octets;
}
