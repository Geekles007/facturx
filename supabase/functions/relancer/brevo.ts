/**
 * L'envoi des relances (spec § 9, étape 4) par l'API transactionnelle de Brevo, ou son simulateur.
 *
 * La clé de l'API (`BREVO_API_KEY`, un secret de la fonction, spec § 11) n'apparaît qu'en en-tête de
 * la requête : ni dans une erreur, ni dans un journal, ni dans une réponse. L'erreur d'un refus porte
 * le statut et rien de la réponse de Brevo, qui peut citer l'adresse ou un fragment de la requête.
 */
import { projetHeberge } from '../_shared/contexte.ts';
import type { MessageBrevo } from './message.ts';

export interface Expediteur {
  envoyer(m: MessageBrevo): Promise<{ messageId: string }>;
}

/** Brevo n'a pas accepté l'e-mail : `statut` est celui de sa réponse, ou 0 s'il n'a pas répondu. */
export class ErreurBrevo extends Error {
  constructor(readonly statut: number) {
    super(
      statut === 0 ? 'Brevo : service injoignable.' : `Brevo : envoi refusé (statut ${statut}).`,
    );
    this.name = 'ErreurBrevo';
  }
}

const ADRESSE = 'https://api.brevo.com/v3/smtp/email';

/** Au-delà, la relance est tenue pour refusée : l'envoi se fait sous le verrou de l'entreprise. */
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
        // Ni le message ni la cause de l'exception : `fetch` peut y citer la requête.
        throw new ErreurBrevo(0);
      }
      if (!reponse.ok) {
        await reponse.body?.cancel();
        throw new ErreurBrevo(reponse.status);
      }
      const corps: unknown = await reponse.json().catch(() => null);
      const messageId = (corps as { messageId?: unknown } | null)?.messageId;
      if (typeof messageId !== 'string' || messageId === '') {
        throw new Error('Brevo : identifiant de message absent de la réponse.');
      }
      return { messageId };
    },
  };
}

/** Le domaine dont le simulateur refuse les adresses, comme Brevo refuserait une adresse qu'il rejette. */
export const DOMAINE_REFUSE = 'refus.test';

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

/** Le domaine dont le simulateur est lent : un envoi long, que les tests de verrou observent en cours. */
export const DOMAINE_LENT = 'lent.test';

/**
 * Le simulateur de la pile locale et de la CI : rien ne part, la réponse est `simule-<uuid>`. Il
 * refuse (statut 400) un message que Brevo refuserait (expéditeur, réponse, objet, pièce jointe ou
 * destinataire absents ou multiples) et les adresses du domaine `refus.test`, ce qui donne aux tests
 * un refus du service. Il répond aussitôt, sauf pour une adresse du domaine `lent.test` (3 secondes) :
 * le test qui tient une relance en plein envoi y regarde si la transaction tient le verrou.
 */
export function simule(): Expediteur {
  return {
    async envoyer(m) {
      if (m.to[0]?.email.endsWith(`@${DOMAINE_LENT}`)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (!accepte(m)) throw new ErreurBrevo(400);
      return { messageId: `simule-${crypto.randomUUID()}` };
    },
  };
}

/**
 * L'expéditeur de l'environnement : `BREVO_API_KEY` vaut `simule` en local et en CI, la clé de l'API
 * en production. Le simulateur n'est jamais admis sur un projet hébergé par Supabase : il y ferait
 * croire à des relances parties. Sans clé, lève (une erreur du serveur) au lieu de simuler.
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
  return simule();
}
