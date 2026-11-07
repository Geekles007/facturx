/**
 * Le dialogue de relance et le bouton « Relancer » de la fiche, sans DOM : les crochets de Preact
 * sont remplacés par un petit moteur qui garde l'état d'un rendu à l'autre et joue les effets dont
 * les dépendances changent ; les composants sont appelés comme des fonctions, et leurs gestionnaires
 * repris dans l'arbre rendu. Le client Supabase est un faux (`functions.invoke`, `auth.resend`), et
 * les lectures du suivi rendent ce que le test leur donne.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** L'état de chaque crochet, par rang d'appel : valeurs, références, dépendances des effets. */
  cases: [] as unknown[],
  rang: 0,
  effets: [] as (() => void)[],
  nettoyages: new Map<number, () => void>(),
}));

vi.mock('preact/hooks', () => {
  const prendre = <T>(init: () => T): [number, T] => {
    const k = h.rang++;
    if (!(k in h.cases)) h.cases[k] = init();
    return [k, h.cases[k] as T];
  };
  return {
    useState: (initial: unknown) => {
      const [k, valeur] = prendre(() =>
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
      );
      const poser = (v: unknown) => {
        h.cases[k] = typeof v === 'function' ? (v as (x: unknown) => unknown)(h.cases[k]) : v;
      };
      return [valeur, poser];
    },
    useRef: (v: unknown) => prendre(() => ({ current: v }))[1],
    useMemo: (f: () => unknown) => f(),
    useCallback: (f: unknown) => f,
    useId: () => 'id',
    useContext: (c: { __?: unknown }) => c.__,
    useLayoutEffect: () => undefined,
    useEffect: (effet: () => unknown, deps?: unknown[]) => {
      const k = h.rang++;
      const avant = h.cases[k] as unknown[] | undefined;
      const memes =
        avant !== undefined &&
        deps !== undefined &&
        deps.length === avant.length &&
        deps.every((d, n) => Object.is(d, avant[n]));
      if (memes) return;
      h.cases[k] = deps;
      h.effets.push(() => {
        h.nettoyages.get(k)?.();
        const nettoyer = effet();
        if (typeof nettoyer === 'function') h.nettoyages.set(k, nettoyer as () => void);
        else h.nettoyages.delete(k);
      });
    },
  };
});

const faux = vi.hoisted(() => ({ invoke: vi.fn(), resend: vi.fn() }));
vi.mock('./client.js', () => ({
  client: () => ({ functions: { invoke: faux.invoke }, auth: { resend: faux.resend } }),
}));

const lectures = vi.hoisted(() => ({
  ligneSuivi: vi.fn(),
  relancesDe: vi.fn(),
  paiementsDe: vi.fn(),
  pdfDe: vi.fn(),
}));
vi.mock('./suivi.js', async (original) => ({
  ...(await original<typeof import('./suivi.js')>()),
  ...lectures,
}));

import { t } from '../i18n.js';
import { defaultAppearance, type SavedInvoice } from '../library.js';
import { sampleForm } from '../sample.js';
import { store } from '../store.js';
import { Button, Dialog } from '../ui.js';
import { Fiche } from './fiche.js';
import { DialogueRelance, FormulaireRelance } from './relance.js';
import { preparerRelance, type RelancePreparee } from './relances.js';
import type { Relance } from './suivi.js';
import { DONNEES_DE_TEST, LIGNE_EN_RETARD, refusDeFonction } from './test-aide.js';

type VNode = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Tous les nœuds de l'arbre rendu ; la saisie d'un champ (`Field`, une fonction) est dépliée. */
function* parcourir(n: unknown): Generator<VNode> {
  if (Array.isArray(n)) {
    for (const x of n) yield* parcourir(x);
    return;
  }
  if (!n || typeof n !== 'object' || !('props' in n)) return;
  const v = n as VNode;
  yield v;
  const enfants = v.props.children;
  yield* parcourir(
    typeof enfants === 'function'
      ? (enfants as (id: string, i: boolean) => unknown)('id', false)
      : enfants,
  );
}

/** Un rendu : le composant appelé, puis les effets dont les dépendances ont changé. */
function rendre<P>(composant: (p: P) => unknown, props: P): VNode[] {
  h.rang = 0;
  const arbre = [...parcourir(composant(props))];
  for (const effet of h.effets.splice(0)) effet();
  return arbre;
}

/** Démonte : les effets sont nettoyés, l'état oublié. */
function demonter(): void {
  for (const nettoyer of h.nettoyages.values()) nettoyer();
  h.nettoyages.clear();
  h.cases.length = 0;
  h.effets.length = 0;
}

/** Le texte affiché : les enfants textuels de tous les nœuds, et l'aide ou l'avertissement des champs. */
const texte = (arbre: VNode[]): string =>
  arbre
    .flatMap((v) => [v.props.children, v.props.hint, v.props.warning].flat())
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .join(' ');

/** Laisse passer les promesses en cours (lectures, appel du faux client). */
const attendre = () => new Promise((resolve) => setTimeout(resolve, 0));

const phrases = t.compte.relance;
const sans = (texte: string) => `${texte} ${phrases.aucuneEnvoyee}`;

function preparee(destinataire = 'compta@client-demo.fr'): RelancePreparee {
  return {
    factureId: 'f-1',
    numero: 'F-2026-0042',
    niveau: 1,
    langue: 'fr',
    langueDeLaFacture: true,
    particulier: false,
    enRetard: true,
    destinataire,
    ...preparerRelance(DONNEES_DE_TEST, 1, 'fr'),
  };
}

const LIGNE = LIGNE_EN_RETARD;

const uiAvant = store.get().ui;
const historiqueAvant = store.get().history;

beforeEach(() => {
  faux.invoke.mockReset();
  faux.resend.mockReset();
  for (const lecture of Object.values(lectures)) lecture.mockReset();
  store.set((s) => ({
    ui: {
      ...s.ui,
      compte: {
        email: 'moi@atelier.fr',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    },
  }));
});

afterEach(() => {
  demonter();
  vi.unstubAllGlobals();
  store.set({ ui: uiAvant, history: historiqueAvant });
});

/** Les accessoires du formulaire, chacun espionné. */
function accessoires(p: RelancePreparee = preparee()) {
  return {
    preparee: p,
    apres: vi.fn(),
    fermer: vi.fn(),
    ouvrirEntreprise: vi.fn(),
    enCours: vi.fn(),
  };
}

/** Le bouton d'envoi, le formulaire, et la saisie du champ `libelle`. */
const envoyer = (arbre: VNode[]) => arbre.find((v) => v.props.type === 'submit');
const formulaire = (arbre: VNode[]) => arbre.find((v) => v.type === 'form');
function saisie(arbre: VNode[], libelle: string): VNode {
  const champ = arbre.find((v) => v.props.label === libelle);
  const enfants = champ?.props.children;
  if (typeof enfants !== 'function') throw new Error(`champ ${libelle} absent`);
  return enfants('id', false) as VNode;
}
/** Le gestionnaire `nom` du nœud `v`, qui doit exister. */
function gestionnaire(v: VNode | undefined, nom: string): (...args: unknown[]) => unknown {
  const f = v?.props[nom];
  if (typeof f !== 'function') throw new Error(`${nom} absent`);
  return f as (...args: unknown[]) => unknown;
}
const soumettre = (arbre: VNode[]) =>
  gestionnaire(formulaire(arbre), 'onSubmit')({ preventDefault: () => undefined });

const refusDe = refusDeFonction;

describe('le formulaire de relance', () => {
  test('destinataire vide : envoi désactivé, et rien ne part', async () => {
    const props = accessoires(preparee(''));
    let arbre = rendre(FormulaireRelance, props);
    expect(envoyer(arbre)?.props.disabled).toBe(true);
    expect(texte(arbre)).toContain(phrases.destinataireVide);

    // Deux adresses : refusé par le serveur, donc par le bouton ; l'avertissement attend que l'on
    // quitte le champ, pas pendant la frappe.
    (saisie(arbre, phrases.destinataire).props.onValue as (v: string) => void)('a@b.fr, c@d.fr');
    arbre = rendre(FormulaireRelance, props);
    expect(envoyer(arbre)?.props.disabled).toBe(true);
    expect(texte(arbre)).not.toContain(phrases.destinataireInvalide);
    gestionnaire(saisie(arbre, phrases.destinataire), 'onBlur')();
    arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(phrases.destinataireInvalide);
    (saisie(arbre, phrases.destinataire).props.onValue as (v: string) => void)(
      ' compta@client.fr ',
    );
    arbre = rendre(FormulaireRelance, props);
    expect(envoyer(arbre)?.props.disabled).toBe(false);
    // Un objet ou un message vide : le serveur refuserait, le bouton aussi.
    (saisie(arbre, phrases.objet).props.onValue as (v: string) => void)('  ');
    arbre = rendre(FormulaireRelance, props);
    expect(envoyer(arbre)?.props.disabled).toBe(true);
    soumettre(arbre);
    await attendre();
    expect(faux.invoke).not.toHaveBeenCalled();
  });

  test('une tentative d’envoi montre aussi l’avertissement d’une adresse non valide', async () => {
    const props = accessoires(preparee('client'));
    let arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).not.toContain(phrases.destinataireInvalide);
    soumettre(arbre);
    await attendre();
    arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(phrases.destinataireInvalide);
    expect(faux.invoke).not.toHaveBeenCalled();
  });

  test('la présentation dit d’où vient la langue, et, au dernier rappel, ce qu’on ne réclame pas à un particulier', () => {
    const langueDe = (p: RelancePreparee) => texte(rendre(FormulaireRelance, accessoires(p)));
    expect(langueDe(preparee())).toContain(
      phrases.presentation(1, phrases.niveaux[1], phrases.langues.fr, true),
    );
    demonter();
    // La facture ne s'est pas lue : la langue est celle de l'interface, et le dialogue ne prétend pas
    // le contraire.
    const repli = langueDe({ ...preparee(), langueDeLaFacture: false });
    expect(repli).toContain(phrases.presentation(1, phrases.niveaux[1], phrases.langues.fr, false));
    expect(phrases.presentation(1, 'x', 'y', false)).not.toBe(
      phrases.presentation(1, 'x', 'y', true),
    );
    demonter();
    expect(langueDe({ ...preparee(), niveau: 3, particulier: true })).toContain(
      phrases.particulier,
    );
    demonter();
    expect(langueDe({ ...preparee(), niveau: 3 })).not.toContain(phrases.particulier);
  });

  test('l’objet et le message sont préremplis et modifiables ; ce qui part est ce qui est relu', async () => {
    const props = accessoires();
    let arbre = rendre(FormulaireRelance, props);
    expect(saisie(arbre, phrases.objet).props.value).toBe(props.preparee.objet);
    expect(saisie(arbre, phrases.corps).props.value).toBe(props.preparee.corps);
    expect(saisie(arbre, phrases.destinataire).props.value).toBe('compta@client-demo.fr');
    (saisie(arbre, phrases.corps).props.onValue as (v: string) => void)('Message relu et modifié.');
    arbre = rendre(FormulaireRelance, props);
    faux.invoke.mockResolvedValueOnce({ data: { id: 'r-1', niveau: 1 }, error: null });
    soumettre(arbre);
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalled());
    expect(faux.invoke).toHaveBeenCalledWith('relancer', {
      body: {
        factureId: 'f-1',
        destinataire: 'compta@client-demo.fr',
        objet: props.preparee.objet,
        corps: 'Message relu et modifié.',
      },
      timeout: expect.any(Number),
    });
  });

  test('envoyée : le niveau du serveur, « envoyée », jamais « reçue » ; la fiche est relue', async () => {
    const props = accessoires();
    faux.invoke.mockResolvedValueOnce({ data: { id: 'r-1', niveau: 2 }, error: null });
    soumettre(rendre(FormulaireRelance, props));
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalledTimes(1));
    const arbre = rendre(FormulaireRelance, props);
    const statut = arbre.find((v) => v.props.role === 'status');
    expect(statut?.props.children).toBe(phrases.envoyee(2, 'compta@client-demo.fr'));
    expect(texte(arbre)).not.toMatch(/reçue|received/i);
    // Le formulaire laisse place au résultat ; « Fermer » ferme.
    expect(formulaire(arbre)).toBeUndefined();
    const fermer = arbre.find((v) => v.type === Button && v.props.children === t.app.close);
    gestionnaire(fermer, 'onClick')();
    expect(props.fermer).toHaveBeenCalled();
    // Pendant l'envoi, le dialogue ne se fermait pas ; il le peut de nouveau.
    expect(props.enCours.mock.calls).toEqual([[true], [false]]);
  });

  test('`incertain` : « peut-être partie », jamais « envoyée » ; la fiche est relue', async () => {
    const props = accessoires();
    faux.invoke.mockResolvedValueOnce({
      data: { id: 'r-1', niveau: 1, incertain: true },
      error: null,
    });
    soumettre(rendre(FormulaireRelance, props));
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalledTimes(1));
    const arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(phrases.incertaine);
    expect(texte(arbre)).not.toMatch(/envoyée|reçue/i);
    expect(formulaire(arbre)).toBeUndefined();
  });

  test('pas de réponse : « peut-être partie » aussi, et la fiche est relue', async () => {
    const props = accessoires();
    faux.invoke.mockResolvedValueOnce(refusDe(504, { message: 'upstream timeout' }));
    soumettre(rendre(FormulaireRelance, props));
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalledTimes(1));
    const arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(phrases.sansReponse);
    expect(texte(arbre)).not.toMatch(/envoyée|reçue/i);
  });

  test('chaque erreur se lit dans le dialogue ; le formulaire reste, pour corriger et réessayer', async () => {
    const cas: [number, unknown, string, string | undefined][] = [
      [403, { code: 'DROITS' }, sans(phrases.refus.droits), undefined],
      [403, { code: 'SUPPRESSION' }, sans(t.compte.erreurs.suppression), undefined],
      [
        422,
        { code: 'ANOMALIES', details: [{ code: 'PAS_DE_RETARD', path: 'factureId', message: '' }] },
        sans(phrases.refus.pasDeRetard),
        undefined,
      ],
      [
        422,
        {
          code: 'ANOMALIES',
          details: [{ code: 'DESTINATAIRE', path: 'destinataire', message: '' }],
        },
        sans(phrases.refus.destinataire),
        phrases.destinataire,
      ],
      [
        422,
        { code: 'ANOMALIES', details: [{ code: 'CORPS', path: 'objet', message: '' }] },
        sans(phrases.refus.objet),
        phrases.objet,
      ],
      [
        422,
        { code: 'ANOMALIES', details: [{ code: 'CORPS', path: 'corps', message: '' }] },
        sans(phrases.refus.corps),
        phrases.corps,
      ],
      [429, { code: 'LIMITE' }, sans(phrases.refus.limite(undefined)), undefined],
      [502, { code: 'ENVOI' }, t.compte.erreurs.envoi, undefined],
      [500, { code: 'INTERNE' }, t.compte.erreurs.interne(undefined), undefined],
      [401, { code: 'SESSION' }, sans(phrases.refus.session), undefined],
    ];
    for (const [statut, corps, message, champ] of cas) {
      demonter();
      const props = accessoires();
      faux.invoke.mockResolvedValueOnce(
        refusDe(statut, { message: 'Texte du serveur', ...(corps as object) }),
      );
      soumettre(rendre(FormulaireRelance, props));
      await vi.waitFor(() => expect(props.apres).toHaveBeenCalled());
      const arbre = rendre(FormulaireRelance, props);
      const alerte = arbre.find((v) => v.props.role === 'alert');
      expect({ statut, message: alerte?.props.children }).toEqual({ statut, message });
      expect(texte(arbre)).not.toContain('Texte du serveur');
      // On peut corriger, puis renvoyer.
      expect(formulaire(arbre)).toBeDefined();
      expect(envoyer(arbre)?.props.disabled).toBe(false);
      // Le champ en cause est marqué, et lui seul.
      for (const libelle of [phrases.destinataire, phrases.objet, phrases.corps]) {
        const invalide =
          saisie(arbre, libelle).props['aria-invalid'] ?? saisie(arbre, libelle).props.invalid;
        expect({ libelle, invalide: Boolean(invalide) }).toEqual({
          libelle,
          invalide: libelle === champ,
        });
      }
    }
  });

  test('SIREN absent : le message propose d’ouvrir la fiche de l’entreprise', async () => {
    const props = accessoires();
    faux.invoke.mockResolvedValueOnce(
      refusDe(422, {
        code: 'ANOMALIES',
        message: '',
        details: [{ code: 'SIREN', path: 'company.seller.siren', message: '' }],
      }),
    );
    soumettre(rendre(FormulaireRelance, props));
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalled());
    const arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(sans(phrases.refus.siren));
    const ouvrir = arbre.find(
      (v) => v.type === Button && v.props.children === phrases.ouvrirEntreprise,
    );
    gestionnaire(ouvrir, 'onClick')();
    expect(props.ouvrirEntreprise).toHaveBeenCalled();
  });

  test('adresse non confirmée : renvoyer l’e-mail de confirmation, depuis le dialogue', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost:8080' });
    const props = accessoires();
    faux.invoke.mockResolvedValueOnce(refusDe(403, { code: 'NON_CONFIRME', message: '' }));
    faux.resend.mockResolvedValueOnce({ error: null });
    soumettre(rendre(FormulaireRelance, props));
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalled());
    let arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(sans(t.compte.erreurs.nonConfirme));
    const renvoyer = arbre.find((v) => v.type === Button && v.props.children === phrases.renvoyer);
    gestionnaire(renvoyer, 'onClick')();
    await vi.waitFor(() => expect(faux.resend).toHaveBeenCalled());
    expect(faux.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'moi@atelier.fr',
      options: { emailRedirectTo: 'http://localhost:8080/studio/' },
    });
    await attendre();
    arbre = rendre(FormulaireRelance, props);
    expect(texte(arbre)).toContain(phrases.confirmationRenvoyee('moi@atelier.fr'));
  });

  test('double clic sur « Envoyer » : une seule requête', async () => {
    const props = accessoires();
    let repondre: (v: unknown) => void = () => undefined;
    faux.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        repondre = resolve;
      }),
    );
    let arbre = rendre(FormulaireRelance, props);
    soumettre(arbre);
    soumettre(arbre);
    // Pendant l'envoi : le bouton est désactivé, et le dialogue ne se ferme pas.
    arbre = rendre(FormulaireRelance, props);
    expect(envoyer(arbre)?.props.disabled).toBe(true);
    expect(envoyer(arbre)?.props.children).toBe(phrases.envoi);
    soumettre(arbre);
    expect(props.enCours).toHaveBeenLastCalledWith(true);
    repondre({ data: { id: 'r-1', niveau: 1 }, error: null });
    await vi.waitFor(() => expect(props.apres).toHaveBeenCalled());
    expect(faux.invoke).toHaveBeenCalledTimes(1);
    expect(props.apres).toHaveBeenCalledTimes(1);
  });
});

describe('le dialogue de relance', () => {
  const facture = (language: 'fr' | 'en'): SavedInvoice => ({
    uid: 'f-1',
    status: 'issued',
    form: sampleForm('2026-09-11'),
    appearance: { ...defaultAppearance(), language },
    summary: {
      id: 'F-2026-0042',
      typeCode: '380',
      issueDate: '2026-09-11',
      buyerName: 'Client Démo SARL',
      currency: 'EUR',
      total: 123456,
      due: 123456,
    },
    issuedAt: '2026-09-11T10:00:00.000Z',
  });

  const relance = (etat: Relance['etat']): Relance => ({
    id: crypto.randomUUID(),
    factureId: 'f-1',
    niveau: 1,
    envoyeeLe: '2026-10-20T09:00:00Z',
    destinataire: 'compta@client-demo.fr',
    objet: 'Rappel',
    etat,
    incertaine: false,
  });

  test('fermé tant qu’aucune facture n’est à relancer ; rien n’est lu', () => {
    const arbre = rendre(DialogueRelance, { apres: vi.fn(), ouvrirEntreprise: vi.fn() });
    expect(arbre.find((v) => v.type === Dialog)?.props.open).toBe(false);
    expect(lectures.ligneSuivi).not.toHaveBeenCalled();
  });

  test('« Relancer » l’ouvre : niveau suivant, langue de la facture, adresse de la facture', async () => {
    store.set((s) => ({ history: [facture('en')], ui: { ...s.ui, relance: 'f-1' } }));
    lectures.ligneSuivi.mockResolvedValue(LIGNE);
    lectures.relancesDe.mockResolvedValue([relance('envoyee'), relance('refusee')]);
    const props = { apres: vi.fn(), ouvrirEntreprise: vi.fn() };
    let arbre = rendre(DialogueRelance, props);
    expect(arbre.find((v) => v.type === Dialog)?.props.open).toBe(true);
    expect(texte(arbre)).toContain(phrases.chargement);
    await vi.waitFor(() => expect(lectures.relancesDe).toHaveBeenCalledWith('f-1'));
    await attendre();
    arbre = rendre(DialogueRelance, props);
    const dialogue = arbre.find((v) => v.type === Dialog);
    expect(dialogue?.props.title).toBe(phrases.titre('F-2026-0042'));
    const formulaire = [...parcourir(dialogue?.props.children)].find(
      (v) => v.type === FormulaireRelance,
    );
    const p = formulaire?.props.preparee as RelancePreparee;
    expect(p).toMatchObject({
      factureId: 'f-1',
      numero: 'F-2026-0042',
      niveau: 2,
      langue: 'en',
      enRetard: true,
      destinataire: 'compta@client-demo.fr',
    });
    expect(p.objet).toMatch(/^Second reminder/);
    expect(p.langueDeLaFacture).toBe(true);
    expect(p.corps).toContain('FR76 3000 6000 0112 3456 7890 189');
    // Fermer : plus de facture à relancer.
    gestionnaire(dialogue, 'onClose')();
    expect(store.get().ui.relance).toBeUndefined();
  });

  test('pendant l’envoi, le dialogue ne se ferme pas', async () => {
    store.set((s) => ({ history: [facture('fr')], ui: { ...s.ui, relance: 'f-1' } }));
    lectures.ligneSuivi.mockResolvedValue(LIGNE);
    lectures.relancesDe.mockResolvedValue([]);
    const props = { apres: vi.fn(), ouvrirEntreprise: vi.fn() };
    rendre(DialogueRelance, props);
    await vi.waitFor(() => expect(lectures.relancesDe).toHaveBeenCalled());
    await attendre();
    let arbre = rendre(DialogueRelance, props);
    const formulaire = arbre.find((v) => v.type === Dialog);
    const enfant = [...parcourir(formulaire?.props.children)].find(
      (v) => v.type === FormulaireRelance,
    );
    gestionnaire(enfant, 'enCours')(true);
    arbre = rendre(DialogueRelance, props);
    const dialogue = arbre.find((v) => v.type === Dialog);
    expect(dialogue?.props.fermable).toBe(false);
    gestionnaire(dialogue, 'onClose')();
    expect(store.get().ui.relance).toBe('f-1');
  });

  test('préparée : un particulier au dernier rappel, rien de réclamé ; sans facture lue, la langue de l’interface', async () => {
    const { preparer } = await import('./relances.js');
    const particulier = facture('fr');
    particulier.form = {
      ...particulier.form,
      buyer: { ...particulier.form.buyer, consumer: true },
    };
    store.set({ history: [particulier] });
    lectures.ligneSuivi.mockResolvedValue(LIGNE);
    lectures.relancesDe.mockResolvedValue([relance('envoyee'), relance('envoyee')]);
    const p = await preparer('f-1');
    expect(p).toMatchObject({ niveau: 3, particulier: true, langueDeLaFacture: true });
    expect(p?.corps).not.toMatch(/pénalit|indemnit|%/i);
    // La facture n'est pas dans l'historique (et sans conservation du compte, rien à relire).
    store.set({ history: [] });
    const repli = await preparer('f-1');
    expect(repli).toMatchObject({ langue: t.lang, langueDeLaFacture: false, particulier: false });
    // Rien de la facture : au dernier rappel, un renvoi à ses conditions, aucun chiffre.
    expect(repli?.corps).toContain(
      'Nous vous renvoyons aux conditions de paiement figurant sur la facture.',
    );
  });

  test('une facture qui n’est plus en retard : le dialogue prévient, le serveur décidera', async () => {
    store.set((s) => ({ history: [facture('fr')], ui: { ...s.ui, relance: 'f-1' } }));
    lectures.ligneSuivi.mockResolvedValue({
      ...LIGNE,
      statut: 'payee',
      resteDu: 0,
      joursRetard: null,
    });
    lectures.relancesDe.mockResolvedValue([]);
    const p = await import('./relances.js').then((m) => m.preparer('f-1'));
    expect(p?.enRetard).toBe(false);
    const arbre = rendre(FormulaireRelance, accessoires(p as RelancePreparee));
    expect(texte(arbre)).toContain(phrases.pasEnRetard);
  });
});

describe('« Relancer » dans la fiche', () => {
  beforeEach(() => {
    lectures.paiementsDe.mockResolvedValue([]);
    lectures.relancesDe.mockResolvedValue([]);
    // Le PDF n'arrive pas : la fiche n'en a pas besoin ici.
    lectures.pdfDe.mockReturnValue(new Promise(() => undefined));
  });

  const props = (relances = 0) => ({
    factureId: 'f-1',
    retour: vi.fn(),
    fermer: vi.fn(),
    relances,
  });

  async function fiche(p = props()): Promise<VNode[]> {
    rendre(Fiche, p);
    await vi.waitFor(() => expect(lectures.ligneSuivi).toHaveBeenCalled());
    await attendre();
    return rendre(Fiche, p);
  }

  const bouton = (arbre: VNode[]) =>
    arbre.find((v) => v.type === Button && v.props.children === t.compte.suivi.fiche.relancer);

  test('une facture en retard offre « Relancer », qui pose la facture à relancer, sans rien d’autre', async () => {
    lectures.ligneSuivi.mockResolvedValue(LIGNE);
    const avant = store.get().ui;
    gestionnaire(bouton(await fiche()), 'onClick')();
    expect(store.get().ui).toEqual({ ...avant, relance: 'f-1' });
  });

  test('une facture qui n’est pas en retard n’a pas « Relancer »', async () => {
    for (const statut of ['a_payer', 'payee', 'payee_en_partie', 'a_rembourser'] as const) {
      demonter();
      lectures.ligneSuivi.mockReset();
      lectures.ligneSuivi.mockResolvedValue({ ...LIGNE, statut, joursRetard: null });
      expect(bouton(await fiche())).toBeUndefined();
    }
  });

  test('après une relance, la fiche relit ses relances ; une relance incertaine le dit', async () => {
    lectures.ligneSuivi.mockResolvedValue(LIGNE);
    await fiche(props(0));
    expect(lectures.relancesDe).toHaveBeenCalledTimes(1);
    lectures.relancesDe.mockResolvedValue([
      {
        id: 'r-1',
        factureId: 'f-1',
        niveau: 1,
        envoyeeLe: '2026-11-07T09:00:00Z',
        destinataire: 'compta@incertain.test',
        objet: 'Rappel',
        etat: 'envoyee',
        incertaine: true,
      },
    ]);
    rendre(Fiche, props(1));
    await vi.waitFor(() => expect(lectures.relancesDe).toHaveBeenCalledTimes(2));
    await attendre();
    const arbre = rendre(Fiche, props(1));
    const ecrit = texte(arbre);
    expect(ecrit).toContain(t.compte.suivi.fiche.incertaine('07/11/2026', 'compta@incertain.test'));
    expect(ecrit).not.toContain(
      t.compte.suivi.fiche.envoyee('07/11/2026', 'compta@incertain.test'),
    );
  });
});
