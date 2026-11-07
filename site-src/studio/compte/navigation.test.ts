/**
 * La navigation du compte, sans DOM : les crochets de Preact sont remplacés, les composants appelés
 * comme des fonctions, et les gestionnaires repris dans l'arbre rendu.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

/** Chaque `useState` rendu : sa valeur et son setter espion. */
const etats: { valeur: unknown; set: ReturnType<typeof vi.fn> }[] = [];

vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => {
    const valeur = typeof init === 'function' ? (init as () => unknown)() : init;
    const set = vi.fn();
    etats.push({ valeur, set });
    return [valeur, set];
  },
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useRef: (v: unknown) => ({ current: v }),
  useContext: (c: { __?: unknown }) => c.__,
  useId: () => 'id',
}));

const { Navigation, ENTREES } = await import('./navigation.js');
const { ListeDesRetards, TableauDeBord, relancer } = await import('./tableau.js');
const { Fiche } = await import('./fiche.js');
const { DialogueRelance } = await import('./relance.js');
const { t } = await import('../i18n.js');
const { store } = await import('../store.js');

type VNode = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Tous les nœuds de l'arbre rendu. */
function* parcourir(n: unknown): Generator<VNode> {
  if (Array.isArray(n)) {
    for (const x of n) yield* parcourir(x);
    return;
  }
  if (!n || typeof n !== 'object' || !('props' in n)) return;
  const v = n as VNode;
  yield v;
  yield* parcourir(v.props.children);
}

const nom = (v: VNode) => (typeof v.type === 'function' ? (v.type as { name: string }).name : '');
const rendre = (v: VNode, props?: Record<string, unknown>): VNode[] => [
  ...parcourir((v.type as (p: unknown) => unknown)({ ...v.props, ...props })),
];

const uiAvant = store.get().ui;

afterEach(() => {
  etats.length = 0;
  store.set({ ui: uiAvant });
});

describe('le tableau de bord dans la navigation du compte', () => {
  test('l’entrée « Tableau de bord » est active, et ouvre la page du tableau de bord', () => {
    const arbre = [...parcourir(Navigation({ nouvelleFacture: async () => undefined }))];
    const menu = arbre.find((v) => Array.isArray(v.props.items));
    if (!menu) throw new Error('menu absent');
    const items = menu.props.items as {
      label: string;
      disabled?: boolean;
      hint?: string;
      onSelect: () => void;
    }[];
    expect(ENTREES[0]).toBe('tableau');
    const tableau = items[0];
    expect(tableau?.label).toBe(t.compte.navigation.tableau);
    // Plus « bientôt » : l'entrée est là, et elle sert.
    expect(tableau?.disabled).toBeFalsy();
    expect(tableau?.hint).toBeUndefined();
    // Le premier état de la navigation est la page ouverte.
    const [page] = etats;
    tableau?.onSelect();
    expect(page?.set).toHaveBeenCalledWith({ vue: 'tableau' });
  });

  test('la page montre le tableau de bord ; une facture s’y ouvre, et sa fiche y ramène', () => {
    const arbre = [...parcourir(Navigation({ nouvelleFacture: async () => undefined }))];
    const page = arbre.find((v) => nom(v) === 'PageDuCompte');
    if (!page) throw new Error('page absente');
    const naviguer = vi.fn();

    const surTableau = rendre(page, { page: { vue: 'tableau' }, naviguer });
    const dialogue = surTableau.find((v) => v.type === 'dialog');
    expect(dialogue?.props['aria-label']).toBe(t.compte.tableau.titre);
    const tableau = surTableau.find((v) => v.type === TableauDeBord);
    if (!tableau) throw new Error('tableau de bord absent');
    (tableau.props.ouvrir as (id: string) => void)('f-1');
    expect(naviguer).toHaveBeenLastCalledWith({
      vue: 'fiche',
      factureId: 'f-1',
      depuis: 'tableau',
    });

    // La fiche ouverte depuis le tableau de bord y revient, et le dit.
    const surFiche = rendre(page, {
      page: { vue: 'fiche', factureId: 'f-1', depuis: 'tableau' },
      naviguer,
    });
    // La page nomme la vue qu'elle montre : la fiche, et non la liste des factures.
    expect(surFiche.find((v) => v.type === 'dialog')?.props['aria-label']).toBe(
      t.compte.suivi.fiche.titre,
    );
    const fiche = surFiche.find((v) => v.type === Fiche);
    if (!fiche) throw new Error('fiche absente');
    expect(fiche.props.libelleRetour).toBe(t.compte.tableau.retour);
    (fiche.props.retour as () => void)();
    expect(naviguer).toHaveBeenLastCalledWith({ vue: 'tableau' });

    // Depuis la liste, la fiche ramène à la liste, comme avant.
    const depuisListe = rendre(page, {
      page: { vue: 'fiche', factureId: 'f-1', depuis: 'factures' },
      naviguer,
    }).find((v) => v.type === Fiche);
    if (!depuisListe) throw new Error('fiche absente');
    expect(depuisListe.props.libelleRetour).toBe(t.compte.suivi.fiche.retour);
    (depuisListe.props.retour as () => void)();
    expect(naviguer).toHaveBeenLastCalledWith({ vue: 'factures' });
  });

  test('« Relancer » pose la facture à relancer, et rien d’autre (Ruling 4)', () => {
    const avant = store.get();
    relancer('f-9');
    const apres = store.get();
    expect(apres.ui.relance).toBe('f-9');
    expect({ ...apres.ui, relance: avant.ui.relance }).toEqual(avant.ui);
    expect(apres.form).toBe(avant.form);
  });

  test('« Relancer » sur une ligne pose la facture de cette ligne, et pas une autre', () => {
    const ligne = (factureId: string, numero: string, joursRetard: number) => ({
      factureId,
      entrepriseId: 'e-1',
      numero,
      typeCode: '380',
      dateEmission: '2026-09-01',
      dateEcheance: '2026-10-01',
      clientId: null,
      clientNom: 'Client',
      clientEmail: null,
      devise: 'EUR',
      ht: 1000,
      ttc: 1200,
      netAPayer: 1200,
      encaisse: 0,
      avoirs: 0,
      resteDu: 1200,
      statut: 'en_retard' as const,
      joursRetard,
    });
    const ouvrir = vi.fn();
    const arbre = [
      ...parcourir(
        ListeDesRetards({
          retards: [ligne('f-1', 'F-1', 40), ligne('f-2', 'F-2', 12)],
          ouvrir,
        }),
      ),
    ];
    const boutons = arbre.filter((v) => v.props.children === t.compte.tableau.relancer);
    const [premier, second] = boutons;
    if (!premier || !second) throw new Error('deux boutons « Relancer » attendus');
    expect(boutons).toHaveLength(2);
    (second.props.onClick as () => void)();
    expect(store.get().ui.relance).toBe('f-2');
    (premier.props.onClick as () => void)();
    expect(store.get().ui.relance).toBe('f-1');
    // « Relancer » n'ouvre pas la fiche.
    expect(ouvrir).not.toHaveBeenCalled();
  });

  test('le dialogue de relance : un seul, et la fiche ouverte est relue après chaque relance', () => {
    const arbre = [...parcourir(Navigation({ nouvelleFacture: async () => undefined }))];
    const dialogues = arbre.filter((v) => v.type === DialogueRelance);
    const [dialogue] = dialogues;
    if (!dialogue || dialogues.length !== 1) throw new Error('un dialogue de relance attendu');
    // Le troisième état de la navigation compte les relances faites depuis le dialogue.
    const compteur = etats[2];
    (dialogue.props.apres as () => void)();
    const suivant = compteur?.set.mock.calls[0]?.[0] as (n: number) => number;
    expect(suivant(4)).toBe(5);

    // La fiche reçoit ce compte : elle se relit quand il change.
    const page = arbre.find((v) => nom(v) === 'PageDuCompte');
    if (!page) throw new Error('page absente');
    expect(page.props.relances).toBe(compteur?.valeur);
    const fiche = rendre(page, {
      page: { vue: 'fiche', factureId: 'f-1', depuis: 'tableau' },
      naviguer: vi.fn(),
      relances: 3,
    }).find((v) => v.type === Fiche);
    expect(fiche?.props.relances).toBe(3);
  });

  test('SIREN absent : « Ouvrir la fiche de l’entreprise » ferme la page et ouvre l’entreprise', () => {
    store.set((s) => ({ ui: { ...s.ui, relance: 'f-1' } }));
    const arbre = [...parcourir(Navigation({ nouvelleFacture: async () => undefined }))];
    const [page] = etats;
    const dialogue = arbre.find((v) => v.type === DialogueRelance);
    if (!dialogue) throw new Error('dialogue de relance absent');
    (dialogue.props.ouvrirEntreprise as () => void)();
    expect(page?.set).toHaveBeenCalledWith(undefined);
    expect(store.get().ui).toMatchObject({ library: 'company', relance: undefined });
  });

  test('la page du tableau de bord dit ce que montrent ses chiffres (une devise à la fois)', () => {
    const arbre = [
      ...parcourir(
        TableauDeBord({
          periode: 'mois',
          changerPeriode: () => undefined,
          ouvrir: () => undefined,
          fermer: () => undefined,
        }),
      ),
    ];
    expect(arbre.some((v) => v.props.children === t.compte.tableau.intro)).toBe(true);
  });
});
