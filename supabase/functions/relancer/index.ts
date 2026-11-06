/**
 * Edge Function `relancer` (spec § 9) : l'e-mail de relance d'une facture en retard, que l'utilisateur
 * a relu, part par Brevo avec le PDF de la facture en pièce jointe, et est consigné.
 *
 *   POST /functions/v1/relancer   { factureId, destinataire, objet, corps }
 *
 * Réponse 201 `{ id, niveau }`. Le niveau (1, rappel courtois ; 2, ferme ; 3, dernier rappel, qui se
 * répète) est le nombre de relances `envoyee` de la facture plus un, plafonné à 3. Les vérifications
 * suivent le § 9, et chacune a son erreur (§ 13) :
 *
 *   1. 401 `SESSION` ; la facture est lue dans l'entreprise du compte, sinon 403 `DROITS` ; son
 *      échéance est passée et son reste dû positif, sinon 422 `ANOMALIES` `PAS_DE_RETARD` ;
 *   2. adresse du compte confirmée (403 `NON_CONFIRME`) ; SIREN du vendeur renseigné (422 `SIREN`,
 *      `company.seller.siren`) ; une relance par facture tous les 72 heures et vingt par jour de Paris
 *      et par entreprise, sinon 429 `LIMITE` avec `details.reessayerApres` ;
 *   3. composition (`message.ts`) : le corps est échappé, l'objet sur une ligne, le destinataire une
 *      seule adresse (422 `DESTINATAIRE`, `path` `destinataire`, vérifié avec le corps de la requête) ;
 *   4. envoi, 5. consignation. Un refus de Brevo est consigné aussi (`etat = 'refusee'`), puis 502
 *      `ENVOI` : rien n'est parti, et la ligne ne compte ni pour le délai, ni pour le plafond, ni
 *      pour le niveau.
 *
 * La facture est lue avec l'entreprise du compte pour seul filtre : une facture inconnue et celle
 * d'une autre entreprise donnent la même réponse (403 `DROITS`, même message), sans oracle. Le refus
 * pendant la suppression du compte (403 `SUPPRESSION`) viendra avec la tâche 12, comme pour `emettre`.
 *
 * Les limites sont exactes sous concurrence : la transaction prend un verrou consultatif par
 * entreprise, avant de compter, et le garde jusqu'à la consignation. L'envoi se fait donc sous le
 * verrou : compter, envoyer, consigner, valider. La transaction dure le temps de l'appel à Brevo
 * (15 secondes au plus), faute d'un état « en cours » dans `relances` (ajout seul, spec § 6) : une
 * relance consignée avant l'envoi, puis corrigée, serait une écriture de plus dans une table figée, et
 * un envoi hors verrou laisserait deux requêtes simultanées passer le même plafond. Seules les
 * relances de la même entreprise s'attendent. Si la base tombe entre l'envoi et la consignation,
 * l'e-mail est parti sans trace, et la relance suivante n'est pas retenue par le délai : cas rare,
 * qu'on préfère à une relance consignée « envoyée » qui ne serait pas partie.
 */
import { aujourdhui, contexte } from '../_shared/contexte.ts';
import { lireObjetPortable, lireTexte, UUID } from '../_shared/corps.ts';
import { admin, sql } from '../_shared/db.ts';
import { type Anomalie, anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { ErreurBrevo, expediteurConfigure } from './brevo.ts';
import { composer, destinataireValide, nettoyerObjet } from './message.ts';

/** Une relance par facture tous les 3 jours (spec § 11), comptés en heures : 72 h exactes. */
const DELAI_HEURES = 72;

/** Relances envoyées par jour de Paris et par entreprise (spec § 11). */
const PLAFOND_PAR_JOUR = 20;

const NIVEAU_MAX = 3;

/** Longueur du message : au-delà, ce n'est plus une relance. */
const CORPS_MAX = 10_000;

/** Une requête de relance tient en quelques Kio ; ce plafond est celui de la lecture du corps. */
const PLAFOND_REQUETE = 100 * 1024;

const SANS_ENVOI = 'aucune relance n’est partie';

interface Corps {
  factureId: string;
  destinataire: string;
  objet: string;
  corps: string;
}

/** Le corps de la requête, vérifié dans sa forme ; `objet` est rendu nettoyé (une seule ligne). */
function lireCorps(texte: string): Corps {
  const message = `La demande de relance est illisible : ${SANS_ENVOI}.`;
  const refus = (anomalie: Anomalie) => anomalies([anomalie], message);
  const requete = lireObjetPortable(texte, message);

  const { factureId, destinataire, objet, corps } = requete;
  if (typeof factureId !== 'string' || !UUID.test(factureId)) {
    throw refus({ code: 'CORPS', path: 'factureId', message: 'Identifiant de facture attendu.' });
  }
  if (typeof destinataire !== 'string') {
    throw refus({
      code: 'CORPS',
      path: 'destinataire',
      message: 'Adresse du destinataire attendue.',
    });
  }
  if (!destinataireValide(destinataire)) {
    throw refus({
      code: 'DESTINATAIRE',
      path: 'destinataire',
      message:
        'Une seule adresse e-mail est attendue, sans espace, virgule, point-virgule ni retour à la ligne.',
    });
  }
  const objetNettoye = typeof objet === 'string' ? nettoyerObjet(objet) : '';
  if (objetNettoye === '') {
    throw refus({ code: 'CORPS', path: 'objet', message: 'Objet de l’e-mail attendu.' });
  }
  if (typeof corps !== 'string' || corps.trim() === '' || corps.length > CORPS_MAX) {
    throw refus({
      code: 'CORPS',
      path: 'corps',
      message: `Message attendu, de ${CORPS_MAX} caractères au plus.`,
    });
  }
  return { factureId, destinataire, objet: objetNettoye, corps };
}

Deno.serve(
  traiter(async (req) => {
    // 1. Authentifier : l'entreprise vient du jeton, par `membres`.
    const ctx = await contexte(req);
    const { factureId, destinataire, objet, corps } = lireCorps(
      await lireTexte(req, PLAFOND_REQUETE),
    );
    const e = ctx.entrepriseId;

    // La facture de l'entreprise du compte, et son reste dû d'après la vue de suivi (qui déduit les
    // paiements et les avoirs ; un avoir n'y figure pas). Inconnue ou d'une autre entreprise : la même
    // réponse, rien ne dit que l'identifiant existe ailleurs.
    const [facture] = await sql<
      { numero: string; pdf_chemin: string; echeance: string | null; du: boolean }[]
    >`
      select f.numero, f.pdf_chemin, f.date_echeance::text as echeance,
             coalesce(s.reste_du > 0, false) as du
        from public.factures f
        left join public.suivi_factures s on s.entreprise_id = f.entreprise_id and s.facture_id = f.id
       where f.id = ${factureId} and f.entreprise_id = ${e}`;
    if (!facture) throw erreur(403, 'DROITS', 'Cette facture n’existe pas dans votre entreprise.');

    // Une échéance du jour n'est pas encore passée ; une facture sans échéance n'est jamais en retard.
    // « Aujourd'hui » est celui de la fonction, comme pour `emettre` (les tests le fixent).
    const jour = aujourdhui(req);
    if (facture.echeance === null || facture.echeance >= jour || !facture.du) {
      throw anomalies(
        [
          {
            code: 'PAS_DE_RETARD',
            path: 'factureId',
            message:
              'Cette facture n’est pas en retard : l’échéance n’est pas passée ou rien n’est dû.',
          },
        ],
        `La facture n’est pas à relancer : ${SANS_ENVOI}.`,
      );
    }

    // 2. L'adresse du compte, puis le SIREN du vendeur (le profil de l'entreprise).
    if (!ctx.confirme) {
      throw erreur(
        403,
        'NON_CONFIRME',
        'Confirmez l’adresse e-mail du compte avant de relancer une facture.',
      );
    }
    const [vendeur] = await sql<{ siren: string | null; nom: string | null }[]>`
      select profil -> 'seller' ->> 'siren' as siren, profil -> 'seller' ->> 'name' as nom
        from public.entreprises where id = ${e}`;
    if (!vendeur?.siren?.trim()) {
      throw anomalies(
        [
          {
            code: 'SIREN',
            path: 'company.seller.siren',
            message:
              'Renseignez le SIREN du vendeur dans la fiche de l’entreprise avant de relancer.',
          },
        ],
        `Le SIREN du vendeur est absent : ${SANS_ENVOI}.`,
      );
    }
    // La configuration de l'envoi se vérifie avant de prendre le verrou : un secret absent est une
    // panne du serveur (500), pas une relance refusée.
    const expediteur = expediteurConfigure();

    // 3. La transaction, sur la connexion directe : verrou de l'entreprise, limites, composition,
    // envoi, consignation (voir l'en-tête).
    const relance = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`relancer:${e}`}, 0))`;

      // Les relances envoyées de la facture donnent le niveau et le délai ; celles de l'entreprise
      // depuis minuit à Paris, le plafond. Les refusées ne comptent pour rien. Le jour va de minuit à
      // minuit à Paris, borne haute exclue ; `at time zone` sait si c'est l'heure d'été ou d'hiver.
      const [{ envoyees, bloquee, libre_le }] = await tx<
        { envoyees: number; bloquee: boolean | null; libre_le: Date | null }[]
      >`
        select count(*)::int as envoyees,
               max(envoyee_le) + make_interval(hours => ${DELAI_HEURES}) > clock_timestamp() as bloquee,
               max(envoyee_le) + make_interval(hours => ${DELAI_HEURES}) as libre_le
          from public.relances
         where entreprise_id = ${e} and facture_id = ${factureId} and etat = 'envoyee'`;
      const [{ du_jour, minuit_suivant }] = await tx<{ du_jour: number; minuit_suivant: Date }[]>`
        select count(*)::int as du_jour,
               ((${jour}::date + 1)::timestamp at time zone 'Europe/Paris') as minuit_suivant
          from public.relances
         where entreprise_id = ${e} and etat = 'envoyee'
           and envoyee_le >= (${jour}::date)::timestamp at time zone 'Europe/Paris'
           and envoyee_le < (${jour}::date + 1)::timestamp at time zone 'Europe/Paris'`;

      // Délai et plafond en défaut ensemble : réessayer après le plus tardif des deux.
      const limites: { apres: Date; message: string }[] = [];
      if (bloquee && libre_le) {
        limites.push({
          apres: libre_le,
          message: `Cette facture a déjà été relancée il y a moins de ${DELAI_HEURES} heures.`,
        });
      }
      if (du_jour >= PLAFOND_PAR_JOUR) {
        limites.push({
          apres: minuit_suivant,
          message: `${PLAFOND_PAR_JOUR} relances ont déjà été envoyées aujourd’hui.`,
        });
      }
      if (limites.length > 0) {
        const tardive = limites.reduce((a, b) => (b.apres > a.apres ? b : a));
        throw erreur(429, 'LIMITE', `${tardive.message} Réessayez plus tard : ${SANS_ENVOI}.`, {
          reessayerApres: tardive.apres.toISOString(),
        });
      }
      const niveau = Math.min(envoyees + 1, NIVEAU_MAX);

      // Le PDF de la facture, lu dans le Storage avec les droits du service : son chemin est celui
      // que la ligne de l'entreprise porte, jamais un chemin reçu.
      const depot = await admin().storage.from('factures').download(facture.pdf_chemin);
      if (depot.error) throw depot.error;
      const pdf = new Uint8Array(await depot.data.arrayBuffer());

      const message = composer({
        objet,
        corps,
        entreprise: vendeur.nom ?? '',
        destinataire,
        replyTo: ctx.email,
        numero: facture.numero,
        pdf,
      });

      // 4. L'envoi, sous le verrou. Le refus de Brevo ne lève pas ici : lever annulerait la
      // transaction, et la ligne `refusee` avec elle. Toute autre exception est une panne (500).
      let messageId: string | null = null;
      let refus: number | undefined;
      try {
        ({ messageId } = await expediteur.envoyer(message));
      } catch (echec) {
        if (!(echec instanceof ErreurBrevo)) throw echec;
        refus = echec.statut;
      }

      // 5. Consigner, dans les deux cas. L'instant est celui de l'envoi, et non du début de la
      // transaction : une requête qui a attendu le verrou ne date pas sa relance d'avant celle qui l'a
      // précédée.
      const [ligne] = await tx<{ id: string }[]>`
        insert into public.relances (
          entreprise_id, facture_id, niveau, envoyee_le, destinataire, objet, corps, message_id, etat
        ) values (
          ${e}, ${factureId}, ${niveau}, clock_timestamp(), ${destinataire}, ${objet},
          ${corps}, ${messageId}, ${refus === undefined ? 'envoyee' : 'refusee'}
        )
        returning id`;
      return { id: ligne.id, niveau, refus };
    });

    // La transaction est validée : la ligne `refusee` est consignée, le 502 peut partir. Le statut de
    // Brevo va aux journaux de la fonction, sans rien de sa réponse ni de la clé.
    if (relance.refus !== undefined) {
      console.error(JSON.stringify({ relancer: 'refus de Brevo', statut: relance.refus }));
      throw erreur(
        502,
        'ENVOI',
        'Le service d’envoi a refusé l’e-mail : la relance n’est pas partie.',
      );
    }
    return json({ id: relance.id, niveau: relance.niveau }, 201);
  }),
);
