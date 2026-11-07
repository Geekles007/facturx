import { FunctionsFetchError, FunctionsRelayError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatDate, t } from '../i18n.js';
import { defaultCompany } from '../library.js';
import { sampleForm } from '../sample.js';
import { store } from '../store.js';
import { finDAttente } from './erreurs.js';
import { ajouterJours } from './periode.js';
import {
  DELAI_RELANCE_MS,
  type DonneesRelance,
  donneesDe,
  envoyerRelance,
  niveauPropose,
  peutEnvoyer,
  preparer,
  preparerRelance,
} from './relances.js';
import { aujourdhuiParis, relancesDe } from './suivi.js';
import {
  adminDeTest,
  compteDeTest,
  DONNEES_DE_TEST,
  insererFacture,
  LIGNE_EN_RETARD,
  refusDeFonction,
} from './test-aide.js';

/**
 * La relance d'une facture en retard : le modèle préparé dans la langue de la facture (sans pile),
 * l'adresse que le bouton laisse partir, le niveau proposé, d'où viennent les données, et ce que
 * chaque réponse de `relancer` veut dire (faux client) ; contre la pile, avec `relancer` servie et
 * le simulateur d'envoi (`BREVO_API_KEY=simule`, `FACTURX_EMETTRE=1`), le vrai contrat.
 */

/** Le client que `relances.ts` et `suivi.ts` emploient par `client()` : celui de l'essai en cours. */
const session = vi.hoisted(() => ({ sb: undefined as unknown }));
vi.mock('./client.js', () => ({ client: () => session.sb }));

const phrases = t.compte.relance;

/** Une phrase de refus, et ce qu'elle garantit : rien n'est parti. */
const sans = (texte: string) => `${texte} ${phrases.aucuneEnvoyee}`;

/** Les espaces insécables que `Intl` met dans les montants et les taux, en espaces simples. */
const espaces = (texte: string) => texte.replace(/[  ]/g, ' ');

const compteUi = (entrepriseId: string) => ({
  email: 'essai@facturx.test',
  confirme: true,
  entrepriseId,
  suppressionDemandeeLe: undefined,
  session: 'active' as const,
});

const uiAvant = store.get().ui;
const historiqueAvant = store.get().history;

afterEach(() => {
  store.set({ ui: uiAvant, history: historiqueAvant });
  session.sb = undefined;
});

/** Connecte la relance au client `sb`, pour l'entreprise `entrepriseId`. */
function connecter(sb: unknown, entrepriseId: string): void {
  session.sb = sb;
  store.set((s) => ({ ui: { ...s.ui, compte: compteUi(entrepriseId), connexion: undefined } }));
}

const DONNEES = DONNEES_DE_TEST;

/** `DONNEES` sans les champs `cles`. */
const sansCles = (...cles: (keyof DonneesRelance)[]): DonneesRelance =>
  Object.fromEntries(
    Object.entries(DONNEES).filter(([cle]) => !cles.includes(cle as keyof DonneesRelance)),
  ) as unknown as DonneesRelance;

describe('preparerRelance (sans pile)', () => {
  test('niveau 1 en français : numéro, échéance, reste dû au format fr-FR, sans pénalités', () => {
    const { objet, corps } = preparerRelance(DONNEES, 1, 'fr');
    expect(objet).toContain('F-2026-0042');
    expect(corps).toContain('F-2026-0042');
    expect(corps).toContain('11/10/2026');
    expect(corps).toContain(
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1234.56),
    );
    expect(espaces(corps)).toContain('1 234,56 €');
    expect(`${objet}\n${corps}`).not.toMatch(/pénalité/i);
    // La signature de l'entreprise.
    expect(corps.trimEnd().endsWith('Atelier Exemple SAS')).toBe(true);
  });

  test('niveau 3 : les pénalités au taux donné et l’indemnité de 40,00 €', () => {
    const corps = espaces(preparerRelance(DONNEES, 3, 'fr').corps);
    expect(corps).toMatch(/pénalités de retard/);
    expect(corps).toContain('10 %');
    expect(corps).toContain('40,00 €');
    expect(espaces(preparerRelance({ ...DONNEES, penalites: '12,5' }, 3, 'fr').corps)).toContain(
      '12,5 %',
    );
  });

  test('niveau 3 à un professionnel : le taux est annuel, comme sur la facture', () => {
    expect(espaces(preparerRelance(DONNEES, 3, 'fr').corps)).toContain(
      'pénalités de retard au taux annuel de 10 % et une indemnité forfaitaire pour frais de recouvrement de 40,00 €.',
    );
    expect(espaces(preparerRelance(DONNEES, 3, 'en').corps)).toContain(
      'late-payment penalties at an annual rate of 10% and a fixed recovery fee of €40.00.',
    );
  });

  test('niveau 3 sur une facture en USD : l’indemnité reste en euros (art. D441-5), le reste dû en USD', () => {
    const usd = { ...DONNEES, devise: 'USD' };
    const fr = espaces(preparerRelance(usd, 3, 'fr').corps);
    expect(fr).toContain('indemnité forfaitaire pour frais de recouvrement de 40,00 €');
    expect(fr).toContain(
      espaces(
        new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(1234.56),
      ),
    );
    expect(fr).not.toContain('40,00 $');
    const en = preparerRelance(usd, 3, 'en').corps;
    expect(en).toContain('fixed recovery fee of €40.00');
    expect(en).toContain('US$1,234.56');
    expect(en).not.toContain('US$40.00');
  });

  test('niveau 3 à un particulier : ni indemnité forfaitaire ni pénalités de retard', () => {
    for (const langue of ['fr', 'en'] as const) {
      const { objet, corps } = preparerRelance({ ...DONNEES, particulier: true }, 3, langue);
      expect(corps).not.toMatch(/pénalit|indemnit|penalt|recovery fee|%|40[,.]00|D441|L441/i);
      // Un rappel ferme, toujours : le dernier, avec la demande de règlement.
      expect(objet).toBe(preparerRelance(DONNEES, 3, langue).objet);
      expect(corps).toContain(langue === 'fr' ? 'dès réception' : 'upon receipt');
      expect(corps).toContain('IBAN');
    }
  });

  test('niveau 3 sans taux ni indemnité sur la facture : un renvoi à ses conditions, rien d’affirmé', () => {
    const fr = preparerRelance(sansCles('penalites', 'indemnite'), 3, 'fr').corps;
    expect(fr).toContain('Nous vous renvoyons aux conditions de paiement figurant sur la facture.');
    expect(fr).not.toMatch(/pénalit|indemnit|exigible|%|40,00/i);
    const en = preparerRelance(sansCles('penalites', 'indemnite'), 3, 'en').corps;
    expect(en).toContain('Please refer to the payment terms stated on the invoice.');
    expect(en).not.toMatch(/penalt|recovery fee|incurs|%|40\.00/i);
    // L'un sans l'autre : seul celui qui est inscrit est cité, et rien de l'autre.
    const sansTaux = espaces(preparerRelance(sansCles('penalites'), 3, 'fr').corps);
    expect(sansTaux).toContain('indemnité forfaitaire pour frais de recouvrement de 40,00 €');
    expect(sansTaux).not.toMatch(/pénalit|%/);
    const sansIndemnite = espaces(preparerRelance(sansCles('indemnite'), 3, 'fr').corps);
    expect(sansIndemnite).toContain('pénalités de retard au taux annuel de 10 %');
    expect(sansIndemnite).not.toMatch(/indemnit|40,00/);
  });

  test('chaque niveau a son objet et son ton ; le numéro est partout', () => {
    const relances = ([1, 2, 3] as const).map((n) => preparerRelance(DONNEES, n, 'fr'));
    expect(new Set(relances.map((r) => r.objet)).size).toBe(3);
    expect(new Set(relances.map((r) => r.corps)).size).toBe(3);
    for (const r of relances) expect(r.objet).toContain('F-2026-0042');
    expect(relances[1]?.corps).toMatch(/rappel/);
    expect(relances[2]?.objet).toMatch(/Dernier rappel/);
  });

  test('la version anglaise est en anglais, avec la date au format en-GB', () => {
    const { objet, corps } = preparerRelance(DONNEES, 1, 'en');
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 9, 11)),
    );
    expect(corps).toContain(date);
    expect(objet).toContain('F-2026-0042');
    expect(corps).toMatch(/invoice F-2026-0042/);
    expect(corps).toContain('€1,234.56');
    expect(`${objet}\n${corps}`).not.toMatch(/facture|Bonjour|Cordialement|échéance/);
    const dernier = espaces(preparerRelance(DONNEES, 3, 'en').corps);
    expect(dernier).toContain('10%');
    expect(dernier).toContain('€40.00');
    expect(preparerRelance(DONNEES, 3, 'en').objet).toMatch(/Final reminder/);
  });

  test('les montants sont dans la devise de la facture', () => {
    const usd = preparerRelance({ ...DONNEES, devise: 'USD' }, 1, 'fr').corps;
    expect(usd).toContain(
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(1234.56),
    );
    expect(usd).not.toContain('€');
  });

  test('sans IBAN, aucune ligne de coordonnées bancaires', () => {
    for (const langue of ['fr', 'en'] as const)
      for (const niveau of [1, 2, 3] as const) {
        const corps = preparerRelance(sansCles('iban'), niveau, langue).corps;
        expect(corps).not.toMatch(/IBAN|bancaires|bank details|référence|reference/i);
      }
    // Avec : l'IBAN par groupes de quatre, et la référence à rappeler (le numéro, à défaut).
    const avec = preparerRelance({ ...DONNEES, reference: 'RF18 5390 0754 7034' }, 1, 'fr').corps;
    expect(avec).toContain('FR76 3000 6000 0112 3456 7890 189');
    expect(avec).toContain('RF18 5390 0754 7034');
    expect(preparerRelance(sansCles('reference'), 1, 'en').corps).toMatch(
      /Reference to quote: F-2026-0042/,
    );
  });

  test('du texte brut : aucune balise dans le modèle ; ce qui est saisi passe tel quel', () => {
    for (const langue of ['fr', 'en'] as const)
      for (const niveau of [1, 2, 3] as const) {
        const { objet, corps } = preparerRelance(DONNEES, niveau, langue);
        expect(`${objet}${corps}`).not.toMatch(/[<>]/);
        expect(objet).not.toMatch(/[\r\n]/);
      }
    // Le serveur échappe le corps : le Studio n'y touche pas.
    expect(preparerRelance({ ...DONNEES, entreprise: 'A <b>&</b> B' }, 1, 'fr').corps).toContain(
      'A <b>&</b> B',
    );
  });
});

describe('peutEnvoyer (sans pile)', () => {
  test('destinataire vide : envoi désactivé', () => {
    expect(peutEnvoyer('')).toBe(false);
    expect(peutEnvoyer('  ')).toBe(false);
    expect(peutEnvoyer('client')).toBe(false);
    expect(peutEnvoyer(' compta@client.fr ')).toBe(true);
  });

  test('une seule adresse, sans rien qui en nomme une autre : ce que le serveur exige', () => {
    for (const adresse of ADRESSES_REFUSEES) expect(peutEnvoyer(adresse), adresse).toBe(false);
    for (const adresse of ADRESSES_ADMISES) expect(peutEnvoyer(adresse), adresse).toBe(true);
  });
});

/** Une adresse de `longueur` caractères (de 197 à 259), valide par ailleurs. */
function adresseDe(longueur: number): string {
  const debut = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.`;
  return `${debut}${'e'.repeat(longueur - debut.length - 3)}.fr`;
}

const ADRESSES_REFUSEES = [
  '',
  '  ',
  'client',
  'a@b.fr, c@d.fr',
  'a@b.fr,c@d.fr',
  'a@b.fr\nBcc: c@d.fr',
  'a@b.fr\r\nBcc: c@d.fr',
  'a@b.fr;c@d.fr',
  'a@b.fr c@d.fr',
  'a b@c.fr',
  'Compta <a@b.fr>',
  '<a@b.fr>',
  '"a"@b.fr',
  'a@b',
  'a@b.f',
  'a@b.1fr',
  'a@@b.fr',
  'a@b@c.fr',
  '@b.fr',
  'a@',
  'a@b..fr',
  'a@.b.fr',
  '.a@b.fr',
  'a.@b.fr',
  'a..b@c.fr',
  'a@-b.fr',
  'a@b-.fr',
  'compta@société.fr',
  'comptà@client.fr',
  `${'a'.repeat(65)}@b.fr`,
  `a@${'b'.repeat(64)}.fr`,
  adresseDe(255),
];

const ADRESSES_ADMISES = [
  'compta@client.fr',
  ' compta@client.fr ',
  'compta@client.fr\n',
  'COMPTA@CLIENT.FR',
  'prenom.nom+relances@sous.domaine.fr',
  "o'brien@client.ie",
  'a_b%c&d=e-f@b.co',
  'compta@xn--socit-esa.fr',
  'a@b.xn--p1ai',
  'a@1-2.fr',
  `${'a'.repeat(64)}@b.fr`,
  `a@${'b'.repeat(63)}.fr`,
  adresseDe(254),
];

describe('le niveau et les données de la relance (sans pile)', () => {
  test('le niveau proposé : les relances envoyées plus un, au plus 3 ; les refusées ne comptent pas', () => {
    const envoyee = { etat: 'envoyee' as const };
    const refusee = { etat: 'refusee' as const };
    expect(niveauPropose([])).toBe(1);
    expect(niveauPropose([envoyee])).toBe(2);
    expect(niveauPropose([refusee, envoyee, refusee])).toBe(2);
    expect(niveauPropose([envoyee, envoyee])).toBe(3);
    expect(niveauPropose([envoyee, envoyee, envoyee, envoyee, envoyee])).toBe(3);
    expect(niveauPropose([refusee, refusee, refusee])).toBe(1);
  });

  const ligne = LIGNE_EN_RETARD;

  /** Un profil d'entreprise à lui : son nom, son IBAN, ses conditions par défaut. */
  function profil() {
    const company = defaultCompany();
    company.seller = { ...company.seller, name: 'Atelier Profil' };
    company.paymentMeans = [
      {
        ...(company.paymentMeans[0] as (typeof company.paymentMeans)[0]),
        iban: 'fr14 2004 1010 0505 0001 3m02 606',
      },
    ];
    company.defaults = { ...company.defaults, latePenaltyRate: '8', recoveryIndemnity: '40' };
    return company;
  }

  test('la facture d’abord : son IBAN, sa référence, ses pénalités et son indemnité', () => {
    const form = sampleForm('2026-09-11');
    form.paymentTerms = {
      ...form.paymentTerms,
      mode: 'structured',
      latePenaltyRate: '12,5',
      recoveryIndemnity: '40',
    };
    form.remittanceInformation = 'RF18 5390 0754 7034';
    expect(donneesDe(ligne, form, profil())).toEqual({
      numero: 'F-2026-0042',
      echeance: '2026-10-11',
      resteDu: 123456,
      devise: 'EUR',
      entreprise: 'Atelier Profil',
      iban: 'FR7630006000011234567890189',
      reference: 'RF18 5390 0754 7034',
      penalites: '12,5',
      indemnite: 4000,
    });
  });

  test('conditions en texte libre : ni taux ni indemnité inventés ; sans nom au profil, celui de la facture', () => {
    const form = sampleForm('2026-09-11');
    form.paymentTerms = { ...form.paymentTerms, mode: 'text', text: 'Paiement à 30 jours.' };
    form.remittanceInformation = '';
    const company = profil();
    company.seller = { ...company.seller, name: '  ' };
    const d = donneesDe(ligne, form, company);
    expect(d).not.toHaveProperty('penalites');
    expect(d).not.toHaveProperty('indemnite');
    expect(d).not.toHaveProperty('reference');
    expect(d.entreprise).toBe(form.seller.name);
  });

  test('un acheteur particulier est signalé ; un professionnel ne l’est pas', () => {
    const form = sampleForm('2026-09-11');
    expect(donneesDe(ligne, form, profil())).not.toHaveProperty('particulier');
    form.buyer = { ...form.buyer, consumer: true };
    expect(donneesDe(ligne, form, profil())).toMatchObject({ particulier: true });
  });

  test('la facture illisible (ou sans ces champs) : l’IBAN et le nom du profil, jamais ses pénalités', () => {
    // Le profil a un taux et une indemnité, que la facture ne porte peut-être pas : rien n'est cité.
    const attendu = {
      numero: 'F-2026-0042',
      echeance: '2026-10-11',
      resteDu: 123456,
      devise: 'EUR',
      entreprise: 'Atelier Profil',
      iban: 'FR1420041010050500013M02606',
    };
    expect(donneesDe(ligne, undefined, profil())).toEqual(attendu);
    // Une facture enregistrée sans formulaire complet (`{}`) ne casse rien.
    expect(donneesDe(ligne, {} as never, profil())).toEqual(attendu);
    // Aucun IBAN nulle part : pas de coordonnées bancaires.
    const company = profil();
    company.paymentMeans = [];
    expect(donneesDe(ligne, undefined, company)).not.toHaveProperty('iban');
  });
});

// ---------- l'envoi, faux client ----------

const refusDe = refusDeFonction;

/** Une anomalie (422) de code `code` sur `path`, avec le texte du serveur (en français). */
const anomalie = (code: string, path: string) => ({
  code: 'ANOMALIES',
  message: 'Texte du serveur',
  details: [{ code, path, message: 'Texte du serveur' }],
});

describe('envoyerRelance (faux client)', () => {
  const invoke = vi.fn();
  const ENVOI = {
    factureId: 'f-1',
    destinataire: ' compta@client.fr ',
    objet: 'Rappel : facture F-1',
    corps: 'Bonjour,\n\nLa facture F-1…',
  };

  beforeEach(() => {
    invoke.mockReset();
    connecter({ functions: { invoke } }, 'e-1');
  });

  test('201 : envoyée, au niveau du serveur ; l’adresse part sans ses espaces, le reste tel quel', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'r-1', niveau: 2 }, error: null });
    expect(await envoyerRelance(ENVOI)).toEqual({ kind: 'envoyee', niveau: 2 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('relancer', {
      body: { ...ENVOI, destinataire: 'compta@client.fr' },
      timeout: DELAI_RELANCE_MS,
    });
  });

  test('201 `incertain` : peut-être partie, jamais « envoyée »', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'r-1', niveau: 1, incertain: true }, error: null });
    expect(await envoyerRelance(ENVOI)).toEqual({ kind: 'incertaine' });
  });

  test('pas de réponse lisible (réseau, passerelle, délai) : peut-être partie', async () => {
    const reponses = [
      { data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) },
      { data: null, error: new FunctionsRelayError(new Response('', { status: 502 })) },
      refusDe(503, '<html>Service Unavailable</html>'),
      refusDe(504, { message: 'upstream timeout' }),
      refusDe(546, { code: 'WORKER_LIMIT', message: 'x' }),
      { data: { id: 'r-1' }, error: null },
      { data: null, error: null },
    ];
    for (const r of reponses) {
      invoke.mockResolvedValueOnce(r);
      expect(await envoyerRelance(ENVOI)).toEqual({ kind: 'sansReponse' });
    }
    invoke.mockRejectedValueOnce(new Error('inattendu'));
    expect(await envoyerRelance(ENVOI)).toEqual({ kind: 'sansReponse' });
  });

  test('chaque code d’erreur a sa phrase de l’interface, et ce qu’il laisse faire', async () => {
    const refus = phrases.refus;
    const erreurs = t.compte.erreurs;
    const cas: [number, unknown, Record<string, unknown>][] = [
      [403, { code: 'DROITS' }, { texte: sans(refus.droits) }],
      [
        403,
        { code: 'NON_CONFIRME' },
        { texte: sans(erreurs.nonConfirme), action: 'renvoyerConfirmation' },
      ],
      [403, { code: 'SUPPRESSION' }, { texte: sans(erreurs.suppression) }],
      [
        422,
        anomalie('SIREN', 'company.seller.siren'),
        { texte: sans(refus.siren), action: 'entreprise' },
      ],
      [422, anomalie('PAS_DE_RETARD', 'factureId'), { texte: sans(refus.pasDeRetard) }],
      [
        422,
        anomalie('DESTINATAIRE', 'destinataire'),
        { texte: sans(refus.destinataire), champ: 'destinataire' },
      ],
      [
        422,
        anomalie('CORPS', 'destinataire'),
        { texte: sans(refus.destinataire), champ: 'destinataire' },
      ],
      [422, anomalie('CORPS', 'objet'), { texte: sans(refus.objet), champ: 'objet' }],
      [422, anomalie('CORPS', 'corps'), { texte: sans(refus.corps), champ: 'corps' }],
      [422, anomalie('CORPS', 'factureId'), { texte: sans(refus.illisible) }],
      [422, anomalie('CORPS', ''), { texte: sans(refus.illisible) }],
      [422, anomalie('NOUVEAU', 'x'), { texte: sans(erreurs.inconnue) }],
      [422, { code: 'ANOMALIES', details: 'x' }, { texte: sans(erreurs.inconnue) }],
      [413, anomalie('CORPS', ''), { texte: sans(refus.corps), champ: 'corps' }],
      [429, { code: 'LIMITE' }, { texte: sans(refus.limite(undefined)) }],
      [502, { code: 'ENVOI' }, { texte: erreurs.envoi }],
      [
        500,
        { code: 'INTERNE', details: { requete: 'req-1' } },
        { texte: erreurs.interne('req-1') },
      ],
      [418, { code: 'THEIERE' }, { texte: sans(erreurs.inconnue) }],
      [400, { message: 'sans code' }, { texte: sans(erreurs.inconnue) }],
      [409, { code: 'BROUILLON_MODIFIE' }, { texte: sans(erreurs.inconnue) }],
    ];
    for (const [statut, corps, attendu] of cas) {
      invoke.mockResolvedValueOnce(
        refusDe(statut, { message: 'Texte du serveur', ...(corps as object) }),
      );
      const issue = await envoyerRelance(ENVOI);
      expect({ statut, corps, issue }).toEqual({
        statut,
        corps,
        issue: { kind: 'refus', refus: attendu },
      });
      // Jamais le texte du serveur, qui n'est qu'en français.
      expect(JSON.stringify(issue)).not.toContain('Texte du serveur');
    }
  });

  test('429 : la limite, avec la date et l’heure où réessayer', async () => {
    const apres = new Date(Date.now() + 72 * 3600 * 1000);
    invoke.mockResolvedValueOnce(
      refusDe(429, {
        code: 'LIMITE',
        message: 'Cette facture a déjà été relancée…',
        details: { reessayerApres: apres.toISOString() },
      }),
    );
    const moment = finDAttente({ reessayerApres: apres.toISOString() });
    const jour = [apres.getFullYear(), apres.getMonth() + 1, apres.getDate()]
      .map((n) => String(n).padStart(2, '0'))
      .join('-');
    expect(moment).toContain(formatDate(jour));
    expect(await envoyerRelance(ENVOI)).toEqual({
      kind: 'refus',
      refus: { texte: sans(phrases.refus.limite(moment)) },
    });
  });

  test('429 : la limite que la réponse nomme, chacune sa phrase ; sans cause connue, la générique', async () => {
    const apres = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const moment = finDAttente({ reessayerApres: apres });
    for (const cause of ['delai', 'jour', 'tentatives', 'verrou'] as const) {
      invoke.mockResolvedValueOnce(
        refusDe(429, { code: 'LIMITE', message: '', details: { reessayerApres: apres, cause } }),
      );
      expect(await envoyerRelance(ENVOI)).toEqual({
        kind: 'refus',
        refus: { texte: sans(phrases.refus.limites[cause](moment)) },
      });
    }
    // Quatre phrases distinctes, et distinctes de la générique.
    const textes = Object.values(phrases.refus.limites).map((f) => f(moment));
    expect(new Set([...textes, phrases.refus.limite(moment)]).size).toBe(5);
    expect(phrases.refus.limites.delai(moment)).toContain(moment);
    expect(phrases.refus.limites.verrou(moment)).toMatch(/quelques secondes/);
    // Une cause absente, inconnue ou mal formée : le message générique.
    for (const details of [
      { reessayerApres: apres },
      { reessayerApres: apres, cause: 'autre' },
      { reessayerApres: apres, cause: 3 },
      { reessayerApres: apres, cause: null },
    ]) {
      invoke.mockResolvedValueOnce(refusDe(429, { code: 'LIMITE', message: '', details }));
      expect(await envoyerRelance(ENVOI)).toEqual({
        kind: 'refus',
        refus: { texte: sans(phrases.refus.limite(moment)) },
      });
    }
  });

  test('401 : la session est dite expirée, et la connexion s’ouvre', async () => {
    for (const corps of [{ code: 'SESSION', message: '' }, { msg: 'Invalid JWT' }]) {
      store.set((s) => ({ ui: { ...s.ui, compte: compteUi('e-1'), connexion: undefined } }));
      invoke.mockResolvedValueOnce(refusDe(401, corps));
      expect(await envoyerRelance(ENVOI)).toEqual({
        kind: 'refus',
        refus: { texte: sans(phrases.refus.session) },
      });
      expect(store.get().ui).toMatchObject({
        connexion: 'connexion',
        compte: { session: 'expiree' },
      });
    }
  });
});

// ---------- contre la pile ----------

const pile = !process.env.SUPABASE_URL || process.env.FACTURX_EMETTRE !== '1';

describe.skipIf(pile)('la relance contre la pile, `relancer` servie (simulateur d’envoi)', () => {
  const J = aujourdhuiParis();

  /** Un compte connecté dont l'entreprise a un nom et un SIREN : ce qu'il faut pour relancer. */
  async function relanceur(siren = '443061841') {
    const { sb, entrepriseId } = await compteDeTest();
    connecter(sb, entrepriseId);
    const admin = adminDeTest();
    const lu = await admin.from('entreprises').select('profil').eq('id', entrepriseId).single();
    if (lu.error) throw new Error(`profil : ${lu.error.message}`);
    const profil = (lu.data as { profil: { seller?: object } | null }).profil ?? {};
    const ecrit = await admin
      .from('entreprises')
      .update({ profil: { ...profil, seller: { ...profil.seller, siren, name: 'Atelier Essai' } } })
      .eq('id', entrepriseId);
    if (ecrit.error) throw new Error(`profil : ${ecrit.error.message}`);
    return entrepriseId;
  }

  /** Une facture échue depuis dix jours, avec son PDF (la relance le joint). */
  const enRetard = (entrepriseId: string, clientEmail?: string) =>
    insererFacture(entrepriseId, {
      prefixe: 'R',
      emission: ajouterJours(J, -40),
      echeance: ajouterJours(J, -10),
      pdf: true,
      ...(clientEmail ? { clientEmail } : {}),
    });

  const relancer = (factureId: string, destinataire: string) =>
    envoyerRelance({
      factureId,
      destinataire,
      objet: 'Rappel : facture impayée',
      corps: 'Bonjour,\n\nLa facture reste impayée.\n\nCordialement',
    });

  test('`peutEnvoyer` et `relancer` s’accordent : le bouton ne s’active pas sur une adresse refusée', async () => {
    await relanceur();
    // Une facture inconnue : une adresse admise passe la lecture du corps et tombe sur `DROITS`, une
    // adresse refusée s'arrête à `DESTINATAIRE`. Rien n'est envoyé.
    const inconnue = crypto.randomUUID();
    for (const adresse of [...ADRESSES_REFUSEES, ...ADRESSES_ADMISES]) {
      const issue = await relancer(inconnue, adresse);
      const attendu = peutEnvoyer(adresse)
        ? { texte: sans(phrases.refus.droits) }
        : { texte: sans(phrases.refus.destinataire), champ: 'destinataire' };
      expect({ adresse, issue }).toEqual({ adresse, issue: { kind: 'refus', refus: attendu } });
    }
  }, 120_000);

  test('une relance part, consignée « envoyée » ; la suivante, aussitôt, montre la limite et sa date', async () => {
    const entrepriseId = await relanceur();
    const factureId = await enRetard(entrepriseId, 'compta@client-demo.fr');

    const preparee = await preparer(factureId);
    expect(preparee).toMatchObject({
      factureId,
      niveau: 1,
      enRetard: true,
      destinataire: 'compta@client-demo.fr',
    });
    if (!preparee) throw new Error('relance non préparée');
    const issue = await envoyerRelance(preparee);
    expect(issue).toEqual({ kind: 'envoyee', niveau: 1 });
    const relances = await relancesDe(factureId);
    expect(relances.map((r) => [r.niveau, r.etat, r.incertaine, r.destinataire, r.objet])).toEqual([
      [1, 'envoyee', false, 'compta@client-demo.fr', preparee.objet],
    ]);
    // La suivante serait de niveau 2…
    expect((await preparer(factureId))?.niveau).toBe(2);
    // … mais elle attend 72 heures : la limite, avec la date et l'heure, et rien de consigné.
    const libre = new Date(Date.parse(relances[0]?.envoyeeLe ?? '') + 72 * 3600 * 1000);
    const moment = finDAttente({ reessayerApres: libre.toISOString() });
    expect(moment).toMatch(/\d/);
    expect(await envoyerRelance(preparee)).toEqual({
      kind: 'refus',
      refus: { texte: sans(phrases.refus.limites.delai(moment)) },
    });
    expect(await relancesDe(factureId)).toHaveLength(1);
  }, 60_000);

  test('`incertain.test` : le service n’a pas répondu ; peut-être partie, consignée, et comptée', async () => {
    const entrepriseId = await relanceur();
    const factureId = await enRetard(entrepriseId);
    expect((await preparer(factureId))?.destinataire).toBe('');
    expect(await relancer(factureId, 'compta@incertain.test')).toEqual({ kind: 'incertaine' });
    const relances = await relancesDe(factureId);
    expect(relances.map((r) => [r.etat, r.incertaine])).toEqual([['envoyee', true]]);
    // Elle compte dans la limite : la suivante attend 72 heures.
    const libre = new Date(Date.parse(relances[0]?.envoyeeLe ?? '') + 72 * 3600 * 1000);
    expect(await relancer(factureId, 'compta@client-demo.fr')).toEqual({
      kind: 'refus',
      refus: {
        texte: sans(
          phrases.refus.limites.delai(finDAttente({ reessayerApres: libre.toISOString() })),
        ),
      },
    });
  }, 60_000);

  test('`refus.test` : refusée par le service d’envoi, consignée « refusée », sans compter', async () => {
    const entrepriseId = await relanceur();
    const factureId = await enRetard(entrepriseId);
    expect(await relancer(factureId, 'compta@refus.test')).toEqual({
      kind: 'refus',
      refus: { texte: t.compte.erreurs.envoi },
    });
    expect((await relancesDe(factureId)).map((r) => [r.etat, r.incertaine])).toEqual([
      ['refusee', false],
    ]);
    expect((await preparer(factureId))?.niveau).toBe(1);
  }, 60_000);

  test('sans SIREN : ouvrir l’entreprise ; une facture qui n’est pas en retard : refusée', async () => {
    const entrepriseId = await relanceur('');
    const factureId = await enRetard(entrepriseId);
    expect(await relancer(factureId, 'compta@client.fr')).toEqual({
      kind: 'refus',
      refus: { texte: sans(phrases.refus.siren), action: 'entreprise' },
    });
    const aVenir = await insererFacture(entrepriseId, {
      prefixe: 'R',
      echeance: ajouterJours(J, 5),
    });
    expect((await preparer(aVenir))?.enRetard).toBe(false);
    expect(await relancer(aVenir, 'compta@client.fr')).toEqual({
      kind: 'refus',
      refus: { texte: sans(phrases.refus.pasDeRetard) },
    });
    expect(await relancesDe(factureId)).toEqual([]);
  }, 60_000);
});
