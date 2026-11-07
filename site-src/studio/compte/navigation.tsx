/**
 * La navigation du mode compte (spec § 10) : Tableau de bord, Factures, Nouvelle facture,
 * Brouillons, Clients, Catalogue et Entreprise, dans cet ordre. Elle prend la place du bouton
 * Bibliothèque de la barre du haut ; sans compte, rien ne change.
 *
 * Le tableau de bord, les factures et la fiche d'une facture s'ouvrent dans une page modale
 * (`<dialog>`, au-dessus de tout) : l'éditeur reste dessous, tel quel, et rien ne s'y tape tant
 * qu'elle est ouverte. Une facture s'ouvre depuis la liste ou depuis le tableau de bord, et sa fiche
 * ramène là d'où l'on vient. Ce qui crée un document (Nouvelle facture, et les actions de la fiche)
 * passe par les chemins de la barre d'outils, qui ne quittent le brouillon ouvert qu'une fois sa
 * saisie sur le serveur. Entreprise ouvre sa page (profil, logo, numérotation, compte), dans la même
 * page modale ; Clients et Catalogue ouvrent les onglets de la bibliothèque, Brouillons la liste du
 * compte. « Relancer » (tableau de bord, fiche) ouvre le dialogue de relance, monté ici une fois,
 * au-dessus de la page ; après chaque relance, la fiche ouverte se relit. Le dialogue d'import des
 * données de ce navigateur est monté ici aussi : il se propose de lui-même à la première connexion,
 * et « Mon compte » le rouvre. Le formulaire du nouveau mot de passe, après un lien de
 * réinitialisation, aussi.
 *
 * Chargé par `import()` depuis app.tsx, avec le reste du compte.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { ui } from '../store.js';
import { Button, type IconName, Menu, type MenuItem } from '../ui.js';
import { Brouillons } from './brouillons.js';
import { Entreprise } from './entreprise.js';
import { Factures } from './factures.js';
import { Fiche } from './fiche.js';
import { DialogueImport } from './importation.js';
import { DialogueRecuperation } from './motdepasse.js';
import type { TypePeriode } from './periode.js';
import { DialogueRelance } from './relance.js';
import type { FiltresSuivi } from './suivi.js';
import { TableauDeBord } from './tableau.js';

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

/**
 * Ce que la page modale montre : le tableau de bord, la liste des factures, la fiche de l'une
 * d'elles, ouverte depuis l'un ou l'autre, ou la page Entreprise.
 */
export type Page =
  | { vue: 'tableau' }
  | { vue: 'factures' }
  | { vue: 'fiche'; factureId: string; depuis: 'tableau' | 'factures' }
  | { vue: 'entreprise' };

export function Navigation({ nouvelleFacture }: { nouvelleFacture: () => Promise<void> }) {
  const phrases = t.compte.navigation;
  const [page, setPage] = useState<Page>();
  const [brouillons, setBrouillons] = useState(false);
  // Les relances faites depuis le dialogue : la fiche ouverte se relit à chacune.
  const [relances, setRelances] = useState(0);
  const actions: Record<Entree, () => void> = {
    tableau: () => setPage({ vue: 'tableau' }),
    factures: () => setPage({ vue: 'factures' }),
    nouvelle: () => void nouvelleFacture(),
    brouillons: () => setBrouillons(true),
    clients: () => ui({ library: 'clients' }),
    catalogue: () => ui({ library: 'products' }),
    entreprise: () => setPage({ vue: 'entreprise' }),
  };
  const items = ENTREES.map(
    (entree): MenuItem => ({
      label: phrases[entree],
      icon: ICONES[entree],
      onSelect: actions[entree],
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
      <PageDuCompte page={page} naviguer={setPage} relances={relances} />
      {/* Au-dessus de la page : ouvert après elle, il passe devant. */}
      <DialogueRelance
        apres={() => setRelances((n) => n + 1)}
        ouvrirEntreprise={() => {
          setPage({ vue: 'entreprise' });
          ui({ relance: undefined });
        }}
      />
      <DialogueImport />
      <DialogueRecuperation />
    </>
  );
}

/**
 * La page modale du compte. Elle garde les filtres de la liste et la période du tableau de bord le
 * temps d'aller à une fiche et d'en revenir ; la liste et le tableau de bord sont relus à chaque
 * retour (un paiement a pu changer un statut).
 */
function PageDuCompte({
  page,
  naviguer,
  relances,
}: {
  page: Page | undefined;
  naviguer: (page: Page | undefined) => void;
  /** Le nombre de relances faites : la fiche se relit quand il change. */
  relances: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filtres, setFiltres] = useState<FiltresSuivi>({});
  const [periode, setPeriode] = useState<TypePeriode>('mois');
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
      aria-label={
        page?.vue === 'tableau'
          ? t.compte.tableau.titre
          : page?.vue === 'fiche'
            ? t.compte.suivi.fiche.titre
            : page?.vue === 'entreprise'
              ? t.compte.entreprise.titre
              : t.compte.suivi.liste.titre
      }
      onClose={fermer}
      onClick={(event) => {
        if (event.target === ref.current) fermer();
      }}
    >
      {page?.vue === 'tableau' && (
        <TableauDeBord
          periode={periode}
          changerPeriode={setPeriode}
          ouvrir={(factureId) => naviguer({ vue: 'fiche', factureId, depuis: 'tableau' })}
          fermer={fermer}
        />
      )}
      {page?.vue === 'factures' && (
        <Factures
          filtres={filtres}
          changerFiltres={setFiltres}
          ouvrir={(factureId) => naviguer({ vue: 'fiche', factureId, depuis: 'factures' })}
          fermer={fermer}
        />
      )}
      {page?.vue === 'fiche' && (
        <Fiche
          key={page.factureId}
          factureId={page.factureId}
          retour={() => naviguer({ vue: page.depuis })}
          libelleRetour={
            page.depuis === 'tableau' ? t.compte.tableau.retour : t.compte.suivi.fiche.retour
          }
          fermer={fermer}
          relances={relances}
        />
      )}
      {page?.vue === 'entreprise' && <Entreprise fermer={fermer} />}
    </dialog>
  );
}
