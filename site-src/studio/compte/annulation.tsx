/**
 * L'écran d'un compte dont la suppression est demandée (spec § 12) : à la connexion, le Studio
 * n'ouvre que lui, jamais l'éditeur. Il dit la date de la demande et celle où tout sera effacé, et
 * n'offre que trois choses : annuler la suppression (la page se recharge, et le Studio reprend tel
 * qu'il était), exporter encore ses données, se déconnecter. « Importer les données de ce
 * navigateur » n'y figure pas.
 *
 * Rien ne s'y enregistre : `main.tsx` ne lit pas la conservation et ne la démarre pas. Une saisie
 * que le miroir de ce navigateur garde sans que le serveur l'ait reçue attend l'annulation ; la
 * déconnexion la signale avant d'effacer quoi que ce soit.
 *
 * Chargé par `import()` depuis `main.tsx`, avec le reste du compte.
 */

import { useState } from 'preact/hooks';
import { formatDate, t } from '../i18n.js';
import { fragmentNonCharge } from '../rechargement.js';
import { useStudio } from '../store.js';
import { Button, Toasts } from '../ui.js';
import { Connexion } from './connexion.js';
import { deconnecter } from './index.js';
import { DialogueRecuperation } from './motdepasse.js';
import { aujourdhuiParis } from './suivi.js';
import { annulerSuppression, DELAI_GRACE_JOURS, datePurge } from './suppression.js';

export function EcranSuppression() {
  const phrases = t.compte.suppression;
  const compte = useStudio((s) => s.ui.compte);
  const [occupe, setOccupe] = useState<'annulation' | 'export' | 'deconnexion'>();
  const [erreur, setErreur] = useState<string>();
  const [annulee, setAnnulee] = useState(false);
  const demandeeLe = compte?.suppressionDemandeeLe;
  if (!compte || !demandeeLe) return null;

  const purge = datePurge(demandeeLe);
  // Le délai écoulé, l'effacement peut avoir lieu à la prochaine passe de la nuit, et le serveur
  // refuse l'annulation (la même règle que `supprimer-compte`).
  const echue = Date.now() > Date.parse(demandeeLe) + DELAI_GRACE_JOURS * 86_400_000;

  const annuler = async (): Promise<void> => {
    setOccupe('annulation');
    setErreur(undefined);
    try {
      await annulerSuppression();
      setAnnulee(true);
      location.reload();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t.compte.erreurs.inconnue);
      setOccupe(undefined);
    }
  };

  const exporter = async (): Promise<void> => {
    setOccupe('export');
    try {
      const module = await import('./export.js').catch(() => undefined);
      if (module) await module.telechargerExport();
      else fragmentNonCharge(t.compte.export.chargement);
    } finally {
      setOccupe(undefined);
    }
  };

  const sortir = async (): Promise<void> => {
    setOccupe('deconnexion');
    try {
      await deconnecter();
    } finally {
      // Refusée (une saisie attend le serveur), la déconnexion n'a rien fait : l'écran reste.
      setOccupe(undefined);
    }
  };

  return (
    <div class="ecran-suppression">
      <main class="ecran-suppression-carte" id="contenu">
        <p class="boot-brand">
          facturx <b>Studio</b>
        </p>
        <h1>{phrases.ecranTitre}</h1>
        <p>{phrases.demandeeLe(compte.email, formatDate(aujourdhuiParis(new Date(demandeeLe))))}</p>
        <p>{phrases.purgeLe(formatDate(purge))}</p>
        <p class={echue ? 'field-issue' : undefined}>{echue ? phrases.echue : phrases.jusqueLa}</p>
        {erreur && (
          <p class="field-issue" role="alert">
            {erreur}
          </p>
        )}
        {annulee && <p role="status">{phrases.annulee}</p>}
        <div class="row-actions">
          <Button
            variant="primary"
            icon="refresh"
            disabled={occupe !== undefined || annulee}
            onClick={() => void annuler()}
          >
            {phrases.annuler}
          </Button>
          <Button
            icon="download"
            disabled={occupe !== undefined || annulee}
            onClick={() => void exporter()}
          >
            {t.compte.export.menu}
          </Button>
          <Button
            variant="ghost"
            icon="lock"
            disabled={occupe !== undefined || annulee}
            onClick={() => void sortir()}
          >
            {t.compte.signOut}
          </Button>
        </div>
      </main>
      <Connexion />
      <DialogueRecuperation />
      <Toasts />
    </div>
  );
}
