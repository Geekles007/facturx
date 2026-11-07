/**
 * Le dialogue d'import des données de ce navigateur (spec § 10). À la première connexion, si ce
 * navigateur garde des données du Studio utilisé sans compte, il les propose, avec ce qu'il a
 * trouvé — jamais d'office : « Pas maintenant », ou fermer, est retenu pour ce compte, et la
 * proposition ne revient qu'à la demande, depuis « Mon compte » (`ui.importation = 'demandee'`).
 * Un import resté en chemin pendant les factures est reproposé comme une reprise : seules les
 * factures qui attendaient repartent.
 *
 * Pendant l'import, le dialogue ne se ferme pas et dit où il en est ; à la fin, le bilan : factures
 * importées, déjà dans le compte ou numéros pris par une autre facture, refusées (avec la raison),
 * en attente, ce qui était déjà dans le compte et ce qui en a été gardé, ce qui n'a pas été repris.
 * Après la limite de débit, l'import reprend de lui-même à l'heure dite si le dialogue reste ouvert,
 * jamais plus tôt qu'un plancher qui double à chaque reprise retombée sur la limite ; après un autre
 * arrêt, « Reprendre l'import ». Une reprise n'envoie que ce qui attendait.
 *
 * Monté une fois, par la navigation du compte ; chargé par `import()` avec elle.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { store, ui, useStudio } from '../store.js';
import { Button, Dialog } from '../ui.js';
import {
  cumuler,
  delaiDeReprise,
  importerCeNavigateur,
  messageNumerotation,
  type RapportNavigateur,
} from './import.js';
import {
  aDesDonnees,
  type Inventaire,
  importAProposer,
  inventaireLocal,
  retenirImport,
} from './proposition.js';

type Etat =
  | { kind: 'lecture' }
  /** Ce que ce navigateur garde ; rien s'il n'y a rien à importer. */
  | { kind: 'offre'; inventaire: Inventaire | undefined }
  | { kind: 'import'; progression?: [number, number] }
  | { kind: 'bilan'; rapport: RapportNavigateur }
  | { kind: 'erreur' };

/** Une passe : la reprise de ces factures seules (sinon tout), à cumuler à un bilan précédent. */
interface Passe {
  reprise?: string[] | undefined;
  avant?: RapportNavigateur | undefined;
  /** Relancée d'elle-même après la limite de débit. */
  auto?: boolean;
}

/** Deux passes en un bilan ; le brouillon, tel que la dernière passe qui s'en est occupée le dit. */
function cumulerAvecBrouillon(
  avant: RapportNavigateur,
  apres: RapportNavigateur,
): RapportNavigateur {
  const brouillon = apres.brouillon ?? avant.brouillon;
  return { ...cumuler(avant, apres), ...(brouillon ? { brouillon } : {}) };
}

/** « votre entreprise, 2 clients et 3 factures émises ». */
function inventaireEnMots(i: Inventaire): string {
  const trouves = t.compte.importation.trouves;
  const parties: string[] = [];
  if (i.entreprise) parties.push(trouves.entreprise);
  if (i.clients > 0) parties.push(trouves.clients(i.clients));
  if (i.produits > 0) parties.push(trouves.produits(i.produits));
  if (i.factures > 0) parties.push(trouves.factures(i.factures));
  if (i.brouillon) parties.push(trouves.brouillon);
  return t.compte.importation.liste(parties);
}

export function DialogueImport() {
  const phrases = t.compte.importation;
  const demande = useStudio((s) => s.ui.importation);
  const pret = useStudio((s) => s.ui.storage === 'ok' && s.ui.compte?.session === 'active');
  const [etat, setEtat] = useState<Etat>({ kind: 'lecture' });
  const verifiee = useRef(false);
  // Un double clic n'importe qu'une fois.
  const enVol = useRef(false);
  // Les reprises automatiques retombées sur la limite d'affilée : le plancher double à chacune.
  const essaisLimite = useRef(0);

  // La première connexion : une fois par chargement, dès que le compte est lu.
  useEffect(() => {
    if (!pret || verifiee.current) return;
    verifiee.current = true;
    void importAProposer().then(
      (inventaire) => {
        if (!inventaire || store.get().ui.importation !== undefined) return;
        setEtat({ kind: 'offre', inventaire });
        ui({ importation: 'proposee' });
      },
      () => undefined,
    );
  }, [pret]);

  // Demandé depuis « Mon compte » : ce que ce navigateur garde, relu.
  useEffect(() => {
    if (demande !== 'demandee') return;
    let abandonne = false;
    setEtat({ kind: 'lecture' });
    void inventaireLocal().then((inventaire) => {
      if (abandonne) return;
      setEtat({
        kind: 'offre',
        inventaire: inventaire && aDesDonnees(inventaire) ? inventaire : undefined,
      });
    });
    return () => {
      abandonne = true;
    };
  }, [demande]);

  const lancer = async ({ reprise, avant, auto }: Passe) => {
    if (enVol.current) return;
    enVol.current = true;
    setEtat({ kind: 'import' });
    try {
      const rapport = await importerCeNavigateur({
        reprise,
        progression: (n, total) => setEtat({ kind: 'import', progression: [n, total] }),
      });
      const limite = rapport.arret?.reessayerApres !== undefined;
      essaisLimite.current = limite && auto ? essaisLimite.current + 1 : 0;
      setEtat({
        kind: 'bilan',
        rapport: avant ? cumulerAvecBrouillon(avant, rapport) : rapport,
      });
    } catch {
      setEtat({ kind: 'erreur' });
    } finally {
      enVol.current = false;
    }
  };

  /**
   * Reprendre : après un arrêt avant les factures (session, réseau dès l'entreprise), tout, de
   * nouveau ; sinon les factures qui attendent seules (aucune, si seul le brouillon restait), et le
   * brouillon s'il n'avait pas pu être repris.
   */
  const reprendre = (avant: RapportNavigateur, auto = false) =>
    void lancer(
      avant.arret?.etape === 'bibliotheque'
        ? { auto }
        : { avant, reprise: avant.enAttente.map((f) => f.uid), auto },
    );

  // Arrêté par la limite de débit : on reprend à l'heure dite, tant que le dialogue reste ouvert.
  const bilan = etat.kind === 'bilan' ? etat.rapport : undefined;
  useEffect(() => {
    const quand = bilan?.arret?.reessayerApres;
    if (!bilan || !quand) return;
    const attente = delaiDeReprise(quand, Date.now(), essaisLimite.current);
    const minuterie = setTimeout(() => reprendre(bilan, true), attente);
    return () => clearTimeout(minuterie);
  }, [bilan]);

  const enCours = etat.kind === 'import';
  const fermer = () => {
    if (enCours) return;
    // Proposée d'office et fermée sans importer : le refus est retenu pour ce compte.
    if (demande === 'proposee' && etat.kind === 'offre') void retenirImport('refuse');
    // Fermé, le dialogue oublie tout, et la reprise prévue avec lui.
    setEtat({ kind: 'lecture' });
    essaisLimite.current = 0;
    ui({ importation: undefined });
  };

  return (
    <Dialog open={demande !== undefined} onClose={fermer} fermable={!enCours} title={phrases.titre}>
      <div class="compte-form">
        {etat.kind === 'lecture' && <p class="lib-empty">{phrases.lecture}</p>}
        {etat.kind === 'offre' && (
          <Offre
            inventaire={etat.inventaire}
            importer={() =>
              void lancer({
                // Une reprise (factures en attente, brouillon à reprendre) n'envoie que cela.
                reprise:
                  etat.inventaire?.enAttente || etat.inventaire?.brouillonEnAttente
                    ? (etat.inventaire.enAttente ?? [])
                    : undefined,
              })
            }
            fermer={fermer}
          />
        )}
        {etat.kind === 'import' && (
          <>
            <p role="status">
              {etat.progression
                ? phrases.progression(etat.progression[0], etat.progression[1])
                : phrases.bibliotheque}
            </p>
            <p class="field-hint">{phrases.enCours}</p>
          </>
        )}
        {etat.kind === 'bilan' && (
          <Bilan rapport={etat.rapport} reprendre={() => reprendre(etat.rapport)} fermer={fermer} />
        )}
        {etat.kind === 'erreur' && (
          <>
            <div class="banner warn" role="alert">
              <span>{phrases.erreur}</span>
            </div>
            <div class="row-actions">
              <Button variant="primary" onClick={fermer}>
                {t.app.close}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Offre({
  inventaire,
  importer,
  fermer,
}: {
  inventaire: Inventaire | undefined;
  importer: () => void;
  fermer: () => void;
}) {
  const phrases = t.compte.importation;
  if (!inventaire) {
    return (
      <>
        <p>{phrases.aucune}</p>
        <div class="row-actions">
          <Button variant="primary" onClick={fermer}>
            {t.app.close}
          </Button>
        </div>
      </>
    );
  }
  const enAttente = inventaire.enAttente?.length ?? 0;
  const reprise = enAttente > 0 || inventaire.brouillonEnAttente === true;
  return (
    <>
      <p class="import-trouve">{phrases.trouve(inventaireEnMots(inventaire))}</p>
      {reprise ? (
        <>
          {enAttente > 0 && <p>{phrases.repriseFactures(enAttente)}</p>}
          {inventaire.brouillonEnAttente && <p>{phrases.repriseBrouillon}</p>}
        </>
      ) : (
        <>
          {inventaire.reprise && <p>{phrases.reprise}</p>}
          <p>{phrases.explication}</p>
        </>
      )}
      <p class="field-hint">{phrases.plusTard}</p>
      <div class="row-actions">
        <Button variant="ghost" onClick={fermer}>
          {phrases.pasMaintenant}
        </Button>
        <Button variant="primary" icon="upload" onClick={importer}>
          {reprise ? phrases.reprendre : phrases.importer}
        </Button>
      </div>
    </>
  );
}

function Bilan({
  rapport,
  reprendre,
  fermer,
}: {
  rapport: RapportNavigateur;
  reprendre: () => void;
  fermer: () => void;
}) {
  const phrases = t.compte.importation;
  const bilan = phrases.bilan;
  const { arret } = rapport;
  const numerotation = messageNumerotation(rapport);
  return (
    <>
      <p class={arret ? 'import-arrete' : 'import-termine'} role="status">
        {arret ? phrases.arrete : phrases.termine}
      </p>
      <p>{bilan.factures(rapport.factures)}</p>
      {(rapport.clients > 0 || rapport.produits > 0) && (
        <p>{bilan.bibliotheque(rapport.clients, rapport.produits)}</p>
      )}
      {(rapport.clientsDejaLa > 0 || rapport.produitsDejaLa > 0) && (
        <p>{bilan.dejaLa(rapport.clientsDejaLa, rapport.produitsDejaLa)}</p>
      )}
      {rapport.conserves.length > 0 && (
        <p>
          {bilan.conserves(phrases.liste(rapport.conserves.map((c) => bilan.conservesNoms[c])))}
        </p>
      )}
      {rapport.doublons.length > 0 && <p>{bilan.doublons(rapport.doublons)}</p>}
      {numerotation && <p>{numerotation}</p>}
      {rapport.brouillon && <p>{phrases.brouillon[rapport.brouillon]}</p>}
      {rapport.numerosPris.length > 0 && (
        <div class="banner warn" role="alert">
          <span>{bilan.numerosPris(rapport.numerosPris)}</span>
        </div>
      )}
      {rapport.refusees.length > 0 && (
        <Liste
          titre={bilan.refusees}
          lignes={rapport.refusees.map((r) => `${r.numero} : ${r.raison}`)}
        />
      )}
      {rapport.echecs.length > 0 && (
        <Liste
          titre={bilan.echecs}
          lignes={rapport.echecs.map((e) => `${e.element} : ${e.raison}`)}
        />
      )}
      {arret && (
        <div class="banner warn" role="alert">
          <span>
            {rapport.enAttente.length > 0 &&
              `${bilan.enAttente(rapport.enAttente.length)} ${rapport.enAttente.map((f) => f.numero).join(', ')}. `}
            {arret.raison}
            {arret.reessayerApres && ` ${phrases.reprendra}`}
          </span>
        </div>
      )}
      <div class="row-actions">
        {((arret && !arret.reessayerApres) || rapport.brouillon === 'nonRepris') && (
          <Button icon="refresh" onClick={reprendre}>
            {phrases.reprendre}
          </Button>
        )}
        <Button variant="primary" onClick={fermer}>
          {t.app.close}
        </Button>
      </div>
    </>
  );
}

function Liste({ titre, lignes }: { titre: string; lignes: string[] }) {
  return (
    <div>
      <p>{titre}</p>
      <ul class="import-liste">
        {lignes.map((ligne) => (
          <li key={ligne}>{ligne}</li>
        ))}
      </ul>
    </div>
  );
}
