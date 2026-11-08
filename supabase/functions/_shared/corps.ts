/**
 * Le corps d'une requête, lu avec un plafond : une fonction ne garde pas en mémoire un envoi sans
 * limite avant de le refuser. L'en-tête `content-length`, quand il est là, refuse d'emblée ; les
 * octets sont comptés en lisant de toute façon, car l'en-tête peut manquer (envoi par morceaux).
 * Puis le JSON portable du Studio (octets en base64 balisé), dont chaque fonction vérifie les champs.
 */
import { fromPortableJson, toPortableJson } from '../_vendor/shared/portable.ts';
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

/** Niveaux d'imbrication d'un corps JSON, au plus (voir `examinerJson`). */
export const PROFONDEUR_MAX = 64;

/** Tableaux et objets d'un corps JSON, au plus (voir `examinerJson`). */
export const OUVRANTS_MAX = 100_000;

/** Virgules hors chaînes d'un corps JSON, au plus : éléments et entrées (voir `examinerJson`). */
export const VIRGULES_MAX = 150_000;

/**
 * Examine le texte d'un corps JSON avant de le décoder, en une passe et en mémoire constante : trois
 * plafonds, hors chaînes. Les chaînes sont sautées, avec leurs échappements : un guillemet précédé d'une
 * barre oblique ne la ferme pas, et une barre échappée par une autre ne protège pas le guillemet qui
 * suit. Rend le motif du refus, ou `undefined`. Le texte n'est pas vérifié pour autant : `JSON.parse`
 * le fera.
 *
 * Ce que chaque plafond borne :
 *   - `PROFONDEUR_MAX`, les `[` et `{` ouverts à la fois : la pile du décodage et des parcours
 *     ultérieurs ;
 *   - `OUVRANTS_MAX`, tous les `[` et `{` du corps : le nombre de tableaux et d'objets décodés, la
 *     mémoire que `JSON.parse` leur donne (un tableau ou un objet vide coûte une centaine d'octets,
 *     `{"$bytes":""}`, que le réviseur change en `Uint8Array`, six fois plus). Les virgules n'y
 *     suffisent pas : le premier enfant d'un conteneur n'en a pas, et 300 000 chaînes de 16 tableaux
 *     imbriqués (9,7 Mio, 299 999 virgules, 4,8 millions de tableaux) épuisent 256 Mo ;
 *   - `VIRGULES_MAX`, les éléments et les entrées : le nombre de valeurs, de clés et de textes (une
 *     entrée de clé et de chaîne coûte près de 500 octets, tout compris).
 *
 * Pourquoi : `JSON.parse` avec un réviseur (ce que fait `fromPortableJson`) coûte bien plus que le
 * texte. Mesuré sous `--max-old-space-size=256`, la limite des fonctions hébergées, sur un corps de
 * 10 Mio : `[{},…]` dépasse 512 Mo, `[[0],…]` et `[{"a":0},…]` 320 Mo, et 5,2 millions de `[` ouverts
 * font manquer de mémoire `JSON.parse` lui-même. Un worker sert plusieurs requêtes : celui qui meurt
 * emporte les autres.
 *
 * Les plafonds sont choisis par la mesure, non par la taille des corps. La pire forme admise connue
 * (tests/decodage-large.ts) atteint les quatre limites à la fois : 10 Mio, 64 niveaux (enfouie sous 62
 * tableaux), 100 000 conteneurs (presque tous des `{"$bytes":"<16 caractères>"}`), 150 000 virgules
 * (entrées de clé et de chaîne, et une chaîne de remplissage), et un caractère non latin dans la clé
 * racine, qui met le texte reçu et le texte sérialisé à deux octets par caractère. Elle traverse le
 * décodage, le contrôle des textes et la sérialisation avec 74 Mio de tas vivant (après un
 * ramasse-miettes forcé) et 128 Mio au plus à la fin ; le plus petit tas sous lequel elle passe est de
 * 88 Mio, pour les 256 Mo des fonctions hébergées. Le test exige moins de 140 Mio vivants et 200 Mio à
 * la fin. Un balayage de 62 formes (profondeurs, échelles de 40 à 100 % des plafonds, caractères
 * échappés, octets, chaînes et clés longues) n'en trouve pas de plus lourde : au plus 74 Mio vivants.
 *
 * La sérialisation est compacte (`serialiser`) : indentée de deux espaces, à 64 niveaux, 350 000
 * lignes portent jusqu'à 128 espaces, près de 90 Mio de texte que `jsonb` jette, et la même forme
 * montait à 160 Mio vivants (165 Mio au plus petit tas qui passe). `jsonb` stocke les deux textes à
 * l'identique.
 *
 * La marge est large pour une facture réelle : une ligne de la facture d'essai compte 2 conteneurs et
 * 8,5 virgules ; en comptant 5 conteneurs et 25 virgules par ligne, une facture tient jusqu'à 6 000
 * lignes (150 000 virgules), 20 000 par les conteneurs. La profondeur utile (corps, facture, lignes,
 * ligne, taxe, …) tient en une dizaine de niveaux.
 */
function examinerJson(texte: string): string | undefined {
  let profondeur = 0;
  let ouvrants = 0;
  let virgules = 0;
  let dansUneChaine = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (dansUneChaine) {
      if (c === 0x5c) {
        // Barre oblique : le caractère suivant est échappé.
        i++;
      } else if (c === 0x22) {
        dansUneChaine = false;
      }
    } else if (c === 0x22) {
      dansUneChaine = true;
    } else if (c === 0x5b || c === 0x7b) {
      if (++profondeur > PROFONDEUR_MAX) {
        return `Le corps est imbriqué sur plus de ${PROFONDEUR_MAX} niveaux.`;
      }
      if (++ouvrants > OUVRANTS_MAX) {
        return `Le corps compte plus de ${OUVRANTS_MAX} tableaux et objets.`;
      }
    } else if (c === 0x5d || c === 0x7d) {
      // Un fermant sans ouvrant n'est pas du JSON : `JSON.parse` le refusera ; il ne doit pas faire
      // gagner de la place à ce qui suit.
      if (profondeur > 0) profondeur--;
    } else if (c === 0x2c && ++virgules > VIRGULES_MAX) {
      return `Le corps compte plus de ${VIRGULES_MAX} éléments.`;
    }
  }
  return undefined;
}

/**
 * Le corps `texte` en JSON portable, qui doit être un objet ; sinon lève 422 `ANOMALIES` (`Issue` de
 * code `CORPS`, chemin vide) sous `message`, que chaque fonction rédige selon ce que le refus laisse
 * intact. Un corps trop profond ou trop large est refusé avant d'être décodé (`examinerJson`) : toute
 * fonction qui lit un corps JSON passe par ici.
 */
export function lireObjetPortable(texte: string, message: string): Record<string, unknown> {
  const refus = (detail: string) =>
    anomalies([{ code: 'CORPS', path: '', message: detail }], message);
  const exces = examinerJson(texte);
  if (exces !== undefined) throw refus(exces);
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

/** Un caractère de contrôle C0 hors tabulation, saut de ligne et retour chariot (le NUL en est un). */
function aDesControles(texte: string): boolean {
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

/**
 * Un texte que `jsonb` et `text` de Postgres enregistrent : ni caractère nul, ni demi-substitut isolé.
 * `controles` : refuse aussi les autres caractères de contrôle C0 (hors `\t`, `\n`, `\r`), pour un texte
 * qui part dans un e-mail.
 */
const admissible = (texte: string, controles: boolean): boolean =>
  !texte.includes('\u0000') && texte.isWellFormed() && !(controles && aDesControles(texte));

/**
 * Un cadre du parcours : un tableau ou un objet en cours de lecture, à l'enfant `i`. Le parcours ne
 * garde qu'un cadre par niveau d'imbrication, jamais un par élément : sa mémoire suit la profondeur.
 */
interface Cadre {
  conteneur: unknown[] | Record<string, unknown>;
  /** Les clés d'un objet ; `undefined` pour un tableau. */
  cles: string[] | undefined;
  /** Le prochain enfant à lire. */
  i: number;
  parent: Cadre | undefined;
  /** Le segment de chemin qui mène à ce conteneur depuis son parent (`.a`, `[2]`). */
  segment: string;
}

const segmentDe = (cles: string[] | undefined, i: number): string =>
  cles ? `.${cles[i]}` : `[${i}]`;

/** Le chemin de l'enfant n° `i` de `cadre` ; celui de `cadre` lui-même : l'enfant de son parent. */
function cheminDe(cadre: Cadre | undefined, segment: string): string {
  const segments = [segment];
  for (let c = cadre; c; c = c.parent) segments.push(c.segment);
  const chemin = segments.reverse().join('');
  return chemin.length > CHEMIN_MAX ? `${chemin.slice(0, CHEMIN_MAX)}…` : chemin;
}

/**
 * Le cadre de `valeur`, enfant n° `i` de `parent` ; `undefined` si ce n'est ni un tableau ni un objet
 * (ni des octets). Le segment de chemin ne se compose que pour un conteneur : une chaîne par élément,
 * pour des millions d'éléments, remplirait le tas.
 */
function ouvrir(valeur: unknown, parent: Cadre | undefined, i: number): Cadre | undefined {
  const tableau = Array.isArray(valeur);
  if (!tableau && !(estObjet(valeur) && !(valeur instanceof Uint8Array))) return undefined;
  return {
    conteneur: valeur as unknown[] | Record<string, unknown>,
    cles: tableau ? undefined : Object.keys(valeur as object),
    i: 0,
    parent,
    segment: parent ? segmentDe(parent.cles, i) : '',
  };
}

/**
 * Le chemin (`.acheteur.noms[1]`) du premier texte de `valeur`, valeur ou clé, que Postgres ne
 * saurait enregistrer en `jsonb` : un caractère nul (`\u0000`) ou un demi-substitut isolé. Le JSON
 * les porte sans broncher (`&#0;` d'un XML, `\u0000` d'un corps), la base les refuse : une erreur du
 * serveur (500) pour une demande qu'un refus 422 explique. Pour une clé fautive, le chemin est celui
 * de l'objet qui la porte. Les octets (`Uint8Array`, rendus en base64) sont sans objet.
 *
 * Le parcours est itératif et paresseux : un corps de 10 Mio peut imbriquer des milliers de niveaux,
 * qu'une récursion ne tiendrait pas, ou compter des millions d'éléments, qu'on ne saurait empiler (le
 * tas des fonctions hébergées est de 256 Mo). Il ne garde qu'un cadre par niveau et n'empile aucune
 * primitive ; le chemin ne se construit qu'au refus. `undefined` : rien à refuser. `controles` : refuse
 * aussi les autres caractères de contrôle C0, hors tabulation, saut de ligne et retour chariot (un
 * texte qui part dans un e-mail).
 */
export function cheminInadmissible(racine: unknown, controles = false): string | undefined {
  if (typeof racine === 'string') return admissible(racine, controles) ? undefined : '';
  const mauvaiseCle = (cadre: Cadre) => cadre.cles?.some((cle) => !admissible(cle, controles));
  let cadre = ouvrir(racine, undefined, 0);
  if (cadre && mauvaiseCle(cadre)) return '';
  while (cadre) {
    const { cles, conteneur } = cadre;
    if (cadre.i >= (cles ? cles.length : (conteneur as unknown[]).length)) {
      cadre = cadre.parent;
      continue;
    }
    const i = cadre.i++;
    const enfant = cles
      ? (conteneur as Record<string, unknown>)[cles[i]]
      : (conteneur as unknown[])[i];
    if (typeof enfant === 'string') {
      if (!admissible(enfant, controles)) return cheminDe(cadre, segmentDe(cles, i));
      continue;
    }
    const ouvert = ouvrir(enfant, cadre, i);
    if (!ouvert) continue;
    // Une clé fautive : le chemin de l'objet qui la porte.
    if (mauvaiseCle(ouvert)) return cheminDe(ouvert.parent, ouvert.segment);
    cadre = ouvert;
  }
  return undefined;
}

/**
 * Lève 422 `ANOMALIES` (`Issue` de code `code`, sous `message`) si `valeur` porte un texte que
 * `cheminInadmissible` refuse. `prefixe` précède le chemin dans `path` (`form` donne `form.note`) ; il
 * est vide pour une valeur dont les chemins se lisent depuis sa racine (la facture : `buyer.name`).
 * À appeler sur tout ce qui ira en `jsonb` ou en `text`, avant de prendre un verrou ou de déposer un
 * fichier. `controles` : voir `cheminInadmissible`.
 */
export function exigerAdmissible(
  valeur: unknown,
  prefixe: string,
  code: string,
  message: string,
  controles = false,
): void {
  const chemin = cheminInadmissible(valeur, controles);
  if (chemin === undefined) return;
  throw anomalies(
    [
      {
        code,
        path: `${prefixe}${chemin}`.replace(/^\./, ''),
        message: controles
          ? 'Le texte contient un caractère de contrôle (hors tabulation et saut de ligne) ou un demi-substitut isolé.'
          : 'Le texte contient un caractère nul ou un demi-substitut isolé, que la base refuse.',
      },
    ],
    message,
  );
}

/**
 * `valeur` en JSON portable, compact : le texte que l'appelant garde pour l'enregistrer en `jsonb`, qui
 * jette l'indentation (voir `examinerJson` pour ce qu'elle coûte en mémoire). Sérialisé une fois, ici,
 * sous `try` : `toPortableJson` lève (`RangeError`) au-delà de quelque 2 700 niveaux,
 * et le même appel fait plus tard, dans la transaction, serait une erreur du serveur après le dépôt du
 * PDF. Un corps reçu n'en approche pas (`lireObjetPortable` plafonne la profondeur à
 * `PROFONDEUR_MAX`), mais la facture validée peut porter ce que le SDK laisse passer : ce n'est
 * que la défense de second rang. Sérialisation impossible : 422 `ANOMALIES` (`Issue` de code `code`
 * et de chemin `path`, sous `message`).
 */
export function serialiser(valeur: unknown, path: string, code: string, message: string): string {
  try {
    return toPortableJson(valeur, { compact: true });
  } catch {
    throw anomalies(
      [
        {
          code,
          path,
          message: 'Cette valeur ne peut pas être écrite en JSON pour être enregistrée.',
        },
      ],
      message,
    );
  }
}
