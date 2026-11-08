/**
 * Le dialogue de connexion : se connecter, créer un compte, retrouver son mot de passe.
 *
 * Il importe `index.ts`, donc `supabase-js` : l'application ne le charge que par `import()`, à la
 * première ouverture (app.tsx). Le volet ouvert est `ui.connexion`, que n'importe quel module peut
 * fixer — une session expirée rouvre ainsi la connexion sans passer par un bouton.
 */

import { useEffect, useId, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { ui, useStudio, type VoletConnexion } from '../store.js';
import { Button, Dialog, Field, Input, Segmented } from '../ui.js';
import { CGU_VERSION, connecter, inscrire, reinitialiser } from './index.js';

const fermer = (): void => ui({ connexion: undefined });

export function Connexion() {
  const volet = useStudio((s) => s.ui.connexion);
  // Session expirée : on se reconnecte au compte affiché, dont l'adresse est déjà connue.
  const expiree = useStudio((s) => s.ui.compte?.session === 'expiree');
  const adresseDuCompte = useStudio((s) => s.ui.compte?.email);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [cgu, setCgu] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [message, setMessage] = useState<string>();
  // La case des CGU est nommée par son étiquette (le texte et le lien), et non par sa valeur.
  const idCgu = useId();

  // À la fermeture, rien ne reste : ni mot de passe, ni message d'une tentative précédente.
  useEffect(() => {
    if (volet) return;
    setEmail('');
    setMotDePasse('');
    setCgu(false);
    setErreur(undefined);
    setMessage(undefined);
  }, [volet]);

  useEffect(() => {
    if (volet && expiree && adresseDuCompte) setEmail((saisie) => saisie || adresseDuCompte);
  }, [volet, expiree, adresseDuCompte]);

  /** Change de volet en gardant l'adresse déjà saisie. */
  const aller = (suivant: VoletConnexion): void => {
    setMotDePasse('');
    setCgu(false);
    setErreur(undefined);
    setMessage(undefined);
    ui({ connexion: suivant });
  };

  const envoyer = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!volet || occupe) return;
    const adresse = email.trim();
    if (volet === 'oubli' ? !adresse : !adresse || !motDePasse) {
      setErreur(volet === 'oubli' ? t.compte.missingEmail : t.compte.missingFields);
      return;
    }
    if (volet === 'inscription' && !cgu) {
      setErreur(t.compte.acceptRequired);
      return;
    }
    setErreur(undefined);
    setOccupe(true);
    try {
      if (volet === 'connexion') {
        await connecter(adresse, motDePasse);
      } else if (volet === 'inscription') {
        if ((await inscrire(adresse, motDePasse, CGU_VERSION)) === 'confirmation')
          setMessage(t.compte.confirmationSent(adresse));
      } else {
        await reinitialiser(adresse);
        setMessage(t.compte.resetSent(adresse));
      }
    } catch (error) {
      setErreur(error instanceof Error ? error.message : t.compte.errors.other);
    } finally {
      setOccupe(false);
    }
  };

  const cguHref = t.lang === 'en' ? '/en/cgu/' : '/cgu/';

  return (
    <Dialog
      open={volet !== undefined}
      onClose={fermer}
      title={volet ? t.compte.dialogTitle[volet] : ''}
    >
      {volet && message && (
        <>
          <p role="status">{message}</p>
          <div class="row-actions">
            <Button variant="primary" onClick={fermer}>
              {t.app.close}
            </Button>
          </div>
        </>
      )}
      {volet && !message && (
        <form class="compte-form" noValidate onSubmit={envoyer}>
          {volet !== 'oubli' && (
            <Segmented<VoletConnexion>
              label={t.compte.menu}
              value={volet}
              onValue={aller}
              options={[
                { value: 'connexion', label: t.compte.signIn },
                { value: 'inscription', label: t.compte.createShort },
              ]}
            />
          )}
          {volet === 'connexion' && expiree && (
            <p class="field-hint">{t.compte.conservation.reprise}</p>
          )}
          {volet === 'inscription' && <p class="field-hint">{t.compte.signUpIntro}</p>}
          {volet === 'oubli' && <p class="field-hint">{t.compte.forgotIntro}</p>}
          <Field label={t.compte.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onValue={setEmail}
                autoComplete="email"
                inputMode="email"
                spellcheck={false}
                aria-invalid={erreur !== undefined && email.trim() === '' ? true : undefined}
              />
            )}
          </Field>
          {volet !== 'oubli' && (
            <Field
              label={t.compte.password}
              action={
                volet === 'connexion' ? (
                  <button type="button" class="link-btn" onClick={() => aller('oubli')}>
                    {t.compte.forgot}
                  </button>
                ) : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={motDePasse}
                  onValue={setMotDePasse}
                  autoComplete={volet === 'connexion' ? 'current-password' : 'new-password'}
                  aria-invalid={erreur !== undefined && motDePasse === '' ? true : undefined}
                />
              )}
            </Field>
          )}
          {volet === 'inscription' && (
            <label class="check-row">
              <input
                type="checkbox"
                checked={cgu}
                aria-required="true"
                aria-labelledby={idCgu}
                onChange={(event) => setCgu((event.currentTarget as HTMLInputElement).checked)}
              />
              <span id={idCgu}>
                {t.compte.acceptBefore}
                <a href={cguHref} target="_blank" rel="noopener">
                  {t.compte.acceptLink}
                </a>
              </span>
            </label>
          )}
          {erreur && (
            <p class="field-issue" role="alert">
              {erreur}
            </p>
          )}
          <div class="row-actions">
            {volet === 'oubli' && (
              <Button variant="ghost" onClick={() => aller('connexion')}>
                {t.app.back}
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={occupe}>
              {t.compte.submit[volet]}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
