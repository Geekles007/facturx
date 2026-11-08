/**
 * Ce que `emettre` et `importer`, les deux seules fonctions qui écrivent dans `factures`, font de
 * cette table de la même façon : y enregistrer une ligne, et savoir si la fenêtre d'une heure de leur
 * limite de débit est pleine. La liste des colonnes et la conversion des JSON en `jsonb` ne s'écrivent
 * qu'ici.
 *
 * Aucune requête ne passe par la RLS : chaque appelant filtre par l'entreprise du contexte (spec § 11).
 */
import type { Invoice } from 'facturx-sdk';
import type postgres from 'postgres';
import { SDK_VERSION } from '../_vendor/sdk-version.ts';

/** `sql` ou la transaction ouverte par `sql.begin`. */
type Requetes = postgres.ISql;

export interface FactureAEnregistrer {
  /** L'identifiant de la facture : il nomme son PDF, déposé avant la ligne qui le désigne. */
  id: string;
  entrepriseId: string;
  /** La facture, numéro compris (`facture.id`) ; ses montants et ses dates sont ceux des colonnes. */
  facture: Invoice;
  /** Le client de la bibliothèque, s'il est de l'entreprise. */
  clientId: string | null;
  /**
   * La facture, le formulaire et l'apparence en texte JSON portable (le texte de la base pour le
   * formulaire d'un brouillon, sinon `serialiser`) : sérialisés une fois par l'appelant, avant son dépôt.
   */
  invoice: string;
  form: string;
  appearance: string;
  pdfChemin: string;
  /** La facture qu'un avoir corrige (`facture_origine_id`). */
  factureOrigineId: string | null;
  brouillonId: string | null;
  origine: 'emise' | 'importee';
  emisePar: string;
}

/**
 * Enregistre la facture (la version du SDK est celle des fonctions, `emise_le` l'heure de la base). Les
 * JSON passent en `text` avant `jsonb` : un paramètre que Postgres annonce en `jsonb`, postgres.js le
 * sérialise encore, et la colonne recevrait une chaîne au lieu d'un objet. Ni les textes, ni les dates,
 * ni la sérialisation ne sont contrôlés ici : l'appelant l'a fait avant son dépôt de fichier
 * (`exigerAdmissible`, `dateAdmise`, `serialiser`).
 */
export async function enregistrerFacture(q: Requetes, f: FactureAEnregistrer): Promise<void> {
  const { facture } = f;
  await q`
    insert into public.factures (
      id, entreprise_id, numero, type_code, date_emission, date_echeance, client_id, client_nom,
      client_email, devise, ht, ttc, net_a_payer, invoice, form, appearance, pdf_chemin,
      sdk_version, facture_origine_id, brouillon_id, origine, emise_par
    ) values (
      ${f.id}, ${f.entrepriseId}, ${facture.id}, ${facture.typeCode}, ${facture.issueDate},
      ${facture.paymentTerms?.dueDate ?? null}, ${f.clientId}, ${facture.buyer.name},
      ${facture.buyer.contact?.email || null}, ${facture.currency},
      ${facture.totals.taxExclusiveAmount}, ${facture.totals.taxInclusiveAmount},
      ${facture.totals.amountDueForPayment}, ${f.invoice}::text::jsonb,
      ${f.form}::text::jsonb, ${f.appearance}::text::jsonb, ${f.pdfChemin},
      ${SDK_VERSION}, ${f.factureOrigineId}, ${f.brouillonId}, ${f.origine}, ${f.emisePar}
    )`;
}

/**
 * Quand la fenêtre d'une heure se libère, si l'entreprise a déjà `limite` factures de cette `origine`
 * dans la dernière heure (`emise_le`) ; `undefined` s'il en reste de la place. À appeler sous le verrou
 * de la numérotation : le compte n'est exact que si les écritures se suivent.
 */
export async function reessayerApres(
  q: Requetes,
  entrepriseId: string,
  origine: 'emise' | 'importee',
  limite: number,
): Promise<Date | undefined> {
  const [pleine] = await q<{ reessayer_apres: Date }[]>`
    select emise_le + interval '1 hour' as reessayer_apres from public.factures
     where entreprise_id = ${entrepriseId} and origine = ${origine}
       and emise_le > now() - interval '1 hour'
     order by emise_le desc
    offset ${limite - 1} limit 1`;
  return pleine?.reessayer_apres;
}
