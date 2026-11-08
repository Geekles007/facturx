/**
 * Lancé par corps.test.ts sous un tas plafonné (`--max-old-space-size`) : parcourt, par
 * `cheminInadmissible`, un tableau de 5 millions d'éléments, ce qu'un corps de 10 Mio peut porter, une
 * fois propre et une fois fautif au dernier élément. Affiche les deux chemins, en JSON. Hors du processus
 * des tests : un parcours qui empile ses éléments meurt ici, de mémoire, et non avec eux.
 */
import { cheminInadmissible } from '../_shared/corps.ts';

const elements: unknown[] = new Array(5_000_000).fill(0);
const corps = { form: { a: elements } };
const propre = cheminInadmissible(corps) ?? null;
elements[elements.length - 1] = 'x\u0000';
const fautif = cheminInadmissible(corps) ?? null;
console.log(JSON.stringify({ propre, fautif }));
