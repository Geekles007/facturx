/**
 * Statuts du cycle de vie d'une facture (« CDV », flux 6 de la réforme).
 *
 * Source : dossier de spécifications externes DGFiP **v3.2**, annexe 2 « Format sémantique FE CDV —
 * Flux 6 » (onglet *Statuts*) et annexe 7 « Règles de gestion » v1.9. Les identifiants `MDT-*`
 * renvoient aux balises du modèle sémantique, les `G*` aux règles de gestion.
 *
 * Ce module couvre le **contenu** d'un statut et sa conformité, pas son transport : le dépôt auprès
 * d'une plateforme agréée reste hors périmètre, comme l'envoi des factures.
 */

import type { Cents } from '../money.js';
import type { IsoDate } from '../types/codes.js';

/**
 * Statuts transmissibles au portail public de facturation.
 *
 * L'annexe 2 n'en énumère **que quatre** pour l'objet « facture » (flux 2), et la règle **G7.44** est
 * explicite : un cycle de vie référençant un statut non obligatoire est rejeté, motif `REJ_RG`.
 * Les statuts intermédiaires que l'on croise dans la littérature (« mise à disposition »,
 * « approuvée », « suspendue »…) circulent entre plateformes ; ils ne remontent pas à
 * l'administration et ne figurent pas dans cette liste.
 */
export type LifecycleStatusCode = '200' | '210' | '212' | '213';

export const LIFECYCLE_STATUS_CODES: readonly LifecycleStatusCode[] = ['200', '210', '212', '213'];

export const LIFECYCLE_STATUS_LABELS: Readonly<Record<LifecycleStatusCode, string>> = {
  '200': 'Déposée',
  '210': 'Refusée',
  '212': 'Encaissée',
  '213': 'Rejetée',
};

/**
 * Codes de montant (**G7.12**, `MDT-207`). `MEN` porte le montant encaissé TTC — celui qui sert au
 * préremplissage de la TVA sur les encaissements.
 */
export type AmountCode = 'RAP' | 'ESC' | 'RAB' | 'REM' | 'MPA' | 'MEN';

export const AMOUNT_LABELS: Readonly<Record<AmountCode, string>> = {
  RAP: 'Reste à payer',
  ESC: 'Escompte accordé',
  RAB: 'Rabais accordé',
  REM: 'Remise accordée',
  MPA: 'Montant payé',
  MEN: 'Montant encaissé (TTC)',
};

/**
 * Motifs normalisés de refus ou de rejet (`MDT-113`), liste close de l'annexe 7,
 * onglet « Tableau des motifs de refus ».
 */
export type RefusalReasonCode =
  | 'ADR_ERR'
  | 'ANNUL_ENC'
  | 'ART_ERR'
  | 'AUT_MOTIF_ERR_VALIDEUR'
  | 'AUTRE'
  | 'CALCUL_ERR'
  | 'CMD_EJ_ERR'
  | 'CODE_ROUTAGE_ERR'
  | 'CONTACT_ACHTR'
  | 'CONTRAT_TERM'
  | 'COORD_BANC_ERR'
  | 'CREANCIER_ERR'
  | 'DEST_ERR'
  | 'DEST_INC'
  | 'DOUBLE_FACT'
  | 'DOUBLON'
  | 'EMMET_INC'
  | 'ERR_VALIDEUR'
  | 'FACT_NON_CONFORME'
  | 'JUSTIF_ABS'
  | 'LIVR_INCOMP'
  | 'MARCHE_TERM'
  | 'MODPAI_ERR'
  | 'MONTANT_ERR'
  | 'MONTANTTOTAL_ERR'
  | 'NON_CONFORME'
  | 'PU_ERR'
  | 'QTE_ERR'
  | 'QUALITE_ERR'
  | 'REF_CT_ABSENT'
  | 'REF_ERR'
  | 'REM_ERR'
  | 'ROUTAGE_ERR'
  | 'SE_ERR'
  | 'SIRET_ERR'
  | 'ST_CT_NON_DECLAR'
  | 'SUPPR_COMP_AVOIR'
  | 'TRANSAC_INC'
  | 'TRANSF_PMNT_REGIE'
  | 'TX_TVA_ERR';

export const REFUSAL_REASON_LABELS: Readonly<Record<RefusalReasonCode, string>> = {
  ADR_ERR: 'Adresse de facturation électronique erronée',
  ANNUL_ENC: "Encaissement non réalisé ou annulation d'encaissement",
  ART_ERR: 'Article facturé incorrect',
  AUT_MOTIF_ERR_VALIDEUR: 'Autre motif que « Erreur de valideur »',
  AUTRE: 'Autre',
  CALCUL_ERR: 'Erreur de calcul de la facture',
  CMD_EJ_ERR: 'N° de commande/engagement incorrect ou manquant',
  CODE_ROUTAGE_ERR: 'Code de routage absent ou erroné',
  CONTACT_ACHTR: 'Autres : contacter votre acheteur',
  CONTRAT_TERM: 'Contrat terminé',
  COORD_BANC_ERR: 'Erreur de coordonnées bancaires',
  CREANCIER_ERR: 'Créancier inconnu ou différent de celui du marché/commande',
  DEST_ERR: 'Erreur de destinataire',
  DEST_INC: 'Destinataire inconnu',
  DOUBLE_FACT: 'Données réglementaires F1 en doublon',
  DOUBLON: 'Facture en doublon (déjà émise / reçue)',
  EMMET_INC: 'Émetteur inconnu',
  ERR_VALIDEUR: 'Mauvais valideur',
  FACT_NON_CONFORME: 'Facture non conforme à la commande',
  JUSTIF_ABS: 'Justificatif absent ou insuffisant',
  LIVR_INCOMP: 'Livraison incomplète ou non effectuée',
  MARCHE_TERM: 'Marché terminé',
  MODPAI_ERR: 'Modalités de paiement incorrectes',
  MONTANT_ERR: 'Montant de la facture erroné',
  MONTANTTOTAL_ERR: 'Montant total erroné',
  NON_CONFORME: 'Mention légale manquante',
  PU_ERR: 'Prix unitaires incorrects',
  QTE_ERR: 'Quantité facturée incorrecte',
  QUALITE_ERR: "Qualité d'article livré incorrecte",
  REF_CT_ABSENT: 'Référence contractuelle manquante',
  REF_ERR: 'Référence incorrecte',
  REM_ERR: 'Remise erronée',
  ROUTAGE_ERR: 'Erreur de routage',
  SE_ERR: 'Service destinataire incorrect',
  SIRET_ERR: 'SIRET erroné ou absent',
  ST_CT_NON_DECLAR: 'Sous-traitant / cotraitant non déclaré',
  SUPPR_COMP_AVOIR: "Suppression pour compensation d'avoirs",
  TRANSAC_INC: 'Transaction inconnue',
  TRANSF_PMNT_REGIE: 'Transfert pour paiement en régie (réservé B2G)',
  TX_TVA_ERR: 'Taux de TVA erroné',
};

/**
 * Motifs autorisés pour refuser une facture déposée par un cotraitant (cadre `S6`), **G7.39**.
 */
export const S6_REFUSAL_REASONS: readonly RefusalReasonCode[] = [
  'DEST_ERR',
  'ROUTAGE_ERR',
  'CODE_ROUTAGE_ERR',
];

/**
 * Facture visée par un statut. La réforme identifie une facture par le triplet numéro + année
 * d'émission + SIREN du fournisseur (**G1.45**) ; c'est ce triplet que porte un CDV (**G7.23**),
 * et l'identification de l'émetteur y est obligatoire (**G7.17**).
 */
export interface LifecycleInvoiceRef {
  /** BT-1 — numéro de la facture, 35 caractères au plus. */
  id: string;
  /** BT-2 — date d'émission ; son année entre dans l'identifiant (G1.45, G7.31). */
  issueDate: IsoDate;
  /** BT-30 — SIREN du fournisseur, obligatoire dans un CDV de facture (G7.17). */
  sellerSiren: string;
}

/** Montant porté par un statut (`MDT-215`/`MDT-216`), qualifié par son code (**G7.12**). */
export interface LifecycleAmount {
  code: AmountCode;
  value: Cents;
  /** Code devise ISO 4217 ; l'euro est imposé pour le montant encaissé (**G6.27**). */
  currency: string;
}

/**
 * Un statut du cycle de vie, tel qu'il sera porté par un message CDV.
 *
 * Le SDK valide son contenu ; le déposer auprès d'une plateforme agréée relève de celle-ci.
 */
export interface LifecycleStatus {
  /** Code du statut (G7.44). */
  code: LifecycleStatusCode;
  /** Horodatage du statut, date-heure ISO 8601 (`MDG-38`). */
  dateTime: string;
  /** Facture visée. */
  invoice: LifecycleInvoiceRef;
  /** Motif normalisé — exigé sur un refus (210) et un rejet (213), **G7.08**. */
  reasonCode?: RefusalReasonCode;
  /** Libellé libre accompagnant le motif (`MDT-114`, 250 caractères au plus). */
  reasonLabel?: string;
  /** Commentaire motivant le refus — exigé sur un refus (210), **G7.25** (`MDT-126`). */
  comment?: string;
  /** Montant associé au statut. */
  amount?: LifecycleAmount;
  /** BT-23 — cadre de facturation de la facture visée, nécessaire pour appliquer **G7.39**. */
  businessProcess?: string;
}
