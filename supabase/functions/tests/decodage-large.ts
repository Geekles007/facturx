/**
 * Lancé par corps.test.ts sous un tas plafonné (`--max-old-space-size`) : passe à `lireObjetPortable`
 * des corps de 10 Mio dont le décodage par `JSON.parse` et son réviseur dépasse 256 Mo (mesuré :
 * `[{},…]` plus de 512 Mo, `[[0],…]` et `[{"a":0},…]` 320 Mo, 5,2 millions de `[` ouverts font
 * manquer de mémoire `JSON.parse` lui-même). Affiche le statut du refus de chacun, en JSON. Hors du
 * processus des tests : un décodage qui n'est pas refusé d'avance meurt ici, de mémoire, et non avec eux.
 */
import { lireObjetPortable, PLAFOND_CORPS } from '../_shared/corps.ts';

/** Un corps d'à peu près `PLAFOND_CORPS` caractères : l'objet `{"a":` puis `motif` répété. */
const corps = (ouvrant: string, motif: string, fermant: string): string => {
  const entete = `{"a":${ouvrant}`;
  const pied = `${fermant}}`;
  const n = Math.floor((PLAFOND_CORPS - entete.length - pied.length) / (motif.length + 1));
  return `${entete}${Array(n).fill(motif).join(',')}${pied}`;
};

const formes: Record<string, string> = {
  objets_vides: corps('[', '{}', ']'),
  tableaux_de_un: corps('[', '[0]', ']'),
  objets_de_un: corps('[', '{"a":0}', ']'),
  // 5,2 millions de `[` ouverts, sans jamais refermer.
  ouvrants: `{"a":${'['.repeat(PLAFOND_CORPS - 8)}`,
};

const statuts: Record<string, number | string> = {};
for (const [nom, texte] of Object.entries(formes)) {
  try {
    lireObjetPortable(texte, 'message');
    statuts[nom] = 'accepté';
  } catch (e) {
    statuts[nom] = e instanceof Response ? e.status : 'erreur';
  }
}
console.log(JSON.stringify(statuts));
