/**
 * La liste des factures du compte, avec leur statut de paiement, filtrée par statut, client et
 * période d'émission. Les statuts et les montants sont ceux de la base (`suivi_factures`) : rien
 * n'est additionné ici. Une ligne ouvre la fiche de la facture.
 *
 * Chargé par `import()` avec la navigation du compte.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatDate, formatMoney, t } from '../i18n.js';
import { useStudio } from '../store.js';
import { Button, Field, IconButton, Input, Select } from '../ui.js';
import {
  type FiltresSuivi,
  type LigneSuivi,
  listerSuivi,
  messageDe,
  STATUTS,
  type Statut,
} from './suivi.js';

/** La pastille du statut de paiement. */
export function PastilleStatut({ statut }: { statut: Statut }) {
  return <span class={`statut statut-${statut}`}>{t.compte.suivi.statuts[statut]}</span>;
}

/** Ce qu'on dit de l'échéance d'une ligne : le retard s'il y en a un, sinon la date. */
export function echeanceDe(ligne: LigneSuivi): string {
  const phrases = t.compte.suivi;
  if (ligne.joursRetard !== null) return phrases.liste.retard(ligne.joursRetard);
  return ligne.dateEcheance
    ? phrases.liste.echeance(formatDate(ligne.dateEcheance))
    : phrases.fiche.sansEcheance;
}

/**
 * Ce qu'on ajoute au net à payer d'une ligne : le reste dû quand il en diffère, ou le montant à
 * rendre (sans signe) d'une facture à rembourser ; rien quand il est nul ou égal au net.
 */
export function resteDeLigne(ligne: LigneSuivi): string {
  const phrases = t.compte.suivi.liste;
  if (ligne.resteDu < 0) return phrases.aRembourser(formatMoney(-ligne.resteDu, ligne.devise));
  if (ligne.resteDu === 0 || ligne.resteDu === ligne.netAPayer) return '';
  return phrases.reste(formatMoney(ligne.resteDu, ligne.devise));
}

export function Factures({
  filtres,
  changerFiltres,
  ouvrir,
  fermer,
}: {
  filtres: FiltresSuivi;
  changerFiltres: (f: FiltresSuivi) => void;
  ouvrir: (factureId: string) => void;
  fermer: () => void;
}) {
  const phrases = t.compte.suivi.liste;
  const clients = useStudio((s) => s.clients);
  const [lignes, setLignes] = useState<LigneSuivi[]>();
  const [erreur, setErreur] = useState<string>();
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let abandonne = false;
    setLignes(undefined);
    setErreur(undefined);
    listerSuivi(filtres).then(
      (lues) => {
        if (!abandonne) setLignes(lues);
      },
      (raison) => {
        if (!abandonne) setErreur(messageDe(raison));
      },
    );
    return () => {
      abandonne = true;
    };
  }, [filtres.statut, filtres.clientId, filtres.debut, filtres.fin, essai]);

  const filtre = (patch: FiltresSuivi) => changerFiltres({ ...filtres, ...patch });
  const filtree = Boolean(filtres.statut || filtres.clientId || filtres.debut || filtres.fin);
  const periodeInversee = Boolean(filtres.debut && filtres.fin && filtres.debut > filtres.fin);
  const choixClients = [...clients]
    .sort((a, b) => a.party.name.localeCompare(b.party.name))
    .map((c) => ({ value: c.uid, label: c.party.name || c.uid }));

  return (
    <div class="page-inner">
      <header class="page-tete">
        <h2>{phrases.titre}</h2>
        <IconButton icon="x" label={t.app.close} onClick={fermer} />
      </header>
      <div class="page-corps">
        <p class="field-hint">{phrases.intro}</p>
        <div class="filtres-suivi">
          <Field label={phrases.statut}>
            {(id) => (
              <Select<Statut | ''>
                id={id}
                value={filtres.statut ?? ''}
                options={[
                  { value: '', label: phrases.tous },
                  ...STATUTS.map((s) => ({ value: s, label: t.compte.suivi.statuts[s] })),
                ]}
                onValue={(v) => filtre({ statut: v || undefined })}
              />
            )}
          </Field>
          <Field label={phrases.client}>
            {(id) => (
              <Select<string>
                id={id}
                value={filtres.clientId ?? ''}
                options={[{ value: '', label: phrases.tous }, ...choixClients]}
                onValue={(v) => filtre({ clientId: v || undefined })}
              />
            )}
          </Field>
          <Field label={phrases.du}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={filtres.debut ?? ''}
                onValue={(v) => filtre({ debut: v || undefined })}
              />
            )}
          </Field>
          <Field label={phrases.au}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={filtres.fin ?? ''}
                onValue={(v) => filtre({ fin: v || undefined })}
              />
            )}
          </Field>
        </div>
        {(filtree || lignes) && (
          <div class="liste-tete">
            <span>{lignes ? phrases.nombre(lignes.length) : ''}</span>
            {filtree && (
              <Button size="sm" variant="ghost" icon="x" onClick={() => changerFiltres({})}>
                {phrases.effacer}
              </Button>
            )}
          </div>
        )}
        {periodeInversee && <p class="field-issue soft">{phrases.periode}</p>}
        {erreur && (
          <div class="banner warn actions" role="alert">
            <span>{erreur}</span>
            <Button size="sm" icon="refresh" onClick={() => setEssai((n) => n + 1)}>
              {phrases.reessayer}
            </Button>
          </div>
        )}
        {!erreur && !lignes && <p class="lib-empty">{phrases.chargement}</p>}
        {lignes?.length === 0 && (
          <p class="lib-empty">{filtree ? phrases.videFiltres : phrases.vide}</p>
        )}
        {lignes && lignes.length > 0 && (
          <ul class="liste-suivi">
            {lignes.map((l) => (
              <li key={l.factureId}>
                <button type="button" class="ligne-suivi" onClick={() => ouvrir(l.factureId)}>
                  <span class="ligne-titre">
                    <span class="numero">{l.numero}</span>
                    <PastilleStatut statut={l.statut} />
                  </span>
                  <span class="ligne-montant">{formatMoney(l.netAPayer, l.devise)}</span>
                  <span class="ligne-detail">
                    {[l.clientNom, phrases.emise(formatDate(l.dateEmission)), echeanceDe(l)].join(
                      ' · ',
                    )}
                  </span>
                  <span class="ligne-reste">{resteDeLigne(l)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
