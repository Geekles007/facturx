/**
 * Edge Function `relancer` (spec § 9) : l'e-mail de relance d'une facture en retard, que l'utilisateur
 * a relu, part par Brevo avec le PDF de la facture en pièce jointe, et est consigné.
 *
 *   POST /functions/v1/relancer   { factureId, destinataire, objet, corps }
 *
 * Réponse 201 `{ id, niveau }`. Le niveau (1, rappel courtois ; 2, ferme ; 3, dernier rappel, qui se
 * répète) est le nombre de relances `envoyee` de la facture plus un, plafonné à 3. Si l'on ne sait pas
 * ce qu'est devenu l'e-mail (Brevo n'a pas répondu à temps, ou sa réponse est illisible), la réponse est
 * encore 201 mais porte `incertain: true` : l'e-mail a pu partir, il est consigné `envoyee` sans
 * identifiant de message, compte dans les limites, et une nouvelle tentative attend le délai. Le Studio
 * l'affiche comme « envoyée, à confirmer » plutôt que de proposer de réessayer aussitôt. Les
 * vérifications suivent le § 9, et chacune a son erreur (§ 13) :
 *
 *   1. 401 `SESSION` ; la forme du corps (422 `CORPS`, et 422 `DESTINATAIRE` pour une adresse qui n'est
 *      pas une seule adresse) ; la facture est lue dans l'entreprise du compte, sinon 403 `DROITS` ; son
 *      échéance est passée et son reste dû positif, sinon 422 `ANOMALIES` `PAS_DE_RETARD` ;
 *   2. adresse du compte confirmée (403 `NON_CONFIRME`) ; SIREN du vendeur renseigné (422 `SIREN`,
 *      `company.seller.siren`) ; une relance par facture tous les 72 heures et vingt par jour de Paris
 *      et par entreprise (`limites.ts`), sinon 429 `LIMITE` avec `details.reessayerApres` ;
 *   3. composition (`message.ts`) : le corps est échappé, l'objet sur une ligne, le destinataire une
 *      seule adresse. L'objet et le corps refusent (422 avec le `path` du champ) un caractère de
 *      contrôle autre que tabulation, saut de ligne et retour chariot, et un demi-substitut isolé ;
 *   4. envoi, 5. consignation. Un refus explicite de Brevo (4xx ou 5xx) est consigné aussi
 *      (`etat = 'refusee'`), puis 502 `ENVOI` : rien n'est parti, et la ligne ne compte ni pour le délai,
 *      ni pour le niveau, ni pour le plafond de 20 (elle compte pour le plafond lâche des refus).
 *
 * La facture est lue avec l'entreprise du compte pour seul filtre : une facture inconnue et celle
 * d'une autre entreprise donnent la même réponse (403 `DROITS`, même message), sans oracle. Pendant le
 * délai de grâce de la suppression du compte (spec § 12), la relance est refusée avant tout le reste
 * (403 `SUPPRESSION`, comme pour `emettre`).
 *
 * Les limites sont exactes sous concurrence : la transaction prend un verrou consultatif par
 * entreprise, avant de compter, et le garde jusqu'à la consignation. L'envoi se fait donc sous le
 * verrou : compter, essayer l'insertion, envoyer, consigner, valider. La transaction dure le temps de
 * l'appel à Brevo (15 secondes au plus), faute d'un état « en cours » dans `relances` (ajout seul, spec
 * § 6) : une relance consignée avant l'envoi, puis corrigée, serait une écriture de plus dans une table
 * figée, et un envoi hors verrou laisserait deux requêtes simultanées passer le même plafond. Seules
 * les relances de la même entreprise s'attendent, et pas plus de 10 secondes. Ce qui est lent et ne
 * dépend pas du verrou, la lecture du PDF, se fait avant lui.
 *
 * Rien ne part qui ne puisse être consigné : l'insertion de la ligne est d'abord essayée dans un point
 * de sauvegarde, défait aussitôt, avant l'appel à Brevo. Toute valeur que la base refuserait l'est ainsi
 * avant l'envoi, et non après, quand un e-mail serait parti sans trace et sans compter dans les limites.
 * Si la base tombe malgré tout entre l'envoi et la consignation, l'e-mail est parti sans trace : cas
 * rare, qu'on préfère à une relance consignée « envoyée » qui ne serait pas partie.
 */
import { aujourdhui, contexte, exigerCompteActif } from '../_shared/contexte.ts';
import { exigerAdmissible, lireObjetPortable, lireTexte, UUID } from '../_shared/corps.ts';
import { admin, sql } from '../_shared/db.ts';
import { type Anomalie, anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { EnvoiIncertain, ErreurBrevo, expediteurConfigure } from './brevo.ts';
import { appliquerLimites } from './limites.ts';
import { composer, destinataireValide, nettoyerObjet, uneLigne } from './message.ts';

/** Longueur du message, en caractères : au-delà, ce n'est plus une relance. */
const CORPS_MAX = 10_000;

/** Une requête de relance tient en quelques Kio ; ce plafond est celui de la lecture du corps. */
const PLAFOND_REQUETE = 100 * 1024;

/** L'identifiant que Brevo rend (une soixantaine de caractères) est borné avant d'être consigné. */
const MESSAGE_ID_MAX = 200;

/** Combien de temps la lecture du PDF dans le Storage peut durer, en millisecondes. */
const DELAI_PDF_MS = 10_000;

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
  if (typeof objet !== 'string') {
    throw refus({ code: 'CORPS', path: 'objet', message: 'Objet de l’e-mail attendu.' });
  }
  if (typeof corps !== 'string') {
    throw refus({ code: 'CORPS', path: 'corps', message: 'Message attendu.' });
  }
  // Ce qui part dans l'e-mail est aussi ce qui est consigné : un caractère que la base refuse (le NUL)
  // ferait échouer la consignation après l'envoi. Rien d'autre que `\t`, `\n` et `\r` comme contrôle.
  exigerAdmissible({ objet, corps }, '', 'CORPS', message, true);

  const objetNettoye = nettoyerObjet(objet);
  if (objetNettoye === '') {
    throw refus({ code: 'CORPS', path: 'objet', message: 'Objet de l’e-mail attendu.' });
  }
  if (corps.trim() === '' || [...corps].length > CORPS_MAX) {
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
    // 1. Authentifier : l'entreprise vient du jeton, par `membres` ; la suppression du compte ne doit
    // pas être demandée.
    const ctx = await contexte(req);
    exigerCompteActif(ctx, SANS_ENVOI);
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
    if (facture.echeance === null || facture.echeance >= aujourdhui(req) || !facture.du) {
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

    // Le PDF de la facture, lu avant le verrou (la facture est figée, et la lecture est lente), avec
    // les droits du service : son chemin est celui que la ligne de l'entreprise porte, et il doit être
    // dans le dossier de l'entreprise (spec § 11).
    if (!facture.pdf_chemin.startsWith(`${e}/`)) {
      throw new Error('Le chemin du PDF de la facture sort du dossier de l’entreprise.');
    }
    const depot = await admin()
      .storage.from('factures')
      .download(facture.pdf_chemin, undefined, { signal: AbortSignal.timeout(DELAI_PDF_MS) });
    if (depot.error) throw depot.error;
    const pdf = new Uint8Array(await depot.data.arrayBuffer());

    // 3. La transaction, sur la connexion directe : verrou de l'entreprise et limites, essai de la
    // consignation, composition, envoi, consignation (voir l'en-tête).
    const relance = await sql.begin(async (tx) => {
      const niveau = await appliquerLimites(tx, e, factureId, req);

      // Les lignes que la relance référence (clés étrangères) sont tenues jusqu'à la fin de la
      // transaction : l'essai de consignation ci-dessous les prend aussi, mais sa défaite aussitôt les
      // relâche, et la purge d'un compte (`purger`) pourrait supprimer l'entreprise pendant l'appel à
      // Brevo, puis faire échouer la vraie consignation après l'envoi. Ainsi tenues, elles ne se
      // suppriment qu'après la relance (la purge attend, puis reprend la nuit suivante). L'entreprise
      // d'abord, comme la suppression en cascade de la purge : deux ordres inverses s'interbloqueraient.
      // Supprimées depuis la lecture de la facture, elles ne sont pas trouvées, et l'essai de
      // consignation échoue sur la clé étrangère, avant tout envoi.
      await tx`select 1 from public.entreprises where id = ${e} for key share`;
      await tx`
        select 1 from public.factures where entreprise_id = ${e} and id = ${factureId}
           for key share`;

      const consigner = (q: typeof tx, etat: 'envoyee' | 'refusee', messageId: string | null) =>
        q<{ id: string }[]>`
          insert into public.relances (
            entreprise_id, facture_id, niveau, envoyee_le, destinataire, objet, corps, message_id,
            etat
          ) values (
            ${e}, ${factureId}, ${niveau}, clock_timestamp(), ${destinataire}, ${objet}, ${corps},
            ${messageId}, ${etat}
          )
          returning id`;

      // L'essai : la même ligne, défaite aussitôt. Si la base la refuse, c'est avant l'envoi.
      const essai = new Error('essai de consignation');
      try {
        await tx.savepoint(async (sp) => {
          await consigner(sp, 'envoyee', null);
          throw essai;
        });
      } catch (echec) {
        if (echec !== essai) throw echec;
      }

      const message = composer({
        objet,
        corps,
        entreprise: vendeur.nom ?? '',
        destinataire,
        replyTo: ctx.email,
        numero: facture.numero,
        pdf,
      });

      // 4. L'envoi, sous le verrou. Un refus de Brevo ne lève pas ici : lever annulerait la
      // transaction, et la ligne `refusee` avec elle. Une issue inconnue se consigne comme un envoi.
      // Toute autre exception est une panne (500).
      let messageId: string | null = null;
      let refus: number | undefined;
      let incertain = false;
      try {
        ({ messageId } = await expediteur.envoyer(message));
      } catch (echec) {
        if (echec instanceof ErreurBrevo) refus = echec.statut;
        else if (echec instanceof EnvoiIncertain) incertain = true;
        else throw echec;
      }

      // 5. Consigner, dans tous les cas. L'instant est celui de l'envoi, et non du début de la
      // transaction : une requête qui a attendu le verrou ne date pas sa relance d'avant celle qui l'a
      // précédée. L'identifiant que Brevo rend est nettoyé (une ligne, 200 caractères) : ce n'est pas
      // nous qui l'avons écrit.
      const identifiant = messageId === null ? '' : uneLigne(messageId, MESSAGE_ID_MAX);
      const [ligne] = await consigner(
        tx,
        refus === undefined ? 'envoyee' : 'refusee',
        identifiant === '' ? null : identifiant,
      );
      return { id: ligne.id, niveau, refus, incertain };
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
    if (relance.incertain) {
      console.error(JSON.stringify({ relancer: 'issue de l’envoi inconnue chez Brevo' }));
      return json({ id: relance.id, niveau: relance.niveau, incertain: true }, 201);
    }
    return json({ id: relance.id, niveau: relance.niveau }, 201);
  }),
);
