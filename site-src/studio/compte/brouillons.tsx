/**
 * Les brouillons du compte : la liste (ouvrir, supprimer, nouveau), et les deux réponses à un
 * conflit — recharger la version du serveur, ou garder la sienne.
 *
 * Chargé par `import()` depuis app.tsx, avec le reste du compte. La conservation est celle du
 * serveur, que `demarrer` a mise derrière `storage` ; elle tient le brouillon courant. Avant de
 * changer de brouillon, ce qui attend le délai d'enregistrement part : la saisie en cours ne se
 * perd pas, et ne s'écrit pas dans le brouillon suivant.
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
import { storage } from '../storage.js';
import { enregistrerMaintenant, persistKeys, store, toast, ui } from '../store.js';
import { Button, Dialog, IconButton } from '../ui.js';
import { startDraft } from '../workflows.js';
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

/** Une facture vierge, à l'en-tête de l'entreprise, qui deviendra un nouveau brouillon. */
async function nouveau(p: PersistenceCompte): Promise<void> {
  await enregistrerMaintenant();
  await p.nouveauBrouillon();
  const { company, numbering } = store.get();
  const apparence = await p.get<Appearance>(persistKeys.appearance).catch(() => undefined);
  startDraft(newInvoiceForm(company, numbering), fill(defaultAppearance(), apparence));
  ui({ conflit: false });
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
  } catch {
    toast(t.compte.brouillons.echec, 'error');
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
  } catch {
    toast(t.compte.brouillons.echec, 'error');
  }
}

// ---------- la liste ----------

export function Brouillons({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phrases = t.compte.brouillons;
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
    } catch {
      toast(phrases.echec, 'error');
    } finally {
      setOccupe(false);
    }
  };

  const ouvrir = (id: string) =>
    agir(async (p) => {
      await enregistrerMaintenant();
      const b = await p.ouvrirBrouillon(id);
      if (!b) {
        toast(phrases.introuvable, 'error');
        await charger();
        return;
      }
      afficher(b);
      onClose();
    });

  const creer = () =>
    agir(async (p) => {
      await nouveau(p);
      onClose();
    });

  const supprimer = (b: ResumeBrouillon) =>
    agir(async (p) => {
      if (!confirm(phrases.supprimerConfirm(b.numero || t.app.untitled))) return;
      // La saisie en attente part d'abord : sinon elle recréerait le brouillon supprimé.
      await enregistrerMaintenant();
      const ouvert = p.brouillonCourant()?.id === b.id;
      await p.supprimerBrouillon(b.id);
      const restants = await p.brouillons();
      setListe(restants);
      if (!ouvert) return;
      // L'éditeur ne garde pas le brouillon supprimé : il passe au plus récent des autres, ou à
      // une facture vierge s'il n'en reste aucun.
      const suivant = restants[0] && (await p.ouvrirBrouillon(restants[0].id));
      if (suivant) afficher(suivant);
      else await nouveau(p);
    });

  const courant = open ? conservation().brouillonCourant()?.id : undefined;

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
      {liste?.length === 0 && <p class="lib-empty">{phrases.vide}</p>}
      {liste && liste.length > 0 && (
        <ul class="lib-list">
          {liste.map((b) => (
            <li key={b.id}>
              <div class="lib-main">
                <strong>
                  {b.numero || t.app.untitled}
                  {b.id === courant && <span class="type-tag">{phrases.ouvert}</span>}
                </strong>
                <span>
                  {b.client || phrases.sansClient} · {phrases.modifie(formatDate(b.modifieLe))}
                </span>
              </div>
              <div class="lib-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={occupe || b.id === courant}
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
