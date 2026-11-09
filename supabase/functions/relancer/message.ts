/**
 * Le message d'une relance (spec § 9, étape 3) : ce que l'utilisateur a relu, mis en forme pour
 * l'API Brevo sans que rien de ce qu'il a saisi puisse devenir du HTML, un en-tête ou un destinataire
 * de plus.
 *
 *   - le corps, en texte, est échappé puis placé dans le cadre fixe des e-mails de facturx
 *     (`cadre`, site-src/shared/courriel.ts) : aucun HTML saisi par l'utilisateur n'est envoyé. Le
 *     gabarit y ajoute, dans la langue du texte (`fr` ou `en`), le nom de l'entreprise en tête, un
 *     encadré de la facture (numéro, reste dû, échéance : lus en base par `relancer`, non saisis), la
 *     mention du PDF joint et, hors de la carte, le pied « Envoyé par … avec facturx ». Le nom, le
 *     numéro et les montants y sont échappés comme le texte. `textContent` porte les mêmes
 *     informations, en texte brut (spec e-mails, § 6.3) ;
 *   - l'objet est débarrassé des retours à la ligne, des caractères de contrôle et de mise en forme
 *     (sens d'écriture, largeur nulle), et coupé à 200 caractères ; le nom de l'expéditeur, de ces
 *     caractères, des guillemets et des chevrons ;
 *   - le destinataire est une seule adresse (`destinataireValide`, site-src/shared/destinataire.ts,
 *     la règle que le Studio applique aussi avant d'activer « Envoyer »).
 *
 * L'adresse d'expédition est celle du domaine de facturx (`RELANCES_EXPEDITEUR`) ; `Reply-To` est
 * l'adresse du compte, de sorte qu'une réponse du client arrive à l'entreprise.
 */
import {
  cadre,
  date,
  encadre,
  type Langue,
  mention,
  montant,
  paragraphes,
} from '../_vendor/shared/courriel.ts';
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

/**
 * Les caractères de mise en forme (catégorie Cf) : sens d'écriture (U+202E, U+2066-2069 : un objet qui
 * se lirait à l'envers), largeur nulle (U+200B…), marque d'ordre des octets. Ils n'ont rien à faire dans
 * un objet ni dans un nom d'expéditeur ; retirés, ils séparent les composants d'un émoji composé.
 */
const MISE_EN_FORME = /\p{Cf}/gu;

/** Les `max` premiers caractères de `texte` : un caractère hors du plan de base ne se coupe pas en deux. */
function couper(texte: string, max: number): string {
  // Deux unités par caractère au plus : la première coupe évite de parcourir un texte énorme.
  return Array.from(texte.slice(0, max * 2))
    .slice(0, max)
    .join('');
}

/**
 * `texte` sur une seule ligne, de `max` caractères au plus : les caractères de mise en forme sont
 * retirés, chaque suite de retours à la ligne et de caractères de contrôle devient une espace, puis le
 * texte est coupé. Aussi pour ce que Brevo répond (l'identifiant du message), avant qu'il soit consigné.
 */
export function uneLigne(texte: string, max: number): string {
  return couper(texte.replace(MISE_EN_FORME, '').replace(FINS_DE_LIGNE, ' ').trim(), max).trim();
}

/**
 * L'objet d'un e-mail sur une seule ligne (c'est ce qui empêche `Relance\r\nBcc: x@y` d'ouvrir un
 * en-tête), de 200 caractères au plus.
 */
export function nettoyerObjet(objet: string): string {
  return uneLigne(objet, OBJET_MAX);
}

/**
 * Le nom de l'entreprise tel qu'il se montre (l'expéditeur, l'en-tête, le pied) : sans guillemet,
 * chevron, barre oblique inverse ni caractère de mise en forme, sur une seule ligne, de 100 caractères
 * au plus. Vide s'il n'en reste rien.
 */
function nomNettoye(entreprise: string): string {
  return couper(
    entreprise
      .replace(/["<>\\]/g, '')
      .replace(MISE_EN_FORME, '')
      .replace(FINS_DE_LIGNE, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    NOM_MAX,
  ).trim();
}

/** « *Nom de l'entreprise* via facturx » ; « facturx » seul quand le nom ne laisse rien. */
function nomExpediteur(entreprise: string): string {
  const nom = nomNettoye(entreprise);
  return nom === '' ? 'facturx' : `${nom} via facturx`;
}

/**
 * Ce que le gabarit dit, dans chaque langue. En français, les deux-points du texte brut sont précédés
 * d'une espace insécable.
 */
const TEXTES: Record<
  Langue,
  {
    facture: string;
    resteDu: string;
    echeance: string;
    deuxPoints: string;
    joint: (fichier: string) => string;
    pied: (nom: string) => string;
    piedSansNom: string;
  }
> = {
  fr: {
    facture: 'Facture',
    resteDu: 'Reste dû',
    echeance: 'Échéance',
    deuxPoints: '\u00a0:',
    joint: (fichier) => `${fichier} est joint à cet e-mail.`,
    pied: (nom) => `Envoyé par ${nom} avec facturx. Pour lui écrire, répondez à cet e-mail.`,
    piedSansNom: 'Envoyé avec facturx.',
  },
  en: {
    facture: 'Invoice',
    resteDu: 'Amount due',
    echeance: 'Due date',
    deuxPoints: ':',
    joint: (fichier) => `${fichier} is attached to this email.`,
    pied: (nom) => `Sent by ${nom} with facturx. To reach them, reply to this email.`,
    piedSansNom: 'Sent with facturx.',
  },
};

/**
 * Le message à envoyer. L'adresse d'expédition est lue dans `RELANCES_EXPEDITEUR` : sans elle, la
 * fonction lève (une erreur du serveur, pas un message sans expéditeur). `resteDu` est en centimes,
 * dans `devise` ; `echeance` est une date `AAAA-MM-JJ` ; `langue` est celle du texte.
 */
export function composer(m: {
  objet: string;
  corps: string;
  entreprise: string;
  destinataire: string;
  replyTo: string;
  numero: string;
  pdf: Uint8Array;
  langue: Langue;
  resteDu: number;
  devise: string;
  echeance: string;
}): MessageBrevo {
  const expediteur = Deno.env.get('RELANCES_EXPEDITEUR')?.trim();
  if (!expediteur) {
    throw new Error('RELANCES_EXPEDITEUR : à définir (adresse d’expédition des relances).');
  }
  const t = TEXTES[m.langue];
  const nom = nomNettoye(m.entreprise);
  const fichier = `${fileStem(m.numero)}.pdf`;
  const reste = montant(m.resteDu, m.devise, m.langue);
  const echeance = date(m.echeance, m.langue);
  const pied = nom === '' ? t.piedSansNom : t.pied(nom);
  const corps = m.corps.trim();
  return {
    sender: { name: nomExpediteur(m.entreprise), email: expediteur },
    to: [{ email: m.destinataire }],
    replyTo: { email: m.replyTo },
    subject: nettoyerObjet(m.objet),
    htmlContent: cadre({
      lang: m.langue,
      preheader: `${t.facture} ${m.numero} · ${t.resteDu} ${reste} · ${t.echeance} ${echeance}`,
      // Sans nom d'entreprise, pas d'en-tête : le message ne porte pas le mot « facturx » en tête.
      ...(nom === '' ? {} : { entete: nom }),
      contenu:
        encadre([
          [t.facture, m.numero],
          [t.resteDu, reste],
          [t.echeance, echeance],
        ]) +
        paragraphes(corps) +
        mention(t.joint(fichier)),
      pied,
    }),
    textContent: [
      `${t.facture} ${m.numero}`,
      `${t.resteDu}${t.deuxPoints} ${reste}`,
      `${t.echeance}${t.deuxPoints} ${echeance}`,
      '',
      corps,
      '',
      t.joint(fichier),
      '--',
      pied,
    ].join('\n'),
    attachment: [{ name: fichier, content: toBase64(m.pdf) }],
  };
}
