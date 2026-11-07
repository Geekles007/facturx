/**
 * La page Entreprise du mode compte (spec § 10) : le profil vendeur (le formulaire de la
 * bibliothèque, repris), le logo des prochaines factures, la numérotation, et le compte — adresse,
 * mot de passe, export des données, suppression en deux temps (spec § 12).
 *
 * - Le logo est celui de l'apparence par défaut, que reprend une facture vierge ; il est refusé
 *   avant l'envoi s'il dépasse 1 Mio ou si ses octets ne sont ni ceux d'un PNG ni ceux d'un JPEG
 *   (spec § 11), puis déposé avec son type (`putFile`, comme le reste).
 * - Le prochain rang de la numérotation ne descend pas sous celui du serveur : le champ le refuse
 *   avant tout envoi (la base le refuserait aussi, `NUMEROTATION_RECUL`).
 * - La suppression ne se demande qu'après un export réussi pendant cette session, puis une
 *   confirmation qui dit les 30 jours, ce qui sera effacé, et que l'archive sera la seule copie qui
 *   restera. La page se recharge ensuite : le Studio n'ouvre plus que l'écran d'annulation.
 *
 * Ouverte par l'entrée « Entreprise » de la navigation du compte, dans sa page modale. Chargé par
 * `import()` avec la navigation ; l'export, et fflate avec lui, à la demande.
 */

import { useEffect, useState } from 'preact/hooks';
import { getFile, normalizeLogo, putFile } from '../files.js';
import { formatDate, t } from '../i18n.js';
import type { Appearance } from '../library.js';
import { CompanyTab, NumberingTab } from '../librarypanel.js';
import { uid } from '../model.js';
import { fragmentNonCharge, rechargerLaPage } from '../rechargement.js';
import { storage } from '../storage.js';
import { conserver, estEnAttente, persistKeys, store, toast, useStudio } from '../store.js';
import { Button, Dialog, Field, FilePick, Icon, IconButton, Input } from '../ui.js';
import { changerAdresse } from './index.js';
import { FormulaireMotDePasse } from './motdepasse.js';
import { estPersistenceCompte, refusDuLogo } from './persistence.js';
import { datePurge, demanderSuppression, exportDeLaSession, peutSupprimer } from './suppression.js';

type Logo = NonNullable<Appearance['logo']>;

// ---------- logo ----------

/**
 * L'apparence que prendra la prochaine facture vierge : l'apparence par défaut enregistrée, ou, sans
 * elle, celle de la facture ouverte (comme « Facture vierge »). Lève si le serveur ne répond pas :
 * rien ne doit alors remplacer une apparence par défaut qu'on n'a pas pu lire.
 */
async function apparenceDesProchaines(): Promise<Appearance> {
  const enregistree = await storage.get<Appearance>(persistKeys.appearance);
  return enregistree ?? store.get().appearance;
}

/** Enregistre l'apparence par défaut ; vrai si elle est passée, ou attend le réseau pour repartir. */
async function poserApparence(apparence: Appearance): Promise<boolean> {
  const cle = persistKeys.appearance;
  return (await conserver(cle, () => storage.set(cle, apparence))) || estEnAttente(cle);
}

/**
 * Le logo des prochaines factures : refusé avant l'envoi s'il n'est ni PNG ni JPEG d'après ses
 * octets, ou s'il pèse plus de 1 Mio ; sinon déposé, puis posé sur l'apparence par défaut, à la
 * position et à la taille du logo qu'il remplace. Rend le logo posé, ou rien (le message a dit
 * pourquoi).
 */
export async function changerLogo(logo: {
  bytes: Uint8Array;
  type: Logo['type'];
  name: string;
}): Promise<Logo | undefined> {
  const phrases = t.compte.entreprise;
  const refus = refusDuLogo(logo.bytes);
  if (refus) {
    toast(refus === 'TAILLE' ? phrases.logoTropGros : phrases.logoType, 'error');
    return undefined;
  }
  let base: Appearance;
  try {
    base = await apparenceDesProchaines();
  } catch {
    toast(t.compte.brouillons.echec, 'error');
    return undefined;
  }
  const key = `logo-${uid()}`;
  if (!(await putFile(key, logo.bytes))) return undefined;
  const pose: Logo = {
    key,
    type: logo.type,
    position: base.logo?.position ?? 'left',
    height: base.logo?.height ?? 44,
    name: logo.name,
  };
  if (!(await poserApparence({ ...base, logo: pose }))) return undefined;
  toast(phrases.logoEnregistre);
  return pose;
}

/** Retire le logo des prochaines factures (le fichier reste : des brouillons peuvent le citer). */
export async function retirerLogo(): Promise<boolean> {
  let base: Appearance;
  try {
    base = await apparenceDesProchaines();
  } catch {
    toast(t.compte.brouillons.echec, 'error');
    return false;
  }
  if (!base.logo) return true;
  if (!(await poserApparence({ ...base, logo: undefined }))) return false;
  toast(t.compte.entreprise.logoRetire);
  return true;
}

function LogoDesFactures() {
  const phrases = t.compte.entreprise;
  // `null` : pas encore lu.
  const [logo, setLogo] = useState<Logo | undefined | null>(null);
  const [url, setUrl] = useState<string>();
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let abandonne = false;
    apparenceDesProchaines().then(
      (a) => !abandonne && setLogo(a.logo),
      () => !abandonne && setLogo(undefined),
    );
    return () => {
      abandonne = true;
    };
  }, []);

  useEffect(() => {
    if (!logo) {
      setUrl(undefined);
      return;
    }
    let abandonne = false;
    let adresse: string | undefined;
    void getFile(logo.key).then((octets) => {
      if (abandonne || !octets) return;
      adresse = URL.createObjectURL(
        new Blob([octets as BlobPart], { type: logo.type === 'png' ? 'image/png' : 'image/jpeg' }),
      );
      setUrl(adresse);
    });
    return () => {
      abandonne = true;
      if (adresse) URL.revokeObjectURL(adresse);
    };
  }, [logo?.key]);

  const choisir = async (fichier: File): Promise<void> => {
    setOccupe(true);
    try {
      let normalise: Awaited<ReturnType<typeof normalizeLogo>>;
      try {
        normalise = await normalizeLogo(fichier);
      } catch {
        toast(phrases.logoIllisible, 'error');
        return;
      }
      const pose = await changerLogo({ ...normalise, name: fichier.name });
      if (pose) setLogo(pose);
    } finally {
      setOccupe(false);
    }
  };

  const retirer = async (): Promise<void> => {
    setOccupe(true);
    try {
      if (await retirerLogo()) setLogo(undefined);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div class="logo-picker">
      <div class="logo-box">
        {logo && url ? <img src={url} alt={logo.name} /> : <Icon name="image" size={22} />}
      </div>
      <div class="logo-controls">
        <p class="field-hint">{logo ? logo.name : phrases.logoAucun}</p>
        {logo !== null && !occupe && (
          <div class="row-actions">
            <FilePick
              accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
              onFile={choisir}
              size="sm"
            >
              {logo ? phrases.logoRemplacer : phrases.logoChoisir}
            </FilePick>
            {logo && (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => void retirer()}>
                {phrases.logoRetirer}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- compte ----------

/** L'heure d'une date ISO, à l'heure de ce navigateur. */
const heureDe = (iso: string): string =>
  new Date(iso).toLocaleTimeString(t.lang === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

function Adresse() {
  const phrases = t.compte.motDePasse;
  const compte = useStudio((s) => s.ui.compte);
  const [nouvelle, setNouvelle] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [envoyee, setEnvoyee] = useState<string>();
  if (!compte) return null;

  const envoyer = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (occupe) return;
    setErreur(undefined);
    setEnvoyee(undefined);
    setOccupe(true);
    try {
      await changerAdresse(nouvelle);
      // L'adresse affichée ne change pas : elle ne change qu'une fois confirmée, aux deux bouts.
      setEnvoyee(phrases.adresseEnvoyee(compte.email, nouvelle.trim()));
      setNouvelle('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t.compte.errors.other);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <form class="compte-form" noValidate onSubmit={envoyer}>
      <p class="adresse-compte">
        <span>{phrases.adresse}</span> <strong>{compte.email}</strong>{' '}
        <span class={`etat-adresse${compte.confirme ? ' ok' : ''}`}>
          {compte.confirme ? phrases.confirmee : phrases.nonConfirmee}
        </span>
      </p>
      <Field label={phrases.nouvelleAdresse}>
        {(id) => (
          <Input
            id={id}
            type="email"
            value={nouvelle}
            onValue={setNouvelle}
            autoComplete="email"
            inputMode="email"
            spellcheck={false}
            aria-invalid={erreur !== undefined ? true : undefined}
          />
        )}
      </Field>
      {erreur && (
        <p class="field-issue" role="alert">
          {erreur}
        </p>
      )}
      {envoyee && (
        <p class="compte-envoye" role="status">
          {envoyee}
        </p>
      )}
      <div class="row-actions">
        <Button type="submit" disabled={occupe}>
          {phrases.changerAdresse}
        </Button>
      </div>
    </form>
  );
}

/** La confirmation de la demande de suppression : les 30 jours, ce qui sera effacé, la seule copie. */
function ConfirmerSuppression({
  ouvert,
  exportFaitLe,
  fermer,
}: {
  ouvert: boolean;
  exportFaitLe: string;
  fermer: () => void;
}) {
  const phrases = t.compte.suppression;
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const demander = async (): Promise<void> => {
    setOccupe(true);
    setErreur(undefined);
    try {
      await demanderSuppression();
      // Rechargé, le Studio n'ouvre plus que l'écran d'annulation.
      await rechargerLaPage();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t.compte.erreurs.inconnue);
      setOccupe(false);
    }
  };
  return (
    <Dialog
      open={ouvert}
      onClose={() => {
        setErreur(undefined);
        fermer();
      }}
      title={phrases.confirmerTitre}
      fermable={!occupe}
    >
      <div class="compte-form">
        <p>{phrases.confirmerDelai(formatDate(datePurge(new Date().toISOString())))}</p>
        <p>{phrases.confirmerEfface}</p>
        <p class="suppression-copie">{phrases.confirmerCopie(heureDe(exportFaitLe))}</p>
        {erreur && (
          <p class="field-issue" role="alert">
            {erreur}
          </p>
        )}
        <div class="row-actions">
          <Button variant="ghost" onClick={fermer} disabled={occupe}>
            {phrases.garder}
          </Button>
          <Button variant="danger" icon="trash" onClick={() => void demander()} disabled={occupe}>
            {phrases.confirmer}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Exporter ses données, puis, l'export fait, demander la suppression du compte. */
function DonneesEtSuppression() {
  const phrases = t.compte.entreprise;
  const suppression = t.compte.suppression;
  const [etat, setEtat] = useState(exportDeLaSession);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  const exporter = async (): Promise<void> => {
    setExportEnCours(true);
    try {
      const module = await import('./export.js').catch(() => undefined);
      if (!module) {
        fragmentNonCharge(t.compte.export.chargement);
        return;
      }
      await module.telechargerExport();
      setEtat(exportDeLaSession());
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <>
      <h4 class="lib-subhead">{phrases.donnees}</h4>
      <p class="field-hint">{phrases.exportIntro}</p>
      <div class="row-actions">
        <Button icon="download" onClick={() => void exporter()} disabled={exportEnCours}>
          {t.compte.export.menu}
        </Button>
      </div>
      {etat.exportFaitLe && (
        <p class="compte-envoye" role="status">
          {phrases.exportFait(heureDe(etat.exportFaitLe))}
        </p>
      )}
      <div class="zone-suppression">
        <h4 class="lib-subhead">{suppression.titre}</h4>
        <p>{suppression.intro}</p>
        {!peutSupprimer(etat) && <p class="field-hint">{suppression.exportDabord}</p>}
        <div class="row-actions">
          <Button
            variant="danger"
            icon="trash"
            disabled={!peutSupprimer(etat)}
            onClick={() => setConfirmation(true)}
          >
            {suppression.demander}
          </Button>
        </div>
      </div>
      {etat.exportFaitLe && (
        <ConfirmerSuppression
          ouvert={confirmation}
          exportFaitLe={etat.exportFaitLe}
          fermer={() => setConfirmation(false)}
        />
      )}
    </>
  );
}

// ---------- la page ----------

/** Le plus bas rang que le serveur admet, lu au moment de la frappe. */
const rangDuServeur = (): number | undefined =>
  estPersistenceCompte(storage) ? storage.numerotationDuServeur()?.next : undefined;

export function Entreprise({ fermer }: { fermer: () => void }) {
  const phrases = t.compte.entreprise;
  return (
    <div class="page-inner">
      <header class="page-tete">
        <h2>{phrases.titre}</h2>
        <IconButton icon="x" label={t.app.close} onClick={fermer} />
      </header>
      <div class="page-corps page-entreprise">
        <p class="field-hint">{phrases.intro}</p>
        <section class="section-entreprise" aria-labelledby="entreprise-profil">
          <h3 id="entreprise-profil">{phrases.profil}</h3>
          <CompanyTab />
        </section>
        <section class="section-entreprise" aria-labelledby="entreprise-logo">
          <h3 id="entreprise-logo">{phrases.logo}</h3>
          <p class="field-hint">{phrases.logoIntro}</p>
          <LogoDesFactures />
        </section>
        <section class="section-entreprise" aria-labelledby="entreprise-numerotation">
          <h3 id="entreprise-numerotation">{phrases.numerotation}</h3>
          <p class="field-hint">{phrases.numerotationIntro}</p>
          <NumberingTab minimum={rangDuServeur} />
        </section>
        <section class="section-entreprise" aria-labelledby="entreprise-compte">
          <h3 id="entreprise-compte">{phrases.compte}</h3>
          <Adresse />
          <h4 class="lib-subhead">{t.compte.motDePasse.titre}</h4>
          <FormulaireMotDePasse />
          <DonneesEtSuppression />
        </section>
      </div>
    </div>
  );
}
