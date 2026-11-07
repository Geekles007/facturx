// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import {
  type Appearance,
  defaultAppearance,
  defaultNumbering,
  type Numbering,
} from '../library.js';
import { rangSaisi, saisirRang } from '../librarypanel.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { store } from '../store.js';
import { changerLogo, retirerLogo } from './entreprise.js';
import { refusDuLogo, supabasePersistence } from './persistence.js';
import { compteDeTest, conservationEnMemoire } from './test-aide.js';

/**
 * La page Entreprise (spec § 10) : la numérotation, dont le prochain rang ne descend pas sous celui
 * du serveur, refusé avant tout envoi ; le logo des prochaines factures, refusé avant l'envoi s'il
 * pèse plus de 1 Mio ou si ses octets ne sont ni ceux d'un PNG ni ceux d'un JPEG (spec § 11).
 */

vi.mock('./client.js', () => ({ client: () => undefined }));

const MIO = 1024 * 1024;
/** Des octets qui commencent comme un PNG, un JPEG, un GIF, une police TrueType. */
const signe = (debut: number[], taille: number): Uint8Array => {
  const octets = new Uint8Array(taille);
  octets.set(debut);
  return octets;
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const TTF = [0x00, 0x01, 0x00, 0x00];

const uiAvant = store.get().ui;

beforeEach(() => {
  store.set((s) => ({
    numbering: { ...defaultNumbering(), next: 10, year: 2026 },
    appearance: { ...defaultAppearance(), accent: '#ab0000' },
    ui: {
      ...s.ui,
      storage: 'ok',
      toast: undefined,
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId: 'e-1',
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    },
  }));
});

afterEach(() => {
  utiliser(indexedDbPersistence);
  store.set({ ui: uiAvant, numbering: defaultNumbering(), appearance: defaultAppearance() });
});

describe('la numérotation : le prochain rang ne recule pas', () => {
  test('sans compte, comme avant : un entier de 1 au moins', () => {
    expect(rangSaisi('12')).toEqual({ rang: 12 });
    expect(rangSaisi('0')).toEqual({ rang: 1 });
    expect(rangSaisi('abc')).toEqual({ rang: 1 });
  });

  test('avec un compte : plus bas que le rang du serveur, refusé ; égal ou plus haut, admis', () => {
    expect(rangSaisi('7', 10)).toEqual({ refus: 10 });
    expect(rangSaisi('', 10)).toEqual({ refus: 10 });
    expect(rangSaisi('10', 10)).toEqual({ rang: 10 });
    expect(rangSaisi('42', 10)).toEqual({ rang: 42 });
  });

  test('un rang refusé ne touche pas la numérotation : rien ne part', () => {
    const avant = store.get().numbering;
    expect(saisirRang('7', 10)).toEqual({ refus: 10 });
    expect(store.get().numbering).toBe(avant);
    expect(saisirRang('12', 10)).toBeUndefined();
    expect(store.get().numbering).toEqual({ ...avant, next: 12 });
  });
});

describe.skipIf(!process.env.SUPABASE_URL)('la numérotation contre la pile', () => {
  test('le rang du serveur, relu ou écrit, est le plus bas qu’on puisse saisir', async () => {
    const { sb, entrepriseId } = await compteDeTest();
    const p = supabasePersistence(sb, entrepriseId);
    const lue = (await p.get<Numbering>('numbering')) as Numbering;
    expect(p.numerotationDuServeur()?.next).toBe(lue.next);
    await p.set('numbering', { ...lue, next: 25 });
    expect(p.numerotationDuServeur()?.next).toBe(25);
    store.set({ numbering: { ...lue, next: 25 } });
    expect(saisirRang('24', p.numerotationDuServeur()?.next)).toEqual({ refus: 25 });
    expect(store.get().numbering.next).toBe(25);
    // Le serveur aurait refusé de même : la base ne laisse pas reculer `prochain`.
    await expect(p.set('numbering', { ...lue, next: 24 })).rejects.toMatchObject({
      detail: 'NUMEROTATION_RECUL',
    });
  });
});

describe('le logo : 1 Mio au plus, PNG ou JPEG d’après ses octets', () => {
  test('les octets décident, jamais l’extension ni le type annoncé', () => {
    expect(refusDuLogo(signe(PNG, 2048))).toBeUndefined();
    expect(refusDuLogo(signe(JPEG, MIO))).toBeUndefined();
    expect(refusDuLogo(signe(PNG, MIO + 1))).toBe('TAILLE');
    expect(refusDuLogo(signe(GIF, 2048))).toBe('TYPE');
    // Une police TrueType passe dans le bucket, pas comme logo.
    expect(refusDuLogo(signe(TTF, 2048))).toBe('TYPE');
  });

  test('trop lourd ou mal signé : refusé avant l’envoi, et dit', async () => {
    const { p, journal } = conservationEnMemoire();
    utiliser(p);
    expect(
      await changerLogo({ bytes: signe(PNG, MIO + 1), type: 'png', name: 'gros.png' }),
    ).toBeUndefined();
    expect(store.get().ui.toast?.text).toBe(t.compte.entreprise.logoTropGros);
    expect(
      await changerLogo({ bytes: signe(GIF, 2048), type: 'png', name: 'faux.png' }),
    ).toBeUndefined();
    expect(store.get().ui.toast?.text).toBe(t.compte.entreprise.logoType);
    expect(journal).toEqual([]);
  });

  test('admis : déposé, puis posé sur l’apparence des prochaines factures', async () => {
    const { p, kv, fichiers, journal } = conservationEnMemoire();
    utiliser(p);
    const logo = await changerLogo({ bytes: signe(PNG, 2048), type: 'png', name: 'logo.png' });
    expect(logo?.name).toBe('logo.png');
    const cle = logo?.key ?? '';
    expect(fichiers.get(cle)?.length).toBe(2048);
    expect(journal).toEqual([`setFile ${cle}`, 'set appearance-default']);
    // Sans apparence par défaut, celle de la facture ouverte sert de base, comme pour une facture vierge.
    const defaut = kv.get('appearance-default') as Appearance;
    expect(defaut.accent).toBe('#ab0000');
    expect(defaut.logo).toEqual({
      key: cle,
      type: 'png',
      position: 'left',
      height: 44,
      name: 'logo.png',
    });
    expect(store.get().ui.toast?.text).toBe(t.compte.entreprise.logoEnregistre);

    // Un nouveau logo garde la position et la taille choisies ; le retirer n'enlève que lui.
    kv.set('appearance-default', {
      ...defaut,
      logo: { ...defaut.logo, position: 'right', height: 60 },
    });
    const second = await changerLogo({ bytes: signe(JPEG, 4096), type: 'jpeg', name: 'b.jpg' });
    expect((kv.get('appearance-default') as Appearance).logo).toEqual({
      key: second?.key,
      type: 'jpeg',
      position: 'right',
      height: 60,
      name: 'b.jpg',
    });
    expect(await retirerLogo()).toBe(true);
    const sans = kv.get('appearance-default') as Appearance;
    expect(sans.logo).toBeUndefined();
    expect(sans.accent).toBe('#ab0000');
  });
});
