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

/** Longueur au-delà de laquelle un chemin rendu à l'expéditeur est tronqué. */
const CHEMIN_MAX = 200;

/** Un texte que `jsonb` et `text` de Postgres enregistrent : ni caractère nul, ni demi-substitut isolé. */
const admissible = (texte: string): boolean => !texte.includes('\u0000') && texte.isWellFormed();

/** Un nœud de la valeur parcourue ; le chemin ne se construit que si on en a besoin. */
interface Noeud {
  valeur: unknown;
  parent: Noeud | undefined;
  segment: string;
}

function cheminDe(noeud: Noeud): string {
  const segments: string[] = [];
  for (let n: Noeud | undefined = noeud; n; n = n.parent) segments.push(n.segment);
  const chemin = segments.reverse().join('');
  return chemin.length > CHEMIN_MAX ? `${chemin.slice(0, CHEMIN_MAX)}…` : chemin;
}

/**
 * Le chemin (`.acheteur.noms[1]`) du premier texte de `valeur`, valeur ou clé, que Postgres ne
 * saurait enregistrer en `jsonb` : un caractère nul (`\u0000`) ou un demi-substitut isolé. Le JSON
 * les porte sans broncher (`&#0;` d'un XML, `\u0000` d'un corps), la base les refuse : une erreur du
 * serveur (500) pour une demande qu'un refus 422 explique. Pour une clé fautive, le chemin est celui
 * de l'objet qui la porte. Les octets (`Uint8Array`, rendus en base64) sont sans objet.
 *
 * Le parcours est itératif : un corps de 10 Mio peut imbriquer des milliers de niveaux, qu'une récursion
 * ne tiendrait pas. `undefined` : rien à refuser.
 */
export function cheminInadmissible(racine: unknown): string | undefined {
  const pile: Noeud[] = [{ valeur: racine, parent: undefined, segment: '' }];
  for (let noeud = pile.pop(); noeud; noeud = pile.pop()) {
    const { valeur } = noeud;
    if (typeof valeur === 'string') {
      if (!admissible(valeur)) return cheminDe(noeud);
    } else if (Array.isArray(valeur)) {
      // Empilés à rebours : le premier élément sort le premier.
      for (let i = valeur.length - 1; i >= 0; i--) {
        pile.push({ valeur: valeur[i], parent: noeud, segment: `[${i}]` });
      }
    } else if (estObjet(valeur) && !(valeur instanceof Uint8Array)) {
      const entrees = Object.entries(valeur);
      if (entrees.some(([cle]) => !admissible(cle))) return cheminDe(noeud);
      for (let i = entrees.length - 1; i >= 0; i--) {
        pile.push({ valeur: entrees[i][1], parent: noeud, segment: `.${entrees[i][0]}` });
      }
    }
  }
  return undefined;
}

/**
 * Lève 422 `ANOMALIES` (`Issue` de code `code`, sous `message`) si `valeur` porte un texte que
 * `cheminInadmissible` refuse. `prefixe` précède le chemin dans `path` (`form` donne `form.note`) ; il
 * est vide pour une valeur dont les chemins se lisent depuis sa racine (la facture : `buyer.name`).
 * À appeler sur tout ce qui ira en `jsonb` ou en `text`, avant de prendre un verrou ou de déposer un
 * fichier.
 */
export function exigerAdmissible(
  valeur: unknown,
  prefixe: string,
  code: string,
  message: string,
): void {
  const chemin = cheminInadmissible(valeur);
  if (chemin === undefined) return;
  throw anomalies(
    [
      {
        code,
        path: `${prefixe}${chemin}`.replace(/^\./, ''),
        message:
          'Le texte contient un caractère nul ou un demi-substitut isolé, que la base refuse.',
      },
    ],
    message,
  );
}
