/**
 * Edge Function `importer` (spec § 6, « Importer les données locales ») : une facture émise en
 * local, dans le Studio sans compte, entre dans le compte avec `origine = 'importee'`, lue dans son
 * PDF Factur-X. Le navigateur ne peut pas écrire dans `factures` : l'import passe par cette fonction.
 *
 *   POST /functions/v1/importer   { form, appearance, pdf },
 *                                 en JSON portable, 10 Mio au plus
 *
 * `form` et `appearance` sont ceux du `SavedInvoice` du Studio : la fonction les stocke sans les lire
 * (elle n'exige que des objets), comme le PDF, déposé tel quel. La facture, son numéro, sa date et ses
 * montants viennent du seul PDF (`extractInvoice`) : ce que le formulaire en dit ne compte pas.
 * Réponse 201 `{ id, numero }`. Erreurs (§ 13) : 401 `SESSION`, 403 `DROITS`, `NON_CONFIRME` ou
 * `SUPPRESSION` (pendant le délai de grâce de la suppression du compte, spec § 12, comme pour `emettre`),
 * 409 `DOUBLON`, 413, 422 `ANOMALIES`, 429 `LIMITE` et 500 `INTERNE`.
 *
 * Le numéro n'a pas été attribué par le serveur : il est celui de la numérotation locale. L'import est
 * donc idempotent par numéro, dans l'entreprise du compte et dans elle seule : un numéro déjà là donne
 * 409 `DOUBLON`, un numéro d'une autre entreprise n'empêche rien et ne se voit pas. Le contrôle n'est
 * exact que sous le verrou de la ligne `numerotation` de l'entreprise, que prend aussi `emettre`.
 * L'import ne modifie pas `numerotation` : la reprise des réglages de numérotation du Studio est
 * l'affaire de l'import des données locales (tâche 20).
 *
 * Aucune validation EN 16931 : une facture émise en local est importée telle quelle (le SDK la lit sans
 * la valider) ; seule une facture Factur-X illisible, ou que la base ne saurait enregistrer (date de
 * l'an 0, caractère nul, type ou devise mal formés), est refusée (422). Ces refus, comme ceux du corps,
 * précèdent le verrou et le dépôt. L'import reprend un historique : aucune date passée n'est refusée.
 * Une date d'émission postérieure à aujourd'hui (Paris, comme `emettre`, horloge des tests comprise)
 * l'est (422, anomalie `DATE` sur `invoice.issueDate`) : `emettre` n'admet aucune date antérieure à
 * la dernière facture du compte, et une faute de frappe locale (2062 pour 2026) bloquerait toutes les
 * émissions suivantes, sans recours.
 *
 * Plafond (Ruling 34) : 500 imports par heure et par entreprise, comptés sous le verrou ; au-delà,
 * 429 `LIMITE` (`details.reessayerApres`). Une facture importée est figée, et son PDF ne part qu'avec
 * la purge du compte : c'est la seule écriture irréversible sans plafond. Le doublon (409) passe
 * avant le plafond : reprendre un import interrompu ne compte pas ce qui est déjà là.
 *
 * Tout refus survient avant le dépôt du PDF ; seul un PDF déposé dont l'enregistrement échoue peut
 * rester sans facture : l'Edge Function `purger` efface ces orphelins au bout d'un jour.
 */
import { FacturXParseError, type Invoice, isValidIsoDate } from 'facturx-sdk';
import { extractInvoice, FacturXPdfError } from 'facturx-sdk/pdf';
import { aujourdhui, contexte, exigerCompteActif } from '../_shared/contexte.ts';
import {
  estObjet,
  exigerAdmissible,
  lireObjetPortable,
  lireTexte,
  PLAFOND_CORPS,
  serialiser,
} from '../_shared/corps.ts';
import { dateAdmise } from '../_shared/dates.ts';
import { admin, sql } from '../_shared/db.ts';
import { type Anomalie, anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { enregistrerFacture, reessayerApres } from '../_shared/factures.ts';

const SANS_IMPORT = 'rien n’a été importé';

/** Imports par heure et par entreprise (Ruling 34), comptés sur `factures.emise_le`. */
const LIMITE_PAR_HEURE = 500;

/** Longueur d'un numéro de facture (BR-FR-01) : celle de la numérotation du Studio, au plus. */
const NUMERO_MAX = 35;

/** Au-delà, un message du SDK est tronqué : il peut citer la valeur fautive, de toute longueur. */
const MESSAGE_MAX = 300;

/**
 * Limites de lecture du PDF, à la mesure d'un worker de 256 Mo : le PDF tient dans le corps
 * (`PLAFOND_CORPS`), et aucun de ses flux ne se décompresse au-delà ; le XML d'une facture du
 * Studio pèse quelques dizaines de Ko. Les défauts du SDK (100 Mio, 64 Mio) laisseraient une pièce
 * de quelques Ko gonfler jusqu'à 128 Mio avant d'être refusée.
 */
const LIMITES_PDF = { pdfBytes: PLAFOND_CORPS, xmlBytes: 4 * 1024 * 1024 };

/** Le corps de la requête : le formulaire et l'apparence en texte JSON portable, le PDF en octets. */
interface Corps {
  form: string;
  appearance: string;
  pdf: Uint8Array;
}

/**
 * Le corps de la requête, vérifié dans sa forme ; la facture l'est dans le PDF. `form` et `appearance`
 * sont sérialisés ici, une fois : le texte est celui que la transaction enregistre.
 */
function lireCorps(texte: string): Corps {
  const message = `La demande d’import est illisible : ${SANS_IMPORT}.`;
  const refus = (path: string, detail: string) =>
    anomalies([{ code: 'CORPS', path, message: detail }], message);
  const corps = lireObjetPortable(texte, message);
  if (!estObjet(corps.form)) throw refus('form', 'Formulaire (objet) attendu.');
  if (!estObjet(corps.appearance)) throw refus('appearance', 'Apparence (objet) attendue.');
  if (!(corps.pdf instanceof Uint8Array)) throw refus('pdf', 'PDF (octets) attendu.');
  // Ce que `jsonb` refuserait (caractère nul, demi-substitut isolé, imbrication que `toPortableJson`
  // ne sait pas écrire) : `form` et `appearance` ne sont pas lus, mais ils iront en base, et un refus
  // ne doit venir ni après le verrou ni après le dépôt du PDF.
  exigerAdmissible(corps.form, 'form', 'CORPS', message);
  exigerAdmissible(corps.appearance, 'appearance', 'CORPS', message);
  return {
    form: serialiser(corps.form, 'form', 'CORPS', message),
    appearance: serialiser(corps.appearance, 'appearance', 'CORPS', message),
    pdf: corps.pdf,
  };
}

/** Une date lue, valide et enregistrable (l'an 0 se lit 1900 et la base le refuse). */
const dateLisible = (date: string): boolean => isValidIsoDate(date) && dateAdmise(date);

/**
 * La facture embarquée dans le PDF, lue sans validation, et son texte JSON portable ; sinon lève 422
 * `ANOMALIES` (`Issue` de code `FACTURX`). Le SDK lit sans valider : la lecture laisse passer ce que
 * la base refuserait ensuite, et ce serait un 500 après le dépôt du PDF (type, devise ou numéro mal
 * formés ; date vide ou de l'an 0 ; caractère nul ou demi-substitut isolé, que le XML porte en `&#0;`
 * ou `&#xD800;`). Ces valeurs-là sont donc contrôlées ici, et elles seules : de quoi ranger la
 * facture, sans juger de son contenu. Le lecteur garantit déjà la présence et la forme du reste
 * (acheteur, montants entiers en centimes). Une date d'émission lisible mais postérieure à
 * `jour` (aujourd'hui à Paris) donne une `Issue` de code `DATE`, avec la date et le jour admis au
 * plus (`details`) : voir l'en-tête.
 */
async function lireFacture(
  pdf: Uint8Array,
  jour: string,
): Promise<{ invoice: Invoice; json: string }> {
  const message = `Le PDF n’est pas une facture Factur-X lisible : ${SANS_IMPORT}.`;
  const refus = (liste: Anomalie[]) => anomalies(liste, message);
  let lue: Awaited<ReturnType<typeof extractInvoice>>;
  try {
    lue = await extractInvoice(pdf, { validate: false, limits: LIMITES_PDF });
  } catch (e) {
    // Un PDF illisible ou chiffré, un XML qui n'est pas du CII : le fait du fichier reçu, pas une
    // panne. Le message du SDK cite parfois la valeur fautive (« Nombre invalide « … » ») : il ne va
    // qu'à l'expéditeur du PDF, dans cette réponse 422, jamais aux journaux (`traiter` ne journalise
    // que les exceptions imprévues) ; une valeur citée démesurée est tronquée.
    if (e instanceof FacturXPdfError || e instanceof FacturXParseError) {
      const detail =
        e.message.length > MESSAGE_MAX ? `${e.message.slice(0, MESSAGE_MAX)}…` : e.message;
      throw refus([{ code: 'FACTURX', path: 'pdf', message: detail }]);
    }
    throw e;
  }
  if (!lue) {
    throw refus([
      { code: 'FACTURX', path: 'pdf', message: 'Le PDF ne contient pas de pièce Factur-X.' },
    ]);
  }

  const { invoice } = lue;
  exigerAdmissible(invoice, 'invoice', 'FACTURX', message);
  const problemes: Anomalie[] = [];
  const probleme = (path: string, detail: string) =>
    problemes.push({ code: 'FACTURX', path: `invoice.${path}`, message: detail });
  if (invoice.id === '' || invoice.id.length > NUMERO_MAX) {
    probleme('id', `Numéro de facture (BT-1) attendu, de ${NUMERO_MAX} caractères au plus.`);
  }
  if (!/^[0-9]{3}$/.test(invoice.typeCode)) {
    probleme('typeCode', 'Code type de document (BT-3) de trois chiffres attendu.');
  }
  // Un `IssueDateTime` absent donne une date vide.
  if (!dateLisible(invoice.issueDate)) probleme('issueDate', 'Date d’émission (BT-2) invalide.');
  else if (invoice.issueDate > jour) {
    problemes.push({
      code: 'DATE',
      path: 'invoice.issueDate',
      message: `Date d’émission (BT-2) ${invoice.issueDate} postérieure à aujourd’hui (${jour}) : elle bloquerait toute émission suivante.`,
      details: { date: invoice.issueDate, max: jour },
    });
  }
  const echeance = invoice.paymentTerms?.dueDate;
  if (echeance !== undefined && !dateLisible(echeance)) {
    probleme('paymentTerms.dueDate', 'Date d’échéance (BT-9) invalide.');
  }
  if (!/^[A-Z]{3}$/.test(invoice.currency)) {
    probleme('currency', 'Code devise (BT-5) de trois lettres majuscules attendu.');
  }
  if (problemes.length > 0) throw refus(problemes);
  return { invoice, json: serialiser(invoice, 'invoice', 'FACTURX', message) };
}

Deno.serve(
  traiter(async (req) => {
    // Tiré dès le début : il nomme le PDF, déposé avant que la facture soit enregistrée.
    const factureId = crypto.randomUUID();

    // 1. Authentifier : l'entreprise vient du jeton, par `membres` ; l'adresse doit être confirmée, et
    // la suppression du compte ne pas être demandée, comme pour émettre.
    const ctx = await contexte(req);
    exigerCompteActif(ctx, SANS_IMPORT);
    if (!ctx.confirme) {
      throw erreur(
        403,
        'NON_CONFIRME',
        'Confirmez l’adresse e-mail du compte avant d’importer des factures.',
      );
    }
    const { form, appearance, pdf } = lireCorps(await lireTexte(req));
    const e = ctx.entrepriseId;

    // 2. Lire la facture dans le PDF, avant de prendre le verrou : la lecture est la partie longue.
    const { invoice: facture, json: factureJson } = await lireFacture(pdf, aujourdhui(req));

    // 3. La transaction, sur la connexion directe.
    const importee = await sql.begin(async (tx) => {
      // Le verrou fait se suivre les imports et les émissions de l'entreprise : le contrôle du doublon
      // qui suit n'est exact que sous lui, la contrainte d'unicité ne ferait que lever une erreur.
      // La ligne n'est que verrouillée : l'import ne change pas la numérotation.
      const [ligne] = await tx`
        select 1 from public.numerotation where entreprise_id = ${e} for update`;
      if (!ligne) throw new Error('numérotation absente pour l’entreprise');

      // 4. Idempotent par numéro, dans l'entreprise du compte seulement : un numéro d'une autre
      // entreprise ne se distingue pas d'un numéro libre.
      const [existant] = await tx`
        select 1 from public.factures where entreprise_id = ${e} and numero = ${facture.id}`;
      if (existant) {
        throw erreur(409, 'DOUBLON', `Le numéro ${facture.id} existe déjà : ${SANS_IMPORT}.`, {
          numero: facture.id,
        });
      }

      // 5. Le plafond horaire, exact sous le verrou : le 500e import de l'heure, s'il y en a un, dit
      // quand la fenêtre se libère.
      const libre = await reessayerApres(tx, e, 'importee', LIMITE_PAR_HEURE);
      if (libre) {
        throw erreur(
          429,
          'LIMITE',
          `${LIMITE_PAR_HEURE} factures importées dans l’heure : réessayez plus tard. ${SANS_IMPORT}.`,
          { reessayerApres: libre.toISOString() },
        );
      }

      // 6. Un avoir cite la facture qu'il corrige : la première des références, si l'entreprise l'a
      // déjà (l'import se fait dans l'ordre des dates, factures avant avoirs) et dans la devise de
      // l'avoir, sinon aucune origine, et jamais d'erreur. Un avoir est dans la devise de sa facture
      // (Ruling 49) : rattaché à une facture d'une autre devise, il en retrancherait son TTC sans
      // conversion, et la base le refuserait (`AVOIR_DEVISE`, migration 000900) ; importé sans origine,
      // il reste dans l'historique. La liste des types d'avoir est celle de la base, que la vue de
      // suivi applique aussi.
      let origine: string | null = null;
      const citee = facture.references?.precedingInvoices?.[0]?.id;
      const [{ avoir }] = await tx<{ avoir: boolean }[]>`
        select public.est_un_avoir(${facture.typeCode}) as avoir`;
      if (avoir && typeof citee === 'string') {
        const [trouvee] = await tx<{ id: string }[]>`
          select id from public.factures
           where entreprise_id = ${e} and numero = ${citee} and devise = ${facture.currency}`;
        origine = trouvee?.id ?? null;
      }

      // 7. Déposer le PDF reçu, sous un chemin que le serveur construit, avant d'enregistrer la
      // facture qui le désigne.
      const pdfChemin = `${e}/${factureId}.pdf`;
      const depot = await admin()
        .storage.from('factures')
        .upload(pdfChemin, pdf, { contentType: 'application/pdf', upsert: false });
      if (depot.error) throw depot.error;

      // 8. Enregistrer la facture : montants et date de la facture lue, `emise_le` à l'heure de
      // l'import, ni brouillon ni client de la bibliothèque.
      await enregistrerFacture(tx, {
        id: factureId,
        entrepriseId: e,
        facture,
        clientId: null,
        invoice: factureJson,
        form,
        appearance,
        pdfChemin,
        factureOrigineId: origine,
        brouillonId: null,
        origine: 'importee',
        emisePar: ctx.userId,
      });
      return { id: factureId, numero: facture.id };
    });

    return json(importee, 201);
  }),
);
