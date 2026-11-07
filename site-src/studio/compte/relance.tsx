/**
 * Le dialogue de relance (spec § 9). « Relancer », depuis le tableau de bord ou la fiche d'une
 * facture, pose la facture à relancer (`ui.relance`) ; le dialogue la lit et prépare l'e-mail : le
 * destinataire de la facture, l'objet et le message au niveau suivant, dans la langue de la facture.
 * L'utilisateur relit, modifie, puis envoie par `relancer`.
 *
 * « Envoyer » ne s'active que sur une adresse que le serveur admettrait, avec un objet et un
 * message ; un double clic n'envoie qu'une requête, et le dialogue ne se ferme pas pendant l'envoi.
 * L'issue se lit dans le dialogue, qui est au-dessus des messages du Studio : « envoyée » (le service
 * d'envoi a accepté l'e-mail ; jamais « reçue »), « peut-être partie » (`incertain`, ou pas de
 * réponse), ou le refus du serveur avec ce qu'il permet (corriger le champ en cause, renvoyer la
 * confirmation de l'adresse, ouvrir l'entreprise). Après chaque réponse, la fiche est relue (`apres`).
 *
 * Monté une fois, par la navigation du compte ; chargé par `import()` avec elle.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { store, ui, useStudio } from '../store.js';
import { Button, Dialog, Field, Input, TextArea } from '../ui.js';
import { renvoyerConfirmation } from './index.js';
import {
  envoyerRelance,
  type IssueRelance,
  peutEnvoyer,
  preparer,
  type RefusRelance,
  type RelancePreparee,
} from './relances.js';
import { messageDe } from './suivi.js';

/** Le plus long message que `relancer` accepte, en caractères. */
const CORPS_MAX = 10_000;

/** L'objet est coupé à 200 caractères par le serveur : on ne laisse pas en taper davantage. */
const OBJET_MAX = 200;

/**
 * Le dialogue : la facture à relancer, sa relance préparée, puis le formulaire. Fermé, il oublie
 * tout : la relance suivante est préparée de nouveau (le niveau a pu changer).
 */
export function DialogueRelance({
  apres,
  ouvrirEntreprise,
}: {
  /** Après chaque réponse de `relancer` : la fiche relit ses relances. */
  apres: () => void;
  /** Ferme la page du compte et ouvre la fiche de l'entreprise (le SIREN y manque). */
  ouvrirEntreprise: () => void;
}) {
  const phrases = t.compte.relance;
  const factureId = useStudio((s) => s.ui.relance);
  const [lue, setLue] = useState<{
    factureId: string;
    preparee?: RelancePreparee | undefined;
    erreur?: string;
  }>();
  const [essai, setEssai] = useState(0);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    setLue(undefined);
    if (!factureId) return;
    let abandonne = false;
    preparer(factureId).then(
      (preparee) => {
        if (!abandonne) setLue({ factureId, preparee });
      },
      (erreur) => {
        if (!abandonne) setLue({ factureId, erreur: messageDe(erreur) });
      },
    );
    return () => {
      abandonne = true;
    };
  }, [factureId, essai]);

  // Pendant l'envoi, rien ne ferme le dialogue : l'issue doit être dite.
  const fermer = () => {
    if (!occupe) ui({ relance: undefined });
  };
  const courante = lue?.factureId === factureId ? lue : undefined;
  const preparee = courante?.preparee;

  return (
    <Dialog
      open={factureId !== undefined}
      onClose={fermer}
      fermable={!occupe}
      wide
      title={preparee ? phrases.titre(preparee.numero) : phrases.titreSansNumero}
    >
      {!courante && <p class="lib-empty">{phrases.chargement}</p>}
      {courante?.erreur && (
        <div class="banner warn actions" role="alert">
          <span>{courante.erreur}</span>
          <Button size="sm" icon="refresh" onClick={() => setEssai((n) => n + 1)}>
            {t.compte.suivi.liste.reessayer}
          </Button>
        </div>
      )}
      {courante && !courante.erreur && !preparee && (
        <p class="lib-empty">{t.compte.suivi.erreurs.introuvable}</p>
      )}
      {preparee && (
        <FormulaireRelance
          key={`${preparee.factureId}-${essai}`}
          preparee={preparee}
          apres={apres}
          fermer={fermer}
          ouvrirEntreprise={ouvrirEntreprise}
          enCours={setOccupe}
        />
      )}
    </Dialog>
  );
}

/** Où en est la relance : en saisie (avec le refus du dernier envoi), en cours d'envoi, ou partie. */
type Etat =
  | { kind: 'saisie'; refus?: RefusRelance }
  | { kind: 'envoi' }
  | { kind: 'fini'; issue: Exclude<IssueRelance, { kind: 'refus' }>; destinataire: string };

/** Le formulaire de la relance préparée, son envoi et son issue. */
export function FormulaireRelance({
  preparee,
  apres,
  fermer,
  ouvrirEntreprise,
  enCours,
}: {
  preparee: RelancePreparee;
  apres: () => void;
  fermer: () => void;
  ouvrirEntreprise: () => void;
  /** Vrai pendant l'envoi : le dialogue ne se ferme pas. */
  enCours: (oui: boolean) => void;
}) {
  const phrases = t.compte.relance;
  const [destinataire, setDestinataire] = useState(preparee.destinataire);
  const [objet, setObjet] = useState(preparee.objet);
  const [corps, setCorps] = useState(preparee.corps);
  const [etat, setEtat] = useState<Etat>({ kind: 'saisie' });
  const [confirmation, setConfirmation] = useState<string>();
  // L'adresse a été quittée, ou un envoi tenté : son avertissement peut paraître (pas pendant la frappe).
  const [adresseVue, setAdresseVue] = useState(false);
  // Le second clic d'un double clic arrive avant le nouveau rendu : cette marque l'arrête, l'état non.
  const enVol = useRef(false);

  const adresseValide = peutEnvoyer(destinataire);
  const envoyable = adresseValide && objet.trim() !== '' && corps.trim() !== '';

  /** Une saisie change : le refus précédent ne vaut plus pour elle. */
  const saisir = (poser: (valeur: string) => void) => (valeur: string) => {
    poser(valeur);
    if (etat.kind === 'saisie' && etat.refus) setEtat({ kind: 'saisie' });
  };

  const envoyer = async () => {
    setAdresseVue(true);
    if (enVol.current || !envoyable) return;
    enVol.current = true;
    setEtat({ kind: 'envoi' });
    setConfirmation(undefined);
    enCours(true);
    try {
      const issue = await envoyerRelance({
        factureId: preparee.factureId,
        destinataire,
        objet,
        corps,
      }).catch((): IssueRelance => ({ kind: 'sansReponse' }));
      setEtat(
        issue.kind === 'refus'
          ? { kind: 'saisie', refus: issue.refus }
          : { kind: 'fini', issue, destinataire: destinataire.trim() },
      );
    } finally {
      enVol.current = false;
      enCours(false);
      // Quelle que soit l'issue : une relance refusée par le service d'envoi est consignée aussi.
      apres();
    }
  };

  const renvoyer = async () => {
    const email = store.get().ui.compte?.email ?? '';
    try {
      await renvoyerConfirmation(email);
      setConfirmation(phrases.confirmationRenvoyee(email));
    } catch (erreur) {
      setConfirmation(erreur instanceof Error ? erreur.message : t.compte.errors.other);
    }
  };

  if (etat.kind === 'fini') {
    const { issue } = etat;
    return (
      <div class="compte-form">
        {issue.kind === 'envoyee' ? (
          <>
            <p class="relance-envoyee" role="status">
              {phrases.envoyee(issue.niveau, etat.destinataire)}
            </p>
            <p class="field-hint">{phrases.envoyeeAide}</p>
          </>
        ) : (
          <div class="banner warn" role="alert">
            <span>{issue.kind === 'incertaine' ? phrases.incertaine : phrases.sansReponse}</span>
          </div>
        )}
        <div class="row-actions">
          <Button variant="primary" onClick={fermer}>
            {t.app.close}
          </Button>
        </div>
      </div>
    );
  }

  const envoi = etat.kind === 'envoi';
  const refus = etat.kind === 'saisie' ? etat.refus : undefined;
  return (
    <form
      class="compte-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void envoyer();
      }}
    >
      <p class="field-hint">
        {phrases.presentation(
          preparee.niveau,
          phrases.niveaux[preparee.niveau],
          phrases.langues[preparee.langue],
          preparee.langueDeLaFacture,
        )}
      </p>
      {preparee.niveau === 3 && preparee.particulier && (
        <p class="field-hint">{phrases.particulier}</p>
      )}
      {!preparee.enRetard && (
        <div class="banner warn">
          <span>{phrases.pasEnRetard}</span>
        </div>
      )}
      <Field
        label={phrases.destinataire}
        hint={destinataire.trim() === '' ? phrases.destinataireVide : undefined}
        warning={
          adresseVue && destinataire.trim() !== '' && !adresseValide
            ? phrases.destinataireInvalide
            : undefined
        }
      >
        {(id, invalide) => (
          <Input
            id={id}
            type="email"
            value={destinataire}
            onValue={saisir(setDestinataire)}
            onBlur={() => setAdresseVue(true)}
            autoComplete="off"
            inputMode="email"
            spellcheck={false}
            disabled={envoi}
            aria-invalid={invalide || refus?.champ === 'destinataire' || undefined}
          />
        )}
      </Field>
      <Field label={phrases.objet}>
        {(id) => (
          <Input
            id={id}
            value={objet}
            onValue={saisir(setObjet)}
            maxLength={OBJET_MAX}
            disabled={envoi}
            aria-invalid={refus?.champ === 'objet' || undefined}
          />
        )}
      </Field>
      <Field label={phrases.corps} hint={phrases.corpsAide}>
        {(id) => (
          <TextArea
            id={id}
            value={corps}
            onValue={saisir(setCorps)}
            rows={12}
            maxLength={CORPS_MAX}
            disabled={envoi}
            invalid={refus?.champ === 'corps'}
          />
        )}
      </Field>
      {refus && (
        <div class="relance-refus">
          <p class="field-issue" role="alert">
            {refus.texte}
          </p>
          {refus.action === 'entreprise' && (
            <Button size="sm" icon="building" onClick={ouvrirEntreprise}>
              {phrases.ouvrirEntreprise}
            </Button>
          )}
          {refus.action === 'renvoyerConfirmation' && (
            <Button size="sm" icon="refresh" onClick={() => void renvoyer()}>
              {phrases.renvoyer}
            </Button>
          )}
        </div>
      )}
      {confirmation && (
        <p class="field-hint" role="status">
          {confirmation}
        </p>
      )}
      <div class="row-actions">
        <Button variant="ghost" disabled={envoi} onClick={fermer}>
          {t.app.cancel}
        </Button>
        <Button type="submit" variant="primary" icon="note" disabled={envoi || !envoyable}>
          {envoi ? phrases.envoi : phrases.envoyer}
        </Button>
      </div>
    </form>
  );
}
