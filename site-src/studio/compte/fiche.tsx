/**
 * La fiche d'une facture émise : son PDF, son suivi (statut, net à payer, encaissé, avoirs, reste
 * dû), ses paiements (actifs, puis annulés et barrés) et ses relances, avec les actions
 * « Enregistrer un paiement », « Marquer comme payée », « Annuler ce paiement », « Dupliquer »,
 * « Faire un avoir » et « Facturer le solde ».
 *
 * Statuts et montants viennent de la base : après chaque écriture, réussie ou non, la fiche relit
 * sa ligne de suivi, ses paiements et ses relances, sans rien recalculer. Les refus s'affichent dans
 * la fiche, qui est au-dessus des messages du Studio. Le PDF est lu par son URL signée de 60
 * secondes, puis affiché depuis une URL `blob:`, libérée quand on quitte la fiche.
 *
 * Dupliquer, Faire un avoir et Facturer le solde créent un nouveau brouillon par le chemin de la
 * barre d'outils (`startDraft`, avec `duplicateForm`, `creditNoteForm` ou `balanceForm`) : le
 * brouillon ouvert ne se quitte qu'une fois sa saisie sur le serveur, et rien n'est écrasé. La page
 * se ferme ensuite, sur le nouveau brouillon ou sur le message qui dit pourquoi il n'est pas créé.
 *
 * Chargé par `import()` avec la navigation du compte.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatDate, formatMoney, t } from '../i18n.js';
import type { SavedInvoice } from '../library.js';
import type { InvoiceForm } from '../model.js';
import { download, fileStem } from '../pipeline.js';
import { storage } from '../storage.js';
import { store, toast } from '../store.js';
import { Button, Field, IconButton, Input, Select } from '../ui.js';
import { balanceForm, creditNoteForm, duplicateForm, startDraft } from '../workflows.js';
import { relireHistorique } from './emission.js';
import { echeanceDe, PastilleStatut } from './factures.js';
import { estPersistenceCompte } from './persistence.js';
import {
  annulerPaiement,
  aujourdhuiParis,
  enregistrerPaiement,
  type LigneSuivi,
  ligneSuivi,
  lireMontant,
  MOYENS,
  type Moyen,
  marquerPayee,
  messageDe,
  montantSaisi,
  type Paiement,
  paiementsDe,
  pdfDe,
  type Relance,
  type Resultat,
  relancesDe,
} from './suivi.js';

/** Ce que la base dit de la facture. */
interface Suivi {
  ligne: LigneSuivi | undefined;
  paiements: Paiement[];
  relances: Relance[];
}

/** Le paiement en cours de saisie. */
interface Saisie {
  date: string;
  montant: string;
  moyen: Moyen;
  note: string;
  erreur?: string | undefined;
}

/** Un horodatage du serveur, dit par sa date à Paris. */
const jourDe = (horodatage: string): string => formatDate(aujourdhuiParis(new Date(horodatage)));

/**
 * La facture émise telle que l'historique la garde (formulaire et apparence) : celle du magasin,
 * ou, si elle n'y est pas encore (émise ailleurs), celle de l'historique relu.
 */
async function factureEnregistree(id: string): Promise<SavedInvoice | undefined> {
  const connue = store.get().history.find((h) => h.uid === id);
  if (connue) return connue;
  if (!estPersistenceCompte(storage)) return undefined;
  const relue = await relireHistorique(storage).catch(() => undefined);
  return relue?.find((h) => h.uid === id);
}

export function Fiche({
  factureId,
  retour,
  fermer,
}: {
  factureId: string;
  retour: () => void;
  fermer: () => void;
}) {
  const phrases = t.compte.suivi.fiche;
  const [suivi, setSuivi] = useState<Suivi>();
  const [erreurLecture, setErreurLecture] = useState<string>();
  const [message, setMessage] = useState<{ ok: boolean; texte: string }>();
  const [occupe, setOccupe] = useState(false);
  const [saisie, setSaisie] = useState<Saisie>();
  const [pdf, setPdf] = useState<{ url?: string; octets?: Blob; erreur?: string }>({});
  const [essaiPdf, setEssaiPdf] = useState(0);

  /** Relit la ligne de suivi, les paiements et les relances : la base seule fait foi. */
  const relire = async (): Promise<void> => {
    try {
      const [ligne, paiements, relances] = await Promise.all([
        ligneSuivi(factureId),
        paiementsDe(factureId),
        relancesDe(factureId),
      ]);
      setSuivi({ ligne, paiements, relances });
      setErreurLecture(undefined);
    } catch (erreur) {
      setErreurLecture(messageDe(erreur));
    }
  };

  useEffect(() => {
    void relire();
  }, [factureId]);

  // Le PDF, depuis une URL `blob:` que l'on libère en quittant la fiche (ou avant un nouvel essai).
  useEffect(() => {
    let abandonne = false;
    let url: string | undefined;
    setPdf({});
    pdfDe(factureId).then(
      (octets) => {
        if (abandonne) return;
        url = URL.createObjectURL(octets);
        setPdf({ url, octets });
      },
      (erreur) => {
        if (!abandonne) setPdf({ erreur: messageDe(erreur) });
      },
    );
    return () => {
      abandonne = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [factureId, essaiPdf]);

  /** Une écriture à la fois ; son issue est dite, puis la fiche est relue. Vrai si elle est faite. */
  const ecrire = async (operation: () => Promise<Resultat>, reussite: string): Promise<boolean> => {
    if (occupe) return false;
    setOccupe(true);
    setMessage(undefined);
    try {
      const r = await operation();
      setMessage(r.ok ? { ok: true, texte: reussite } : { ok: false, texte: r.message });
      await relire();
      return r.ok;
    } finally {
      setOccupe(false);
    }
  };

  const ligne = suivi?.ligne;

  const ouvrirSaisie = (l: LigneSuivi) => {
    setMessage(undefined);
    setSaisie({
      date: aujourdhuiParis(),
      montant: l.resteDu > 0 ? montantSaisi(l.resteDu) : '',
      moyen: 'virement',
      note: '',
    });
  };

  const valider = async () => {
    if (!saisie) return;
    // Le refus précédent ne vaut plus pour ce qui est saisi maintenant.
    setMessage(undefined);
    if (!saisie.date) {
      setSaisie({ ...saisie, erreur: phrases.dateVide });
      return;
    }
    const lu = lireMontant(saisie.montant);
    if (!lu.ok) {
      setSaisie({ ...saisie, erreur: lu.message });
      return;
    }
    setSaisie({ ...saisie, erreur: undefined });
    const fait = await ecrire(
      () =>
        enregistrerPaiement({
          factureId,
          date: saisie.date,
          montant: lu.montant,
          moyen: saisie.moyen,
          note: saisie.note,
        }),
      phrases.enregistre,
    );
    if (fait) setSaisie(undefined);
  };

  const marquer = (l: LigneSuivi) => {
    if (!confirm(phrases.marquerConfirm(formatMoney(l.resteDu, l.devise)))) return;
    setSaisie(undefined);
    void ecrire(() => marquerPayee(factureId, aujourdhuiParis()), phrases.marquee);
  };

  const annuler = (p: Paiement, devise: string) => {
    if (!confirm(phrases.annulerConfirm(formatMoney(p.montant, devise), formatDate(p.date))))
      return;
    void ecrire(() => annulerPaiement(p.id), phrases.annule);
  };

  /**
   * Un nouveau brouillon tiré de la facture, par le chemin de la barre d'outils ; la page se ferme
   * ensuite, sur lui ou sur le message qui dit pourquoi il n'a pas pu l'être.
   */
  const nouveauDocument = async (fabriquer: (saved: SavedInvoice) => InvoiceForm) => {
    if (occupe) return;
    setOccupe(true);
    setMessage(undefined);
    try {
      const saved = await factureEnregistree(factureId);
      if (!saved) {
        setMessage({ ok: false, texte: phrases.formulaireIntrouvable });
        return;
      }
      let form: InvoiceForm;
      try {
        form = fabriquer(saved);
      } catch (erreur) {
        setMessage({ ok: false, texte: (erreur as Error).message });
        return;
      }
      try {
        await startDraft(form, structuredClone(saved.appearance));
      } catch {
        toast(t.compte.brouillons.echec, 'error', 9000);
      }
      fermer();
    } finally {
      setOccupe(false);
    }
  };

  const telecharger = async (numero: string) => {
    if (!pdf.octets) return;
    download(
      new Uint8Array(await pdf.octets.arrayBuffer()),
      `${fileStem(numero)}.pdf`,
      'application/pdf',
    );
  };

  const dateFuture = saisie !== undefined && saisie.date > aujourdhuiParis();

  return (
    <div class="page-inner">
      <header class="page-tete">
        <Button size="sm" variant="ghost" icon="chevronRight" class="retour" onClick={retour}>
          {phrases.retour}
        </Button>
        <h2>
          {ligne && <span class="numero">{ligne.numero}</span>}
          {ligne && <PastilleStatut statut={ligne.statut} />}
        </h2>
        <IconButton icon="x" label={t.app.close} onClick={fermer} />
      </header>
      <div class="page-corps">
        {erreurLecture && (
          <div class="banner warn actions" role="alert">
            <span>{phrases.relue(erreurLecture)}</span>
            <Button size="sm" icon="refresh" disabled={occupe} onClick={() => void relire()}>
              {t.compte.suivi.liste.reessayer}
            </Button>
          </div>
        )}
        {!suivi && !erreurLecture && <p class="lib-empty">{phrases.chargement}</p>}
        {suivi && !ligne && <p class="lib-empty">{t.compte.suivi.erreurs.introuvable}</p>}
        {suivi && ligne && (
          <div class="fiche">
            <div class="fiche-suivi">
              <p class="fiche-client">
                <strong>{ligne.clientNom}</strong>
                <span>
                  {t.compte.suivi.liste.emise(formatDate(ligne.dateEmission))} · {echeanceDe(ligne)}
                </span>
              </p>
              <dl class="fiche-montants">
                <div>
                  <dt class="libelle">{phrases.netAPayer}</dt>
                  <dd>{formatMoney(ligne.netAPayer, ligne.devise)}</dd>
                </div>
                <div>
                  <dt class="libelle">{phrases.encaisse}</dt>
                  <dd>{formatMoney(ligne.encaisse, ligne.devise)}</dd>
                </div>
                {ligne.avoirs !== 0 && (
                  <div>
                    <dt class="libelle">{phrases.avoirs}</dt>
                    <dd>{formatMoney(ligne.avoirs, ligne.devise)}</dd>
                  </div>
                )}
                <div class={`reste statut-${ligne.statut}`}>
                  <dt class="libelle">{phrases.resteDu}</dt>
                  <dd>{formatMoney(ligne.resteDu, ligne.devise)}</dd>
                </div>
              </dl>

              {ligne.resteDu > 0 && !saisie && (
                <div class="row-actions fiche-actions">
                  <Button
                    variant="primary"
                    icon="plus"
                    disabled={occupe}
                    onClick={() => ouvrirSaisie(ligne)}
                  >
                    {phrases.enregistrer}
                  </Button>
                  <Button icon="check" disabled={occupe} onClick={() => marquer(ligne)}>
                    {phrases.marquer}
                  </Button>
                </div>
              )}

              {saisie && (
                <form
                  class="fiche-saisie"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void valider();
                  }}
                >
                  <div class="grid">
                    <Field
                      label={phrases.date}
                      span={3}
                      warning={dateFuture ? phrases.dateFuture : undefined}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          type="date"
                          value={saisie.date}
                          onValue={(date) => setSaisie({ ...saisie, date, erreur: undefined })}
                        />
                      )}
                    </Field>
                    <Field
                      label={phrases.montant}
                      span={3}
                      hint={phrases.resteDuAide(formatMoney(ligne.resteDu, ligne.devise))}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          decimal
                          suffix={ligne.devise === 'EUR' ? '€' : ligne.devise}
                          value={saisie.montant}
                          aria-invalid={saisie.erreur !== undefined || undefined}
                          onValue={(montant) =>
                            setSaisie({ ...saisie, montant, erreur: undefined })
                          }
                        />
                      )}
                    </Field>
                    <Field label={phrases.moyen} span={3}>
                      {(id) => (
                        <Select<Moyen>
                          id={id}
                          value={saisie.moyen}
                          options={MOYENS.map((m) => ({
                            value: m,
                            label: t.compte.suivi.moyens[m],
                          }))}
                          onValue={(moyen) => setSaisie({ ...saisie, moyen })}
                        />
                      )}
                    </Field>
                    <Field label={phrases.note} span={3} optional hint={phrases.noteAide}>
                      {(id) => (
                        <Input
                          id={id}
                          value={saisie.note}
                          maxLength={500}
                          onValue={(note) => setSaisie({ ...saisie, note })}
                        />
                      )}
                    </Field>
                  </div>
                  {saisie.erreur && (
                    <p class="field-issue" role="alert">
                      {saisie.erreur}
                    </p>
                  )}
                  <div class="row-actions">
                    <Button variant="ghost" disabled={occupe} onClick={() => setSaisie(undefined)}>
                      {t.app.cancel}
                    </Button>
                    <Button type="submit" variant="primary" icon="check" disabled={occupe}>
                      {phrases.valider}
                    </Button>
                  </div>
                </form>
              )}

              {message && (
                <p
                  class={message.ok ? 'fiche-message' : 'field-issue'}
                  role={message.ok ? 'status' : 'alert'}
                >
                  {message.texte}
                </p>
              )}

              <section class="fiche-section">
                <h3>{phrases.paiements}</h3>
                {suivi.paiements.length === 0 ? (
                  <p class="lib-empty">{phrases.aucunPaiement}</p>
                ) : (
                  <ul class="lib-list fiche-paiements">
                    {suivi.paiements.map((p) => (
                      <li key={p.id} class={p.annuleLe ? 'annule' : undefined}>
                        <div class="lib-main">
                          <strong>
                            <span class="barre">{formatMoney(p.montant, ligne.devise)}</span>
                          </strong>
                          <span>
                            <span class="barre">
                              {formatDate(p.date)} · {t.compte.suivi.moyens[p.moyen]}
                              {p.note ? ` · ${p.note}` : ''}
                            </span>
                            {p.annuleLe && ` · ${phrases.annuleLe(jourDe(p.annuleLe))}`}
                          </span>
                        </div>
                        {!p.annuleLe && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={occupe}
                            onClick={() => annuler(p, ligne.devise)}
                          >
                            {phrases.annuler}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section class="fiche-section">
                <h3>{phrases.relances}</h3>
                {suivi.relances.length === 0 ? (
                  <p class="lib-empty">{phrases.aucuneRelance}</p>
                ) : (
                  <ul class="lib-list">
                    {suivi.relances.map((r) => (
                      <li key={r.id}>
                        <div class="lib-main">
                          <strong>{phrases.niveau(r.niveau)}</strong>
                          <span>
                            {r.etat === 'envoyee'
                              ? phrases.envoyee(jourDe(r.envoyeeLe), r.destinataire)
                              : phrases.refusee(jourDe(r.envoyeeLe), r.destinataire)}
                          </span>
                          <span>{r.objet}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div class="row-actions fiche-documents">
                <Button
                  variant="ghost"
                  icon="copy"
                  disabled={occupe}
                  onClick={() => void nouveauDocument((s) => duplicateForm(s.form))}
                >
                  {phrases.dupliquer}
                </Button>
                <Button
                  variant="ghost"
                  icon="receipt"
                  disabled={occupe}
                  onClick={() => void nouveauDocument((s) => creditNoteForm(s.form))}
                >
                  {phrases.avoir}
                </Button>
                {ligne.typeCode === '386' && (
                  <Button
                    variant="ghost"
                    icon="file"
                    disabled={occupe}
                    onClick={() => void nouveauDocument((s) => balanceForm([s]))}
                  >
                    {phrases.solde}
                  </Button>
                )}
              </div>
            </div>

            <section class="fiche-pdf" aria-label={phrases.pdf}>
              {pdf.url && <iframe src={pdf.url} title={phrases.pdf} />}
              {!pdf.url && !pdf.erreur && <p class="lib-empty">{phrases.pdfChargement}</p>}
              {pdf.erreur && (
                <div class="banner warn actions" role="alert">
                  <span>{pdf.erreur}</span>
                  <Button size="sm" icon="refresh" onClick={() => setEssaiPdf((n) => n + 1)}>
                    {t.compte.suivi.liste.reessayer}
                  </Button>
                </div>
              )}
              {pdf.octets && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="download"
                  onClick={() => void telecharger(ligne.numero)}
                >
                  {phrases.telecharger}
                </Button>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
