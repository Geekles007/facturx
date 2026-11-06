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
 * Réponse 201 `{ id, numero }`. Erreurs (§ 13) : 401 `SESSION`, 403 `DROITS` ou `NON_CONFIRME`,
 * 409 `DOUBLON`, 413, 422 `ANOMALIES` et 500 `INTERNE`. Le refus pendant le délai de suppression du
 * compte (403 `SUPPRESSION`) viendra avec la tâche 12, comme pour `emettre`.
 *
 * Le numéro n'a pas été attribué par le serveur : il est celui de la numérotation locale. L'import est
 * donc idempotent par numéro, dans l'entreprise du compte et dans elle seule : un numéro déjà là donne
 * 409 `DOUBLON`, un numéro d'une autre entreprise n'empêche rien et ne se voit pas. Le contrôle n'est
 * exact que sous le verrou de la ligne `numerotation` de l'entreprise, que prend aussi `emettre`.
 * L'import ne modifie pas `numerotation` : la reprise des réglages de numérotation du Studio est
 * l'affaire de l'import des données locales (tâche 20).
 *
 * Aucune validation EN 16931 : une facture émise en local est importée telle quelle (le SDK la lit sans
 * la valider) ; seule une facture Factur-X illisible, ou à laquelle manque de quoi la ranger dans
 * `factures`, est refusée (422). Ni date bornée, ni limite de débit : l'import reprend un historique.
 *
 * Tout refus survient avant le dépôt du PDF ; seul un PDF déposé dont l'enregistrement échoue peut
 * rester sans facture : l'Edge Function `purger` efface ces orphelins au bout d'un jour.
 */
import { FacturXParseError, type Invoice, isValidIsoDate } from 'facturx-sdk';
import { extractInvoice, FacturXPdfError } from 'facturx-sdk/pdf';
import { contexte } from '../_shared/contexte.ts';
import { estObjet, lireObjetPortable, lireTexte } from '../_shared/corps.ts';
import { admin, sql } from '../_shared/db.ts';
import { type Anomalie, anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { SDK_VERSION } from '../_vendor/sdk-version.ts';
import { toPortableJson } from '../_vendor/shared/portable.ts';

const SANS_IMPORT = 'rien n’a été importé';

/** Longueur d'un numéro de facture (BR-FR-01) : celle de la numérotation du Studio, au plus. */
const NUMERO_MAX = 35;

interface Corps {
  form: Record<string, unknown>;
  appearance: Record<string, unknown>;
  pdf: Uint8Array;
}

/** Le corps de la requête, vérifié dans sa forme ; la facture l'est dans le PDF. */
function lireCorps(texte: string): Corps {
  const message = `La demande d’import est illisible : ${SANS_IMPORT}.`;
  const refus = (path: string, detail: string) =>
    anomalies([{ code: 'CORPS', path, message: detail }], message);
  const corps = lireObjetPortable(texte, message);
  if (!estObjet(corps.form)) throw refus('form', 'Formulaire (objet) attendu.');
  if (!estObjet(corps.appearance)) throw refus('appearance', 'Apparence (objet) attendue.');
  if (!(corps.pdf instanceof Uint8Array)) throw refus('pdf', 'PDF (octets) attendu.');
  return { form: corps.form, appearance: corps.appearance, pdf: corps.pdf };
}

/**
 * La facture embarquée dans le PDF, lue sans validation ; sinon lève 422 `ANOMALIES` (`Issue` de
 * code `FACTURX`). Le SDK lit sans valider : la lecture laisse passer ce que la base refuserait ensuite
 * (type, devise ou numéro mal formés, montants absents), et ce serait un 500. Ces valeurs-là sont donc
 * contrôlées ici, et elles seules : de quoi ranger la facture, sans juger de son contenu.
 */
async function lireFacture(pdf: Uint8Array): Promise<Invoice> {
  const refus = (liste: Anomalie[]) =>
    anomalies(liste, `Le PDF n’est pas une facture Factur-X lisible : ${SANS_IMPORT}.`);
  let lue: Awaited<ReturnType<typeof extractInvoice>>;
  try {
    lue = await extractInvoice(pdf, { validate: false });
  } catch (e) {
    // Un PDF illisible ou chiffré, un XML qui n'est pas du CII : le fait du fichier reçu, pas une
    // panne. Les messages du SDK décrivent l'anomalie sans citer la facture.
    if (e instanceof FacturXPdfError || e instanceof FacturXParseError) {
      throw refus([{ code: 'FACTURX', path: 'pdf', message: e.message }]);
    }
    throw e;
  }
  if (!lue) {
    throw refus([
      { code: 'FACTURX', path: 'pdf', message: 'Le PDF ne contient pas de pièce Factur-X.' },
    ]);
  }

  const { invoice } = lue;
  const problemes: Anomalie[] = [];
  const probleme = (path: string, message: string) =>
    problemes.push({ code: 'FACTURX', path: `invoice.${path}`, message });
  if (typeof invoice.id !== 'string' || invoice.id === '' || invoice.id.length > NUMERO_MAX) {
    probleme('id', `Numéro de facture (BT-1) attendu, de ${NUMERO_MAX} caractères au plus.`);
  }
  if (!/^[0-9]{3}$/.test(String(invoice.typeCode))) {
    probleme('typeCode', 'Code type de document (BT-3) de trois chiffres attendu.');
  }
  if (typeof invoice.issueDate !== 'string' || !isValidIsoDate(invoice.issueDate)) {
    probleme('issueDate', 'Date d’émission (BT-2) invalide.');
  }
  const echeance = invoice.paymentTerms?.dueDate;
  if (echeance !== undefined && (typeof echeance !== 'string' || !isValidIsoDate(echeance))) {
    probleme('paymentTerms.dueDate', 'Date d’échéance (BT-9) invalide.');
  }
  if (!/^[A-Z]{3}$/.test(String(invoice.currency))) {
    probleme('currency', 'Code devise (BT-5) de trois lettres majuscules attendu.');
  }
  if (typeof invoice.buyer?.name !== 'string') {
    probleme('buyer.name', 'Nom de l’acheteur (BT-44) attendu.');
  }
  for (const montant of [
    'taxExclusiveAmount',
    'taxInclusiveAmount',
    'amountDueForPayment',
  ] as const) {
    if (!Number.isSafeInteger(invoice.totals?.[montant])) {
      probleme(`totals.${montant}`, 'Montant en centimes attendu.');
    }
  }
  if (problemes.length > 0) throw refus(problemes);
  return invoice;
}

Deno.serve(
  traiter(async (req) => {
    // Tiré dès le début : il nomme le PDF, déposé avant que la facture soit enregistrée.
    const factureId = crypto.randomUUID();

    // 1. Authentifier : l'entreprise vient du jeton, par `membres` ; l'adresse doit être confirmée,
    // comme pour émettre.
    const ctx = await contexte(req);
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
    const facture = await lireFacture(pdf);

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

      // 5. Un avoir cite la facture qu'il corrige : la première des références, si l'entreprise l'a
      // déjà (l'import se fait dans l'ordre des dates, factures avant avoirs), sinon aucune origine,
      // et jamais d'erreur. La liste des types d'avoir est celle de la base, que la vue de suivi
      // applique aussi.
      let origine: string | null = null;
      const citee = facture.references?.precedingInvoices?.[0]?.id;
      const [{ avoir }] = await tx<{ avoir: boolean }[]>`
        select public.est_un_avoir(${facture.typeCode}) as avoir`;
      if (avoir && typeof citee === 'string') {
        const [trouvee] = await tx<{ id: string }[]>`
          select id from public.factures where entreprise_id = ${e} and numero = ${citee}`;
        origine = trouvee?.id ?? null;
      }

      // 6. Déposer le PDF reçu, sous un chemin que le serveur construit, avant d'enregistrer la
      // facture qui le désigne.
      const pdfChemin = `${e}/${factureId}.pdf`;
      const depot = await admin()
        .storage.from('factures')
        .upload(pdfChemin, pdf, { contentType: 'application/pdf', upsert: false });
      if (depot.error) throw depot.error;

      // 7. Enregistrer la facture : montants et date de la facture lue, `emise_le` à l'heure de
      // l'import, ni brouillon ni client de la bibliothèque. Les JSON passent en `text` avant `jsonb`
      // (voir `emettre`), et la colonne reçoit des objets.
      await tx`
        insert into public.factures (
          id, entreprise_id, numero, type_code, date_emission, date_echeance, client_id, client_nom,
          client_email, devise, ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin,
          sdk_version, facture_origine_id, brouillon_id, origine, emise_par
        ) values (
          ${factureId}, ${e}, ${facture.id}, ${facture.typeCode}, ${facture.issueDate},
          ${facture.paymentTerms?.dueDate ?? null}, null, ${facture.buyer.name},
          ${facture.buyer.contact?.email || null}, ${facture.currency},
          ${facture.totals.taxExclusiveAmount}, ${facture.totals.taxInclusiveAmount},
          ${facture.totals.amountDueForPayment}, ${toPortableJson(facture)}::text::jsonb,
          ${toPortableJson(form)}::text::jsonb, ${toPortableJson(appearance)}::text::jsonb,
          ${pdfChemin}, ${SDK_VERSION}, ${origine}, null, 'importee', ${ctx.userId}
        )`;
      return { id: factureId, numero: facture.id };
    });

    return json(importee, 201);
  }),
);
