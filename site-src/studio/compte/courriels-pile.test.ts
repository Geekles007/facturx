import { describe, expect, test } from 'vitest';
import { adminDeTest, clientAnonyme, compteDeTest, courrielRecu } from './test-aide.js';

/**
 * Les e-mails du compte, tels que la pile les envoie : chaque flux d'Auth est déclenché pour de bon
 * et son e-mail lu dans Mailpit. C'est la seule preuve que Supabase accepte les gabarits de
 * supabase/templates/, qu'il évalue `.Data.langue` dans l'objet comme dans le corps, et que les
 * variables (`.ConfirmationURL`, `.Email`, `.NewEmail`, `.Token`) s'y remplissent. La pile doit
 * avoir été démarrée avec le config.toml du dépôt : une pile plus ancienne envoie les e-mails par
 * défaut de Supabase, en anglais, et ces tests le disent.
 *
 * Chaque test prend une adresse neuve : aucun ne lit l'e-mail d'un autre.
 */

const adresseNeuve = () => `essai-${crypto.randomUUID()}@facturx.test`;

/** Le lien que le titulaire suit : celui de la vérification d'Auth, dans un `href`. */
const LIEN_DE_VERIFICATION = /href="[^"]*\/auth\/v1\/verify\?[^"]+"/;

/** La langue de l'e-mail, telle que le gabarit l'écrit dans `<html lang>`. */
const langueDuCourriel = (html: string) => /<html lang="(\w+)">/.exec(html)?.[1];

describe.skipIf(!process.env.MAILPIT_URL || !process.env.SUPABASE_URL)(
  'Les e-mails du compte, contre la pile (Mailpit)',
  // L'e-mail peut mettre quelques secondes à arriver (10 s au plus) : le délai de 5 s de Vitest
  // couperait `courrielRecu` avant qu'il nomme l'adresse qui n'a rien reçu.
  { timeout: 30_000 },
  () => {
    describe('confirmation, à l’inscription', () => {
      const FRANCAIS = { lang: 'fr', objet: 'Confirmez votre adresse e-mail' };
      const ANGLAIS = { lang: 'en', objet: 'Confirm your email address' };

      test.each([
        { nom: 'langue « en » : en anglais', data: { langue: 'en' }, ...ANGLAIS },
        { nom: 'langue « fr » : en français', data: { langue: 'fr' }, ...FRANCAIS },
        { nom: 'sans langue : en français', data: {}, ...FRANCAIS },
        {
          nom: 'langue qui n’est pas un texte (42) : en français',
          data: { langue: 42 },
          ...FRANCAIS,
        },
        { nom: 'langue qui est un objet : en français', data: { langue: { a: 1 } }, ...FRANCAIS },
      ])('$nom', async ({ data, lang, objet }) => {
        const adresse = adresseNeuve();
        const { error } = await clientAnonyme().auth.signUp({
          email: adresse,
          password: crypto.randomUUID(),
          options: {
            data: { cgu: '2026-11', ...data },
            emailRedirectTo: 'http://localhost:8080/studio/',
          },
        });
        expect(error).toBeNull();

        const courriel = await courrielRecu(adresse);
        expect(courriel.Subject).toBe(objet);
        expect(langueDuCourriel(courriel.HTML)).toBe(lang);
        expect(courriel.HTML).toMatch(LIEN_DE_VERIFICATION);
      });
    });

    test('mot de passe oublié : en anglais pour un compte dont la langue est « en »', async () => {
      const { sb, email, userId } = await compteDeTest();
      const langue = await adminDeTest().auth.admin.updateUserById(userId, {
        user_metadata: { langue: 'en' },
      });
      expect(langue.error).toBeNull();

      const { error } = await sb.auth.resetPasswordForEmail(email);
      expect(error).toBeNull();

      const courriel = await courrielRecu(email);
      expect(courriel.Subject).toBe('Reset your password');
      expect(langueDuCourriel(courriel.HTML)).toBe('en');
      expect(courriel.HTML).toMatch(LIEN_DE_VERIFICATION);
    });

    test('changement d’adresse : un e-mail à chaque adresse, qui les cite toutes deux', async () => {
      const { sb, email, userId } = await compteDeTest();
      const nouvelle = adresseNeuve();
      const { error } = await sb.auth.updateUser({ email: nouvelle, data: { langue: 'en' } });
      expect(error).toBeNull();

      // La double confirmation : l'ancienne adresse et la nouvelle reçoivent chacune le leur.
      for (const adresse of [email, nouvelle]) {
        const courriel = await courrielRecu(adresse);
        expect(courriel.Subject, adresse).toBe('Confirm your email change');
        expect(langueDuCourriel(courriel.HTML), adresse).toBe('en');
        expect(courriel.HTML, adresse).toContain(email);
        expect(courriel.HTML, adresse).toContain(nouvelle);
        expect(courriel.HTML, adresse).toMatch(LIEN_DE_VERIFICATION);
      }

      // `data` s'ajoute aux métadonnées du compte (spec § 5.2) : les CGU acceptées y restent.
      const { data } = await adminDeTest().auth.admin.getUserById(userId);
      expect(data.user?.user_metadata.cgu).toBe('2026-11');
      expect(data.user?.user_metadata.langue).toBe('en');
    });

    test('lien de connexion : en français pour un compte sans langue', async () => {
      const { sb, email } = await compteDeTest();
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      expect(error).toBeNull();

      const courriel = await courrielRecu(email);
      expect(courriel.Subject).toBe('Votre lien de connexion');
      expect(langueDuCourriel(courriel.HTML)).toBe('fr');
      expect(courriel.HTML).toMatch(LIEN_DE_VERIFICATION);
    });

    test('réauthentification : le code à six chiffres', async () => {
      const { sb, email } = await compteDeTest();
      const { error } = await sb.auth.reauthenticate();
      expect(error).toBeNull();

      const courriel = await courrielRecu(email);
      expect(courriel.Subject).toBe('Votre code de vérification');
      expect(langueDuCourriel(courriel.HTML)).toBe('fr');
      // Le code est seul dans son paragraphe : `>123456<`. Un « \d{6} » partout ailleurs
      // reconnaîtrait aussi les couleurs de la feuille de style (`#000000`).
      expect(courriel.HTML).toMatch(/>\s*\d{6}\s*</);
    });
  },
);
