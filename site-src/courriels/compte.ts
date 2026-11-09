/**
 * Les e-mails que Supabase Auth envoie au titulaire d'un compte facturx : confirmation de l'adresse,
 * mot de passe oublié, changement d'adresse, lien de connexion, code de vérification. Supabase les
 * compose, objet comme corps, avec un gabarit Go (`html/template`) ; on lui en remet un par type,
 * bilingue, que `pnpm emails:construire` écrit dans supabase/templates/. `html/template` retire les
 * commentaires HTML : un modèle du compte ne peut porter de commentaire conditionnel, comme le
 * `<!--[if mso]>` d'Outlook.
 *
 * Un modèle tient les deux langues : l'anglais si la langue du compte (`user_metadata.langue`, que
 * le Studio y enregistre) est « en », le français sinon, y compris pour un compte qui n'en a pas.
 * Le choix se fait dans le gabarit, autour des deux documents complets : l'action qui porte des
 * guillemets est écrite ici, hors de tout texte échappé.
 *
 * Seules quatre données du gabarit sont affichées (`.ConfirmationURL`, `.Email`, `.NewEmail`,
 * `.Token`) ; `.Data`, que le titulaire modifie lui-même, ne sert qu'à comparer la langue. Aucun
 * e-mail ne dit combien de temps son lien ou son code vaut : cette durée est un réglage de Supabase,
 * qui peut changer sans toucher au texte.
 */
import {
  bouton,
  cadre,
  code,
  type Langue,
  lienEnClair,
  mention,
  paragraphes,
  titre,
} from '../shared/courriel.js';

/** Les types d'e-mail du compte, nommés comme les sections `[auth.email.template.…]` de Supabase. */
export const MODELES = [
  'confirmation',
  'recovery',
  'email_change',
  'magic_link',
  'reauthentication',
] as const;

export type Modele = (typeof MODELES)[number];

type Texte = {
  /** L'objet de l'e-mail, repris en titre. */
  objet: string;
  /** La phrase que la messagerie montre après l'objet, dans la liste des messages. */
  preheader: string;
  /** Le message, avec les variables du gabarit. */
  texte: string;
  /** Le bouton ; sans lui, le modèle montre le code à recopier (la réauthentification). */
  bouton?: string;
  /** Ce qu'on dit à qui n'a rien demandé. */
  mention: string;
};

// Les espaces insécables du français sont écrites ` `, pour qu'on les voie dans le code.
const TEXTES: Record<Modele, Record<Langue, Texte>> = {
  confirmation: {
    fr: {
      objet: 'Confirmez votre adresse e-mail',
      preheader: 'Un clic pour activer votre compte facturx.',
      texte:
        'Vous venez de créer un compte facturx avec l’adresse {{ .Email }}. Confirmez-la pour conserver vos factures et relancer vos clients.',
      bouton: 'Confirmer mon adresse',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail : le compte ne sera pas activé.',
    },
    en: {
      objet: 'Confirm your email address',
      preheader: 'One click to activate your facturx account.',
      texte:
        'You just created a facturx account with the address {{ .Email }}. Confirm it to keep your invoices and send payment reminders.',
      bouton: 'Confirm my address',
      mention: 'Didn’t ask for this? Ignore this email: the account won’t be activated.',
    },
  },
  recovery: {
    fr: {
      objet: 'Réinitialisez votre mot de passe',
      preheader: 'Choisissez un nouveau mot de passe pour votre compte facturx.',
      texte: 'Un nouveau mot de passe a été demandé pour le compte facturx {{ .Email }}.',
      bouton: 'Choisir un nouveau mot de passe',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail : votre mot de passe ne change pas.',
    },
    en: {
      objet: 'Reset your password',
      preheader: 'Choose a new password for your facturx account.',
      texte: 'A new password was requested for the facturx account {{ .Email }}.',
      bouton: 'Choose a new password',
      mention: 'Didn’t ask for this? Ignore this email: your password stays the same.',
    },
  },
  email_change: {
    fr: {
      objet: 'Confirmez le changement d’adresse',
      preheader: 'Le changement se fait quand les deux adresses l’ont confirmé.',
      texte:
        'Une demande remplace l’adresse du compte facturx, {{ .Email }}, par {{ .NewEmail }}. Le changement se fait quand les deux adresses l’ont confirmé.',
      bouton: 'Confirmer le changement',
      mention:
        'Vous n’avez rien demandé ? Ne cliquez pas : l’adresse ne change pas sans cette confirmation.',
    },
    en: {
      objet: 'Confirm your email change',
      preheader: 'The change happens once both addresses have confirmed it.',
      texte:
        'A request replaces the facturx account address, {{ .Email }}, with {{ .NewEmail }}. The change happens once both addresses have confirmed it.',
      bouton: 'Confirm the change',
      mention:
        'Didn’t ask for this? Don’t click: the address won’t change without this confirmation.',
    },
  },
  magic_link: {
    fr: {
      objet: 'Votre lien de connexion',
      preheader: 'Connectez-vous à facturx en un clic.',
      texte: 'Un lien de connexion a été demandé pour le compte facturx {{ .Email }}.',
      bouton: 'Me connecter',
      mention: 'Vous n’avez rien demandé ? Ignorez cet e-mail.',
    },
    en: {
      objet: 'Your sign-in link',
      preheader: 'Sign in to facturx in one click.',
      texte: 'A sign-in link was requested for the facturx account {{ .Email }}.',
      bouton: 'Sign in',
      mention: 'Didn’t ask for this? Ignore this email.',
    },
  },
  reauthentication: {
    fr: {
      objet: 'Votre code de vérification',
      preheader: 'Le code pour confirmer une opération sur votre compte facturx.',
      texte: 'Voici le code demandé pour confirmer une opération sur votre compte facturx :',
      mention:
        'Vous n’avez rien demandé ? Quelqu’un utilise peut-être votre session : changez votre mot de passe.',
    },
    en: {
      objet: 'Your verification code',
      preheader: 'The code to confirm an operation on your facturx account.',
      texte: 'Here is the code requested to confirm an operation on your facturx account:',
      mention: 'Didn’t ask for this? Someone may be using your session: change your password.',
    },
  },
};

/** Ce qui précède le lien en clair sous chaque bouton. */
const INTRO_LIEN: Record<Langue, string> = {
  fr: 'Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :',
  en: 'Button not working? Copy this link into your browser:',
};

const ENTETE = 'facturx';
const PIED = 'facturx · facturx.ibird.dev';

const LIEN = '{{ .ConfirmationURL }}';
const CODE = '{{ .Token }}';

/** La condition du gabarit : la langue connue du compte est l'anglais. */
const EN = 'eq (printf "%v" .Data.langue) "en"';

/** Le document d'un modèle dans une langue. */
function document(modele: Modele, lang: Langue): string {
  const t = TEXTES[modele][lang];
  const action =
    t.bouton === undefined
      ? code(CODE)
      : bouton(t.bouton, LIEN) + lienEnClair(INTRO_LIEN[lang], LIEN);
  return cadre({
    lang,
    preheader: t.preheader,
    entete: ENTETE,
    contenu: titre(t.objet) + paragraphes(t.texte) + action + mention(t.mention),
    pied: PIED,
  });
}

/**
 * Les cinq modèles : l'objet et le document de chacun, prêts pour Supabase (le gabarit Go choisit
 * la langue). Pure : `pnpm emails:construire` en écrit le résultat, un test vérifie qu'il est à jour.
 */
export function modelesDuCompte(): Record<Modele, { objet: string; html: string }> {
  const modeles = {} as Record<Modele, { objet: string; html: string }>;
  for (const modele of MODELES) {
    modeles[modele] = {
      objet: `{{ if ${EN} }}${TEXTES[modele].en.objet}{{ else }}${TEXTES[modele].fr.objet}{{ end }}`,
      html: `{{ $en := ${EN} }}{{ if $en }}${document(modele, 'en')}{{ else }}${document(modele, 'fr')}{{ end }}`,
    };
  }
  return modeles;
}
