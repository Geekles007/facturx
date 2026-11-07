/**
 * La navigation du mode compte (spec § 10) : Tableau de bord, Factures, Nouvelle facture,
 * Brouillons, Clients, Catalogue et Entreprise, dans cet ordre. Elle prend la place du bouton
 * Bibliothèque de la barre du haut ; sans compte, rien ne change.
 *
 * Les factures et la fiche d'une facture s'ouvrent dans une page modale (`<dialog>`, au-dessus de
 * tout) : l'éditeur reste dessous, tel quel, et rien ne s'y tape tant qu'elle est ouverte. Ce qui
 * crée un document (Nouvelle facture, et les actions de la fiche) passe par les chemins de la barre
 * d'outils, qui ne quittent le brouillon ouvert qu'une fois sa saisie sur le serveur. Clients,
 * Catalogue et Entreprise ouvrent les onglets de la bibliothèque, Brouillons la liste du compte. Le
 * tableau de bord n'existe pas encore : son entrée est là, désactivée.
 *
 * Chargé par `import()` depuis app.tsx, avec le reste du compte.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { ui } from '../store.js';
import { Button, type IconName, Menu, type MenuItem } from '../ui.js';
import { Brouillons } from './brouillons.js';
import { Factures } from './factures.js';
import { Fiche } from './fiche.js';
import type { FiltresSuivi } from './suivi.js';

export type Entree =
  | 'tableau'
  | 'factures'
  | 'nouvelle'
  | 'brouillons'
  | 'clients'
  | 'catalogue'
  | 'entreprise';

/** Les entrées de la navigation, dans l'ordre du § 10 de la spec. */
export const ENTREES: readonly Entree[] = [
  'tableau',
  'factures',
  'nouvelle',
  'brouillons',
  'clients',
  'catalogue',
  'entreprise',
];

const ICONES: Record<Entree, IconName> = {
  tableau: 'eye',
  factures: 'receipt',
  nouvelle: 'plus',
  brouillons: 'folder',
  clients: 'user',
  catalogue: 'tag',
  entreprise: 'building',
};

/** Ce que la page modale montre : la liste des factures, ou la fiche de l'une d'elles. */
export type Page = { vue: 'factures' } | { vue: 'fiche'; factureId: string };

export function Navigation({ nouvelleFacture }: { nouvelleFacture: () => Promise<void> }) {
  const phrases = t.compte.navigation;
  const [page, setPage] = useState<Page>();
  const [brouillons, setBrouillons] = useState(false);
  const actions: Record<Entree, () => void> = {
    tableau: () => undefined,
    factures: () => setPage({ vue: 'factures' }),
    nouvelle: () => void nouvelleFacture(),
    brouillons: () => setBrouillons(true),
    clients: () => ui({ library: 'clients' }),
    catalogue: () => ui({ library: 'products' }),
    entreprise: () => ui({ library: 'company' }),
  };
  const items = ENTREES.map(
    (entree): MenuItem => ({
      label: phrases[entree],
      icon: ICONES[entree],
      onSelect: actions[entree],
      ...(entree === 'tableau' ? { disabled: true, hint: phrases.bientot } : {}),
    }),
  );
  return (
    <>
      <Menu
        label={phrases.titre}
        align="right"
        trigger={(props) => (
          <Button icon="menu" variant="ghost" title={phrases.titre} {...props}>
            <span class="hide-md">{phrases.titre}</span>
          </Button>
        )}
        items={items}
      />
      <Brouillons open={brouillons} onClose={() => setBrouillons(false)} />
      <PageDuCompte page={page} naviguer={setPage} />
    </>
  );
}

/**
 * La page modale des factures. Elle garde les filtres de la liste le temps d'aller à une fiche et
 * d'en revenir ; la liste est relue à chaque retour (un paiement a pu changer un statut).
 */
function PageDuCompte({
  page,
  naviguer,
}: {
  page: Page | undefined;
  naviguer: (page: Page | undefined) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filtres, setFiltres] = useState<FiltresSuivi>({});
  const ouverte = page !== undefined;
  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (ouverte && !dialogue.open) dialogue.showModal();
    if (!ouverte && dialogue.open) dialogue.close();
  }, [ouverte]);
  const fermer = () => naviguer(undefined);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: le clic sur le fond double Échap, que `<dialog>` gère déjà.
    <dialog
      ref={ref}
      class="dialog page-compte"
      aria-label={t.compte.suivi.liste.titre}
      onClose={fermer}
      onClick={(event) => {
        if (event.target === ref.current) fermer();
      }}
    >
      {page?.vue === 'factures' && (
        <Factures
          filtres={filtres}
          changerFiltres={setFiltres}
          ouvrir={(factureId) => naviguer({ vue: 'fiche', factureId })}
          fermer={fermer}
        />
      )}
      {page?.vue === 'fiche' && (
        <Fiche
          key={page.factureId}
          factureId={page.factureId}
          retour={() => naviguer({ vue: 'factures' })}
          fermer={fermer}
        />
      )}
    </dialog>
  );
}
