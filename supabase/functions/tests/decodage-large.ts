/**
 * Lancé par corps.test.ts sous un tas plafonné (`--max-old-space-size=256`, `--expose-gc`) : fait
 * passer à `lireObjetPortable` des corps de 10 Mio dont le décodage par `JSON.parse` et son réviseur
 * dépasse 256 Mo, puis la pire forme que les plafonds admettent, sur tout le chemin d'un corps :
 * décodage, contrôle des textes (`cheminInadmissible`, avec `controles` comme `relancer`) et
 * sérialisation. Affiche en JSON le statut du refus de chaque forme refusée, et pour la pire forme
 * admise ses nombres de conteneurs et de virgules, sa profondeur, sa taille et son tas final, avec et
 * sans ramasse-miettes forcé. Hors du processus des tests : un décodage qui n'est pas refusé d'avance,
 * ou une forme admise qui dépasse le tas, meurt ici, de mémoire, et non avec eux.
 *
 * Mesures (corps de 10 Mio, tas sous 256 Mo, avant les plafonds de conteneurs) : `[{},…]` plus de
 * 512 Mo, `[[0],…]` et `[{"a":0},…]` 320 Mo, 5,2 millions de `[` ouverts font manquer de mémoire
 * `JSON.parse` lui-même, et 300 000 chaînes de 16 tableaux imbriqués (9,7 Mio, 299 999 virgules)
 * aussi : les virgules comptent des voisins, non des conteneurs.
 */
import {
  cheminInadmissible,
  lireObjetPortable,
  OUVRANTS_MAX,
  PLAFOND_CORPS,
  PROFONDEUR_MAX,
  serialiser,
  VIRGULES_MAX,
} from '../_shared/corps.ts';

/** Un corps d'à peu près `PLAFOND_CORPS` caractères : l'objet `{"a":` puis `motif` répété. */
const corps = (ouvrant: string, motif: string, fermant: string): string => {
  const entete = `{"a":${ouvrant}`;
  const pied = `${fermant}}`;
  const n = Math.floor((PLAFOND_CORPS - entete.length - pied.length) / (motif.length + 1));
  return `${entete}${Array(n).fill(motif).join(',')}${pied}`;
};

/** Seize tableaux imbriqués, répétés : peu de virgules, des millions de conteneurs. */
const SEIZE = `${'['.repeat(16)}0${']'.repeat(16)}`;

/** Les corps refusés, produits à la demande : aucun ne reste en mémoire après son essai. */
const refusees: Record<string, () => string> = {
  objets_vides: () => corps('[', '{}', ']'),
  tableaux_de_un: () => corps('[', '[0]', ']'),
  objets_de_un: () => corps('[', '{"a":0}', ']'),
  // 300 000 chaînes de 16 tableaux : 9,7 Mio, 299 999 virgules, 4,8 millions de tableaux.
  chaines_de_seize: () => `{"a":[${Array(300_000).fill(SEIZE).join(',')}]}`,
  // 5,2 millions de `[` ouverts, sans jamais refermer.
  ouvrants: () => `{"a":${'['.repeat(PLAFOND_CORPS - 8)}`,
};

/**
 * La pire forme admise connue : celle qui atteint à la fois les quatre limites (profondeur, conteneurs,
 * virgules, 10 Mio), avec ce que la mesure a trouvé de plus lourd à chacune.
 *   - enfouie sous 62 tableaux, à `PROFONDEUR_MAX` : le moins de place pour le décodage et le contrôle,
 *     et, indentée, l'amplificateur de la sérialisation (350 000 lignes de jusqu'à 128 espaces : ≈ 86
 *     Mio que `jsonb` jette), d'où la sérialisation compacte de `serialiser` ;
 *   - `OUVRANTS_MAX` conteneurs, presque tous des `{"$bytes":"<16 caractères>"}` (un `Uint8Array` de
 *     12 octets chacun, la plus lourde des formes à ce nombre de conteneurs) ;
 *   - les virgules restantes en entrées de clé et de chaîne d'un dernier objet, dont une chaîne de
 *     remplissage qui amène le corps à 10 Mio ;
 *   - un caractère non latin dans la clé racine (`"€"`) : le texte reçu et le texte sérialisé passent
 *     à deux octets par caractère.
 * C'est la forme `pire_profond_gros` de la relecture.
 */
function pire(): {
  texte: string;
  conteneurs: number;
  virgules: number;
  profondeur: number;
  octets: number;
} {
  const tableaux = PROFONDEUR_MAX - 2;
  const nombre = OUVRANTS_MAX - tableaux - 2;
  const entrees = VIRGULES_MAX - nombre;
  const cles = Array.from({ length: entrees }, (_, i) => `"cle${i}":"valeur-${i}"`).join(',');
  const avant = `{"€":${'['.repeat(tableaux)}${Array(nombre).fill(OCTETS).join(',')},{"gros":"`;
  const apres = `",${cles}}${']'.repeat(tableaux)}}`;
  // `€` pèse trois octets en UTF-8 : 64 caractères de marge couvrent aussi cette différence.
  const remplissage = PLAFOND_CORPS - avant.length - apres.length - 64;
  const texte = `${avant}${'x'.repeat(remplissage)}${apres}`;
  // Chaînes sans crochet, accolade ni virgule : un compte du texte est exact.
  const compte = (c: string) => texte.split(c).length - 1;
  let profondeur = 0;
  let maximum = 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c === 0x5b || c === 0x7b) maximum = Math.max(maximum, ++profondeur);
    else if (c === 0x5d || c === 0x7d) profondeur--;
  }
  return {
    texte,
    conteneurs: compte('[') + compte('{'),
    virgules: compte(','),
    profondeur: maximum,
    octets: texte.length + 2,
  };
}

/** Un conteneur qui devient un `Uint8Array` de 12 octets : le plus lourd à vivre, mesuré. */
const OCTETS = '{"$bytes":"AAAAAAAAAAAAAAAA"}';

/** Le décodage, le contrôle des textes puis la sérialisation : ce que garde un corps jusqu'à la base. */
function traverser(texte: string): unknown[] {
  const valeur = lireObjetPortable(texte, 'message');
  if (cheminInadmissible(valeur, true) !== undefined) throw new Error('refusé');
  return [valeur, serialiser(valeur, 'form', 'CORPS', 'message')];
}

const mio = (octets: number) => Math.round(octets / 1024 / 1024);

// La pire forme admise d'abord, avant que les corps refusés n'aient laissé quoi que ce soit : le tas
// final est le sien (le texte reçu reste référencé ici, ce que le serveur ne fait pas : mesure par excès).
const { texte, conteneurs, virgules, profondeur, octets } = pire();
const gardes = traverser(texte);
const tas = mio(Deno.memoryUsage().heapUsed);
// @ts-expect-error : `gc` n'existe qu'avec `--expose-gc`.
gc();
const vivant = mio(Deno.memoryUsage().heapUsed);

const statuts: Record<string, number | string> = {};
for (const [nom, produire] of Object.entries(refusees)) {
  try {
    lireObjetPortable(produire(), 'message');
    statuts[nom] = 'accepté';
  } catch (e) {
    statuts[nom] = e instanceof Response ? e.status : 'erreur';
  }
}
console.log(
  JSON.stringify({
    refusees: statuts,
    pire: {
      conteneurs,
      virgules,
      profondeur,
      taille_Mio: Math.round((octets / 1024 / 1024) * 10) / 10,
      tas_Mio: tas,
      vivant_Mio: vivant,
      gardes: gardes.length,
    },
  }),
);
