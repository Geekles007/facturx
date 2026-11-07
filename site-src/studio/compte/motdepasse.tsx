/**
 * Le nouveau mot de passe : le formulaire de la page Entreprise, et le dialogue qui s'ouvre de
 * lui-même quand un lien de réinitialisation a ouvert la session (`PASSWORD_RECOVERY`,
 * `ui.recuperation`). Le dialogue est monté par la navigation du compte et par l'écran d'un compte en
 * suppression : le lien peut arriver sur l'un ou l'autre.
 *
 * Chargé par `import()` avec le reste du compte.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { toast, ui, useStudio } from '../store.js';
import { Button, Dialog, Field, Input } from '../ui.js';
import { changerMotDePasse } from './index.js';

/**
 * Deux saisies du nouveau mot de passe, puis `auth.updateUser`. Les erreurs sont dites sous le
 * formulaire ; une fois changé, le message le dit, les champs se vident, et `apres` est appelé.
 */
export function FormulaireMotDePasse({
  apres,
  autres,
}: {
  apres?: () => void;
  /** D'autres boutons, avant celui qui envoie (« Plus tard » dans le dialogue). */
  autres?: ComponentChildren;
}) {
  const phrases = t.compte.motDePasse;
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string>();

  const envoyer = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (occupe) return;
    if (!nouveau || !confirmation) {
      setErreur(phrases.manquant);
      return;
    }
    if (nouveau !== confirmation) {
      setErreur(phrases.differents);
      return;
    }
    setErreur(undefined);
    setOccupe(true);
    try {
      await changerMotDePasse(nouveau);
      setNouveau('');
      setConfirmation('');
      toast(phrases.change);
      apres?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t.compte.errors.other);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <form class="compte-form" noValidate onSubmit={envoyer}>
      <div class="grid">
        <Field label={phrases.nouveau} span={3}>
          {(id) => (
            <Input
              id={id}
              type="password"
              value={nouveau}
              onValue={setNouveau}
              autoComplete="new-password"
              aria-invalid={erreur !== undefined && nouveau === '' ? true : undefined}
            />
          )}
        </Field>
        <Field label={phrases.confirmation} span={3}>
          {(id) => (
            <Input
              id={id}
              type="password"
              value={confirmation}
              onValue={setConfirmation}
              autoComplete="new-password"
              aria-invalid={
                erreur !== undefined && (confirmation === '' || confirmation !== nouveau)
                  ? true
                  : undefined
              }
            />
          )}
        </Field>
      </div>
      {erreur && (
        <p class="field-issue" role="alert">
          {erreur}
        </p>
      )}
      <div class="row-actions">
        {autres}
        <Button type="submit" variant="primary" disabled={occupe}>
          {phrases.changer}
        </Button>
      </div>
    </form>
  );
}

/** Après un lien de réinitialisation : choisir le nouveau mot de passe, ou le remettre à plus tard. */
export function DialogueRecuperation() {
  const phrases = t.compte.motDePasse;
  const ouvert = useStudio((s) => s.ui.recuperation && s.ui.compte !== undefined);
  const fermer = () => ui({ recuperation: false });
  return (
    <Dialog open={ouvert} onClose={fermer} title={phrases.recuperationTitre}>
      <p class="field-hint">{phrases.recuperationIntro}</p>
      <FormulaireMotDePasse
        apres={fermer}
        autres={
          <Button variant="ghost" onClick={fermer}>
            {phrases.plusTard}
          </Button>
        }
      />
    </Dialog>
  );
}
