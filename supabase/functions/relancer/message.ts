/**
 * Le message d'une relance (spec § 9, étape 3) : ce que l'utilisateur a relu, mis en forme pour
 * l'API Brevo sans que rien de ce qu'il a saisi puisse devenir du HTML, un en-tête ou un destinataire
 * de plus.
 *
 *   - le corps, en texte, est échappé puis placé dans un gabarit HTML fixe (`textContent` garde le
 *     texte brut) : aucun HTML saisi par l'utilisateur n'est envoyé ;
 *   - l'objet est débarrassé des retours à la ligne et des caractères de contrôle, et coupé à 200
 *     caractères ; le nom de l'expéditeur, des guillemets et des retours à la ligne ;
 *   - le destinataire est une seule adresse (`destinataireValide`).
 *
 * L'adresse d'expédition est celle du domaine de facturx (`RELANCES_EXPEDITEUR`) ; `Reply-To` est
 * l'adresse du compte, de sorte qu'une réponse du client arrive à l'entreprise.
 */
import { fileStem } from '../_vendor/shared/numerotation.ts';
import { toBase64 } from '../_vendor/shared/portable.ts';

/** Le corps de `POST https://api.brevo.com/v3/smtp/email` (les champs que `relancer` renseigne). */
export interface MessageBrevo {
  sender: { name: string; email: string };
  to: { email: string }[];
  replyTo: { email: string };
  subject: string;
  htmlContent: string;
  textContent: string;
  /** Le PDF de la facture : `content` est son contenu en base64. */
  attachment: { name: string; content: string }[];
}

const OBJET_MAX = 200;
const NOM_MAX = 100;

/** Une fin de ligne, sous toutes ses formes : caractères de contrôle (CR, LF, tabulation…) et U+2028/9. */
const FINS_DE_LIGNE = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

const ENTITES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** `texte` pour le contenu d'un élément HTML : il s'affichera tel qu'il a été saisi. */
export function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ENTITES[c] as string);
}

/** Les `max` premiers caractères de `texte` : un caractère hors du plan de base ne se coupe pas en deux. */
function couper(texte: string, max: number): string {
  // Deux unités par caractère au plus : la première coupe évite de parcourir un texte énorme.
  return Array.from(texte.slice(0, max * 2))
    .slice(0, max)
    .join('');
}

/**
 * L'objet d'un e-mail sur une seule ligne : chaque suite de retours à la ligne et de caractères de
 * contrôle devient une espace (c'est ce qui empêche `Relance\r\nBcc: x@y` d'ouvrir un en-tête), puis
 * l'objet est coupé à 200 caractères.
 */
export function nettoyerObjet(objet: string): string {
  return couper(objet.replace(FINS_DE_LIGNE, ' ').trim(), OBJET_MAX).trim();
}

/** « *Nom de l'entreprise* via facturx », sans guillemet, chevron, barre oblique inverse ni retour à la ligne. */
function nomExpediteur(entreprise: string): string {
  const nom = couper(
    entreprise
      .replace(/["<>\\]/g, '')
      .replace(FINS_DE_LIGNE, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    NOM_MAX,
  ).trim();
  return nom === '' ? 'facturx' : `${nom} via facturx`;
}

/** Les paragraphes du texte (lignes vides), en `<p>` ; un retour à la ligne simple devient `<br>`. */
function enParagraphes(corps: string): string {
  return corps
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraphe) => paragraphe.trim())
    .filter((paragraphe) => paragraphe !== '')
    .map(
      (paragraphe) =>
        `<p style="margin:0 0 16px">${echapper(paragraphe).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

/** Le gabarit fixe : le seul HTML qui part est celui-ci, autour de paragraphes déjà échappés. */
const gabarit = (paragraphes: string): string =>
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  '<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;' +
  `line-height:1.5;color:#111">${paragraphes}</body></html>`;

/**
 * Le message à envoyer. L'adresse d'expédition est lue dans `RELANCES_EXPEDITEUR` : sans elle, la
 * fonction lève (une erreur du serveur, pas un message sans expéditeur).
 */
export function composer(m: {
  objet: string;
  corps: string;
  entreprise: string;
  destinataire: string;
  replyTo: string;
  numero: string;
  pdf: Uint8Array;
}): MessageBrevo {
  const expediteur = Deno.env.get('RELANCES_EXPEDITEUR')?.trim();
  if (!expediteur) {
    throw new Error('RELANCES_EXPEDITEUR : à définir (adresse d’expédition des relances).');
  }
  return {
    sender: { name: nomExpediteur(m.entreprise), email: expediteur },
    to: [{ email: m.destinataire }],
    replyTo: { email: m.replyTo },
    subject: nettoyerObjet(m.objet),
    htmlContent: gabarit(enParagraphes(m.corps)),
    textContent: m.corps,
    attachment: [{ name: `${fileStem(m.numero)}.pdf`, content: toBase64(m.pdf) }],
  };
}

/** Un segment de la partie locale d'une adresse : le sous-ensemble courant de la RFC 5322. */
const ATOME = "[A-Za-z0-9_%+'&=-]+";
const PARTIE_LOCALE = new RegExp(`^${ATOME}(?:\\.${ATOME})*$`);
const ETIQUETTE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SUFFIXE = /^(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]+)$/;

/**
 * Une seule adresse `local@domaine.suffixe` : ni espace, ni virgule, ni point-virgule, ni retour à la
 * ligne, ni chevron ni guillemet (rien qui nomme une deuxième adresse ou un en-tête), un domaine d'au
 * moins deux étiquettes, ASCII (un domaine accentué s'écrit en `xn--`). 254 caractères au plus, 64
 * pour la partie locale.
 */
export function destinataireValide(adresse: string): boolean {
  if (adresse.length > 254) return false;
  const arobase = adresse.indexOf('@');
  if (arobase < 1 || arobase !== adresse.lastIndexOf('@')) return false;
  const local = adresse.slice(0, arobase);
  const etiquettes = adresse.slice(arobase + 1).split('.');
  return (
    local.length <= 64 &&
    PARTIE_LOCALE.test(local) &&
    etiquettes.length >= 2 &&
    etiquettes.every((etiquette) => ETIQUETTE.test(etiquette)) &&
    SUFFIXE.test(etiquettes[etiquettes.length - 1] as string)
  );
}
