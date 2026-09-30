/**
 * facturx Studio — démarrage.
 *
 * Relit ce que ce navigateur a conservé (brouillon, entreprise, clients, catalogue, historique,
 * numérotation) ; à la première visite, ouvre la facture d'exemple. Tout s'exécute ici : le Studio
 * n'a pas de serveur. Un seul signal sans contenu part quand un PDF Factur-X est produit, pour le
 * décompte (site/README.md, « Compter les factures du Studio »).
 */

import { render } from 'preact';
import { App } from './app.js';
import { defaultAppearance, defaultCompany, defaultNumbering } from './library.js';
import { blankForm, blankParty, type InvoiceForm } from './model.js';
import { sampleForm } from './sample.js';
import { loadPersisted, startPersistence, store } from './store.js';

/** Complète un objet conservé par les valeurs par défaut : un champ ajouté depuis ne manque jamais. */
function fill<T>(defaults: T, saved: unknown): T {
  if (Array.isArray(defaults) || saved === undefined || saved === null)
    return (saved ?? defaults) as T;
  if (
    typeof defaults !== 'object' ||
    defaults === null ||
    typeof saved !== 'object' ||
    Array.isArray(saved)
  ) {
    return saved as T;
  }
  if (saved instanceof Uint8Array) return saved as T;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    out[key] = key in out ? fill(out[key], value) : value;
  }
  return out as T;
}

function hydrateForm(saved: InvoiceForm): InvoiceForm {
  const form = fill(blankForm(), saved);
  form.seller = fill(blankParty(), saved.seller);
  form.buyer = fill(blankParty(), saved.buyer);
  return form;
}

async function boot(): Promise<void> {
  const root = document.getElementById('studio');
  if (!root) return;
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
  } else {
    store.set({ form: sampleForm(), ui: { ...ui, storage: 'memory', sample: true } });
  }
  startPersistence();
  root.replaceChildren();
  render(<App />, root);
}

void boot();
