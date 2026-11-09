/**
 * Le cadre HTML des e-mails de facturx, partagé entre le Studio (qui formate les montants et les
 * dates du texte qu'il prépare), les modèles d'e-mail du compte (construits avec `pnpm site:build`)
 * et l'Edge Function `relancer` (l'habillage de la relance) : un seul style, et un montant ou une
 * date qui se disent partout de la même façon.
 *
 * Le cadre est celui que les messageries affichent : des tableaux (`role="presentation"`) et des
 * styles en ligne, 560 px de large au plus, la pile de polices du système, aucune ressource distante
 * (ni image, ni police, ni feuille de style : rien ne se charge à l'ouverture). Le mode sombre tient
 * dans la seule règle `prefers-color-scheme` de l'en-tête, pour les messageries qui l'appliquent ;
 * les autres inversent les couleurs elles-mêmes, ou gardent le clair.
 *
 * Chaque fonction échappe ce qu'on lui passe : un texte saisi (le nom d'une entreprise, le texte
 * relu d'une relance) ne devient jamais du HTML. Seul `contenu` de `cadre` est du HTML, assemblé
 * avec ces fonctions. Une action de gabarit Go comme `{{ .ConfirmationURL }}` ne porte aucun des cinq
 * caractères échappés : elle traverse intacte.
 *
 * Le module n'importe rien. `pnpm compte:preparer` le copie tel quel pour Deno, qui ne résout pas
 * un `./x.js` vers `./x.ts` comme esbuild ou vitest.
 */

export type Langue = 'fr' | 'en';

export const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB' };

/** Un montant en centimes, dans sa devise, avec ses deux décimales (comme en base). */
export function montant(centimes: number, devise: string, langue: Langue): string {
  return new Intl.NumberFormat(LOCALES[langue], {
    style: 'currency',
    currency: devise,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimes / 100);
}

/** Une date `AAAA-MM-JJ` ; telle quelle si elle ne se lit pas. */
export function date(iso: string, langue: Langue): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Intl.DateTimeFormat(LOCALES[langue], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

// ---------- le texte ----------

const ENTITES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * `texte` pour le contenu d'un élément ou la valeur d'un attribut HTML : il s'affichera tel qu'il a
 * été saisi. Les cinq caractères `& < > " '` ; une entité déjà écrite (`&lt;`) est échappée à son tour.
 */
export function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ENTITES[c] as string);
}

// ---------- les couleurs ----------

/**
 * La palette du site (site/style.css), adaptée aux messageries. Le clair va en ligne, le sombre dans
 * la règle de l'en-tête ; chaque texte atteint 4,5:1 sur son fond (`COUPLES`, que le test vérifie).
 */
export const COULEURS = {
  clair: {
    fond: '#fafafa',
    carte: '#ffffff',
    bordure: '#e5e5e5',
    texte: '#0a0a0a',
    secondaire: '#555555',
    mention: '#6b6b6b',
    bouton: '#0a0a0a',
    boutonTexte: '#ffffff',
  },
  sombre: {
    fond: '#000000',
    carte: '#111111',
    bordure: '#2a2a2a',
    texte: '#ededed',
    secondaire: '#a1a1a1',
    mention: '#8f8f8f',
    bouton: '#ededed',
    boutonTexte: '#0a0a0a',
  },
} as const;

type Theme = keyof typeof COULEURS;
type Teinte = keyof (typeof COULEURS)[Theme];

/** Où se pose chaque texte : sur la carte, ou sur le fond (en-tête, pied, encadré). */
const PAIRES: readonly (readonly [string, Teinte, Teinte])[] = [
  ['texte sur la carte', 'texte', 'carte'],
  ['texte secondaire sur la carte', 'secondaire', 'carte'],
  ['mention sur la carte', 'mention', 'carte'],
  ['texte sur le fond', 'texte', 'fond'],
  ['texte secondaire sur le fond', 'secondaire', 'fond'],
  ['mention sur le fond', 'mention', 'fond'],
  ['bouton', 'boutonTexte', 'bouton'],
];

/** Les couples texte / fond du cadre, dans chaque thème : le test en calcule le contraste. */
export const COUPLES: readonly { theme: Theme; nom: string; texte: string; fond: string }[] = (
  Object.keys(COULEURS) as Theme[]
).flatMap((theme) =>
  PAIRES.map(([nom, texte, fond]) => ({
    theme,
    nom,
    texte: COULEURS[theme][texte],
    fond: COULEURS[theme][fond],
  })),
);

const C = COULEURS.clair;
const S = COULEURS.sombre;

/** Les classes portent le mode sombre : `!important` pour passer devant les styles en ligne. */
const MODE_SOMBRE =
  '@media (prefers-color-scheme: dark){' +
  `.fond{background-color:${S.fond} !important}` +
  `.carte{background-color:${S.carte} !important;border-color:${S.bordure} !important;color:${S.texte} !important}` +
  `.encadre{background-color:${S.fond} !important;border-color:${S.bordure} !important}` +
  `.texte{color:${S.texte} !important}` +
  `.secondaire{color:${S.secondaire} !important}` +
  `.mention{color:${S.mention} !important}` +
  `.bouton{background-color:${S.bouton} !important}` +
  `.bouton-texte{color:${S.boutonTexte} !important}` +
  '}';

// ---------- les éléments ----------

/** Les guillemets du style en ligne sont doubles : le nom d'une police prend des apostrophes. */
const POLICE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const POLICE_CODE =
  "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;";

/** Un tableau de mise en page : sans marge ni bordure propres, lu comme tel par les lecteurs d'écran. */
const TABLEAU = 'role="presentation" cellspacing="0" cellpadding="0" border="0"';

/**
 * `html` (un tableau) entre deux espaces. Outlook de bureau ignore la marge d'un tableau, mais pas le
 * remplissage d'une cellule : c'est la cellule qui espace.
 */
const bloc = (html: string, haut: number, bas: number): string =>
  `<table ${TABLEAU} width="100%"><tr><td style="padding:${haut}px 0 ${bas}px">${html}</td></tr></table>`;

/** Le texte courant de la carte : les paragraphes d'un message. */
const COURANT = `${POLICE}font-size:15px;line-height:1.6;color:${C.texte}`;

/** Le titre de l'e-mail. */
export function titre(texte: string): string {
  return `<h1 class="texte" style="margin:0 0 16px;${POLICE}font-size:20px;line-height:1.3;font-weight:600;color:${C.texte}">${echapper(texte)}</h1>`;
}

/**
 * Les paragraphes du texte (séparés par une ligne vide), en `<p>` échappés ; un retour à la ligne
 * simple devient `<br>`.
 */
export function paragraphes(texte: string): string {
  return texte
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraphe) => paragraphe.trim())
    .filter((paragraphe) => paragraphe !== '')
    .map(
      (paragraphe) =>
        `<p class="texte" style="margin:0 0 16px;${COURANT}">${echapper(paragraphe).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

/** Un petit texte discret : ce qu'on dit à qui n'a rien demandé, ce qu'on ajoute en marge. */
export function mention(texte: string): string {
  return `<p class="mention" style="margin:0 0 16px;${POLICE}font-size:13px;line-height:1.5;color:${C.mention}">${echapper(texte)}</p>`;
}

/**
 * Le bouton : un lien dans une cellule colorée (Outlook de bureau en carre les coins, ce qui est
 * admis). `href` est échappé comme le reste ; `{{ .ConfirmationURL }}` le traverse intact.
 */
export function bouton(libelle: string, href: string): string {
  const lien =
    `<a class="bouton-texte" href="${echapper(href)}" style="display:inline-block;padding:12px 24px;` +
    `${POLICE}font-size:15px;line-height:1.2;font-weight:600;color:${C.boutonTexte};` +
    `text-decoration:none;border-radius:999px">${echapper(libelle)}</a>`;
  return bloc(
    `<table ${TABLEAU}><tr><td class="bouton" style="background-color:${C.bouton};border-radius:999px">${lien}</td></tr></table>`,
    8,
    16,
  );
}

/**
 * Le même lien, écrit en clair sous le bouton, pour la messagerie qui n'affiche pas le bouton ou
 * pour qui veut le recopier.
 */
export function lienEnClair(intro: string, href: string): string {
  const lien = echapper(href);
  return (
    `<p class="secondaire" style="margin:0 0 16px;${POLICE}font-size:13px;line-height:1.5;color:${C.secondaire}">` +
    `${echapper(intro)}<br><a class="secondaire" href="${lien}" style="color:${C.secondaire};` +
    `word-break:break-all;text-decoration:underline">${lien}</a></p>`
  );
}

/** Un code en grand, à recopier (la réauthentification). */
export function code(texte: string): string {
  return `<p class="texte" style="margin:0 0 16px;${POLICE_CODE}font-size:32px;line-height:1.2;font-weight:700;letter-spacing:6px;color:${C.texte}">${echapper(texte)}</p>`;
}

/** Des lignes « libellé, valeur » dans un encadré (le numéro, le reste dû, l'échéance d'une facture). */
export function encadre(lignes: readonly (readonly [string, string])[]): string {
  const cellule = `padding:8px 16px;${POLICE}font-size:14px;line-height:1.4;`;
  const rangees = lignes
    .map(
      ([libelle, valeur]) =>
        `<tr><td class="secondaire" style="${cellule}color:${C.secondaire}">${echapper(libelle)}</td>` +
        `<td class="texte" align="right" style="${cellule}text-align:right;font-weight:600;color:${C.texte}">${echapper(valeur)}</td></tr>`,
    )
    .join('');
  return bloc(
    `<table ${TABLEAU} width="100%" class="encadre" style="background-color:${C.fond};border:1px solid ${C.bordure};border-radius:8px">${rangees}</table>`,
    0,
    16,
  );
}

// ---------- le cadre ----------

/**
 * Le document complet. `preheader` (la phrase que la messagerie montre dans la liste après l'objet,
 * cachée dans l'e-mail), `entete` (au-dessus de la carte) et `pied` (au-dessous) sont du texte,
 * échappé ici ; `contenu` est du HTML, assemblé avec les fonctions de ce module. Sans `entete`, pas
 * de ligne en tête.
 */
export function cadre(c: {
  lang: Langue;
  preheader: string;
  entete?: string;
  contenu: string;
  pied: string;
}): string {
  const hors = (classe: string, style: string, texte: string): string =>
    `<tr><td class="${classe}" style="${style}">${echapper(texte)}</td></tr>`;
  const entete =
    c.entete === undefined
      ? ''
      : hors(
          'texte',
          `padding:0 4px 16px;${POLICE}font-size:15px;line-height:1.4;font-weight:600;color:${C.texte}`,
          c.entete,
        );
  const pied = hors(
    'mention',
    `padding:16px 4px 0;${POLICE}font-size:12px;line-height:1.5;color:${C.mention}`,
    c.pied,
  );
  return [
    '<!doctype html>',
    `<html lang="${c.lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<style>${MODE_SOMBRE}</style>`,
    '</head>',
    `<body class="fond" style="margin:0;padding:0;background-color:${C.fond}">`,
    // Cachée à l'écran, lue par la messagerie pour la liste des messages.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.fond}">${echapper(c.preheader)}</div>`,
    `<table ${TABLEAU} width="100%" class="fond" style="background-color:${C.fond}"><tr><td align="center" style="padding:32px 16px">`,
    `<table ${TABLEAU} width="560" style="width:100%;max-width:560px">`,
    entete,
    // Le contenu finit par la marge basse de son dernier élément : la carte en retient 16 de moins.
    `<tr><td class="carte" style="padding:28px 24px 12px;${COURANT};background-color:${C.carte};border:1px solid ${C.bordure};border-radius:12px">${c.contenu}</td></tr>`,
    pied,
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ]
    .filter((ligne) => ligne !== '')
    .join('\n');
}
