/**
 * Émettre en mode compte (spec § 7) : le brouillon ouvert devient une facture par l'Edge Function
 * `emettre`, qui lui attribue son numéro, la valide et produit son PDF, dans une transaction.
 *
 * Ce qui part est ce que le serveur a, à la version qu'il a : la saisie est d'abord enregistrée
 * (`enregistrerMaintenant`), puis, sans rien attendre, la conservation confirme que l'écran montre
 * exactement cette version (`brouillonAEmettre`), et le corps est construit dans le même temps. Une
 * saisie qui ne part pas n'est pas émise ; une frappe pendant l'enregistrement le fait recommencer.
 *
 * Après l'émission, le brouillon (que le serveur a supprimé) est quitté sans retour possible, ni par
 * le miroir, ni par une écriture tardive ; l'historique et la numérotation sont relus, et la facture
 * émise s'ouvre. Un refus laisse le brouillon intact, et le dit : aucun numéro n'a été consommé.
 * Une réponse perdue (réseau, passerelle) laisse l'issue incertaine : on cherche d'abord la facture
 * par son brouillon, et le Studio ne promet rien qu'il ne sache.
 *
 * Chargé par `import()` depuis `workflows.ts`, avec le reste du compte.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { toPortableJson } from '../../shared/portable.js';
import { formatDate, t } from '../i18n.js';
import {
  type ClientRecord,
  defaultNumbering,
  fill,
  type Numbering,
  type SavedInvoice,
} from '../library.js';
import { buildInvoice, type FormParty } from '../model.js';
import { storage } from '../storage.js';
import {
  brouillonAffiche,
  enregistrerMaintenant,
  focusField,
  type StudioState,
  store,
  toast,
  ui,
} from '../store.js';
import { openIssued } from '../workflows.js';
import { client } from './client.js';
import { type Reaction, reaction } from './erreurs.js';
import { estPersistenceCompte, formulaireNumerote, type PersistenceCompte } from './persistence.js';

/** Le plus gros corps qu'`emettre` accepte (`PLAFOND_CORPS`, `_shared/corps.ts`) : au-delà, 413. */
export const PLAFOND_CORPS = 10 * 1024 * 1024;

/** Au-delà, on renonce à rattraper une saisie qui ne cesse de changer pendant l'enregistrement. */
const ESSAIS = 10;

/** Un message d'échec reste affiché le temps de le lire. */
const DUREE_MS = 9000;

/** Ce qui part : le corps, et ce qu'il a été construit à partir de. */
interface Envoi {
  brouillonId: string;
  version: number;
  corps: Blob;
  form: StudioState['form'];
  appearance: StudioState['appearance'];
  invoice: ReturnType<typeof buildInvoice>['invoice'];
}

/** L'émission en cours : un second clic l'attend, sans rien émettre ni afficher de plus. */
let enCours: Promise<boolean> | undefined;

/**
 * Émet le brouillon ouvert par le serveur. Vrai si une facture est émise (et ouverte). Ne lève
 * jamais : chaque issue est dite à l'utilisateur.
 */
export async function emettreSurServeur(): Promise<boolean> {
  if (enCours) {
    await enCours;
    return false;
  }
  const emission = emettre().catch(() => {
    toast(t.compte.erreurs.inconnue, 'error', DUREE_MS);
    return false;
  });
  enCours = emission;
  try {
    return await emission;
  } finally {
    enCours = undefined;
  }
}

/** La clé d'un client dans la bibliothèque, comme `saveClient` : le SIREN, sinon le nom. */
const cleClient = (p: FormParty): string =>
  p.siren.replace(/\s+/g, '') || p.name.trim().toLowerCase();

/** L'uid du client de la bibliothèque que l'acheteur désigne, s'il y en a un (Ruling 29). */
function clientDuBrouillon(acheteur: FormParty, clients: ClientRecord[]): string | undefined {
  const cle = cleClient(acheteur);
  return cle ? clients.find((c) => cleClient(c.party) === cle)?.uid : undefined;
}

/**
 * Le corps à envoyer, si l'écran montre exactement le brouillon enregistré ; sinon rien. Synchrone :
 * aucune frappe ne s'intercale entre la vérification et ce qui part.
 */
function preparer(p: PersistenceCompte): Envoi | undefined {
  const courant = p.brouillonAEmettre(brouillonAffiche());
  if (!courant) return undefined;
  const { form, appearance, clients } = store.get();
  const { invoice } = buildInvoice(form);
  const clientId = clientDuBrouillon(form.buyer, clients);
  const texte = toPortableJson(
    {
      brouillonId: courant.id,
      version: courant.version,
      invoice,
      appearance,
      ...(clientId ? { clientId } : {}),
    },
    { compact: true },
  );
  return {
    brouillonId: courant.id,
    version: courant.version,
    corps: new Blob([texte], { type: 'application/json' }),
    form,
    appearance,
    invoice,
  };
}

/** Un échec qui laisse le brouillon intact : le message, et ce qu'il garantit. */
function refus(texte: string): false {
  toast(`${texte} ${t.compte.emission.aucunNumero}`, 'error', DUREE_MS);
  return false;
}

/**
 * La saisie part, puis l'écran doit être ce que le serveur a : sinon on recommence (frappe pendant
 * l'enregistrement), ou l'on s'arrête, en le disant (le brouillon ne part pas).
 */
async function enregistrerPuisPreparer(p: PersistenceCompte): Promise<Envoi | false> {
  const phrases = t.compte.emission;
  for (let essai = 1; ; essai++) {
    const avant = store.get();
    if (!(await enregistrerMaintenant())) return refus(phrases.nonEnregistre);
    await p.envoisTermines();
    const envoi = preparer(p);
    if (envoi) return envoi;
    const apres = store.get();
    if (apres.form === avant.form && apres.appearance === avant.appearance) {
      return refus(phrases.nonEnregistre);
    }
    if (essai === ESSAIS) return refus(phrases.enCours);
  }
}

async function emettre(): Promise<boolean> {
  const phrases = t.compte.emission;
  const p = storage;
  const { ui: etat } = store.get();
  if (!estPersistenceCompte(p) || etat.issued !== undefined) return false;
  if (etat.sample) {
    toast(phrases.exemple, 'error', DUREE_MS);
    return false;
  }

  // 1. Ce que le serveur a, à sa version.
  const envoi = await enregistrerPuisPreparer(p);
  if (!envoi) return false;

  // 2. Au-delà du plafond du serveur, rien ne part : le message dit quoi réduire.
  if (envoi.corps.size > PLAFOND_CORPS) return refus(phrases.tropGros);

  // 3. L'émission.
  const { data, error } = await client().functions.invoke('emettre', { body: envoi.corps });
  if (!error) {
    const emise = data as { id?: unknown; numero?: unknown } | null;
    if (typeof emise?.id === 'string' && typeof emise.numero === 'string') {
      return succes(p, { id: emise.id, numero: emise.numero }, envoi);
    }
    return incertain(p, envoi);
  }
  if (!(error instanceof FunctionsHttpError)) return incertain(p, envoi);
  const reponse = error.context as Response;
  const corps = await reponse.json().catch(() => undefined);
  const lisible =
    typeof corps === 'object' &&
    corps !== null &&
    typeof (corps as { code?: unknown }).code === 'string';
  // Une panne hors de la fonction (passerelle, worker arrêté) ou qu'elle ne nomme pas : la
  // transaction a pu aboutir. `INTERNE` vient de la fonction, qui a tout annulé.
  if (reponse.status >= 500 && (!lisible || (corps as { code: string }).code !== 'INTERNE')) {
    return incertain(p, envoi);
  }
  const { code, message, details } = (lisible ? corps : {}) as {
    code?: string;
    message?: unknown;
    details?: unknown;
  };
  return reagir(
    p,
    reaction(reponse.status, {
      code: code ?? '',
      message: typeof message === 'string' ? message : '',
      details,
    }),
    envoi,
  );
}

/** Le refus du serveur, dit à l'utilisateur ; le brouillon reste tel quel. */
function reagir(p: PersistenceCompte, r: Reaction, envoi: Envoi): false {
  const phrases = t.compte.emission;
  switch (r.kind) {
    case 'connexion': {
      // Demandée par un clic : la connexion s'ouvre, même si la session était déjà dite expirée.
      const compte = store.get().ui.compte;
      if (compte) ui({ compte: { ...compte, session: 'expiree' }, connexion: 'connexion' });
      return refus(phrases.session);
    }
    case 'recharger': {
      // Sa propre frappe, partie pendant l'émission, a fait avancer la version : rien d'autre
      // n'a changé le brouillon. Sinon il a changé ailleurs : le Studio propose de trancher.
      const courant = p.brouillonCourant();
      if (courant?.id === envoi.brouillonId && courant.version !== envoi.version) {
        return refus(phrases.saisieChangee);
      }
      ui({ conflit: true });
      return refus(r.texte);
    }
    case 'date':
      focusField('issueDate');
      return refus(phrases.date(r.min ? formatDate(r.min) : undefined, formatDate(r.max)));
    case 'controle':
      ui({
        refusServeur: { form: envoi.form, appearance: envoi.appearance, issues: r.issues },
        tab: 'check',
      });
      focusField(r.issues[0]?.path ?? '', 'check');
      return refus(phrases.refus(r.issues.length));
    case 'message':
      return refus(r.texte);
  }
}

/**
 * La réponse n'est pas arrivée, ou ne se lit pas : la facture est-elle émise ? On la cherche par son
 * brouillon. Trouvée, c'est un succès ; sinon (ou si l'on ne peut pas savoir), le Studio dit de
 * réessayer : le serveur rejoue une émission déjà faite, sans en faire une seconde.
 */
async function incertain(p: PersistenceCompte, envoi: Envoi): Promise<boolean> {
  const emise = await p.factureDuBrouillon(envoi.brouillonId).catch(() => undefined);
  if (emise) return succes(p, emise, envoi);
  toast(t.compte.emission.incertain, 'error', 12_000);
  return false;
}

/**
 * La facture est émise : le brouillon est quitté pour de bon, l'historique et la numérotation sont
 * relus (le numéro proposé du brouillon suivant en dépend), et la facture émise s'ouvre. Relire
 * peut échouer sans rien défaire : la facture est alors reconstituée de ce qui a été envoyé.
 */
async function succes(
  p: PersistenceCompte,
  emise: { id: string; numero: string },
  envoi: Envoi,
): Promise<true> {
  await p.brouillonEmis(envoi.brouillonId);
  const [lues, numerotation] = await Promise.allSettled([
    p.list<SavedInvoice>('invoices'),
    p.get<Numbering>('numbering'),
  ]);
  let history = lues.status === 'fulfilled' ? lues.value : store.get().history;
  let saved = history.find((h) => h.uid === emise.id);
  if (!saved) {
    saved = reconstituer(emise, envoi);
    history = [...history.filter((h) => h.uid !== emise.id), saved];
  }
  const numbering =
    numerotation.status === 'fulfilled' && numerotation.value
      ? fill(defaultNumbering(), numerotation.value)
      : undefined;
  store.set((s) => ({
    history,
    ...(numbering ? { numbering } : {}),
    ui: { ...s.ui, refusServeur: undefined },
  }));
  openIssued(saved);
  toast(t.compte.emission.emise(emise.numero));
  return true;
}

/** La facture émise, telle que l'historique la rendra, d'après ce qui a été envoyé. */
function reconstituer(emise: { id: string; numero: string }, envoi: Envoi): SavedInvoice {
  const { invoice } = envoi;
  return {
    uid: emise.id,
    status: 'issued',
    form: formulaireNumerote(structuredClone(envoi.form), emise.numero),
    appearance: structuredClone(envoi.appearance),
    summary: {
      id: emise.numero,
      typeCode: invoice.typeCode,
      issueDate: invoice.issueDate,
      buyerName: invoice.buyer.name,
      currency: invoice.currency,
      total: invoice.totals.taxInclusiveAmount,
      due: invoice.totals.amountDueForPayment,
    },
    issuedAt: new Date().toISOString(),
  };
}
