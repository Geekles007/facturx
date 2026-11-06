/**
 * Les brouillons du compte : la liste (ouvrir, supprimer, nouveau), et les deux réponses à un
 * conflit — recharger la version du serveur, ou garder la sienne.
 *
 * Chargé par `import()` depuis app.tsx, avec le reste du compte. La conservation est celle du
 * serveur, que `demarrer` a mise derrière `storage` ; elle tient le brouillon ouvert. On ne quitte
 * un brouillon qu'une fois sa saisie sur le serveur (`quitterLeBrouillon`) : sinon le Studio dit
 * pourquoi, et l'éditeur reste dessus. Rien de ce qu'on a tapé ne se perd en changeant de document.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatDate, t } from '../i18n.js';
import {
  type Appearance,
  defaultAppearance,
  fill,
  hydrateForm,
  newInvoiceForm,
} from '../library.js';
import { ErreurConservation } from '../persistence.js';
import { storage } from '../storage.js';
import {
  brouillonAffiche,
  oublierLeBrouillonRefuse,
  persistKeys,
  store,
  toast,
  ui,
  useStudio,
} from '../store.js';
import { Button, Dialog, IconButton } from '../ui.js';
import {
  changerDeDocument,
  messageEnAttente,
  quitterLeBrouillon,
  remplacer,
  startDraft,
} from '../workflows.js';
import {
  type Brouillon,
  estPersistenceCompte,
  type PersistenceCompte,
  type ResumeBrouillon,
} from './persistence.js';

/** La conservation du compte, si c'est bien elle qui répond. */
function conservation(): PersistenceCompte {
  if (!estPersistenceCompte(storage)) throw new Error('conservation du compte absente');
  return storage;
}

/** Met `b` dans l'éditeur, complété comme au démarrage : ni facture émise, ni exemple, ni conflit. */
function afficher(b: Brouillon): void {
  store.set((s) => ({
    form: hydrateForm(b.form),
    appearance: fill(defaultAppearance(), b.appearance),
    ui: {
      ...s.ui,
      issued: undefined,
      sample: false,
      conflit: false,
      library: undefined,
      tab: 'content',
      focus: undefined,
    },
  }));
}

/** Ce que l'éditeur affiche, tel que le Studio l'enregistre. */
function affiche(): Brouillon {
  const { form, appearance } = store.get();
  return { form, appearance };
}

/** Le message d'un échec : la saisie qui ne peut pas partir, ou le serveur qui ne répond pas. */
function messageDEchec(erreur: unknown): string {
  if (erreur instanceof ErreurConservation && erreur.code === 'EN_ATTENTE')
    return messageEnAttente(erreur.detail);
  return t.compte.brouillons.echec;
}

/** Une facture vierge, à l'en-tête de l'entreprise, qui devient un nouveau brouillon. */
async function nouveau(): Promise<boolean> {
  // Le refus vient tout de suite : lire l'apparence par défaut attendrait le réseau pour rien.
  if (!(await quitterLeBrouillon())) return false;
  const { company, numbering } = store.get();
  const apparence = await storage.get<Appearance>(persistKeys.appearance).catch(() => undefined);
  return startDraft(newInvoiceForm(company, numbering), fill(defaultAppearance(), apparence));
}

// ---------- conflit ----------

/** Le conflit tranché pour la version du serveur : elle remplace la saisie affichée. */
export async function rechargerBrouillon(): Promise<void> {
  const phrases = t.compte.conservation;
  try {
    const p = conservation();
    const b = await p.rechargerBrouillon();
    if (b) {
      afficher(b);
      toast(phrases.recharge);
      return;
    }
    // Émis ou supprimé ailleurs : il n'y a rien à recharger, la saisie devient un nouveau brouillon.
    await p.imposerBrouillon(affiche());
    ui({ conflit: false });
    toast(phrases.supprimeAilleurs, 'info', 7000);
  } catch (erreur) {
    toast(messageDEchec(erreur), 'error');
  }
}

/**
 * La saisie que le serveur refuse, abandonnée après confirmation : le brouillon revient à sa
 * dernière version enregistrée, ou laisse la place à une facture vierge s'il ne l'a jamais été.
 * Le miroir et ce qui attendait s'en vont ; l'éditeur change dans le même temps.
 */
export async function abandonnerSaisie(): Promise<void> {
  const phrases = t.compte.conservation;
  if (!confirm(phrases.abandonnerConfirm)) return;
  try {
    const b = (await conservation().abandonnerSaisie()) as Brouillon | undefined;
    oublierLeBrouillonRefuse();
    if (b) afficher(b);
    else {
      const { company, numbering, appearance } = store.get();
      remplacer(newInvoiceForm(company, numbering), appearance);
    }
    toast(phrases.abandonne);
  } catch (erreur) {
    toast(messageDEchec(erreur), 'error');
  }
}

/** Le conflit tranché pour la saisie affichée : elle remplace la version du serveur, relue avant. */
export async function garderMaVersion(): Promise<void> {
  const phrases = t.compte.conservation;
  if (!confirm(phrases.garderConfirm)) return;
  try {
    await conservation().imposerBrouillon(affiche());
    ui({ conflit: false });
    toast(phrases.garde);
  } catch (erreur) {
    toast(messageDEchec(erreur), 'error');
  }
}

// ---------- la liste ----------

export function Brouillons({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phrases = t.compte.brouillons;
  // Une facture émise ou l'exemple affichés : le brouillon ouvert est dessous, il se rouvre.
  const vue = useStudio((s) => s.ui.issued !== undefined || s.ui.sample);
  const [liste, setListe] = useState<ResumeBrouillon[]>();
  const [erreur, setErreur] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const charger = async (): Promise<void> => {
    setErreur(false);
    try {
      setListe(await conservation().brouillons());
    } catch {
      setErreur(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    setListe(undefined);
    void charger();
  }, [open]);

  /** Une action à la fois ; un échec le dit, sans rien changer à l'éditeur. */
  const agir = async (action: (p: PersistenceCompte) => Promise<void>): Promise<void> => {
    if (occupe) return;
    setOccupe(true);
    try {
      await action(conservation());
    } catch (raison) {
      toast(messageDEchec(raison), 'error', 9000);
    } finally {
      setOccupe(false);
    }
  };

  /**
   * Ouvre `id` : la conservation bascule après sa lecture, sans attendre, et l'éditeur suit dans le
   * même temps (aucune frappe ne s'intercale). Vrai si le brouillon est ouvert ; rien s'il n'existe
   * plus.
   */
  const basculerVers = async (p: PersistenceCompte, id: string): Promise<boolean | undefined> => {
    const ouvrirLe = async (): Promise<boolean> => {
      const b = await p.ouvrirBrouillon(id, brouillonAffiche);
      if (b) afficher(b);
      return true;
    };
    // Le brouillon ouvert (sous une vue) se rouvre tel quel ; un autre attend que la saisie parte.
    const dejaOuvert = id === p.brouillonCourant()?.id;
    if (!(dejaOuvert ? await ouvrirLe() : await changerDeDocument(ouvrirLe))) return false;
    return p.brouillonCourant()?.id === id ? true : undefined;
  };

  const ouvrir = (id: string) =>
    agir(async (p) => {
      const ouvert = await basculerVers(p, id);
      if (ouvert === undefined) {
        toast(phrases.introuvable, 'error');
        await charger();
        return;
      }
      if (ouvert) onClose();
    });

  /** La saisie d'un brouillon jamais parvenu au serveur, cachée sous une vue : on la reprend. */
  const reprendre = (b: Brouillon) => {
    afficher(b);
    onClose();
  };

  const creer = () =>
    agir(async () => {
      if (await nouveau()) onClose();
    });

  const supprimer = (b: ResumeBrouillon) =>
    agir(async (p) => {
      if (!confirm(phrases.supprimerConfirm(b.numero || t.app.untitled))) return;
      const ouvert = p.brouillonCourant()?.id === b.id;
      await p.supprimerBrouillon(b.id);
      const restants = await p.brouillons();
      setListe(restants);
      if (!ouvert) return;
      // L'éditeur ne garde pas le brouillon supprimé : il passe au plus récent des autres, ou à
      // une facture vierge s'il n'en reste aucun (ou si le suivant a disparu entre-temps).
      const suivant = restants[0] ? await basculerVers(p, restants[0].id) : undefined;
      if (suivant === undefined) await nouveau();
    });

  const p = open ? conservation() : undefined;
  const courant = p?.brouillonCourant()?.id;
  // Une saisie qui attend le serveur, sous une vue, et absente de la liste (jamais créée).
  const enAttente = vue ? (p?.saisieEnAttente() as Brouillon | undefined) : undefined;
  const cachee = enAttente && !liste?.some((b) => b.id === courant) ? enAttente : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={phrases.titre}
      wide
      actions={
        <Button variant="primary" icon="plus" disabled={occupe} onClick={creer}>
          {phrases.nouveau}
        </Button>
      }
    >
      <p class="field-hint">{phrases.intro}</p>
      {erreur && (
        <p class="field-issue" role="alert">
          {phrases.echec}
        </p>
      )}
      {!erreur && liste === undefined && <p class="lib-empty">{phrases.chargement}</p>}
      {liste?.length === 0 && !cachee && <p class="lib-empty">{phrases.vide}</p>}
      {liste && (liste.length > 0 || cachee) && (
        <ul class="lib-list">
          {cachee && (
            <li>
              <div class="lib-main">
                <strong>
                  {cachee.form.id || t.app.untitled}
                  <span class="type-tag">{phrases.nonEnregistre}</span>
                </strong>
                <span>{cachee.form.buyer.name || phrases.sansClient}</span>
              </div>
              <div class="lib-actions">
                <Button size="sm" variant="ghost" onClick={() => reprendre(cachee)}>
                  {phrases.reprendre}
                </Button>
              </div>
            </li>
          )}
          {liste.map((b) => (
            <li key={b.id}>
              <div class="lib-main">
                <strong>
                  {b.numero || t.app.untitled}
                  {b.id === courant && !vue && <span class="type-tag">{phrases.ouvert}</span>}
                </strong>
                <span>
                  {b.client || phrases.sansClient} · {phrases.modifie(formatDate(b.modifieLe))}
                </span>
              </div>
              <div class="lib-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={occupe || (b.id === courant && !vue)}
                  onClick={() => ouvrir(b.id)}
                >
                  {phrases.ouvrir}
                </Button>
                <IconButton
                  icon="trash"
                  label={t.app.remove}
                  disabled={occupe}
                  onClick={() => supprimer(b)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
