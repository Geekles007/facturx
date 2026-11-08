/**
 * Les pages publiées du site : copie `site/` (bundles construits compris) dans un dossier, celui que
 * l'image sert (Dockerfile), en n'y laissant parler du compte que si le site en offre un (Ruling 66) :
 *
 *   node scripts/publier-site.mjs <dossier>
 *
 * Le compte est offert quand FACTURX_SUPABASE_URL et FACTURX_SUPABASE_KEY sont tous deux renseignés :
 * la règle est celle du Studio (`compteActif`, compte/session.ts), à qui la construction les donne.
 * Les pages de `site/` sont écrites pour un site avec compte, et marquées :
 *   - `data-compte` : l'élément ne vaut que pour le compte (un bloc, une phrase, un lien vers les CGU) ;
 *     sans compte, il disparaît avec son contenu ;
 *   - `data-sans-compte` : la variante d'un élément pour un site sans compte (un intitulé, une
 *     description) ; avec un compte, elle disparaît. `site/style.css` la cache dans les pages telles
 *     que le dépôt les sert, en développement.
 * La marque qui reste est retirée des pages publiées. Sans compte, les pages `cgu/` et
 * `sous-traitance/` (français et anglais) ne sont pas publiées non plus, et la publication échoue si
 * une page publiée y mène encore. `site/README.md` n'est jamais publié. Le dossier `site/` n'est
 * jamais modifié.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les pages qui n'existent que pour le compte, retirées d'un site qui n'en offre pas. */
export const PAGES_DU_COMPTE = ['cgu', 'sous-traitance', 'en/cgu', 'en/sous-traitance'];

/** Les éléments HTML sans fermeture : la marque n'y retire que la balise. */
const VIDES = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'wbr']);

/** Le site offre-t-il un compte ? Les deux variables, comme le Studio. */
export function compteOffert(env = process.env) {
  return (
    (env.FACTURX_SUPABASE_URL?.trim() ?? '') !== '' &&
    (env.FACTURX_SUPABASE_KEY?.trim() ?? '') !== ''
  );
}

/** La position juste après la balise fermante de l'élément `nom` ouvert avant `depuis`. */
function finDeLElement(html, nom, depuis) {
  const balise = new RegExp(`<(/?)${nom}(?=[\\s>/])[^>]*>`, 'gi');
  balise.lastIndex = depuis;
  let profondeur = 1;
  for (let m = balise.exec(html); m; m = balise.exec(html)) {
    profondeur += m[1] ? -1 : 1;
    if (profondeur === 0) return m.index + m[0].length;
  }
  throw new Error(`<${nom}> marqué sans balise fermante`);
}

/**
 * Retire de `html` chaque élément qui porte l'attribut `marque`, avec son contenu ; s'il occupe seul
 * sa ligne, la ligne part avec lui.
 */
function retirer(html, marque) {
  const ouvrante = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\s${marque}(?=[\\s/>])[^>]*>`);
  let texte = html;
  for (let m = ouvrante.exec(texte); m; m = ouvrante.exec(texte)) {
    const nom = m[1].toLowerCase();
    let debut = m.index;
    let fin = VIDES.has(nom)
      ? m.index + m[0].length
      : finDeLElement(texte, nom, m.index + m[0].length);
    // Seul sur sa ligne : la ligne entière, fin de ligne comprise (celle d'avant, en dernière ligne).
    const avant = texte.lastIndexOf('\n', debut - 1) + 1;
    const apres = texte.indexOf('\n', fin);
    if (
      /^\s*$/.test(texte.slice(avant, debut)) &&
      /^\s*$/.test(texte.slice(fin, apres === -1 ? texte.length : apres))
    ) {
      debut = apres === -1 ? Math.max(avant - 1, 0) : avant;
      fin = apres === -1 ? texte.length : apres + 1;
    }
    texte = texte.slice(0, debut) + texte.slice(fin);
  }
  return texte;
}

/** Retire la marque `marque` des balises qui la portent, en gardant l'élément. */
const sansMarque = (html, marque) => html.replace(new RegExp(`\\s${marque}(?=[\\s/>])`, 'g'), '');

/** La page publiée : sans compte, les éléments `data-compte` en moins ; avec, les `data-sans-compte`. */
export function pagePubliee(html, avecCompte) {
  const [retiree, gardee] = avecCompte
    ? ['data-sans-compte', 'data-compte']
    : ['data-compte', 'data-sans-compte'];
  return sansMarque(retirer(html, retiree), gardee);
}

/** Les fichiers d'un dossier, à toute profondeur, en chemins relatifs. */
function fichiers(dossier) {
  return (
    readdirSync(dossier, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      // `parentPath` depuis Node 20.12 ; `path` avant.
      .map((e) => relative(dossier, join(e.parentPath ?? e.path, e.name)))
  );
}

/** Les liens d'une page publiée vers une page du compte retirée (`href` relatif ou absolu). */
export function liensVersLeCompte(html) {
  const pages = PAGES_DU_COMPTE.map((p) => p.replace(/^en\//, ''));
  return [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter(
      (lien) =>
        !/^[a-z]+:/i.test(lien) &&
        pages.some((p) => new RegExp(`(^|/)${p}/?$`).test(lien.replace(/[?#].*$/, ''))),
    );
}

/** Publie `source` dans `cible` (vidé d'abord) ; rend la liste des pages publiées. */
export function publier(source, cible, avecCompte) {
  if (resolve(cible) === resolve(source) || resolve(cible).startsWith(`${resolve(source)}/`)) {
    throw new Error('le dossier publié doit être hors de site/ : site/ n’est jamais modifié');
  }
  rmSync(cible, { recursive: true, force: true });
  mkdirSync(cible, { recursive: true });
  const retirees = avecCompte ? [] : PAGES_DU_COMPTE;
  const pages = [];
  for (const chemin of fichiers(source)) {
    if (chemin === 'README.md') continue;
    if (retirees.some((p) => chemin.startsWith(`${p}/`))) continue;
    const vers = join(cible, chemin);
    mkdirSync(dirname(vers), { recursive: true });
    if (!chemin.endsWith('.html')) {
      cpSync(join(source, chemin), vers);
      continue;
    }
    const html = pagePubliee(readFileSync(join(source, chemin), 'utf8'), avecCompte);
    if (!avecCompte) {
      const morts = liensVersLeCompte(html);
      if (morts.length > 0) {
        throw new Error(`${chemin} mène encore à une page du compte retirée : ${morts.join(', ')}`);
      }
    }
    writeFileSync(vers, html);
    pages.push(chemin);
  }
  return pages;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cible = process.argv[2];
  if (!cible) {
    console.error('publier-site : le dossier à publier est attendu en argument.');
    process.exit(1);
  }
  const avecCompte = compteOffert();
  const source = join(racine, 'site');
  if (!existsSync(source)) throw new Error('site/ introuvable');
  const pages = publier(source, resolve(cible), avecCompte);
  console.log(
    `publier-site — ${pages.length} pages dans ${cible}, ${avecCompte ? 'avec' : 'sans'} le compte${
      avecCompte ? '' : ` (${PAGES_DU_COMPTE.map((p) => `${p}/`).join(', ')} non publiées)`
    }.`,
  );
}
