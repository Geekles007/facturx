/**
 * La proposition d'importer les données de ce navigateur (spec § 10) : à la première connexion, si
 * le Studio a gardé ici des données saisies sans compte, le dialogue d'import (`importation.tsx`) les
 * propose, avec ce qu'il a trouvé. Jamais d'office : le refus est retenu pour ce compte, dans ce
 * navigateur, et la proposition ne revient qu'à la demande, depuis « Mon compte ». Un import resté
 * en chemin (limite de débit, session, réseau) est reproposé, et ne reprend que ce qui attendait.
 *
 * Tout se lit dans IndexedDB (`indexedDbPersistence`), jamais sur le serveur : ce sont les données
 * de ce navigateur. Chargé par `import()` avec le reste du compte.
 */

import type { CompanyProfile } from '../library.js';
import type { InvoiceForm } from '../model.js';
import { indexedDbPersistence as local } from '../storage.js';
import { type Loaded, store } from '../store.js';

/** Ce que ce navigateur garde du Studio utilisé sans compte, compté pour la proposition d'import. */
export interface Inventaire {
  entreprise: boolean;
  clients: number;
  produits: number;
  factures: number;
  brouillon: boolean;
  /** Un import précédent de ce navigateur dans ce compte n'est pas allé au bout. */
  reprise: boolean;
  /** Ses factures en attente (`uid`), quand c'est elles seules qu'il reste à envoyer. */
  enAttente?: string[];
}

/**
 * Ce que ce navigateur retient de la proposition, pour un compte : refusée (elle ne revient qu'à la
 * demande, depuis « Mon compte »), faite, ou inachevée (elle revient, comme une reprise). Avec
 * l'empreinte du brouillon local déjà devenu un brouillon du compte (il ne le redevient pas), et,
 * pour un import inachevé pendant les factures, celles qui attendent.
 */
export interface MarqueImport {
  etat: 'refuse' | 'partiel' | 'fait';
  le: string;
  brouillon?: string;
  enAttente?: string[];
}

/** La marque vit dans IndexedDB, à côté des données locales, une par compte (entreprise). */
const cleMarque = (entrepriseId: string): string => `import-local-${entrepriseId}`;

const texte = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Une entreprise renseignée : sa raison sociale, son SIREN, son SIRET, son numéro de TVA, ses
 * mentions légales ou un IBAN, l'un au moins, saisis. Sinon c'est l'entreprise vide que le Studio et
 * l'inscription créent (`defaultCompany`, migration 000100), quels que soient ses réglages par défaut
 * (TVA, délai de paiement…). Une entreprise vide en local n'est pas une donnée à importer ; dans le
 * compte, elle est encore « à son état initial » et celle du navigateur peut la remplacer.
 */
export function entrepriseRenseignee(profil: unknown): profil is CompanyProfile {
  const p = profil as Partial<CompanyProfile> | undefined;
  const vendeur = p?.seller;
  return (
    [vendeur?.name, vendeur?.siren, vendeur?.siret, vendeur?.vatId, vendeur?.legalInfo].some(
      texte,
    ) ||
    (Array.isArray(p?.paymentMeans) && p.paymentMeans.some((m) => texte(m?.iban)))
  );
}

/**
 * Une saisie en cours : ni l'exemple, ni une facture émise affichée (des vues), et quelque chose de
 * saisi — un acheteur (nom ou SIREN) ou une ligne (désignation, description ou prix). Le vendeur, le
 * numéro, les dates et les conditions, le Studio les pose de lui-même sur une facture vierge : ils ne
 * font pas un brouillon.
 */
export function brouillonSaisi(valeur: unknown): valeur is NonNullable<Loaded['draft']> {
  const b = valeur as Loaded['draft'] | null;
  if (typeof b !== 'object' || b === null || b.sample === true || b.issued !== undefined) {
    return false;
  }
  const form = b.form as Partial<InvoiceForm> | undefined;
  if (typeof form !== 'object' || form === null) return false;
  const lignes = Array.isArray(form.lines) ? form.lines : [];
  return (
    texte(form.buyer?.name) ||
    texte(form.buyer?.siren) ||
    lignes.some((l) => texte(l?.name) || texte(l?.description) || texte(l?.unitPrice))
  );
}

/** Vrai s'il y a quelque chose à importer. */
export const aDesDonnees = (i: Inventaire): boolean =>
  i.entreprise || i.clients > 0 || i.produits > 0 || i.factures > 0 || i.brouillon;

/** La marque de ce navigateur pour le compte connecté. */
export async function lireMarqueImport(): Promise<MarqueImport | undefined> {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (!entrepriseId) return undefined;
  return local.get<MarqueImport>(cleMarque(entrepriseId));
}

/**
 * Retient l'issue de la proposition pour le compte connecté, dans ce navigateur. L'empreinte d'un
 * brouillon déjà repris est gardée d'une marque à l'autre ; les factures en attente ne valent que
 * pour la marque qui les porte. Ne lève pas : au pire, la proposition reviendra.
 */
export async function retenirImport(
  etat: MarqueImport['etat'],
  options: { brouillon?: string | undefined; enAttente?: string[] | undefined } = {},
): Promise<void> {
  const entrepriseId = store.get().ui.compte?.entrepriseId;
  if (!entrepriseId) return;
  const avant = await lireMarqueImport().catch(() => undefined);
  const marque: MarqueImport = { etat, le: new Date().toISOString() };
  const empreinte = options.brouillon ?? avant?.brouillon;
  if (empreinte) marque.brouillon = empreinte;
  if (etat === 'partiel' && options.enAttente?.length) marque.enAttente = options.enAttente;
  await local.set(cleMarque(entrepriseId), marque).catch(() => undefined);
}

/**
 * Ce que ce navigateur garde du Studio sans compte, lu dans IndexedDB (jamais le serveur), sans les
 * PDF : de quoi le dire avant d'importer. Rien si IndexedDB ne répond pas.
 */
export async function inventaireLocal(): Promise<Inventaire | undefined> {
  try {
    const [entreprise, brouillon, factures, clients, produits, marque] = await Promise.all([
      local.get('company'),
      local.get('draft'),
      local.list('invoices'),
      local.list('clients'),
      local.list('products'),
      lireMarqueImport(),
    ]);
    const inventaire: Inventaire = {
      entreprise: entrepriseRenseignee(entreprise),
      clients: clients.length,
      produits: produits.length,
      factures: factures.length,
      brouillon: brouillonSaisi(brouillon),
      reprise: marque?.etat === 'partiel',
    };
    if (marque?.etat === 'partiel' && marque.enAttente?.length) {
      inventaire.enAttente = marque.enAttente;
    }
    return inventaire;
  } catch {
    return undefined;
  }
}

/**
 * À la première connexion (spec § 10) : ce que ce navigateur garde, s'il faut proposer de
 * l'importer. Rien — et rien n'est proposé — si ce navigateur n'a pas de données du Studio sans
 * compte, si la proposition a déjà été refusée ou faite pour ce compte, si la session n'est pas
 * active, si le serveur n'a pas répondu au démarrage, ou si la suppression du compte est demandée.
 * La proposition n'est jamais imposée : elle s'ouvre, et l'utilisateur choisit.
 */
export async function importAProposer(): Promise<Inventaire | undefined> {
  const { compte, storage: etat } = store.get().ui;
  if (compte?.session !== 'active' || compte.suppressionDemandeeLe || etat !== 'ok') {
    return undefined;
  }
  const marque = await lireMarqueImport().catch(() => undefined);
  if (marque && marque.etat !== 'partiel') return undefined;
  const inventaire = await inventaireLocal();
  return inventaire && aDesDonnees(inventaire) ? inventaire : undefined;
}
