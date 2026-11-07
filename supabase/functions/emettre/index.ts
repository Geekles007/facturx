/**
 * Edge Function `emettre` (spec § 7) : le brouillon d'une entreprise devient une facture émise, avec
 * le numéro que le serveur attribue, validée par le SDK, son PDF Factur-X déposé, le tout dans une
 * transaction.
 *
 *   POST /functions/v1/emettre   { brouillonId, version, invoice, appearance, clientId? },
 *                                en JSON portable, 10 Mio au plus
 *
 * `invoice` est construite par le Studio (traduction du formulaire, `computeTotals`) et porte le
 * numéro qu'il propose ; le serveur le remplace par celui qu'il attribue. `clientId`, l'uid du client
 * dans la bibliothèque du Studio, n'est retenu que s'il désigne un client de l'entreprise (Ruling 29).
 * Réponse 201 `{ id, numero }`, ou 200 avec le même corps pour un rejeu du même brouillon. Erreurs
 * (§ 13) : 401 `SESSION`, 403 `DROITS`, `NON_CONFIRME` ou `SUPPRESSION` (pendant le délai de grâce de la
 * suppression du compte, spec § 12), 409 `BROUILLON_MODIFIE`, `DATE` ou `DOUBLON`, 413 et 422
 * `ANOMALIES`, 429 `LIMITE`, 500 `INTERNE`.
 *
 * Outre les bornes du § 7 (étape 5), une numérotation annuelle n'admet pas de date antérieure au
 * 1er janvier de son année (Ruling 30) : une facture de l'année précédente prendrait le rang 1 de la
 * série en cours. Elle passe par l'import des factures locales.
 *
 * Tout refus survient avant la validation de la transaction : aucun numéro n'est consommé, et le
 * brouillon reste intact. Seul un PDF déjà déposé peut rester sans facture (étape 9) : l'Edge
 * Function `purger` efface ces orphelins au bout d'un jour, et on ne tente pas de le faire ici, dans
 * un chemin d'erreur qui pourrait lui-même échouer.
 */
import { type Invoice, isValidIsoDate, validateInvoice } from 'facturx-sdk';
import type postgres from 'postgres';
import { aujourdhui, contexte, exigerCompteActif } from '../_shared/contexte.ts';
import {
  estObjet,
  exigerAdmissible,
  lireObjetPortable,
  lireTexte,
  serialiser,
  UUID,
} from '../_shared/corps.ts';
import { dateAdmise } from '../_shared/dates.ts';
import { admin, sql } from '../_shared/db.ts';
import { type Anomalie, anomalies, erreur, json, traiter } from '../_shared/erreurs.ts';
import { enregistrerFacture, reessayerApres } from '../_shared/factures.ts';
import { type ApparenceEmise, lireApparence, produirePdf } from '../_shared/pdf.ts';
import {
  advance,
  formatNumber,
  type Numbering,
  nextRank,
  numberProblems,
} from '../_vendor/shared/numerotation.ts';
import { controlerDate } from './regles.ts';

/** Émissions par heure et par compte (spec § 11), comptées sur `factures.emise_le`. */
const LIMITE_PAR_HEURE = 60;

const SANS_NUMERO = 'aucun numéro n’a été consommé';

/** `sql` ou la transaction ouverte par `sql.begin`. */
type Requetes = postgres.ISql;

interface Corps {
  brouillonId: string;
  version: number;
  invoice: Invoice;
  appearance: ApparenceEmise;
  /** L'apparence en texte JSON portable : sérialisée une fois, à la lecture du corps. */
  appearanceJson: string;
  clientId: string | undefined;
}

/** Le corps de la requête, vérifié dans sa forme ; la facture elle-même l'est par le SDK. */
function lireCorps(texte: string): Corps {
  const message = `La demande d’émission est illisible : ${SANS_NUMERO}.`;
  const refus = (anomalie: Anomalie) => anomalies([anomalie], message);
  const corps = lireObjetPortable(texte, message);
  if (typeof corps.brouillonId !== 'string' || !UUID.test(corps.brouillonId)) {
    throw refus({
      code: 'CORPS',
      path: 'brouillonId',
      message: 'Identifiant de brouillon attendu.',
    });
  }
  if (!Number.isInteger(corps.version)) {
    throw refus({ code: 'CORPS', path: 'version', message: 'Version du brouillon attendue.' });
  }
  if (!estObjet(corps.invoice)) {
    throw refus({ code: 'CORPS', path: 'invoice', message: 'Facture attendue.' });
  }
  if (corps.clientId != null && typeof corps.clientId !== 'string') {
    throw refus({ code: 'CORPS', path: 'clientId', message: 'Identifiant de client attendu.' });
  }
  // Le client est cherché par ce texte, après le dépôt du PDF : un caractère nul ferait lever la requête.
  exigerAdmissible(corps.clientId, 'clientId', 'CORPS', message);
  // Les textes que `jsonb` refuserait (caractère nul, demi-substitut isolé) : un 500 à l'étape 10,
  // après le dépôt du PDF. La facture se lit depuis sa racine, comme les `Issue` du SDK.
  exigerAdmissible(corps.invoice, '', 'CORPS', message);
  const appearance = lireApparence(corps.appearance);
  exigerAdmissible(appearance, 'appearance', 'CORPS', message);
  const appearanceJson = serialiser(appearance, 'appearance', 'CORPS', message);
  // La date est lue avant la validation (étapes 5 et 6) : elle doit déjà être une date, de l'an 1
  // au moins (Postgres refuse l'an 0, que `isValidIsoDate` admet) ; l'échéance de même, que la
  // validation laisse passer.
  const refusDate = (path: string, detail: string) =>
    anomalies(
      [{ code: 'FORMAT-DATE', path, message: detail }],
      `La facture comporte des anomalies : ${SANS_NUMERO}.`,
    );
  const { issueDate, paymentTerms } = corps.invoice;
  if (typeof issueDate !== 'string' || !isValidIsoDate(issueDate) || !dateAdmise(issueDate)) {
    throw refusDate('issueDate', 'Date d’émission (BT-2) invalide.');
  }
  const echeance = estObjet(paymentTerms) ? paymentTerms.dueDate : undefined;
  if (typeof echeance === 'string' && isValidIsoDate(echeance) && !dateAdmise(echeance)) {
    throw refusDate('paymentTerms.dueDate', 'Date d’échéance (BT-9) invalide.');
  }
  return {
    brouillonId: corps.brouillonId,
    version: corps.version as number,
    invoice: corps.invoice as unknown as Invoice,
    appearance,
    appearanceJson,
    clientId: corps.clientId ?? undefined,
  };
}

/**
 * Un avoir est dans la devise des factures qu'il cite (Ruling 49) : la vue de suivi et le contrôle des
 * paiements déduisent son TTC du reste dû de sa facture, sans conversion, et la base refuse l'écriture
 * d'un tel avoir (`AVOIR_DEVISE`, migration 000900). Le refus vient ici, avant le verrou et avant le
 * dépôt du PDF : 422 `ANOMALIES`, une `Issue` sur la devise (`currency`). Seules les factures de
 * l'entreprise sont lues : un numéro d'une autre entreprise ne laisse rien voir de sa devise (il
 * reste inconnu, `ORIGINE` à l'étape 8). Une facture émise ne change plus : le contrôle n'a pas besoin
 * du verrou. Une facture que le SDK ne saurait lire (type, devise ou références absents) passe ici
 * sans contrôle : la validation la refusera.
 */
async function controlerDeviseDeLAvoir(e: string, invoice: Invoice): Promise<void> {
  const { typeCode, currency } = invoice as { typeCode?: unknown; currency?: unknown };
  const references = (invoice as { references?: { precedingInvoices?: unknown } }).references;
  const precedentes = references?.precedingInvoices;
  if (typeof typeCode !== 'string' || typeof currency !== 'string' || !Array.isArray(precedentes)) {
    return;
  }
  const numeros = precedentes.flatMap((p) =>
    estObjet(p) && typeof p.id === 'string' && p.id !== '' ? [p.id] : [],
  );
  if (numeros.length === 0) return;
  const autres = await sql<{ numero: string; devise: string }[]>`
    select numero, devise from public.factures
     where public.est_un_avoir(${typeCode}) and entreprise_id = ${e}
       and numero in ${sql(numeros)} and devise <> ${currency}
     order by numero`;
  if (autres.length === 0) return;
  const citees = autres.map((f) => `${f.numero} (${f.devise})`).join(', ');
  throw anomalies(
    [
      {
        code: 'AVOIR_DEVISE',
        path: 'currency',
        message: `L’avoir est en ${currency} ; la facture citée ${citees} ne l’est pas : un avoir est dans la devise de la facture qu’il corrige.`,
      },
    ],
    `L’avoir n’est pas dans la devise de la facture qu’il cite : ${SANS_NUMERO}.`,
  );
}

/** La facture déjà émise depuis ce brouillon, s'il y en a une. */
async function factureDuBrouillon(
  q: Requetes,
  entrepriseId: string,
  brouillonId: string,
): Promise<{ id: string; numero: string } | undefined> {
  const [facture] = await q<{ id: string; numero: string }[]>`
    select id, numero from public.factures
     where brouillon_id = ${brouillonId} and entreprise_id = ${entrepriseId}`;
  return facture ? { id: facture.id, numero: facture.numero } : undefined;
}

/**
 * Le formulaire du brouillon, s'il appartient à l'entreprise et en est à `version` ; sinon 409
 * `BROUILLON_MODIFIE`, que le brouillon ait changé ou qu'il ne soit pas (ou plus) de l'entreprise.
 * `verrou` : la ligne est verrouillée jusqu'à la fin de la transaction, et un enregistrement venu
 * d'un autre onglet attend la suppression du brouillon au lieu de passer entre la vérification et
 * l'émission.
 */
async function formulaireDuBrouillon(
  q: Requetes,
  entrepriseId: string,
  brouillonId: string,
  version: number,
  verrou: boolean,
): Promise<string> {
  const [brouillon] = await q<{ version: number; form: string }[]>`
    select version, form::text as form from public.brouillons
     where id = ${brouillonId} and entreprise_id = ${entrepriseId}
     ${verrou ? q`for update` : q``}`;
  if (!brouillon || brouillon.version !== version) {
    throw erreur(
      409,
      'BROUILLON_MODIFIE',
      `Le brouillon a changé depuis qu’il a été ouvert : rechargez-le. ${SANS_NUMERO}.`,
    );
  }
  return brouillon.form;
}

Deno.serve(
  traiter(async (req) => {
    // Tiré dès le début : il nomme le PDF, déposé avant que la facture soit enregistrée.
    const factureId = crypto.randomUUID();

    // 1. Authentifier : l'entreprise vient du jeton, par `membres` ; l'adresse doit être confirmée, et
    // la suppression du compte ne pas être demandée.
    const ctx = await contexte(req);
    exigerCompteActif(ctx, SANS_NUMERO);
    if (!ctx.confirme) {
      throw erreur(
        403,
        'NON_CONFIRME',
        'Confirmez l’adresse e-mail du compte avant d’émettre une facture.',
      );
    }
    const { brouillonId, version, invoice, appearance, appearanceJson, clientId } = lireCorps(
      await lireTexte(req),
    );
    const e = ctx.entrepriseId;

    // 2. Rejouer sans dupliquer : un double clic, ou un réseau qui coupe, rend la même facture.
    const deja = await factureDuBrouillon(sql, e, brouillonId);
    if (deja) return json(deja, 200);

    // 3. Vérifier le brouillon : ce qu'on émet est ce que l'utilisateur voit. Un avoir est dans la
    // devise des factures qu'il cite (Ruling 49) : refusé ici, avant le verrou.
    await formulaireDuBrouillon(sql, e, brouillonId, version, false);
    await controlerDeviseDeLAvoir(e, invoice);

    // 4. La transaction, sur la connexion directe. `set local` annonce l'émission au déclencheur de
    // la numérotation, qui la laisse seule changer l'année et repartir à 1 (migration 000200).
    const emise = await sql.begin(async (tx) => {
      await tx`set local facturx.emission = 'on'`;
      // Le verrou fait se suivre les émissions de l'entreprise : chacune lit le rang que la
      // précédente a laissé.
      const [ligne] = await tx<
        { gabarit: string; prochain: number; annuelle: boolean; annee: number }[]
      >`
        select gabarit, prochain, annuelle, annee from public.numerotation
         where entreprise_id = ${e}
           for update`;
      if (!ligne) throw new Error('numérotation absente pour l’entreprise');

      // Le rejeu, de nouveau : un appel simultané du même brouillon a pu émettre pendant l'attente.
      const rejeu = await factureDuBrouillon(tx, e, brouillonId);
      if (rejeu) return { ...rejeu, rejeu: true };

      // La limite de débit, exacte sous le verrou : la 60e émission de l'heure, s'il y en a une, dit
      // quand la fenêtre se libère.
      const libre = await reessayerApres(tx, e, 'emise', LIMITE_PAR_HEURE);
      if (libre) {
        throw erreur(
          429,
          'LIMITE',
          `${LIMITE_PAR_HEURE} factures émises dans l’heure : réessayez plus tard. ${SANS_NUMERO}.`,
          { reessayerApres: libre.toISOString() },
        );
      }
      const form = await formulaireDuBrouillon(tx, e, brouillonId, version, true);

      // 5. Contrôler la date : ni après aujourd'hui (Paris), ni avant la dernière facture, ni, en
      // numérotation annuelle, avant le 1er janvier de son année (Ruling 30).
      const [{ derniere }] = await tx<{ derniere: string | null }[]>`
        select max(date_emission)::text as derniere from public.factures where entreprise_id = ${e}`;
      const bornes = controlerDate(
        invoice.issueDate,
        aujourdhui(req),
        derniere ?? undefined,
        ligne.annuelle ? `${String(ligne.annee).padStart(4, '0')}-01-01` : undefined,
      );
      if (bornes) {
        throw erreur(
          409,
          'DATE',
          `La date d’émission sort des dates admises : ${SANS_NUMERO}.`,
          bornes,
        );
      }

      // 6. Attribuer le numéro.
      const numbering: Numbering = {
        pattern: ligne.gabarit,
        next: ligne.prochain,
        yearly: ligne.annuelle,
        year: ligne.annee,
      };
      const numero = formatNumber(
        numbering.pattern,
        nextRank(numbering, invoice.issueDate),
        invoice.issueDate,
      );
      const problemes = numberProblems(numero);
      if (problemes.length > 0) {
        throw anomalies(
          problemes.map((probleme) =>
            probleme === 'length'
              ? { code: 'BR-FR-01', path: 'id', message: `${numero} : 35 caractères au plus.` }
              : {
                  code: 'BR-FR-02',
                  path: 'id',
                  message: `${numero} : caractères A-Z a-z 0-9 - + _ /.`,
                },
          ),
          `Le gabarit de la numérotation produit un numéro invalide : ${SANS_NUMERO}.`,
        );
      }
      const [existant] = await tx`
        select 1 from public.factures where entreprise_id = ${e} and numero = ${numero}`;
      if (existant) {
        throw erreur(
          409,
          'DOUBLON',
          `Le numéro ${numero} existe déjà : relevez le prochain numéro de la numérotation. ${SANS_NUMERO}.`,
          { numero },
        );
      }
      // Le numéro proposé par le Studio, et la référence de paiement qui le rappelait.
      const numerotee: Invoice = { ...invoice, id: numero };
      if (typeof invoice.id === 'string' && invoice.id !== '') {
        if (invoice.remittanceInformation === invoice.id) numerotee.remittanceInformation = numero;
      }

      // 7. Valider la facture numérotée. Un corps qui n'a pas la forme d'une facture peut faire
      // lever le SDK : c'est une anomalie, pas une panne.
      let resultat: ReturnType<typeof validateInvoice>;
      try {
        resultat = validateInvoice(numerotee);
      } catch {
        throw anomalies(
          [{ code: 'CORPS', path: 'invoice', message: 'La facture est illisible.' }],
          `La facture est illisible : ${SANS_NUMERO}.`,
        );
      }
      if (!resultat.ok) {
        throw anomalies(resultat.issues, `La facture comporte des anomalies : ${SANS_NUMERO}.`);
      }
      const facture = resultat.invoice;
      // Sérialisée ici, avant le dépôt du PDF : le SDK laisse passer une propriété inconnue, et une
      // imbrication que `toPortableJson` ne sait pas écrire le ferait lever à l'étape 10, PDF déposé.
      const factureJson = serialiser(
        facture,
        'invoice',
        'CORPS',
        `La facture est trop imbriquée : ${SANS_NUMERO}.`,
      );

      // 8. Un avoir cite des factures de l'entreprise, et la première devient son origine ; elles sont
      // dans sa devise (étape 3). La liste des types d'avoir est celle de la base, que la vue de suivi
      // applique aussi.
      let origine: string | null = null;
      const [{ avoir }] = await tx<{ avoir: boolean }[]>`
        select public.est_un_avoir(${facture.typeCode}) as avoir`;
      if (avoir) {
        const absentes: Anomalie[] = [];
        for (const [i, citee] of (facture.references?.precedingInvoices ?? []).entries()) {
          const [trouvee] = await tx<{ id: string }[]>`
            select id from public.factures where entreprise_id = ${e} and numero = ${citee.id}`;
          // Le message ne dit pas si ce numéro existe dans une autre entreprise.
          if (!trouvee) {
            absentes.push({
              code: 'ORIGINE',
              path: `references.precedingInvoices[${i}].id`,
              message: `Aucune facture ${citee.id} parmi celles de l’entreprise.`,
            });
          }
          origine ??= trouvee?.id ?? null;
        }
        if (absentes.length > 0) {
          throw anomalies(absentes, `L’avoir cite une facture inconnue : ${SANS_NUMERO}.`);
        }
      }

      // 9. Produire le PDF, une fois, et le déposer avant d'enregistrer la facture qui le désigne.
      const pdf = await produirePdf(facture, appearance, e);
      const pdfChemin = `${e}/${factureId}.pdf`;
      const depot = await admin()
        .storage.from('factures')
        .upload(pdfChemin, pdf, { contentType: 'application/pdf', upsert: false });
      if (depot.error) throw depot.error;

      // 10. Enregistrer la facture (montants de `invoice.totals`, facture sous sa forme portable),
      // avancer la numérotation, supprimer le brouillon ; `sql.begin` valide en sortant. Le client de
      // la bibliothèque n'est retenu que s'il est de l'entreprise (Ruling 29) ; sinon `null`, sans
      // erreur : un uid d'une autre entreprise ne se distingue pas d'un uid inconnu.
      const [client] =
        clientId === undefined
          ? []
          : await tx<{ id: string }[]>`
              select id from public.clients where entreprise_id = ${e} and id = ${clientId}`;
      await enregistrerFacture(tx, {
        id: factureId,
        entrepriseId: e,
        facture,
        clientId: client?.id ?? null,
        invoice: factureJson,
        form,
        appearance: appearanceJson,
        pdfChemin,
        factureOrigineId: origine,
        brouillonId,
        origine: 'emise',
        emisePar: ctx.userId,
      });
      const suivante = advance(numbering, facture.issueDate, numero);
      await tx`
        update public.numerotation set prochain = ${suivante.next}, annee = ${suivante.year}
         where entreprise_id = ${e}`;
      await tx`delete from public.brouillons where id = ${brouillonId} and entreprise_id = ${e}`;
      return { id: factureId, numero, rejeu: false };
    });

    const { rejeu, ...corps } = emise;
    return json(corps, rejeu ? 200 : 201);
  }),
);
