/**
 * facturx Studio — démarrage.
 *
 * Relit ce que ce navigateur a conservé (brouillon, entreprise, clients, catalogue, historique,
 * numérotation) ; à la première visite, ouvre la facture d'exemple. Sans compte, tout s'exécute ici :
 * le Studio n'a pas de serveur. Un seul signal sans contenu part quand un PDF Factur-X est produit,
 * pour le décompte (site/README.md, « Compter les factures du Studio »). Avec un compte, la session
 * est restaurée avant la lecture de ce qui a été conservé, qui vient alors du serveur. Un compte dont
 * la suppression est demandée n'ouvre que l'écran d'annulation (spec § 12) : ni l'éditeur, ni rien
 * de ce qu'il conserve.
 */

import { render } from 'preact';
import { App } from './app.js';
import { compteActif, retourDeLien, sessionProbable } from './compte/session.js';
import { t } from './i18n.js';
import {
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  fill,
  hydrateForm,
} from './library.js';
import { estDuCompte } from './persistence.js';
import { sampleForm } from './sample.js';
import { storage } from './storage.js';
import { DELAI_COMPTE_MS, type Loaded, loadPersisted, startPersistence, store } from './store.js';

async function boot(): Promise<void> {
  const root = document.getElementById('studio');
  if (!root) return;
  // Qui n'a pas de session ne télécharge ni `supabase-js` ni le code du compte. Le retour d'un lien
  // de confirmation arrive sans session, avec un code (ou une erreur) dans l'adresse : il charge le
  // compte, qui échange le code ou explique l'échec. Si le fragment ne se charge pas (hors ligne),
  // le Studio démarre en mode local.
  if (compteActif() && (sessionProbable() || retourDeLien() !== undefined)) {
    await import('./compte/index.js').then((m) => m.demarrer()).catch(() => undefined);
  }
  if (store.get().ui.compte?.suppressionDemandeeLe) {
    await ecranDeSuppression(root);
    return;
  }
  const loaded = await loadPersisted().catch(() => undefined);
  const ui = store.get().ui;
  if (loaded) {
    const draft = loaded.draft;
    store.set({
      form: draft ? hydrateForm(draft.form) : sampleForm(),
      appearance: draft ? fill(defaultAppearance(), draft.appearance) : defaultAppearance(),
      company: fill(defaultCompany(), loaded.company),
      numbering: fill(defaultNumbering(), loaded.numbering),
      clients: loaded.clients,
      products: loaded.products,
      history: loaded.history,
      ui: {
        ...ui,
        storage: 'ok',
        sample: draft ? draft.sample === true : true,
        issued: draft?.issued,
      },
    });
  } else if (ui.compte && estDuCompte(storage)) {
    // Le serveur du compte n'a pas répondu à la lecture : rien n'en est lu, donc rien n'y part
    // (`injoignable`). La saisie gardée dans ce navigateur reprend, et le Studio le dit.
    const local = (await storage.brouillonLocal().catch(() => undefined)) as Loaded['draft'];
    store.set({
      form: local ? hydrateForm(local.form) : sampleForm(),
      appearance: local ? fill(defaultAppearance(), local.appearance) : defaultAppearance(),
      ui: {
        ...ui,
        storage: 'injoignable',
        sample: local ? local.sample === true : true,
        issued: local?.issued,
      },
    });
  } else {
    store.set({ form: sampleForm(), ui: { ...ui, storage: 'memory', sample: true } });
  }
  // En mode compte, l'enregistrement part vers le serveur une seconde après la dernière frappe.
  startPersistence(store.get().ui.compte ? { delai: DELAI_COMPTE_MS } : {});
  root.replaceChildren();
  render(<App />, root);
}

/**
 * L'écran d'un compte en suppression, à la place du Studio. Si son fragment ne se charge pas, une
 * phrase le dit et propose de recharger : l'éditeur ne s'ouvre pas pour autant.
 */
async function ecranDeSuppression(root: HTMLElement): Promise<void> {
  const ecran = await import('./compte/annulation.js').catch(() => undefined);
  root.replaceChildren();
  if (ecran) {
    render(<ecran.EcranSuppression />, root);
    return;
  }
  render(
    <div class="boot">
      <p class="boot-text">{t.compte.suppression.chargement}</p>
      <p>
        <button type="button" class="btn-ui default md" onClick={() => location.reload()}>
          {t.compte.conservation.rechargerPage}
        </button>
      </p>
    </div>,
    root,
  );
}

void boot();
