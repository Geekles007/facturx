/**
 * Émettre en mode compte (spec § 7) : le brouillon ouvert devient une facture par l'Edge Function
 * `emettre`, qui lui attribue son numéro, la valide et produit son PDF, dans une transaction.
 *
 * Ce qui part est ce que le serveur a, à la version qu'il a : la saisie est d'abord enregistrée
 * (`enregistrerMaintenant`), puis, sans rien attendre, la conservation confirme que l'écran montre
 * exactement cette version (`brouillonAEmettre`), et le corps est construit dans le même temps. Une
 * saisie qui ne part pas n'est pas émise ; une frappe pendant l'enregistrement le fait recommencer.
 *
 * Pendant l'émission, le document est figé (`ui.emissionEnCours` : rien ne s'y tape, l'éditeur est
 * inerte), et l'appel passe dans la file des envois de la conservation (`dansLaFile`) : aucune
 * écriture du brouillon n'est en vol pendant qu'`emettre` le lit, le verrouille et le supprime. Après
 * l'émission, le brouillon est quitté dans la même file (`brouillonEmis`) : une écriture qui
 * attendait trouve un document supprimé et ne part pas, ni ne signale de conflit. Puis l'historique
 * et la numérotation sont relus, et la facture émise s'ouvre.
 *
 * Un refus laisse le brouillon intact, et le dit : aucun numéro n'a été consommé. Une réponse perdue
 * (réseau, passerelle) laisse l'issue incertaine : on cherche d'abord la facture par son brouillon,
 * et le Studio ne promet rien qu'il ne sache.
 *
 * Chargé par `import()` depuis `workflows.ts`, avec le reste du compte.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { toPortableJson } from '../../shared/portable.js';
import { formatDate, t } from '../i18n.js';
import {
  type ClientRecord,
  cleClient,
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
  oublierLeBrouillonRefuse,
  type StudioState,
  store,
  toast,
  ui,
} from '../store.js';
import { openIssued } from '../workflows.js';
import { client } from './client.js';
import { type Reaction, reaction } from './erreurs.js';
import { renvoyerConfirmation } from './index.js';
import { estPersistenceCompte, formulaireNumerote, type PersistenceCompte } from './persistence.js';

/** Le plus gros corps qu'`emettre` accepte (`PLAFOND_CORPS`, `_shared/corps.ts`) : au-delà, 413. */
export const PLAFOND_CORPS = 10 * 1024 * 1024;

/** Au-delà, on renonce à rattraper une saisie qui ne cesse de changer pendant l'enregistrement. */
const ESSAIS = 10;

/** Un message d'échec reste affiché le temps de le lire. */
const DUREE_MS = 9000;

/**
 * Le plus long qu'une étape de l'émission fige l'éditeur : l'enregistrement qui la précède, l'appel
 * à `emettre` (le `fetch` est abandonné au même délai). Au-delà, l'issue est incertaine (on cherche
 * la facture par son brouillon) et l'éditeur reprend.
 */
export const DELAI_EMISSION_MS = 60_000;

/** Le plus long que dure la recherche de la facture d'une réponse perdue. */
const DELAI_RECHERCHE_MS = 15_000;

/** Le plus long que dure la relecture de l'historique après l'émission (sinon : `reconstituer`). */
const DELAI_RELECTURE_MS = 15_000;

/**
 * Le plus long que l'éditeur reste figé, toutes étapes comprises. Au-delà, l'émission est abandonnée
 * (`Etape.abandonnee`) : ce qui en reviendrait ensuite ne quitte ni n'ouvre plus rien, l'issue est
 * dite incertaine, et l'éditeur reprend.
 */
export const DELAI_GEL_MS = 120_000;

/** Où en est l'émission : partie au serveur, ou abandonnée au bout du délai. */
interface Etape {
  envoye: boolean;
  abandonnee: boolean;
}

/** `promesse`, ou `repli` au bout de `ms` : l'émission ne fige jamais l'éditeur sans fin. */
function borne<T>(promesse: Promise<T>, ms: number, repli: T): Promise<T> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<T>((resolve) => {
    minuterie = setTimeout(() => resolve(repli), ms);
  });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuterie));
}

/** Ce qui part : le corps, et ce qu'il a été construit à partir de. */
interface Envoi {
  brouillonId: string;
  version: number;
  corps: Blob;
  form: StudioState['form'];
  appearance: StudioState['appearance'];
  invoice: ReturnType<typeof buildInvoice>['invoice'];
}

/** Une facture émise : son identifiant et le numéro que le serveur lui a attribué. */
interface Emise {
  id: string;
  numero: string;
}

/** Ce que l'échange avec le serveur a donné. `ouvert` : le brouillon émis était l'ouvert. */
type Resultat =
  | { kind: 'emise'; emise: Emise; ouvert?: boolean }
  | { kind: 'refus'; reaction: Reaction }
  | { kind: 'incertaine' };

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
  const phrases = t.compte.emission;
  const etape: Etape = { envoye: false, abandonnee: false };
  ui({ emissionEnCours: true });
  // Une exception du Studio avant l'envoi n'a rien consommé ; après, l'issue est incertaine.
  const issue = emettre(etape).catch(() => {
    if (etape.abandonnee) return false;
    if (!etape.envoye) return refus(phrases.erreurLocale);
    toast(phrases.incertain, 'error', 12_000);
    return false;
  });
  const emission = borne<boolean | undefined>(issue, DELAI_GEL_MS, undefined)
    .then((reponse) => {
      if (reponse !== undefined) return reponse;
      // Trop long : l'éditeur reprend, et ce qui reviendrait de cette émission n'y touche plus.
      etape.abandonnee = true;
      if (etape.envoye) toast(phrases.incertain, 'error', 12_000);
      else refus(phrases.nonEnregistre.delai);
      return false;
    })
    .finally(() => ui({ emissionEnCours: false }));
  enCours = emission;
  try {
    return await emission;
  } finally {
    enCours = undefined;
  }
}

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
 * Pourquoi le brouillon n'a pas pu être enregistré avant l'émission, d'après ce que le magasin en
 * sait (réseau, session, conflit, refus, serveur injoignable), ou parce que l'enregistrement n'a pas
 * répondu à temps (`delaiDepasse`). Sans rien supposer d'un bandeau.
 */
function pourquoiNonEnregistre(delaiDepasse: boolean): string {
  const s = store.get().ui;
  const phrases = t.compte.emission.nonEnregistre;
  if (s.storage === 'injoignable') return phrases.injoignable;
  if (s.compte?.session === 'expiree') return phrases.session;
  if (s.reseau === 'hors-ligne') return phrases.reseau;
  if (s.conflit === 'supprime') return phrases.supprime;
  if (s.conflit) return phrases.conflit;
  if (s.brouillonRefuse !== undefined) return phrases.refus(s.brouillonRefuse);
  return delaiDepasse ? phrases.delai : phrases.autre;
}

/**
 * La saisie part, puis l'écran doit être ce que le serveur a : sinon on recommence (frappe pendant
 * l'enregistrement), ou l'on s'arrête, en le disant (le brouillon ne part pas). Quand l'écran est
 * bien la version enregistrée, l'échange prend sa place dans la file des envois dans le même temps
 * que la vérification : aucune écriture ne passe entre les deux.
 */
async function enregistrerPuisEnvoyer(
  p: PersistenceCompte,
  etape: Etape,
): Promise<{ envoi: Envoi; resultat: Promise<Resultat> } | false> {
  const phrases = t.compte.emission;
  // Abandonnée entre-temps (gel trop long) : plus rien ne part, et le message est déjà dit.
  const arret = (texte: string): false => (etape.abandonnee ? false : refus(texte));
  for (let essai = 1; ; essai++) {
    const avant = store.get();
    // Un enregistrement qui ne répond pas ne fige pas l'éditeur : il continue sans l'émission.
    const enregistre = await borne(
      enregistrerMaintenant().then((ok) => (ok ? 'ok' : 'echec')),
      DELAI_EMISSION_MS,
      'delai',
    );
    if (enregistre !== 'ok') return arret(pourquoiNonEnregistre(enregistre === 'delai'));
    const termines = p.envoisTermines().then(() => true);
    if (!(await borne(termines, DELAI_EMISSION_MS, false))) {
      return arret(pourquoiNonEnregistre(true));
    }
    if (etape.abandonnee) return false;
    const envoi = preparer(p);
    if (envoi) {
      // Au-delà du plafond du serveur, rien ne part : le message dit quoi réduire.
      if (envoi.corps.size > PLAFOND_CORPS) return refus(phrases.tropGros);
      return { envoi, resultat: p.dansLaFile(() => echanger(p, envoi, etape)) };
    }
    const apres = store.get();
    if (apres.form === avant.form && apres.appearance === avant.appearance) {
      return arret(pourquoiNonEnregistre(false));
    }
    if (essai === ESSAIS) return arret(phrases.enCours);
  }
}

async function emettre(etape: Etape): Promise<boolean> {
  const phrases = t.compte.emission;
  const p = storage;
  if (!estPersistenceCompte(p)) {
    toast(phrases.indisponible, 'error', DUREE_MS);
    return false;
  }
  const { ui: etat } = store.get();
  if (etat.issued !== undefined) {
    toast(phrases.dejaEmise, 'info', DUREE_MS);
    return false;
  }
  if (etat.sample) {
    toast(phrases.exemple, 'error', DUREE_MS);
    return false;
  }

  const lancee = await enregistrerPuisEnvoyer(p, etape);
  if (!lancee) return false;
  const { envoi } = lancee;
  const resultat = await lancee.resultat;
  // Abandonnée au bout du délai : l'issue a été dite, l'utilisateur a repris la main.
  if (etape.abandonnee) return false;
  switch (resultat.kind) {
    case 'emise':
      await ouvrirLaFactureEmise(p, resultat.emise, {
        brouillonOuvert: resultat.ouvert === true,
        secours: envoi,
      });
      toast(phrases.emise(resultat.emise.numero));
      return true;
    case 'refus':
      return reagir(resultat.reaction, envoi);
    case 'incertaine':
      toast(phrases.incertain, 'error', 12_000);
      return false;
  }
}

/**
 * L'échange avec le serveur, dans la file des envois : l'appel, l'issue, et, si la facture est
 * émise, le brouillon quitté avant que la file ne reprenne (`brouillonEmis`).
 */
async function echanger(p: PersistenceCompte, envoi: Envoi, etape: Etape): Promise<Resultat> {
  // Abandonnée pendant l'attente de la file : rien ne part.
  if (etape.abandonnee) return { kind: 'incertaine' };
  etape.envoye = true;
  // Sans réponse au bout du délai, l'issue est incertaine ; la réponse tardive, s'il en vient une,
  // est ignorée (rien n'est quitté pour elle) : la recherche ci-dessous, ou plus tard la reprise
  // d'un brouillon émis (`imposer`), dit ce qu'il en est.
  let resultat = await borne(interroger(envoi), DELAI_EMISSION_MS, { kind: 'incertaine' });
  if (resultat.kind === 'incertaine' && !etape.abandonnee) {
    // La réponse n'est pas arrivée, ou ne se lit pas : la facture est-elle émise ?
    const recherche = p.factureDuBrouillon(envoi.brouillonId).catch(() => undefined);
    const emise = await borne(recherche, DELAI_RECHERCHE_MS, undefined);
    if (emise) resultat = { kind: 'emise', emise };
  }
  // Abandonnée : la facture a peut-être été émise, mais l'éditeur a repris la main ; le brouillon
  // n'est pas quitté (sa reprise, `imposer`, le découvrira et gardera la saisie).
  if (resultat.kind !== 'emise' || etape.abandonnee) {
    return resultat.kind === 'emise' ? { kind: 'incertaine' } : resultat;
  }
  return { ...resultat, ouvert: await p.brouillonEmis(envoi.brouillonId) };
}

/** L'appel à `emettre`, et ce que sa réponse dit. */
async function interroger(envoi: Envoi): Promise<Resultat> {
  const { data, error } = await client().functions.invoke('emettre', {
    body: envoi.corps,
    timeout: DELAI_EMISSION_MS,
  });
  if (!error) {
    const emise = data as { id?: unknown; numero?: unknown } | null;
    return typeof emise?.id === 'string' && typeof emise.numero === 'string'
      ? { kind: 'emise', emise: { id: emise.id, numero: emise.numero } }
      : { kind: 'incertaine' };
  }
  if (!(error instanceof FunctionsHttpError)) return { kind: 'incertaine' };
  const reponse = error.context as Response;
  const corps = await reponse.json().catch(() => undefined);
  const lisible =
    typeof corps === 'object' &&
    corps !== null &&
    typeof (corps as { code?: unknown }).code === 'string';
  // Une panne hors de la fonction (passerelle, worker arrêté) ou qu'elle ne nomme pas : la
  // transaction a pu aboutir. `INTERNE` vient de la fonction, qui a tout annulé.
  if (reponse.status >= 500 && (!lisible || (corps as { code: string }).code !== 'INTERNE')) {
    return { kind: 'incertaine' };
  }
  const { code, message, details } = (lisible ? corps : {}) as {
    code?: string;
    message?: unknown;
    details?: unknown;
  };
  return {
    kind: 'refus',
    reaction: reaction(reponse.status, {
      code: code ?? '',
      message: typeof message === 'string' ? message : '',
      details,
    }),
  };
}

/** Renvoie l'e-mail de confirmation de l'adresse du compte, et dit ce qu'il en est. */
async function renvoyerLaConfirmation(): Promise<void> {
  const email = store.get().ui.compte?.email ?? '';
  try {
    await renvoyerConfirmation(email);
    toast(t.compte.emission.confirmationRenvoyee(email), 'ok', DUREE_MS);
  } catch (erreur) {
    toast(erreur instanceof Error ? erreur.message : t.compte.errors.other, 'error', DUREE_MS);
  }
}

/** Le refus du serveur, dit à l'utilisateur ; le brouillon reste tel quel. */
function reagir(r: Reaction, envoi: Envoi): false {
  const phrases = t.compte.emission;
  switch (r.kind) {
    case 'connexion': {
      // Demandée par un clic : la connexion s'ouvre, même si la session était déjà dite expirée.
      const compte = store.get().ui.compte;
      if (compte) ui({ compte: { ...compte, session: 'expiree' }, connexion: 'connexion' });
      return refus(phrases.session);
    }
    case 'recharger':
      // Aucune écriture d'ici n'était en vol (file des envois) : le brouillon a changé ailleurs.
      ui({ conflit: true });
      return refus(r.texte);
    case 'date':
      focusField('issueDate');
      return refus(phrases.date(r.min ? formatDate(r.min) : undefined, formatDate(r.max)));
    case 'controle':
      // Sans anomalie lisible, l'onglet Contrôle n'aurait rien à montrer.
      if (r.issues.length === 0) return refus(phrases.refusSansDetail);
      ui({
        refusServeur: { form: envoi.form, appearance: envoi.appearance, issues: r.issues },
        tab: 'check',
      });
      focusField(r.issues[0]?.path ?? '', 'check');
      return refus(phrases.refus(r.issues.length));
    case 'message':
      if (r.action === 'renvoyerConfirmation') {
        toast(`${r.texte} ${phrases.aucunNumero}`, 'error', 15_000, {
          label: phrases.renvoyer,
          run: renvoyerLaConfirmation,
        });
        return false;
      }
      return refus(r.texte);
  }
}

/**
 * Relit l'historique et la numérotation (le numéro proposé du brouillon suivant en dépend), chacun
 * s'il se lit. Rend l'historique lu, ou rien s'il ne s'est pas lu.
 */
export async function relireHistorique(p: PersistenceCompte): Promise<SavedInvoice[] | undefined> {
  const [lues, numerotation] = await Promise.allSettled([
    p.list<SavedInvoice>('invoices'),
    p.get<Numbering>('numbering'),
  ]);
  const history = lues.status === 'fulfilled' ? lues.value : undefined;
  const numbering =
    numerotation.status === 'fulfilled' && numerotation.value
      ? fill(defaultNumbering(), numerotation.value)
      : undefined;
  store.set({ ...(history ? { history } : {}), ...(numbering ? { numbering } : {}) });
  return history;
}

/**
 * La facture est émise : ce que le magasin attendait encore du brouillon émis (conflit, écriture en
 * échec) ne vaut plus s'il était l'ouvert ; l'historique et la numérotation sont relus, et la
 * facture émise s'ouvre. Relire peut échouer sans rien défaire : la facture est alors reconstituée
 * de ce qui a été envoyé (`secours`), s'il est là ; sinon elle ne s'ouvre pas, et l'écran reste ce
 * qu'il est. Vrai si elle s'est ouverte : à l'appelant de dire ce qu'il en est. Sert aussi quand on
 * découvre après coup qu'un brouillon a été émis (réponse perdue).
 */
export async function ouvrirLaFactureEmise(
  p: PersistenceCompte,
  emise: Emise,
  options: { brouillonOuvert: boolean; secours?: Envoi },
): Promise<boolean> {
  if (options.brouillonOuvert) oublierLeBrouillonRefuse();
  // Bornée : l'éditeur est encore figé ; à défaut, la facture est reconstituée (`secours`).
  const relue = await borne(relireHistorique(p), DELAI_RELECTURE_MS, undefined);
  let history = relue ?? store.get().history;
  let saved = history.find((h) => h.uid === emise.id);
  if (!saved && options.secours) {
    saved = reconstituer(emise, options.secours);
    history = [...history.filter((h) => h.uid !== emise.id), saved];
  }
  store.set((s) => ({ history, ui: { ...s.ui, refusServeur: undefined } }));
  if (!saved) return false;
  openIssued(saved);
  return true;
}

/** La facture émise, telle que l'historique la rendra, d'après ce qui a été envoyé. */
function reconstituer(emise: Emise, envoi: Envoi): SavedInvoice {
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
