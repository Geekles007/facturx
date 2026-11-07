/**
 * La relance d'une facture en retard (spec § 9) : l'e-mail préparé dans la langue de la facture, au
 * niveau que donnent les relances déjà envoyées, que l'utilisateur relit et modifie ; puis son envoi
 * par l'Edge Function `relancer`, et ce que la réponse veut dire.
 *
 * Le modèle est du texte brut, sans HTML : le serveur l'échappe et le met en forme. Montants (en
 * centimes) et dates sont formatés par `Intl`, dans la langue et la devise de la facture. Les données
 * viennent de la ligne de suivi (numéro, échéance, reste dû, devise) et de la facture telle que
 * l'historique la garde (IBAN, référence de paiement, pénalités et indemnité « inscrites sur la
 * facture », § 9), ou, si elle ne se lit pas, du profil de l'entreprise ; le nom qui signe est celui
 * du profil, comme celui de l'expéditeur (« Nom via facturx »).
 *
 * Le serveur reste la seule autorité : il recalcule le niveau, applique les limites et juge le
 * destinataire. Le Studio prévient seulement : `peutEnvoyer` refuse ce que `relancer` refuserait, pour
 * que « Envoyer » ne s'active pas en vain. « Envoyée » veut dire que le service d'envoi a accepté
 * l'e-mail, jamais qu'il est reçu ; une réponse `incertain: true`, ou pas de réponse lisible, laisse
 * l'issue inconnue : la relance est peut-être partie, et elle compte dans la limite.
 *
 * Chargé par `import()` avec le reste du compte.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { t } from '../i18n.js';
import type { CompanyProfile, SavedInvoice } from '../library.js';
import { type InvoiceForm, parseScaled } from '../model.js';
import { store } from '../store.js';
import { client } from './client.js';
import { factureEnregistree } from './emission.js';
import { finDAttente, type Issue, reaction } from './erreurs.js';
import { type LigneSuivi, ligneSuivi, type Relance, relancesDe, sessionRefusee } from './suivi.js';

export type Langue = 'fr' | 'en';

/** 1 : rappel courtois ; 2 : rappel ferme ; 3 : dernier rappel, qui se répète. */
export type Niveau = 1 | 2 | 3;

export interface DonneesRelance {
  numero: string;
  /** `AAAA-MM-JJ`. */
  echeance: string;
  /** En centimes. */
  resteDu: number;
  devise: string;
  /** Le nom qui signe. */
  entreprise: string;
  iban?: string;
  /** La référence à rappeler avec le paiement ; à défaut, le numéro de la facture. */
  reference?: string;
  /** Le taux des pénalités de retard, en pour cent, tel qu'il est saisi (`10`, `12,5`). */
  penalites?: string;
  /** L'indemnité forfaitaire pour frais de recouvrement, en centimes. */
  indemnite?: number;
}

// ---------- le modèle ----------

const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB' };

/** Un montant en centimes, dans sa devise, avec ses deux décimales (comme en base). */
function montant(centimes: number, devise: string, langue: Langue): string {
  return new Intl.NumberFormat(LOCALES[langue], {
    style: 'currency',
    currency: devise,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimes / 100);
}

/** Une date `AAAA-MM-JJ` ; telle quelle si elle ne se lit pas. */
function date(iso: string, langue: Langue): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Intl.DateTimeFormat(LOCALES[langue], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** Un taux saisi en pour cent ; tel quel s'il ne se lit pas comme un nombre. */
function taux(saisi: string, langue: Langue): string {
  const centiemes = parseScaled(saisi, 2, '', []);
  if (centiemes === undefined) return saisi.trim();
  return new Intl.NumberFormat(LOCALES[langue], {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(centiemes / 10_000);
}

/** L'IBAN par groupes de quatre caractères, comme on le recopie. */
const parQuatre = (iban: string): string => iban.replace(/(.{4})(?=.)/g, '$1 ');

/** Ce que la relance écrit, dans la langue de la facture. */
const fr = {
  objet: {
    1: (numero: string) => `Rappel : facture ${numero} arrivée à échéance`,
    2: (numero: string) => `Deuxième rappel : facture ${numero} impayée`,
    3: (numero: string) => `Dernier rappel : facture ${numero} impayée`,
  },
  bonjour: 'Bonjour,',
  constat: {
    1: (numero: string, echeance: string, reste: string) =>
      `Sauf erreur de notre part, la facture ${numero}, arrivée à échéance le ${echeance}, n'est pas encore réglée : il reste ${reste} à payer.`,
    2: (numero: string, echeance: string, reste: string) =>
      `Malgré notre précédent rappel, la facture ${numero}, arrivée à échéance le ${echeance}, n'est toujours pas réglée : il reste ${reste} à payer.`,
    3: (numero: string, echeance: string, reste: string) =>
      `Malgré nos rappels, la facture ${numero}, arrivée à échéance le ${echeance}, reste impayée : il reste ${reste} à payer.`,
  },
  demande: {
    1: "Pourriez-vous procéder à son règlement ? Si vous l'avez déjà fait, merci de ne pas tenir compte de ce message.",
    2: 'Nous vous remercions de procéder à son règlement sans tarder.',
    3: 'Nous vous demandons de procéder à son règlement dès réception de ce message.',
  },
  /** Le dernier rappel : ce que le retard rend exigible, avec les chiffres inscrits sur la facture. */
  penalites: (taux: string | undefined, indemnite: string | undefined): string => {
    const debut = 'Nous vous rappelons que tout retard de paiement rend exigibles';
    if (taux && indemnite)
      return `${debut} des pénalités de retard au taux de ${taux} et une indemnité forfaitaire pour frais de recouvrement de ${indemnite}, inscrites sur la facture.`;
    if (taux)
      return `${debut} des pénalités de retard au taux de ${taux}, inscrites sur la facture.`;
    if (indemnite)
      return `${debut} des pénalités de retard, ainsi que l'indemnité forfaitaire pour frais de recouvrement de ${indemnite} inscrite sur la facture.`;
    return `${debut} des pénalités de retard et une indemnité forfaitaire pour frais de recouvrement, prévues par nos conditions de paiement.`;
  },
  coordonnees: 'Nos coordonnées bancaires :',
  iban: (iban: string) => `IBAN : ${iban}`,
  reference: (reference: string) => `Référence à indiquer : ${reference}`,
  jointe: 'La facture est jointe à ce message.',
  salutations: 'Cordialement,',
};

const en: typeof fr = {
  objet: {
    1: (numero) => `Payment reminder: invoice ${numero}`,
    2: (numero) => `Second reminder: invoice ${numero} unpaid`,
    3: (numero) => `Final reminder: invoice ${numero} unpaid`,
  },
  bonjour: 'Hello,',
  constat: {
    1: (numero, echeance, reste) =>
      `Unless we are mistaken, invoice ${numero}, due on ${echeance}, has not been paid yet: ${reste} remains outstanding.`,
    2: (numero, echeance, reste) =>
      `Despite our previous reminder, invoice ${numero}, due on ${echeance}, has still not been paid: ${reste} remains outstanding.`,
    3: (numero, echeance, reste) =>
      `Despite our reminders, invoice ${numero}, due on ${echeance}, remains unpaid: ${reste} is outstanding.`,
  },
  demande: {
    1: 'Could you please arrange payment? If you have already done so, please disregard this message.',
    2: 'Please arrange payment without delay.',
    3: 'We ask you to settle it upon receipt of this message.',
  },
  penalites: (taux, indemnite) => {
    const debut = 'Please note that';
    if (taux && indemnite)
      return `${debut}, as stated on the invoice, late payment incurs late-payment penalties at the rate of ${taux} and a fixed recovery fee of ${indemnite}.`;
    if (taux)
      return `${debut}, as stated on the invoice, late payment incurs late-payment penalties at the rate of ${taux}.`;
    if (indemnite)
      return `${debut} late payment incurs late-payment penalties and, as stated on the invoice, a fixed recovery fee of ${indemnite}.`;
    return `${debut} late payment incurs the late-payment penalties and fixed recovery fee set out in our payment terms.`;
  },
  coordonnees: 'Our bank details:',
  iban: (iban) => `IBAN: ${iban}`,
  reference: (reference) => `Reference to quote: ${reference}`,
  jointe: 'Please find the invoice attached.',
  salutations: 'Kind regards,',
};

const MODELES: Record<Langue, typeof fr> = { fr, en };

/**
 * L'objet et le message de la relance de niveau `niveau`, en `langue` : texte brut, paragraphes
 * séparés par une ligne vide. Les coordonnées bancaires ne figurent qu'avec un IBAN ; le dernier
 * rappel cite pénalités et indemnité, avec les chiffres qu'il a.
 */
export function preparerRelance(
  d: DonneesRelance,
  niveau: Niveau,
  langue: Langue,
): { objet: string; corps: string } {
  const m = MODELES[langue];
  const paragraphes = [
    m.bonjour,
    m.constat[niveau](d.numero, date(d.echeance, langue), montant(d.resteDu, d.devise, langue)),
    m.demande[niveau],
  ];
  if (niveau === 3) {
    paragraphes.push(
      m.penalites(
        d.penalites === undefined ? undefined : taux(d.penalites, langue),
        d.indemnite === undefined ? undefined : montant(d.indemnite, d.devise, langue),
      ),
    );
  }
  if (d.iban) {
    paragraphes.push(
      [m.coordonnees, m.iban(parQuatre(d.iban)), m.reference(d.reference ?? d.numero)].join('\n'),
    );
  }
  paragraphes.push(m.jointe, [m.salutations, d.entreprise.trim()].filter(Boolean).join('\n'));
  return { objet: m.objet[niveau](d.numero), corps: paragraphes.join('\n\n') };
}

// ---------- le destinataire et le niveau ----------

/** Un segment de la partie locale d'une adresse : le sous-ensemble courant de la RFC 5322. */
const ATOME = "[A-Za-z0-9_%+'&=-]+";
const PARTIE_LOCALE = new RegExp(`^${ATOME}(?:\\.${ATOME})*$`);
const ETIQUETTE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SUFFIXE = /^(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]+)$/;

/**
 * L'adresse, sans ses espaces de début et de fin, est-elle une seule adresse que `relancer`
 * admettra ? La règle du serveur (`destinataireValide`, relancer/message.ts), sur ce qui part :
 * `local@domaine.suffixe`, ni espace, ni virgule, ni point-virgule, ni retour à la ligne, ni chevron
 * ni guillemet ; un domaine ASCII d'au moins deux étiquettes (accentué, il s'écrit en `xn--`) ; 254
 * caractères au plus, 64 pour la partie locale. Un test contre la pile vérifie qu'ils s'accordent.
 */
export function peutEnvoyer(destinataire: string): boolean {
  const adresse = destinataire.trim();
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
    SUFFIXE.test(etiquettes[etiquettes.length - 1] ?? '')
  );
}

/**
 * Le niveau de la prochaine relance : les relances envoyées plus un, au plus 3 (les refusées ne
 * comptent pas). Le serveur le recalcule ; celui-ci règle le modèle proposé.
 */
export function niveauPropose(relances: readonly Pick<Relance, 'etat'>[]): Niveau {
  const envoyees = relances.filter((r) => r.etat === 'envoyee').length;
  return envoyees >= 2 ? 3 : envoyees === 1 ? 2 : 1;
}

/**
 * Les données de la relance : la ligne de suivi, puis la facture (`form`), ou, pour ce qu'elle n'a
 * pas (elle ne se lit pas, ou elle a été enregistrée sans formulaire complet), le profil de
 * l'entreprise. Des conditions de paiement en texte libre n'ont ni taux ni indemnité à citer : rien
 * n'est inventé. Un taux ou une indemnité nuls ne se citent pas.
 */
export function donneesDe(
  ligne: LigneSuivi,
  form: InvoiceForm | undefined,
  company: CompanyProfile,
): DonneesRelance {
  const f: Partial<InvoiceForm> | undefined = form;
  const iban = (f?.paymentMeans ?? company.paymentMeans)
    .map((m) => (m.iban ?? '').replace(/\s+/g, '').toUpperCase())
    .find((i) => i !== '');
  const termes = f?.paymentTerms
    ? f.paymentTerms.mode === 'structured'
      ? f.paymentTerms
      : undefined
    : company.defaults;
  // Ce qui vient du serveur peut manquer d'un champ : rien ne lève pour autant.
  const saisi = termes?.latePenaltyRate?.trim() ?? '';
  const penalites = saisi !== '' && parseScaled(saisi, 2, '', []) !== 0 ? saisi : undefined;
  const indemnite = parseScaled(termes?.recoveryIndemnity ?? '', 2, '', []);
  const reference = f?.remittanceInformation?.trim();
  return {
    numero: ligne.numero,
    echeance: ligne.dateEcheance ?? '',
    resteDu: ligne.resteDu,
    devise: ligne.devise,
    entreprise: company.seller.name?.trim() || f?.seller?.name?.trim() || '',
    ...(iban ? { iban } : {}),
    ...(reference ? { reference } : {}),
    ...(penalites ? { penalites } : {}),
    ...(indemnite ? { indemnite } : {}),
  };
}

/** La langue de la facture (celle de ses libellés) ; à défaut, celle de l'interface. */
function langueDe(facture: SavedInvoice | undefined): Langue {
  const langue = facture?.appearance?.language;
  return langue === 'fr' || langue === 'en' ? langue : t.lang;
}

/** La relance préparée pour le dialogue : ce que l'utilisateur relit avant l'envoi. */
export interface RelancePreparee {
  factureId: string;
  numero: string;
  niveau: Niveau;
  langue: Langue;
  /** En retard selon la base (échéance passée, reste dû positif) ; sinon le serveur refusera. */
  enRetard: boolean;
  /** L'adresse de contact de l'acheteur sur la facture ; vide si elle n'en a pas. */
  destinataire: string;
  objet: string;
  corps: string;
}

/**
 * Prépare la relance de la facture : sa ligne de suivi et ses relances sont relues, la facture prise
 * dans l'historique. Rien si elle n'a pas de ligne de suivi (un avoir, une autre entreprise). Les
 * lectures lèvent une `ErreurSuivi`, comme celles de la fiche.
 */
export async function preparer(factureId: string): Promise<RelancePreparee | undefined> {
  const [ligne, relances, facture] = await Promise.all([
    ligneSuivi(factureId),
    relancesDe(factureId),
    factureEnregistree(factureId).catch(() => undefined),
  ]);
  if (!ligne) return undefined;
  const niveau = niveauPropose(relances);
  const langue = langueDe(facture);
  const donnees = donneesDe(ligne, facture?.form, store.get().company);
  return {
    factureId,
    numero: ligne.numero,
    niveau,
    langue,
    enRetard: ligne.statut === 'en_retard',
    destinataire: ligne.clientEmail?.trim() ?? '',
    ...preparerRelance(donnees, niveau, langue),
  };
}

// ---------- l'envoi ----------

/**
 * Le plus long qu'on attend `relancer` : la lecture du PDF (10 s), l'attente du verrou de
 * l'entreprise (10 s) et l'appel au service d'envoi (15 s) se suivent. Au-delà, l'issue est inconnue.
 */
export const DELAI_RELANCE_MS = 45_000;

/** Ce que l'utilisateur a relu, et qui part. */
export interface EnvoiRelance {
  factureId: string;
  destinataire: string;
  objet: string;
  corps: string;
}

/** Le champ du formulaire en cause dans un refus. */
export type ChampRelance = 'destinataire' | 'objet' | 'corps';

/** Un refus du serveur, dit dans la langue de l'interface. */
export interface RefusRelance {
  texte: string;
  /** Le champ à corriger. */
  champ?: ChampRelance;
  /** Ce que le message propose : renvoyer la confirmation de l'adresse (§ 13), ou compléter l'entreprise. */
  action?: 'renvoyerConfirmation' | 'entreprise';
}

/**
 * L'issue d'un envoi : envoyée (le service d'envoi l'a acceptée, au niveau que le serveur a
 * calculé) ; incertaine (le serveur le dit : le service n'a pas répondu à temps) ; sans réponse
 * lisible (réseau, délai, passerelle) ; ou refusée.
 */
export type IssueRelance =
  | { kind: 'envoyee'; niveau: number }
  | { kind: 'incertaine' }
  | { kind: 'sansReponse' }
  | { kind: 'refus'; refus: RefusRelance };

/** Un refus, et ce qu'il garantit : aucune relance n'est partie. */
const sansEnvoi = (texte: string, plus: Omit<RefusRelance, 'texte'> = {}): RefusRelance => ({
  texte: `${texte} ${t.compte.relance.aucuneEnvoyee}`,
  ...plus,
});

/** L'anomalie (422) que `relancer` a relevée : il n'en relève qu'une à la fois. */
function anomalie(issue: Issue | undefined): RefusRelance {
  const phrases = t.compte.relance.refus;
  switch (issue?.code) {
    case 'SIREN':
      return sansEnvoi(phrases.siren, { action: 'entreprise' });
    case 'PAS_DE_RETARD':
      return sansEnvoi(phrases.pasDeRetard);
    case 'DESTINATAIRE':
      return sansEnvoi(phrases.destinataire, { champ: 'destinataire' });
    case 'CORPS':
      // La forme de la demande : le champ que le chemin nomme.
      switch (issue.path) {
        case 'destinataire':
          return sansEnvoi(phrases.destinataire, { champ: 'destinataire' });
        case 'objet':
          return sansEnvoi(phrases.objet, { champ: 'objet' });
        case 'corps':
          return sansEnvoi(phrases.corps, { champ: 'corps' });
        default:
          return sansEnvoi(phrases.illisible);
      }
    default:
      return sansEnvoi(t.compte.erreurs.inconnue);
  }
}

/**
 * Le refus de `relancer`, de statut `statut`, dans la langue de l'interface : jamais le `message` du
 * serveur, qui n'est qu'en français. La réaction commune (`reaction`) dit la session, la confirmation
 * de l'adresse, la suppression du compte, le refus du service d'envoi et la panne ; la relance dit
 * le reste (facture, anomalies, limites). Un code qu'elle ne connaît pas : le message générique.
 */
function refusDeRelance(
  statut: number,
  corps: { code: string; message: string; details?: unknown },
): RefusRelance {
  const phrases = t.compte.relance.refus;
  // Une demande plus grosse que ce que le serveur lit : seul le message peut l'être.
  if (statut === 413) return sansEnvoi(phrases.corps, { champ: 'corps' });
  const r = reaction(statut, corps);
  if (r.kind === 'connexion') return sansEnvoi(phrases.session);
  if (r.kind === 'controle' || r.kind === 'devise') return anomalie(r.issues[0]);
  if (r.kind !== 'message') return sansEnvoi(t.compte.erreurs.inconnue);
  switch (corps.code) {
    case 'DROITS':
      return sansEnvoi(phrases.droits);
    case 'LIMITE':
      return sansEnvoi(phrases.limite(finDAttente(corps.details)));
    case 'NON_CONFIRME':
    case 'SUPPRESSION':
      return sansEnvoi(r.texte, r.action ? { action: r.action } : {});
    // Le service d'envoi a refusé : la phrase dit déjà que rien n'est parti. Une panne du serveur
    // peut, rarement, suivre l'envoi : rien n'est promis.
    case 'ENVOI':
    case 'INTERNE':
      return { texte: r.texte };
    default:
      return sansEnvoi(t.compte.erreurs.inconnue);
  }
}

/**
 * Envoie la relance par `relancer` : l'adresse sans ses espaces de début et de fin, l'objet et le
 * message tels qu'ils ont été relus. Ne lève jamais. Une session refusée (401) ouvre la connexion,
 * comme pour l'émission. Une panne hors de la fonction (passerelle, worker arrêté, délai) laisse
 * l'issue inconnue : l'e-mail a pu partir.
 */
export async function envoyerRelance(envoi: EnvoiRelance): Promise<IssueRelance> {
  let reponse: { data: unknown; error: unknown };
  try {
    reponse = await client().functions.invoke('relancer', {
      body: {
        factureId: envoi.factureId,
        destinataire: envoi.destinataire.trim(),
        objet: envoi.objet,
        corps: envoi.corps,
      },
      timeout: DELAI_RELANCE_MS,
    });
  } catch {
    return { kind: 'sansReponse' };
  }
  const { data, error } = reponse;
  if (!error) {
    const relance = data as { niveau?: unknown; incertain?: unknown } | null;
    if (relance?.incertain === true) return { kind: 'incertaine' };
    return typeof relance?.niveau === 'number'
      ? { kind: 'envoyee', niveau: relance.niveau }
      : { kind: 'sansReponse' };
  }
  if (!(error instanceof FunctionsHttpError)) return { kind: 'sansReponse' };
  const reponseHttp = error.context as Response;
  const lu: unknown = await reponseHttp.json().catch(() => undefined);
  const corps = (typeof lu === 'object' && lu !== null ? lu : {}) as Record<string, unknown>;
  const code = typeof corps.code === 'string' ? corps.code : '';
  // Deux 5xx viennent de la fonction, qui sait ce qu'il en est : `ENVOI` (rien n'est parti) et
  // `INTERNE`. Les autres (passerelle, worker arrêté) ne disent rien de l'e-mail.
  if (reponseHttp.status >= 500 && code !== 'ENVOI' && code !== 'INTERNE') {
    return { kind: 'sansReponse' };
  }
  sessionRefusee(reponseHttp.status);
  return {
    kind: 'refus',
    refus: refusDeRelance(reponseHttp.status, {
      code,
      message: typeof corps.message === 'string' ? corps.message : '',
      details: corps.details,
    }),
  };
}
