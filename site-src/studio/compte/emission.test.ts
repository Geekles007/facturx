// Le magasin et la conservation importent IndexedDB : le faux doit exister avant leur évaluation.
import 'fake-indexeddb/auto';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import {
  type Appearance,
  type ClientRecord,
  defaultAppearance,
  defaultCompany,
  defaultNumbering,
  type Numbering,
  type SavedInvoice,
} from '../library.js';
import type { InvoiceForm } from '../model.js';
import { type CodeConservation, ErreurConservation } from '../persistence.js';
import { sampleForm } from '../sample.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import {
  type CompteUi,
  enregistrerMaintenant,
  type Loaded,
  setForm,
  startPersistence,
  store,
} from '../store.js';
import { issueInvoice } from '../workflows.js';
import { emettreSurServeur, PLAFOND_CORPS } from './emission.js';
import type { PersistenceCompte } from './persistence.js';

/** Le client Supabase simulé : seul `functions.invoke` sert à l'émission. */
const faux = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./client.js', () => ({ client: () => ({ functions: { invoke: faux.invoke } }) }));

type Brouillon = NonNullable<Loaded['draft']>;

const COMPTE: CompteUi = {
  email: 'a@exemple.test',
  confirme: true,
  entrepriseId: 'e-1',
  suppressionDemandeeLe: undefined,
  session: 'active',
};

const AUJOURDHUI = '2026-11-05';

/**
 * Une conservation du compte simulée : le brouillon ouvert `b-1`, dont chaque écriture qui change le
 * contenu avance la version, et qui ne se dit prêt à émettre que si l'écran montre les objets mêmes
 * qu'elle a reçus — comme la vraie. `refus` fait échouer l'écriture du brouillon.
 */
function fausseConservation() {
  const etat: {
    refus: CodeConservation | undefined;
    version: number;
    recu: { form: unknown; appearance: unknown } | undefined;
    emis: string[];
    historique: SavedInvoice[] | Error;
    numerotation: Numbering;
    factureDuBrouillon: { id: string; numero: string } | undefined;
    pendantEcriture: (() => void) | undefined;
  } = {
    refus: undefined,
    version: 1,
    recu: undefined,
    emis: [],
    historique: [],
    numerotation: { ...defaultNumbering(), next: 8, year: 2026 },
    factureDuBrouillon: undefined,
    pendantEcriture: undefined,
  };
  const memes = (b: Brouillon) =>
    etat.recu !== undefined && b.form === etat.recu.form && b.appearance === etat.recu.appearance;
  const p = {
    entrepriseId: 'e-1',
    available: async () => true,
    get: async <T>(cle: string) => (cle === 'numbering' ? etat.numerotation : undefined) as T,
    async set(cle: string, valeur: unknown) {
      const b = valeur as Brouillon;
      if (cle !== 'draft' || b.issued !== undefined || b.sample) return cle;
      if (etat.refus) throw new ErreurConservation(etat.refus);
      const tache = etat.pendantEcriture;
      etat.pendantEcriture = undefined;
      tache?.();
      if (etat.recu !== undefined && !memes(b)) etat.version++;
      etat.recu = { form: b.form, appearance: b.appearance };
      return cle;
    },
    async list<T>(magasin: string) {
      if (magasin !== 'invoices') return [] as T[];
      if (etat.historique instanceof Error) throw etat.historique;
      return etat.historique as T[];
    },
    put: async (_: string, v: { uid: string }) => v.uid,
    remove: async () => undefined,
    getFile: async () => undefined,
    setFile: async (cle: string) => cle,
    dump: async () => ({}),
    garderBrouillon: async () => undefined,
    envoisTermines: async () => undefined,
    quitterBrouillon: () => true,
    saisieSurLExemple: () => undefined,
    saisieEnAttente: () => undefined,
    brouillonLocal: async () => undefined,
    preparerBrouillon: async () => ({ brouillon: undefined, appliquer: () => undefined }),
    abandonnerSaisie: async () => undefined,
    brouillonCourant: () => ({ id: 'b-1', version: etat.version }),
    brouillons: async () => [],
    ouvrirBrouillon: async () => undefined,
    supprimerBrouillon: async () => undefined,
    rechargerBrouillon: async () => undefined,
    imposerBrouillon: async () => undefined,
    brouillonAEmettre(affiche: unknown) {
      const b = affiche as Brouillon;
      if (b.issued !== undefined || b.sample || !memes(b)) return undefined;
      return { id: 'b-1', version: etat.version };
    },
    async brouillonEmis(id: string) {
      etat.emis.push(id);
    },
    factureDuBrouillon: async () => etat.factureDuBrouillon,
  };
  return { p: p as unknown as PersistenceCompte, etat };
}

/** Une facture émise telle que l'historique du compte la rend. */
function emise(
  id: string,
  numero: string,
  form: InvoiceForm,
  appearance: Appearance,
): SavedInvoice {
  return {
    uid: id,
    status: 'issued',
    form: { ...structuredClone(form), id: numero },
    appearance: structuredClone(appearance),
    summary: {
      id: numero,
      typeCode: form.typeCode,
      issueDate: form.issueDate,
      buyerName: form.buyer.name,
      currency: form.currency,
      total: 0,
      due: 0,
    },
    issuedAt: '2026-11-05T10:00:00.000Z',
  };
}

/** Une réponse de la fonction : un succès, ou une erreur `{ code, message, details? }`. */
const succes = (corps: unknown, status = 201) => ({
  data: corps,
  error: null,
  response: new Response(null, { status }),
});
function erreurHttp(status: number, corps: unknown) {
  const response = new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return { data: null, error: new FunctionsHttpError(response), response };
}
const coupure = () => ({
  data: null,
  error: new FunctionsFetchError(new TypeError('Failed to fetch')),
  response: undefined,
});

/** Le corps envoyé au n-ième appel, relu en JSON (les octets restent en `{ $bytes }`). */
async function corpsEnvoye(n = 0): Promise<Record<string, unknown>> {
  const options = faux.invoke.mock.calls[n]?.[1] as { body: Blob };
  return JSON.parse(await options.body.text());
}

const uiAvant = store.get().ui;
let arreter: (() => void) | undefined;
let fenetre: EventTarget;

/** Le Studio connecté sur `p`, la facture d'exemple devenue un brouillon (rien d'affiché à part). */
function demarrer(p: PersistenceCompte): void {
  fenetre = new EventTarget();
  vi.stubGlobal('addEventListener', fenetre.addEventListener.bind(fenetre));
  vi.stubGlobal('removeEventListener', fenetre.removeEventListener.bind(fenetre));
  utiliser(p);
  store.set((s) => ({
    form: sampleForm(AUJOURDHUI),
    appearance: defaultAppearance(),
    company: defaultCompany(),
    numbering: { ...defaultNumbering(), next: 7, year: 2026 },
    clients: [],
    history: [],
    ui: {
      ...s.ui,
      storage: 'ok',
      compte: COMPTE,
      conflit: false,
      reseau: 'ok',
      connexion: undefined,
      toast: undefined,
      issued: undefined,
      sample: false,
      tab: 'content',
      focus: undefined,
      refusServeur: undefined,
    },
  }));
  arreter = startPersistence({ delai: 1000 });
}

const texteDuMessage = () => store.get().ui.toast?.text ?? '';

beforeEach(() => {
  faux.invoke.mockReset();
});

afterEach(() => {
  arreter?.();
  arreter = undefined;
  utiliser(indexedDbPersistence);
  vi.unstubAllGlobals();
  store.set({ ui: uiAvant, history: [] });
});

describe('emettreSurServeur', () => {
  test('succès : le corps porte la version enregistrée ; facture ouverte, historique et numérotation relus', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    setForm('buyer.name', 'Client émis');
    const { form, appearance } = store.get();
    etat.historique = [emise('f-1', 'F-2026-0007', form, appearance)];
    faux.invoke.mockResolvedValue(succes({ id: 'f-1', numero: 'F-2026-0007' }));

    expect(await emettreSurServeur()).toBe(true);

    expect(faux.invoke).toHaveBeenCalledTimes(1);
    expect(faux.invoke.mock.calls[0]?.[0]).toBe('emettre');
    const corps = await corpsEnvoye();
    expect(corps.brouillonId).toBe('b-1');
    expect(corps.version).toBe(etat.version);
    expect((corps.invoice as { buyer: { name: string } }).buyer.name).toBe('Client émis');
    expect(corps.appearance).toEqual(JSON.parse(JSON.stringify(appearance)));
    expect('clientId' in corps).toBe(false);
    // Le brouillon émis est quitté pour de bon ; la facture émise s'ouvre.
    expect(etat.emis).toEqual(['b-1']);
    const s = store.get();
    expect(s.ui.issued).toBe('f-1');
    expect(s.form.id).toBe('F-2026-0007');
    expect(s.history.map((h) => h.uid)).toEqual(['f-1']);
    expect(s.numbering.next).toBe(8);
    expect(texteDuMessage()).toBe(t.compte.emission.emise('F-2026-0007'));
  });

  test('le client choisi dans la bibliothèque part avec son uid (clientId)', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    const party = structuredClone(store.get().form.buyer);
    const client: ClientRecord = { uid: 'client-7', party, updatedAt: '2026-11-01T00:00:00.000Z' };
    store.set({ clients: [client] });
    faux.invoke.mockResolvedValue(coupure());
    await emettreSurServeur();
    expect((await corpsEnvoye()).clientId).toBe('client-7');
  });

  test('double clic : une seule émission, un seul message, la facture ouverte une fois', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    const { form, appearance } = store.get();
    etat.historique = [emise('f-1', 'F-2026-0007', form, appearance)];
    let repondre: (v: unknown) => void = () => undefined;
    faux.invoke.mockReturnValue(
      new Promise((resolve) => {
        repondre = resolve;
      }),
    );
    const premier = emettreSurServeur();
    const second = emettreSurServeur();
    await vi.waitFor(() => expect(faux.invoke).toHaveBeenCalledTimes(1));
    const ouvertures: (string | undefined)[] = [];
    const desabonner = store.subscribe(() => {
      const issued = store.get().ui.issued;
      if (issued !== ouvertures.at(-1)) ouvertures.push(issued);
    });
    repondre(succes({ id: 'f-1', numero: 'F-2026-0007' }));
    expect(await premier).toBe(true);
    expect(await second).toBe(false);
    desabonner();
    expect(faux.invoke).toHaveBeenCalledTimes(1);
    expect(etat.emis).toEqual(['b-1']);
    expect(ouvertures).toEqual(['f-1']);
  });

  test('échec réseau, rien d’émis : le brouillon reste, le Studio dit de réessayer', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    const avant = store.get().form;
    faux.invoke.mockResolvedValue(coupure());
    expect(await emettreSurServeur()).toBe(false);
    expect(etat.emis).toEqual([]);
    expect(store.get().form).toBe(avant);
    expect(store.get().ui.issued).toBeUndefined();
    expect(texteDuMessage()).toBe(t.compte.emission.incertain);
  });

  test('réponse perdue mais facture émise : retrouvée par son brouillon, ouverte', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    faux.invoke.mockResolvedValue(coupure());
    etat.factureDuBrouillon = { id: 'f-9', numero: 'F-2026-0009' };
    // L'historique ne se relit pas : la facture est reconstituée de ce qui a été envoyé.
    etat.historique = new Error('réseau');
    expect(await emettreSurServeur()).toBe(true);
    expect(etat.emis).toEqual(['b-1']);
    const s = store.get();
    expect(s.ui.issued).toBe('f-9');
    expect(s.form.id).toBe('F-2026-0009');
    expect(s.form.remittanceInformation).toBe('F-2026-0009');
    expect(s.history.map((h) => [h.uid, h.summary.id])).toEqual([['f-9', 'F-2026-0009']]);
  });

  test('BROUILLON_MODIFIE (modifié ailleurs) : conflit signalé, rien d’émis ni de touché', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    const avant = store.get().form;
    faux.invoke.mockResolvedValue(
      erreurHttp(409, { code: 'BROUILLON_MODIFIE', message: 'Le brouillon a changé.' }),
    );
    expect(await emettreSurServeur()).toBe(false);
    expect(store.get().ui.conflit).toBe(true);
    expect(store.get().form).toBe(avant);
    expect(etat.emis).toEqual([]);
    expect(texteDuMessage()).toBe(
      `${t.compte.erreurs.brouillonModifie} ${t.compte.emission.aucunNumero}`,
    );
  });

  test('BROUILLON_MODIFIE par sa propre frappe pendant l’émission : pas de conflit, le Studio le dit', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    faux.invoke.mockImplementation(async () => {
      setForm('buyer.name', 'Tapé pendant l’émission');
      await enregistrerMaintenant();
      return erreurHttp(409, { code: 'BROUILLON_MODIFIE', message: '' });
    });
    expect(await emettreSurServeur()).toBe(false);
    expect(store.get().ui.conflit).toBe(false);
    expect(texteDuMessage()).toBe(
      `${t.compte.emission.saisieChangee} ${t.compte.emission.aucunNumero}`,
    );
  });

  test('ANOMALIES : l’onglet Contrôle s’ouvre sur le champ en cause (focusField), anomalies gardées', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    const issues = [
      { code: 'ORIGINE', path: 'references.precedingInvoices[0].id', message: 'Inconnue.' },
      { code: 'GLYPH_MISSING', path: 'appearance.font', message: 'ŋ absent.' },
    ];
    faux.invoke.mockResolvedValue(
      erreurHttp(422, { code: 'ANOMALIES', message: '', details: issues }),
    );
    const { form, appearance } = store.get();
    expect(await emettreSurServeur()).toBe(false);
    const ui = store.get().ui;
    expect(ui.tab).toBe('check');
    expect(ui.focus?.path).toBe('references.precedingInvoices[0].id');
    expect(ui.refusServeur).toEqual({ form, appearance, issues });
    expect(texteDuMessage()).toBe(`${t.compte.emission.refus(2)} ${t.compte.emission.aucunNumero}`);
  });

  test('DATE : les dates admises, et le champ de la date', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    faux.invoke.mockResolvedValue(
      erreurHttp(409, {
        code: 'DATE',
        message: '',
        details: { min: '2026-11-02', max: AUJOURDHUI },
      }),
    );
    expect(await emettreSurServeur()).toBe(false);
    expect(store.get().ui.focus?.path).toBe('issueDate');
    expect(store.get().ui.tab).toBe('content');
    expect(texteDuMessage()).toBe(
      `${t.compte.emission.date('02/11/2026', '05/11/2026')} ${t.compte.emission.aucunNumero}`,
    );
  });

  test('401 : la connexion s’ouvre, la saisie reste', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    faux.invoke.mockResolvedValue(erreurHttp(401, { code: 'SESSION', message: '' }));
    expect(await emettreSurServeur()).toBe(false);
    expect(store.get().ui.compte?.session).toBe('expiree');
    expect(store.get().ui.connexion).toBe('connexion');
  });

  test('500 INTERNE : un message avec l’identifiant ; 5xx sans réponse lisible : issue incertaine', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    faux.invoke.mockResolvedValue(
      erreurHttp(500, { code: 'INTERNE', message: '', details: { requete: 'r-1' } }),
    );
    expect(await emettreSurServeur()).toBe(false);
    expect(texteDuMessage()).toBe(
      `${t.compte.erreurs.interne('r-1')} ${t.compte.emission.aucunNumero}`,
    );
    faux.invoke.mockResolvedValue(erreurHttp(504, '<html>Gateway Timeout</html>'));
    expect(await emettreSurServeur()).toBe(false);
    expect(texteDuMessage()).toBe(t.compte.emission.incertain);
  });

  test('corps trop grand : refusé avant l’envoi, le message dit de réduire les pièces jointes', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    setForm('attachments', [
      {
        uid: 'pj-1',
        id: 'PJ-1',
        description: 'Plan',
        uri: '',
        file: {
          name: 'plan.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array(Math.ceil((PLAFOND_CORPS * 3) / 4) + 1024),
        },
      },
    ]);
    expect(await emettreSurServeur()).toBe(false);
    expect(faux.invoke).not.toHaveBeenCalled();
    expect(texteDuMessage()).toBe(`${t.compte.emission.tropGros} ${t.compte.emission.aucunNumero}`);
  });

  test('le brouillon ne part pas (hors ligne) : rien n’est émis, sur aucune version', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    setForm('buyer.name', 'Saisie non envoyée');
    etat.refus = 'RESEAU';
    expect(await emettreSurServeur()).toBe(false);
    expect(faux.invoke).not.toHaveBeenCalled();
    expect(texteDuMessage()).toBe(
      `${t.compte.emission.nonEnregistre} ${t.compte.emission.aucunNumero}`,
    );
  });

  test('l’enregistrement préalable échoue sur un écran déjà reçu : rien n’est émis non plus', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    expect(await enregistrerMaintenant()).toBe(true);
    // Rien de neuf à l'écran, mais l'enregistrement qui précède l'émission ne passe pas.
    etat.refus = 'SESSION';
    expect(await emettreSurServeur()).toBe(false);
    expect(faux.invoke).not.toHaveBeenCalled();
  });

  test('frappe pendant l’enregistrement : on enregistre de nouveau, et la dernière saisie part', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    setForm('buyer.name', 'Avant');
    etat.pendantEcriture = () => setForm('buyer.name', 'Tapé pendant l’enregistrement');
    faux.invoke.mockResolvedValue(coupure());
    await emettreSurServeur();
    const corps = await corpsEnvoye();
    expect((corps.invoice as { buyer: { name: string } }).buyer.name).toBe(
      'Tapé pendant l’enregistrement',
    );
    // Ce qui part est ce que le serveur a reçu, à la version qu'il a.
    expect((etat.recu?.form as InvoiceForm | undefined)?.buyer.name).toBe(
      'Tapé pendant l’enregistrement',
    );
    expect(corps.version).toBe(etat.version);
    expect(etat.version).toBe(2);
  });

  test('l’exemple affiché n’est pas un brouillon : rien n’est émis', async () => {
    const { p } = fausseConservation();
    demarrer(p);
    store.set((s) => ({ ui: { ...s.ui, sample: true } }));
    expect(await emettreSurServeur()).toBe(false);
    expect(faux.invoke).not.toHaveBeenCalled();
    expect(texteDuMessage()).toBe(t.compte.emission.exemple);
  });

  test('issueInvoice, en mode compte, émet par le serveur', async () => {
    const { p, etat } = fausseConservation();
    demarrer(p);
    const { form, appearance } = store.get();
    etat.historique = [emise('f-1', 'F-2026-0007', form, appearance)];
    faux.invoke.mockResolvedValue(succes({ id: 'f-1', numero: 'F-2026-0007' }));
    const assets = { fonts: { regular: new Uint8Array(), bold: new Uint8Array() } };
    expect(await issueInvoice(assets, { record: true })).toBe(true);
    expect(faux.invoke).toHaveBeenCalledTimes(1);
    expect(store.get().ui.issued).toBe('f-1');
  });
});
