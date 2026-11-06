// Le miroir du brouillon vit dans IndexedDB : le faux doit exister avant l'évaluation de storage.ts.
import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { t } from '../i18n.js';
import {
  type ClientRecord,
  type CompanyProfile,
  defaultAppearance,
  defaultCompany,
  type Numbering,
  type ProductRecord,
  type SavedInvoice,
} from '../library.js';
import { blankForm, blankParty } from '../model.js';
import { contratPersistence } from '../persistence.contract.js';
import { indexedDbPersistence, utiliser } from '../storage.js';
import { type Loaded, setForm, startPersistence, store, ui } from '../store.js';
import { duplicateForm, quitterLeBrouillon, startDraft } from '../workflows.js';
import { abandonnerSaisie } from './brouillons.js';
import { type Miroir, supabasePersistence } from './persistence.js';
import { adminDeTest, compteDeTest, perimerJeton } from './test-aide.js';

type Brouillon = NonNullable<Loaded['draft']>;

/** Un brouillon tel que le Studio l'enregistre, avec une pièce jointe : des octets dans le JSON. */
function brouillon(client: string): Brouillon {
  const form = blankForm('2026-11-04');
  form.id = 'F-2026-0001';
  form.buyer = { ...blankParty(), name: client };
  form.attachments = [
    {
      uid: 'pj-1',
      id: 'BC-17',
      description: 'Bon de commande',
      uri: '',
      file: {
        name: 'bc.pdf',
        mimeType: 'application/pdf',
        bytes: Uint8Array.of(0x25, 0x50, 0, 255),
      },
    },
  ];
  return { form, appearance: { ...defaultAppearance(), accent: '#0a7f5a' } };
}

/** La seule ligne de `brouillons` de l'entreprise, lue par le client de service. */
async function ligneDuBrouillon(entrepriseId: string) {
  const { data, error } = await adminDeTest()
    .from('brouillons')
    .select('id, form, version')
    .eq('entreprise_id', entrepriseId);
  if (error) throw error;
  return data as { id: string; form: { buyer: { name: string } }; version: number }[];
}

const nomDuMiroir = (entrepriseId: string) => `draft-compte-${entrepriseId}`;

/** `b` tel que le serveur le garde : formulaire et apparence en JSON portable. */
function portable(b: Brouillon): { form: unknown; appearance: unknown } {
  return JSON.parse(
    JSON.stringify({ form: b.form, appearance: b.appearance }, (_, v) =>
      v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString('base64') } : v,
    ),
  );
}

describe.skipIf(!process.env.SUPABASE_URL)('Persistance du compte, contre la pile locale', () => {
  contratPersistence(
    'Supabase',
    async () => {
      const { sb, entrepriseId } = await compteDeTest();
      return supabasePersistence(sb, entrepriseId);
    },
    { emission: 'serveur' },
  );

  describe('brouillon', () => {
    test('version périmée : conflit signalé, rien d’écrasé', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const premier = supabasePersistence(sb, entrepriseId);
      await premier.set('draft', brouillon('Premier'));
      // Un second onglet ouvre le même brouillon, à sa version 1.
      const second = supabasePersistence(sb, entrepriseId);
      expect((await second.get<Brouillon>('draft'))?.form.buyer.name).toBe('Premier');

      await premier.set('draft', brouillon('Premier, modifié'));
      await expect(second.set('draft', brouillon('Second, sur la version 1'))).rejects.toThrow(
        'BROUILLON_MODIFIE',
      );

      const lignes = await ligneDuBrouillon(entrepriseId);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.form.buyer.name).toBe('Premier, modifié');
      expect(lignes[0]?.version).toBe(2);
    });

    test('insertion, puis mise à jour sur la version lue ; les octets reviennent intacts', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      expect(await p.get('draft')).toBeUndefined();

      const ecrit = brouillon('Atelier des Lilas');
      await p.set('draft', ecrit);
      const [ligne] = await ligneDuBrouillon(entrepriseId);
      expect(ligne?.version).toBe(1);
      expect(p.brouillonCourant()).toEqual({ id: ligne?.id, version: 1 });
      expect(await indexedDbPersistence.get(`brouillon-courant-${entrepriseId}`)).toBe(ligne?.id);

      // Un autre démarrage relit le même brouillon, pièce jointe comprise.
      const relu = await supabasePersistence(sb, entrepriseId).get<Brouillon>('draft');
      expect(relu).toEqual(ecrit);

      const modifie = brouillon('Atelier des Lilas, SARL');
      await p.set('draft', modifie);
      expect(p.brouillonCourant()?.version).toBe(2);
      // Le même contenu une seconde fois, dans un autre objet : rien ne part, la version reste.
      await p.set('draft', structuredClone(modifie));
      expect((await ligneDuBrouillon(entrepriseId))[0]?.version).toBe(2);
    });

    test('l’exemple et une facture émise affichée ne sont pas des brouillons du serveur', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      await p.set('draft', { ...brouillon('Exemple'), sample: true });
      expect(await ligneDuBrouillon(entrepriseId)).toHaveLength(0);
      await p.set('draft', brouillon('Ouvert'));
      const ouvert = p.brouillonCourant();
      await p.set('draft', { ...brouillon('Émise'), issued: 'facture-1' });
      // Le brouillon ouvert reste le même, intact, sous la vue.
      expect(p.brouillonCourant()).toEqual(ouvert);
      expect((await ligneDuBrouillon(entrepriseId)).map((l) => l.form.buyer.name)).toEqual([
        'Ouvert',
      ]);
      // Le démarrage suivant affiche de nouveau la facture émise.
      const relu = await supabasePersistence(sb, entrepriseId).get<Brouillon>('draft');
      expect(relu?.issued).toBe('facture-1');
    });

    test('401 à l’enregistrement : le miroir local garde la saisie', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const arreter = demarrerLeStudio(supabasePersistence(sb, entrepriseId), entrepriseId);
      try {
        perimerJeton(sb);
        setForm('buyer.name', 'Saisi pendant la session expirée');
        await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));
        expect(store.get().ui.connexion).toBe('connexion');

        const miroir = await indexedDbPersistence.get<Miroir>(nomDuMiroir(entrepriseId));
        expect(miroir?.form.buyer.name).toBe('Saisi pendant la session expirée');
        expect(miroir?.envoye).toBe(false);
        expect(await ligneDuBrouillon(entrepriseId)).toHaveLength(0);
      } finally {
        arreter();
      }
    });

    test('après la reconnexion, le brouillon gardé part au serveur', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const arreter = demarrerLeStudio(supabasePersistence(sb, entrepriseId), entrepriseId);
      try {
        const retablir = perimerJeton(sb);
        setForm('buyer.name', 'Saisi pendant la session expirée');
        await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));

        // Reconnexion : une session valable, et `ui.compte.session` redevient active.
        retablir();
        const compte = store.get().ui.compte;
        if (compte) ui({ compte: { ...compte, session: 'active' }, connexion: undefined });
        await vi.waitFor(async () => {
          const lignes = await ligneDuBrouillon(entrepriseId);
          expect(lignes[0]?.form.buyer.name).toBe('Saisi pendant la session expirée');
        });
        const miroir = await indexedDbPersistence.get<Miroir>(nomDuMiroir(entrepriseId));
        expect(miroir?.envoye).toBe(true);
      } finally {
        arreter();
      }
    });

    test('au démarrage, la saisie du miroir plus récente que le serveur est reprise et rejouée', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      await avant.set('draft', brouillon('Version 1'));
      const retablir = perimerJeton(sb);
      await expect(avant.set('draft', brouillon('Tapé, jamais parvenu'))).rejects.toThrow(
        'SESSION',
      );
      retablir();

      // Le Studio rouvert (après reconnexion) : le miroir l'emporte, et le magasin le renvoie.
      const apres = supabasePersistence(sb, entrepriseId);
      expect((await apres.get<Brouillon>('draft'))?.form.buyer.name).toBe('Tapé, jamais parvenu');
      expect((apres.saisieEnAttente() as Brouillon).form.buyer.name).toBe('Tapé, jamais parvenu');
      const arreter = demarrerLeStudio(apres, entrepriseId);
      try {
        await vi.waitFor(async () => {
          const [ligne] = await ligneDuBrouillon(entrepriseId);
          expect(ligne?.form.buyer.name).toBe('Tapé, jamais parvenu');
          expect(ligne?.version).toBe(2);
        });
        expect(apres.saisieEnAttente()).toBeUndefined();
      } finally {
        arreter();
      }
    });

    test('au démarrage, sa propre écriture dont la réponse s’est perdue n’est pas un conflit', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const avant = supabasePersistence(sb, entrepriseId);
      await avant.set('draft', brouillon('Version 1'));
      const id = avant.brouillonCourant()?.id as string;
      // L'écriture de la version 2 est arrivée, mais pas sa réponse : le miroir la croit en attente.
      const v2 = brouillon('Version 2, réponse perdue');
      await adminDeTest()
        .from('brouillons')
        .update(portable(v2))
        .eq('entreprise_id', entrepriseId)
        .eq('id', id);
      await indexedDbPersistence.set(nomDuMiroir(entrepriseId), {
        ...v2,
        brouillon: { id, version: 1 },
        idPrevu: id,
        envoye: false,
      });

      const apres = supabasePersistence(sb, entrepriseId);
      expect(await apres.get<Brouillon>('draft')).toEqual(v2);
      expect(apres.saisieEnAttente()).toBeUndefined();
      expect(apres.brouillonCourant()).toEqual({ id, version: 2 });
      await apres.set('draft', brouillon('Version 3'));
      expect((await ligneDuBrouillon(entrepriseId))[0]?.version).toBe(3);
    });

    test('une insertion rejouée après une réponse perdue retrouve sa ligne', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const saisie = brouillon('Nouveau, réponse perdue');
      const idPrevu = crypto.randomUUID();
      // L'insertion est arrivée, pas sa réponse : le miroir n'a que l'identifiant prévu.
      const insertion = await adminDeTest()
        .from('brouillons')
        .insert({ id: idPrevu, entreprise_id: entrepriseId, ...portable(saisie) });
      expect(insertion.error).toBeNull();
      await indexedDbPersistence.set(nomDuMiroir(entrepriseId), {
        ...saisie,
        idPrevu,
        envoye: false,
      });

      const apres = supabasePersistence(sb, entrepriseId);
      const relu = (await apres.get<Brouillon>('draft')) as Brouillon;
      await apres.set('draft', relu);
      const lignes = await ligneDuBrouillon(entrepriseId);
      expect(lignes.map((l) => [l.id, l.version])).toEqual([[idPrevu, 1]]);
      expect(apres.brouillonCourant()).toEqual({ id: idPrevu, version: 1 });
    });

    test('la saisie ne part pas : nouveau et ouvrir sont refusés, puis acceptés quand elle part', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      await p.set('draft', brouillon('Ouvert'));
      const autre = await adminDeTest()
        .from('brouillons')
        .insert({ entreprise_id: entrepriseId, ...portable(brouillon('Autre')) })
        .select('id')
        .single();
      const retablir = perimerJeton(sb);
      const tape = brouillon('Tapé hors session');
      await expect(p.set('draft', tape)).rejects.toThrow('SESSION');

      // L'écran montre une saisie que le serveur n'a pas : on ne quitte pas ce brouillon.
      expect(p.quitterBrouillon(tape)).toBe(false);
      await expect(p.ouvrirBrouillon(autre.data?.id, () => tape)).rejects.toMatchObject({
        code: 'EN_ATTENTE',
        detail: 'EN_COURS',
      });
      const miroir = await indexedDbPersistence.get<Miroir>(nomDuMiroir(entrepriseId));
      expect([miroir?.form.buyer.name, miroir?.envoye]).toEqual(['Tapé hors session', false]);

      // La session revient : la saisie part, puis le changement de document passe.
      retablir();
      await p.set('draft', tape);
      expect((await p.ouvrirBrouillon(autre.data?.id, () => tape))?.form.buyer.name).toBe('Autre');
      const lignes = await ligneDuBrouillon(entrepriseId);
      expect(lignes.map((l) => l.form.buyer.name).sort()).toEqual(['Autre', 'Tapé hors session']);
    });

    test('onglet fermé juste après « nouveau » : la saisie jamais partie reprend au démarrage', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const ancien = brouillon('Ancien');
      await p.set('draft', ancien);
      expect(p.quitterBrouillon(ancien)).toBe(true);
      const retablir = perimerJeton(sb);
      await expect(p.set('draft', brouillon('Nouveau, hors session'))).rejects.toThrow('SESSION');
      retablir();

      // Rouvert : la saisie non partie l'emporte sur le brouillon le plus récent du serveur.
      const rouvert = supabasePersistence(sb, entrepriseId);
      const relu = await rouvert.get<Brouillon>('draft');
      expect(relu?.form.buyer.name).toBe('Nouveau, hors session');
      await rouvert.set('draft', rouvert.saisieEnAttente());
      const noms = (await ligneDuBrouillon(entrepriseId)).map((l) => l.form.buyer.name);
      expect(noms.sort()).toEqual(['Ancien', 'Nouveau, hors session']);
    });

    test('réseau lent : l’écriture en file d’un brouillon n’est pas sautée pour un autre document', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      await p.set('draft', brouillon('A, version 1'));
      // Les mises à jour mettent 300 ms à partir.
      const fetchOrigine = globalThis.fetch;
      globalThis.fetch = async (entree, init) => {
        if (init?.method === 'PATCH') await new Promise((r) => setTimeout(r, 300));
        return fetchOrigine(entree, init);
      };
      try {
        const lente = p.set('draft', brouillon('A, version 2'));
        // Pendant l'envoi, une facture émise s'affiche, puis un nouveau brouillon commence.
        const emise = { ...brouillon('Émise'), issued: 'facture-1' };
        await p.set('draft', emise);
        await p.envoisTermines();
        expect(p.quitterBrouillon(emise)).toBe(true);
        await p.set('draft', brouillon('B'));
        await lente;
      } finally {
        globalThis.fetch = fetchOrigine;
      }
      const noms = (await ligneDuBrouillon(entrepriseId)).map((l) => l.form.buyer.name);
      expect(noms.sort()).toEqual(['A, version 2', 'B']);
    });

    test('frappe pendant l’aller-retour de « Dupliquer » : elle part sur l’original, rien ne se perd', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const arreter = demarrerLeStudio(p, entrepriseId, 1000);
      const fetchOrigine = globalThis.fetch;
      try {
        setForm('buyer.name', 'A');
        await vi.waitFor(
          async () => expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe('A'),
          { timeout: 3000 },
        );
        const idA = p.brouillonCourant()?.id;
        setForm('buyer.name', 'A modifié');
        // Les mises à jour mettent 300 ms à partir ; on tape 50 ms après « Dupliquer ».
        globalThis.fetch = async (entree, init) => {
          if (init?.method === 'PATCH') await new Promise((r) => setTimeout(r, 300));
          return fetchOrigine(entree, init);
        };
        const fini = startDraft(duplicateForm(store.get().form));
        await new Promise((r) => setTimeout(r, 50));
        setForm('buyer.name', 'A modifié, tapé pendant');
        expect(await fini).toBe(true);
        globalThis.fetch = fetchOrigine;
        await vi.waitFor(
          async () => {
            const lignes = await ligneDuBrouillon(entrepriseId);
            expect(lignes.find((l) => l.id === idA)?.form.buyer.name).toBe(
              'A modifié, tapé pendant',
            );
          },
          { timeout: 3000 },
        );
      } finally {
        globalThis.fetch = fetchOrigine;
        arreter();
      }
    }, 15_000);

    test('brouillon refusé (caractère nul) : la cause est dite, puis « abandonner » libère', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const arreter = demarrerLeStudio(p, entrepriseId);
      vi.stubGlobal('confirm', () => true);
      try {
        setForm('buyer.name', 'Propre');
        await vi.waitFor(async () =>
          expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe('Propre'),
        );
        // Un caractère nul collé (invisible) : jsonb le refuse, 4xx.
        setForm('buyer.name', 'Avec\u0000nul');
        await vi.waitFor(() => expect(store.get().ui.brouillonRefuse).toBeTruthy());
        const cause = store.get().ui.brouillonRefuse as string;
        expect(await quitterLeBrouillon()).toBe(false);
        expect(store.get().ui.toast?.text).toBe(t.compte.conservation.enAttente.refus(cause));

        await abandonnerSaisie();
        expect(store.get().form.buyer.name).toBe('Propre');
        expect(store.get().ui.brouillonRefuse).toBeUndefined();
        expect(await quitterLeBrouillon()).toBe(true);
        const miroir = await indexedDbPersistence.get<Miroir>(nomDuMiroir(entrepriseId));
        expect([miroir?.form.buyer.name, miroir?.envoye]).toEqual(['Propre', true]);
        expect(supabasePersistence(sb, entrepriseId).saisieEnAttente()).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
        arreter();
      }
    });

    test('première insertion refusée : « abandonner » laisse une facture vierge, rien n’attend', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const arreter = demarrerLeStudio(p, entrepriseId);
      vi.stubGlobal('confirm', () => true);
      try {
        setForm('buyer.name', 'Nul\u0000dès le début');
        await vi.waitFor(() => expect(store.get().ui.brouillonRefuse).toBeTruthy());
        await abandonnerSaisie();
        expect(store.get().form.buyer.name).toBe('');
        expect(await quitterLeBrouillon()).toBe(true);
        // La facture vierge est le nouveau brouillon ; la saisie refusée n'est nulle part.
        const noms = (await ligneDuBrouillon(entrepriseId)).map((l) => l.form.buyer.name);
        expect(noms).toEqual(['']);
        const rouvert = supabasePersistence(sb, entrepriseId);
        await rouvert.get('draft');
        expect(rouvert.saisieEnAttente()).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
        arreter();
      }
    });

    test('refusé ou en conflit, supprimer le seul brouillon le fait disparaître pour de bon', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const arreter = demarrerLeStudio(p, entrepriseId);
      try {
        setForm('buyer.name', 'Ma version');
        await vi.waitFor(async () =>
          expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe('Ma version'),
        );
        const id = p.brouillonCourant()?.id as string;
        await adminDeTest()
          .from('brouillons')
          .update({ form: { ...blankForm('2026-11-04'), buyer: { name: 'Ailleurs' } } })
          .eq('id', id);
        setForm('buyer.name', 'Ma version 2');
        await vi.waitFor(() => expect(store.get().ui.conflit).toBe(true));

        await p.supprimerBrouillon(id);
        // L'éditeur montre encore le brouillon supprimé : ses minuteries ne le font pas renaître.
        setForm('buyer.name', 'Ma version 3');
        expect(await quitterLeBrouillon()).toBe(true);
        expect(await ligneDuBrouillon(entrepriseId)).toEqual([]);
        expect(await indexedDbPersistence.get(nomDuMiroir(entrepriseId))).toBeUndefined();
        const rouvert = supabasePersistence(sb, entrepriseId);
        expect(await rouvert.get('draft')).toBeUndefined();
        expect(rouvert.saisieEnAttente()).toBeUndefined();
      } finally {
        arreter();
      }
    });

    test('une ligne déjà là sous notre identifiant, modifiée depuis, n’est pas écrasée', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const idPrevu = crypto.randomUUID();
      // La ligne existe sous l'identifiant prévu, et quelqu'un l'a modifiée (version 2).
      await adminDeTest()
        .from('brouillons')
        .insert({ id: idPrevu, entreprise_id: entrepriseId, ...portable(brouillon('Inséré')) });
      await adminDeTest()
        .from('brouillons')
        .update(portable(brouillon('Modifié ailleurs')))
        .eq('id', idPrevu);
      await indexedDbPersistence.set(nomDuMiroir(entrepriseId), {
        ...brouillon('Ma saisie'),
        idPrevu,
        envoye: false,
      });

      const apres = supabasePersistence(sb, entrepriseId);
      const relu = (await apres.get<Brouillon>('draft')) as Brouillon;
      await expect(apres.set('draft', relu)).rejects.toThrow('BROUILLON_MODIFIE');
      const [ligne] = await ligneDuBrouillon(entrepriseId);
      expect([ligne?.form.buyer.name, ligne?.version]).toEqual(['Modifié ailleurs', 2]);
    });

    test('une facture émise affichée ne remplace ni la saisie en attente ni son miroir', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      await p.set('draft', brouillon('Version 1'));
      const retablir = perimerJeton(sb);
      await expect(p.set('draft', brouillon('Tapé hors session'))).rejects.toThrow('SESSION');
      await p.set('draft', { ...brouillon('Émise'), issued: 'facture-1' });

      const miroir = await indexedDbPersistence.get<Miroir>(nomDuMiroir(entrepriseId));
      expect([miroir?.form.buyer.name, miroir?.envoye]).toEqual(['Tapé hors session', false]);
      // Rouvert : la facture émise s'affiche, la saisie attend toujours, et part au retour.
      retablir();
      const rouvert = supabasePersistence(sb, entrepriseId);
      expect((await rouvert.get<Brouillon>('draft'))?.issued).toBe('facture-1');
      const saisie = rouvert.saisieEnAttente() as Brouillon;
      expect(saisie.form.buyer.name).toBe('Tapé hors session');
      await rouvert.set('draft', saisie);
      expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe('Tapé hors session');
    });

    test('Dupliquer sur un brouillon en crée un autre ; l’original reste intact', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const arreter = demarrerLeStudio(supabasePersistence(sb, entrepriseId), entrepriseId);
      try {
        setForm('buyer.name', 'Original');
        await vi.waitFor(async () => {
          expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe('Original');
        });
        expect(await startDraft(duplicateForm(store.get().form))).toBe(true);
        setForm('buyer.name', 'Copie');
        await vi.waitFor(async () => {
          const noms = (await ligneDuBrouillon(entrepriseId)).map((l) => l.form.buyer.name);
          expect(noms.sort()).toEqual(['Copie', 'Original']);
        });
      } finally {
        arreter();
      }
    });

    test('session expirée : Dupliquer est refusé, la saisie reste et part après la reconnexion', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const arreter = demarrerLeStudio(supabasePersistence(sb, entrepriseId), entrepriseId);
      try {
        const retablir = perimerJeton(sb);
        setForm('buyer.name', 'Tapé hors session');
        await vi.waitFor(() => expect(store.get().ui.compte?.session).toBe('expiree'));
        expect(await startDraft(duplicateForm(store.get().form))).toBe(false);
        expect(store.get().form.buyer.name).toBe('Tapé hors session');

        retablir();
        const compte = store.get().ui.compte;
        if (compte) ui({ compte: { ...compte, session: 'active' }, connexion: undefined });
        await vi.waitFor(async () => {
          const lignes = await ligneDuBrouillon(entrepriseId);
          expect(lignes.map((l) => l.form.buyer.name)).toEqual(['Tapé hors session']);
        });
      } finally {
        arreter();
      }
    });

    test('au démarrage, une saisie locale sur une version dépassée ne remplace rien', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const ici = supabasePersistence(sb, entrepriseId);
      await ici.set('draft', brouillon('Version 1'));
      const retablir = perimerJeton(sb);
      await expect(ici.set('draft', brouillon('Tapé ici, hors session'))).rejects.toThrow(
        'SESSION',
      );
      retablir();
      // Pendant ce temps, un autre appareil (une autre base IndexedDB) enregistre la version 2.
      await adminDeTest()
        .from('brouillons')
        .update({ form: { ...brouillon('Version 2, ailleurs').form, attachments: [] } })
        .eq('entreprise_id', entrepriseId);

      // Ce navigateur rouvert affiche sa saisie, et son enregistrement signale le conflit.
      const rouvert = supabasePersistence(sb, entrepriseId);
      expect((await rouvert.get<Brouillon>('draft'))?.form.buyer.name).toBe(
        'Tapé ici, hors session',
      );
      await expect(rouvert.set('draft', brouillon('Tapé ici, encore'))).rejects.toThrow(
        'BROUILLON_MODIFIE',
      );
      expect((await ligneDuBrouillon(entrepriseId))[0]?.form.buyer.name).toBe(
        'Version 2, ailleurs',
      );
    });

    test('conflit : recharger la version du serveur, ou garder la sienne après relecture', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const premier = supabasePersistence(sb, entrepriseId);
      await premier.set('draft', brouillon('Premier'));
      const second = supabasePersistence(sb, entrepriseId);
      await second.get('draft');
      await premier.set('draft', brouillon('Premier, modifié'));
      await expect(second.set('draft', brouillon('Second'))).rejects.toThrow('BROUILLON_MODIFIE');

      expect((await second.rechargerBrouillon())?.form.buyer.name).toBe('Premier, modifié');
      expect(second.brouillonCourant()?.version).toBe(2);

      await premier.set('draft', brouillon('Premier, encore'));
      await second.imposerBrouillon(brouillon('Second, imposé'));
      const [ligne] = await ligneDuBrouillon(entrepriseId);
      expect(ligne?.form.buyer.name).toBe('Second, imposé');
      expect(ligne?.version).toBe(4);
    });

    test('brouillons : lister, ouvrir, nouveau, supprimer', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const premierClient = brouillon('Premier client');
      await p.set('draft', premierClient);
      const premier = p.brouillonCourant()?.id;
      expect(p.quitterBrouillon(premierClient)).toBe(true);
      expect(p.brouillonCourant()).toBeUndefined();
      const secondClient = brouillon('Second client');
      await p.set('draft', secondClient);
      const second = p.brouillonCourant()?.id;
      expect(second).not.toBe(premier);

      const liste = await p.brouillons();
      expect(liste.map((b) => b.client)).toEqual(['Second client', 'Premier client']);
      expect(liste[0]).toMatchObject({ id: second, numero: 'F-2026-0001', version: 1 });

      const ouvert = await p.ouvrirBrouillon(premier ?? '', () => secondClient);
      expect(ouvert?.form.buyer.name).toBe('Premier client');
      expect(p.brouillonCourant()).toEqual({ id: premier, version: 1 });

      await p.supprimerBrouillon(premier ?? '');
      expect(p.brouillonCourant()).toBeUndefined();
      // Ce que l'éditeur montre encore du brouillon supprimé ne part plus nulle part.
      await p.set('draft', brouillon('Premier client, encore'));
      expect(p.quitterBrouillon(brouillon('Premier client, encore'))).toBe(true);
      expect((await p.brouillons()).map((b) => b.id)).toEqual([second]);
      // Le démarrage suivant, sans brouillon ouvert, reprend le plus récent.
      expect(
        (await supabasePersistence(sb, entrepriseId).get<Brouillon>('draft'))?.form.buyer.name,
      ).toBe('Second client');
    });
  });

  describe('entreprise et numérotation', () => {
    test('entreprise, apparence et numérotation vont dans leurs colonnes', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const entreprise: CompanyProfile = {
        ...defaultCompany(),
        seller: { ...blankParty(), name: 'Atelier des Lilas', siren: '552100554' },
      };
      const apparence = { ...defaultAppearance(), template: 'modern' as const };
      await p.set('company', entreprise);
      await p.set('appearance-default', apparence);
      const anneeAvant = (await p.get<Numbering>('numbering'))?.year;
      await p.set('numbering', { pattern: 'FA-{AAAA}-{NNN}', next: 12, yearly: false, year: 1999 });

      const admin = adminDeTest();
      const ligne = await admin
        .from('entreprises')
        .select('profil, apparence_defaut')
        .eq('id', entrepriseId)
        .single();
      expect(ligne.data?.profil).toEqual(entreprise);
      expect(ligne.data?.apparence_defaut).toEqual(apparence);
      const numerotation = await admin
        .from('numerotation')
        .select('gabarit, prochain, annuelle, annee')
        .eq('entreprise_id', entrepriseId)
        .single();
      // `annee` n'appartient qu'à l'émission : le Studio ne l'envoie jamais.
      expect(numerotation.data).toEqual({
        gabarit: 'FA-{AAAA}-{NNN}',
        prochain: 12,
        annuelle: false,
        annee: anneeAvant,
      });

      const relu = supabasePersistence(sb, entrepriseId);
      expect(await relu.get('company')).toEqual(entreprise);
      expect(await relu.get('appearance-default')).toEqual(apparence);
      expect(await relu.get('numbering')).toEqual({
        pattern: 'FA-{AAAA}-{NNN}',
        next: 12,
        yearly: false,
        year: anneeAvant,
      });
    });

    test('la numérotation ne recule pas : le serveur refuse, la valeur ne part pas', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const numerotation = (await p.get<Numbering>('numbering')) as Numbering;
      await p.set('numbering', { ...numerotation, next: 12 });
      await expect(p.set('numbering', { ...numerotation, next: 3 })).rejects.toMatchObject({
        code: 'REFUS',
        detail: 'NUMEROTATION_RECUL',
      });
      expect((await p.get<Numbering>('numbering'))?.next).toBe(12);
    });

    test('un gabarit changé n’envoie pas un rang périmé', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const lue = (await p.get<Numbering>('numbering')) as Numbering;
      // L'émission avance le rang sur le serveur pendant que le Studio garde l'ancien.
      await adminDeTest()
        .from('numerotation')
        .update({ prochain: 40 })
        .eq('entreprise_id', entrepriseId);
      await p.set('numbering', { ...lue, pattern: 'F{AA}-{NNNN}' });
      expect(await supabasePersistence(sb, entrepriseId).get('numbering')).toMatchObject({
        pattern: 'F{AA}-{NNNN}',
        next: 40,
      });
    });
  });

  describe('clients, catalogue, factures et fichiers', () => {
    test('clients et produits : clé (entreprise_id, id), nom et e-mail tirés de la fiche', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const client: ClientRecord = {
        uid: 'c-17',
        party: {
          ...blankParty(),
          name: 'Atelier des Lilas',
          contact: { name: '', phone: '', email: 'compta@lilas.test' },
        },
        updatedAt: '2026-11-04T09:30:00.000Z',
      };
      const produit: ProductRecord = {
        uid: 'p-3',
        name: 'Journée de conseil',
        description: '',
        unitCode: 'DAY',
        unitPrice: '650.00',
        vat: 'S:20',
        sellerItemId: '',
        updatedAt: '2026-11-04T09:30:00.000Z',
      };
      expect(await p.put('clients', client)).toBe('c-17');
      expect(await p.put('products', produit)).toBe('p-3');

      const admin = adminDeTest();
      const c = await admin
        .from('clients')
        .select('id, nom, email')
        .eq('entreprise_id', entrepriseId);
      expect(c.data).toEqual([
        { id: 'c-17', nom: 'Atelier des Lilas', email: 'compta@lilas.test' },
      ]);
      const r = await admin.from('produits').select('id, nom').eq('entreprise_id', entrepriseId);
      expect(r.data).toEqual([{ id: 'p-3', nom: 'Journée de conseil' }]);

      // Le même uid dans une autre entreprise est un autre client.
      const autre = await compteDeTest();
      await supabasePersistence(autre.sb, autre.entrepriseId).put('clients', {
        ...client,
        party: { ...client.party, name: 'Un autre' },
      });
      expect(await p.list<ClientRecord>('clients')).toEqual([client]);
    });

    test('put(invoices) lève EMISSION_SERVEUR', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const facture = { uid: 'f-1' } as SavedInvoice;
      await expect(p.put('invoices', facture)).rejects.toThrow('EMISSION_SERVEUR');
    });

    test('list(invoices) rend les factures émises, et getFile leur PDF', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const emise = brouillon('Atelier des Lilas');
      const id = crypto.randomUUID();
      const admin = adminDeTest();
      const membre = await admin
        .from('membres')
        .select('user_id')
        .eq('entreprise_id', entrepriseId);
      const pdf = new TextEncoder().encode('%PDF-1.7 émis par le serveur');
      const depot = await admin.storage
        .from('factures')
        .upload(`${entrepriseId}/${id}.pdf`, pdf, { contentType: 'application/pdf' });
      expect(depot.error).toBeNull();
      // Comme `emettre` : le formulaire et l'apparence en JSON portable.
      const portable = JSON.parse(
        JSON.stringify(emise, (_, v) =>
          v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString('base64') } : v,
        ),
      );
      const insertion = await admin.from('factures').insert({
        id,
        entreprise_id: entrepriseId,
        numero: 'F-2026-0007',
        type_code: '380',
        date_emission: '2026-11-04',
        client_nom: 'Atelier des Lilas',
        devise: 'EUR',
        ht: 65_000,
        ttc: 78_000,
        net_a_payer: 78_000,
        invoice: {},
        form: portable.form,
        appearance: portable.appearance,
        pdf_chemin: `${entrepriseId}/${id}.pdf`,
        sdk_version: 'essai',
        origine: 'emise',
        emise_le: '2026-11-04T09:30:00Z',
        emise_par: membre.data?.[0]?.user_id,
      });
      expect(insertion.error).toBeNull();

      const p = supabasePersistence(sb, entrepriseId);
      expect(await p.list<SavedInvoice>('invoices')).toEqual([
        {
          uid: id,
          status: 'issued',
          form: emise.form,
          appearance: emise.appearance,
          summary: {
            id: 'F-2026-0007',
            typeCode: '380',
            issueDate: '2026-11-04',
            buyerName: 'Atelier des Lilas',
            currency: 'EUR',
            total: 78_000,
            due: 78_000,
          },
          issuedAt: '2026-11-04T09:30:00.000Z',
        },
      ]);
      expect(Array.from((await p.getFile(`pdf-${id}`)) ?? [])).toEqual(Array.from(pdf));
      expect(await p.getFile(`pdf-${crypto.randomUUID()}`)).toBeUndefined();
      await expect(p.setFile(`pdf-${id}`, pdf)).rejects.toThrow('EMISSION_SERVEUR');
    });

    test('setFile annonce le type lu dans les octets, et refuse le reste', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      await p.setFile('logo-1', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1));
      await p.setFile('logo-2', Uint8Array.of(0xff, 0xd8, 0xff, 1));
      await p.setFile('font-1', Uint8Array.of(0x00, 0x01, 0x00, 0x00, 1));
      const { data } = await adminDeTest().storage.from('fichiers').list(entrepriseId);
      const types = Object.fromEntries(
        (data ?? []).map((o) => [o.name, (o.metadata as { mimetype: string }).mimetype]),
      );
      expect(types).toEqual({
        'logo-1': 'image/png',
        'logo-2': 'image/jpeg',
        'font-1': 'font/ttf',
      });

      await expect(p.setFile('logo-3', Uint8Array.of(0x3c, 0x73, 0x76, 0x67))).rejects.toThrow(
        'FICHIER',
      );
      const logoTropLourd = new Uint8Array(1024 * 1024 + 1);
      logoTropLourd.set([0x89, 0x50, 0x4e, 0x47]);
      await expect(p.setFile('logo-4', logoTropLourd)).rejects.toThrow('FICHIER');
    });

    test('dump : la forme de la sauvegarde locale, sans les PDF', async () => {
      const { sb, entrepriseId } = await compteDeTest();
      const p = supabasePersistence(sb, entrepriseId);
      const ecrit = brouillon('Atelier des Lilas');
      await p.set('draft', ecrit);
      await p.setFile('logo-1', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1));
      const copie = await p.dump();
      expect(Object.keys(copie).sort()).toEqual(['clients', 'files', 'invoices', 'kv', 'products']);
      const kv = copie.kv as Record<string, unknown>;
      expect(kv.draft).toEqual(ecrit);
      expect(kv.company).toBeDefined();
      expect(kv.numbering).toMatchObject({ pattern: 'F-{AAAA}-{NNNN}', next: 1 });
      expect(Object.keys(copie.files as object)).toEqual(['logo-1']);
    });
  });
});

/**
 * Le Studio connecté, tel que `main.tsx` le démarre : la persistance du compte derrière `storage`,
 * `ui.compte` renseigné, l'enregistrement sans délai. Rend de quoi tout remettre en l'état.
 */
function demarrerLeStudio(
  p: ReturnType<typeof supabasePersistence>,
  entrepriseId: string,
  delai = 0,
): () => void {
  utiliser(p);
  const avant = store.get().ui;
  store.set((s) => ({
    form: blankForm('2026-11-04'),
    ui: {
      ...s.ui,
      storage: 'ok',
      issued: undefined,
      sample: false,
      conflit: false,
      reseau: 'ok',
      connexion: undefined,
      compte: {
        email: 'essai@facturx.test',
        confirme: true,
        entrepriseId,
        suppressionDemandeeLe: undefined,
        session: 'active',
      },
    },
  }));
  const arreter = startPersistence({ delai });
  return () => {
    arreter();
    utiliser(indexedDbPersistence);
    store.set({ ui: avant });
  };
}
