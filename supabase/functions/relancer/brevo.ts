/**
 * L'envoi des relances (spec § 9, étape 4) par l'API transactionnelle de Brevo, ou son simulateur.
 *
 * La clé de l'API (`BREVO_API_KEY`, un secret de la fonction, spec § 11) n'apparaît qu'en en-tête de
 * la requête : ni dans une erreur, ni dans un journal, ni dans une réponse. Les erreurs ne portent ni
 * le corps de la réponse de Brevo, qui peut citer l'adresse ou un fragment de la requête, ni la cause
 * d'une exception de `fetch`.
 *
 * Une issue a trois formes. L'e-mail est accepté (`messageId`). Brevo le refuse par une réponse
 * explicite, 4xx ou 5xx : `ErreurBrevo`, rien n'est parti. Ou l'on ne sait pas : pas de réponse (délai,
 * réseau coupé après l'envoi de la requête) ou une 2xx sans identifiant lisible, `EnvoiIncertain` ;
 * Brevo a pu envoyer, et l'appelant le consigne comme envoyé.
 */
import { projetHeberge } from '../_shared/contexte.ts';
import { admin } from '../_shared/db.ts';
import type { MessageBrevo } from './message.ts';

export interface Expediteur {
  envoyer(m: MessageBrevo): Promise<{ messageId: string }>;
}

/** Brevo a refusé l'e-mail par une réponse explicite : `statut` est celui de sa réponse. */
export class ErreurBrevo extends Error {
  constructor(readonly statut: number) {
    super(`Brevo : envoi refusé (statut ${statut}).`);
    this.name = 'ErreurBrevo';
  }
}

/** On ne sait pas si Brevo a envoyé l'e-mail : il n'a pas répondu, ou sa réponse n'est pas lisible. */
export class EnvoiIncertain extends Error {
  constructor() {
    super('Brevo : issue de l’envoi inconnue.');
    this.name = 'EnvoiIncertain';
  }
}

const ADRESSE = 'https://api.brevo.com/v3/smtp/email';

/** Au-delà, l'issue est tenue pour inconnue : l'envoi se fait sous le verrou de l'entreprise. */
const DELAI_MS = 15_000;

/** Le client de l'API Brevo, avec la clé `cle`. */
export function brevo(cle: string): Expediteur {
  return {
    async envoyer(m) {
      let reponse: Response;
      try {
        reponse = await fetch(ADRESSE, {
          method: 'POST',
          headers: {
            'api-key': cle,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(m),
          signal: AbortSignal.timeout(DELAI_MS),
        });
      } catch {
        // Délai dépassé ou réseau coupé : Brevo a pu recevoir la requête. Ni le message ni la cause de
        // l'exception, où `fetch` peut citer la requête.
        throw new EnvoiIncertain();
      }
      if (!reponse.ok) {
        await reponse.body?.cancel();
        throw new ErreurBrevo(reponse.status);
      }
      const corps: unknown = await reponse.json().catch(() => null);
      const messageId = (corps as { messageId?: unknown } | null)?.messageId;
      if (typeof messageId !== 'string' || messageId === '') throw new EnvoiIncertain();
      return { messageId };
    },
  };
}

/** Le domaine dont le simulateur refuse les adresses, comme Brevo refuserait une adresse qu'il rejette. */
export const DOMAINE_REFUSE = 'refus.test';

/** Le domaine dont le simulateur ne dit pas ce qu'il est advenu de l'e-mail (délai dépassé de Brevo). */
export const DOMAINE_INCERTAIN = 'incertain.test';

/** Le domaine dont le simulateur est lent : un envoi long, que les tests de verrou observent en cours. */
export const DOMAINE_LENT = 'lent.test';

/** Le domaine dont le simulateur répond un identifiant de message hostile (contrôles, 600 caractères). */
export const DOMAINE_ID_HOSTILE = 'id-hostile.test';

/** Le PDF joint est-il un seul fichier `.pdf` dont le contenu commence par `%PDF` ? */
function pieceJointeValide(attachment: MessageBrevo['attachment']): boolean {
  const [pj] = attachment;
  if (attachment.length !== 1 || !pj?.name.endsWith('.pdf')) return false;
  try {
    return atob(pj.content).startsWith('%PDF');
  } catch {
    return false;
  }
}

/** Ce que Brevo exige du message, au minimum : une erreur de composition se verrait dès les tests. */
function accepte(m: MessageBrevo): boolean {
  const destinataire = m.to[0]?.email;
  return (
    m.to.length === 1 &&
    Boolean(destinataire) &&
    !destinataire?.endsWith(`@${DOMAINE_REFUSE}`) &&
    Boolean(m.replyTo.email) &&
    Boolean(m.sender.email) &&
    Boolean(m.sender.name) &&
    m.subject !== '' &&
    !/[\r\n]/.test(m.subject) &&
    pieceJointeValide(m.attachment)
  );
}

/**
 * Le simulateur de la pile locale et de la CI : rien ne part, la réponse est `simule-<uuid>`. Il
 * refuse (statut 400) un message que Brevo refuserait (expéditeur, réponse, objet, pièce jointe ou
 * destinataire absents ou multiples) et les adresses du domaine `refus.test`, ce qui donne aux tests
 * un refus du service ; celles de `incertain.test` n'ont pas de réponse (issue inconnue) ; celles de
 * `lent.test` répondent après 3 secondes, le temps pour un test de regarder la base pendant l'envoi ;
 * celles de `id-hostile.test` reçoivent un identifiant de message que la base refuserait tel quel.
 */
export function simule(): Expediteur {
  return {
    async envoyer(m) {
      const adresse = m.to[0]?.email ?? '';
      if (adresse.endsWith(`@${DOMAINE_LENT}`)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (adresse.endsWith(`@${DOMAINE_INCERTAIN}`)) throw new EnvoiIncertain();
      if (!accepte(m)) throw new ErreurBrevo(400);
      const messageId = `simule-${crypto.randomUUID()}`;
      if (adresse.endsWith(`@${DOMAINE_ID_HOSTILE}`)) {
        return { messageId: `${messageId}\u0000\r\nBcc: x@y${'x'.repeat(600)}` };
      }
      return { messageId };
    },
  };
}

/** Où les tests lisent les messages remis au simulateur : `simule/<numéro>/<uuid>.json`, bucket `factures`. */
export const DOSSIER_TRACES = 'simule';

/** Dépose `m` (pièce jointe comprise) dans le Storage local, sous le nom de sa pièce jointe. */
async function deposerLeMessage(m: MessageBrevo): Promise<void> {
  const numero = (m.attachment[0]?.name ?? 'sans-nom').replace(/\.pdf$/, '');
  const depot = await admin()
    .storage.from('factures')
    .upload(
      `${DOSSIER_TRACES}/${numero.replace(/[^A-Za-z0-9._-]+/g, '-')}/${crypto.randomUUID()}.json`,
      JSON.stringify(m),
      { contentType: 'application/json' },
    );
  if (depot.error) throw depot.error;
}

/**
 * `expediteur`, qui laisse une trace de chaque message qu'on lui remet, avant de le lui remettre : un
 * test lit ce qui serait parti (destinataire, `Reply-To`, nom de l'expéditeur, PDF) ou constate que rien
 * n'a été remis. `deposer` : où la trace va, pour les tests unitaires.
 */
export function tracant(
  expediteur: Expediteur,
  deposer: (m: MessageBrevo) => Promise<void> = deposerLeMessage,
): Expediteur {
  return {
    async envoyer(m) {
      await deposer(m);
      return await expediteur.envoyer(m);
    },
  };
}

/**
 * L'expéditeur de l'environnement : `BREVO_API_KEY` vaut `simule` en local et en CI, la clé de l'API
 * en production. Le simulateur, qui trace ses messages, n'est jamais admis sur un projet hébergé par
 * Supabase : il y ferait croire à des relances parties. Sans clé, lève (une erreur du serveur) au lieu
 * de simuler.
 */
export function expediteurConfigure(): Expediteur {
  const cle = Deno.env.get('BREVO_API_KEY')?.trim();
  if (!cle) {
    throw new Error('BREVO_API_KEY : à définir (la clé de l’API Brevo, ou « simule » en local).');
  }
  if (cle !== 'simule') return brevo(cle);
  if (projetHeberge()) {
    throw new Error('BREVO_API_KEY : « simule » est refusé sur un projet hébergé par Supabase.');
  }
  return tracant(simule());
}
