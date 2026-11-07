/**
 * Le tableau de bord du compte (spec § 8). Sur la période choisie (ce mois-ci ou cette année) : le
 * facturé HT, avoirs déduits, et l'encaissé ; à ce jour, quelle que soit la période : le reste à
 * encaisser et les retards, en montant et en nombre. Puis les factures en retard, la plus en retard
 * d'abord, chacune avec « Relancer », et les échéances des 15 prochains jours.
 *
 * Un bloc de chiffres par devise, la devise du compte d'abord : rien n'est converti ni additionné
 * d'une devise à l'autre, et chaque facture des listes garde la sienne. Les chiffres viennent de
 * `tableau_de_bord`, les listes de la vue `suivi_factures`, le jour de Paris comme en base : rien
 * n'est recalculé ici. Une ligne s'ouvre sur la fiche de la facture.
 *
 * « Relancer » pose la facture à relancer (`ui.relance`), et rien d'autre : le dialogue de relance
 * la lit.
 *
 * Chargé par `import()` avec la navigation du compte.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatDate, formatMoney, t } from '../i18n.js';
import { ui, useStudio } from '../store.js';
import { Button, IconButton, Segmented } from '../ui.js';
import { PastilleStatut } from './factures.js';
import { periode as bornes, type TypePeriode } from './periode.js';
import {
  aujourdhuiParis,
  type ChiffresDevise,
  chiffresParDevise,
  deviseDuCompte,
  ECHEANCES_JOURS,
  echeancesProches,
  facturesEnRetard,
  type LigneSuivi,
  messageDe,
  tableauDeBord,
} from './suivi.js';

/** « Relancer » : la facture à relancer, pour le dialogue de relance. Rien d'autre ne change. */
export function relancer(factureId: string): void {
  ui({ relance: factureId });
}

/** Les quatre chiffres d'une devise. */
function Chiffres({ c, titre }: { c: ChiffresDevise; titre: boolean }) {
  const phrases = t.compte.tableau;
  return (
    <section class="tableau-devise" aria-label={phrases.devise(c.devise)}>
      {titre && <h3>{phrases.devise(c.devise)}</h3>}
      <dl class="tableau-chiffres">
        <div>
          <dt class="intitule">{phrases.factureHt}</dt>
          <dd class="valeur">{formatMoney(c.factureHt, c.devise)}</dd>
          <dd class="aide">{phrases.factureHtAide}</dd>
        </div>
        <div>
          <dt class="intitule">{phrases.encaisse}</dt>
          <dd class="valeur">{formatMoney(c.encaisse, c.devise)}</dd>
        </div>
        <div>
          <dt class="intitule">{phrases.resteAEncaisser}</dt>
          <dd class="valeur">{formatMoney(c.resteAEncaisser, c.devise)}</dd>
        </div>
        <div class={c.retardNombre > 0 ? 'retard' : undefined}>
          <dt class="intitule">{phrases.enRetard}</dt>
          <dd class="valeur">{formatMoney(c.retardMontant, c.devise)}</dd>
          <dd class="aide">{phrases.nombre(c.retardNombre)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Une facture des listes : son numéro, son reste dû dans sa devise, son client et `detail`. */
function Ligne({
  l,
  detail,
  pastille,
  ouvrir,
}: {
  l: LigneSuivi;
  detail: string;
  pastille: boolean;
  ouvrir: (factureId: string) => void;
}) {
  return (
    <button type="button" class="ligne-suivi" onClick={() => ouvrir(l.factureId)}>
      <span class="ligne-titre">
        <span class="numero">{l.numero}</span>
        {pastille && <PastilleStatut statut={l.statut} />}
      </span>
      <span class="ligne-montant">{formatMoney(l.resteDu, l.devise)}</span>
      <span class="ligne-detail">{[l.clientNom, detail].join(' · ')}</span>
    </button>
  );
}

export function TableauDeBord({
  periode,
  changerPeriode,
  ouvrir,
  fermer,
}: {
  periode: TypePeriode;
  changerPeriode: (p: TypePeriode) => void;
  ouvrir: (factureId: string) => void;
  fermer: () => void;
}) {
  const phrases = t.compte.tableau;
  const devise = deviseDuCompte(useStudio((s) => s.company.defaults.currency));
  const aujourdhui = aujourdhuiParis();
  const { debut, fin } = bornes(periode, aujourdhui);
  const [chiffres, setChiffres] = useState<ChiffresDevise[]>();
  const [listes, setListes] = useState<{ retards: LigneSuivi[]; echeances: LigneSuivi[] }>();
  const [erreurChiffres, setErreurChiffres] = useState<string>();
  const [erreurListes, setErreurListes] = useState<string>();
  const [essai, setEssai] = useState(0);

  // Les chiffres de la période.
  useEffect(() => {
    let abandonne = false;
    setChiffres(undefined);
    setErreurChiffres(undefined);
    tableauDeBord(debut, fin).then(
      (lus) => {
        if (!abandonne) setChiffres(lus);
      },
      (raison) => {
        if (!abandonne) setErreurChiffres(messageDe(raison));
      },
    );
    return () => {
      abandonne = true;
    };
  }, [debut, fin, essai]);

  // Les retards et les échéances, qui ne dépendent pas de la période.
  useEffect(() => {
    let abandonne = false;
    setListes(undefined);
    setErreurListes(undefined);
    Promise.all([facturesEnRetard(), echeancesProches(aujourdhui)]).then(
      ([retards, echeances]) => {
        if (!abandonne) setListes({ retards, echeances });
      },
      (raison) => {
        if (!abandonne) setErreurListes(messageDe(raison));
      },
    );
    return () => {
      abandonne = true;
    };
  }, [aujourdhui, essai]);

  const erreur = erreurChiffres ?? erreurListes;
  const blocs = chiffres ? chiffresParDevise(chiffres, devise) : undefined;

  return (
    <div class="page-inner">
      <header class="page-tete">
        <h2>{phrases.titre}</h2>
        <IconButton icon="x" label={t.app.close} onClick={fermer} />
      </header>
      <div class="page-corps">
        <div class="tableau-periode">
          <Segmented<TypePeriode>
            label={phrases.periode}
            size="sm"
            value={periode}
            options={[
              { value: 'mois', label: phrases.mois },
              { value: 'annee', label: phrases.annee },
            ]}
            onValue={changerPeriode}
          />
          <span class="field-hint">{phrases.intervalle(formatDate(debut), formatDate(fin))}</span>
        </div>
        {erreur && (
          <div class="banner warn actions" role="alert">
            <span>{erreur}</span>
            <Button size="sm" icon="refresh" onClick={() => setEssai((n) => n + 1)}>
              {t.compte.suivi.liste.reessayer}
            </Button>
          </div>
        )}
        {!erreurChiffres && !blocs && <p class="lib-empty">{phrases.chargement}</p>}
        {blocs?.map((c) => (
          <Chiffres key={c.devise} c={c} titre={blocs.length > 1} />
        ))}
        {blocs && <p class="field-hint">{phrases.aDate}</p>}

        <section class="fiche-section">
          <h3>{phrases.retards}</h3>
          {!erreurListes && !listes && <p class="lib-empty">{phrases.chargement}</p>}
          {listes?.retards.length === 0 && <p class="lib-empty">{phrases.aucunRetard}</p>}
          {listes && listes.retards.length > 0 && (
            <ul class="liste-tableau">
              {listes.retards.map((l) => (
                <li key={l.factureId}>
                  <Ligne
                    l={l}
                    pastille={false}
                    detail={t.compte.suivi.liste.retard(l.joursRetard ?? 0)}
                    ouvrir={ouvrir}
                  />
                  <Button size="sm" icon="note" onClick={() => relancer(l.factureId)}>
                    {phrases.relancer}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="fiche-section">
          <h3>{phrases.echeances(ECHEANCES_JOURS)}</h3>
          {!erreurListes && !listes && <p class="lib-empty">{phrases.chargement}</p>}
          {listes?.echeances.length === 0 && (
            <p class="lib-empty">{phrases.aucuneEcheance(ECHEANCES_JOURS)}</p>
          )}
          {listes && listes.echeances.length > 0 && (
            <ul class="liste-tableau">
              {listes.echeances.map((l) => (
                <li key={l.factureId}>
                  <Ligne
                    l={l}
                    pastille
                    detail={
                      l.dateEcheance === aujourdhui
                        ? phrases.aujourdhui
                        : t.compte.suivi.liste.echeance(formatDate(l.dateEcheance ?? ''))
                    }
                    ouvrir={ouvrir}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
