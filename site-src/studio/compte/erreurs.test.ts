import { describe, expect, test } from 'vitest';
import { t } from '../i18n.js';
import { reaction } from './erreurs.js';

/** Le tableau du § 13 de la spec : chaque statut et chaque code donne sa réaction. */
describe('reaction', () => {
  test.each([
    [401, 'SESSION', 'connexion'],
    [403, 'NON_CONFIRME', 'message'],
    [409, 'BROUILLON_MODIFIE', 'recharger'],
    [409, 'DATE', 'date'],
    [422, 'ANOMALIES', 'controle'],
    [429, 'LIMITE', 'message'],
    [502, 'ENVOI', 'message'],
    [500, 'INTERNE', 'message'],
  ])('%i %s → %s', (statut, code, kind) =>
    expect(
      reaction(statut, {
        code,
        message: '',
        details: code === 'ANOMALIES' ? [] : code === 'DATE' ? { max: '2026-11-05' } : undefined,
      }).kind,
    ).toBe(kind),
  );

  test.each([
    [413, 'ANOMALIES', 'message'],
    [409, 'DOUBLON', 'message'],
    [403, 'SUPPRESSION', 'message'],
    [403, 'DROITS', 'message'],
    [409, 'PDF_DEJA_DEPOSE', 'message'],
    [418, 'THEIERE', 'message'],
    [500, 'WORKER_LIMIT', 'message'],
    [404, '', 'message'],
  ])('%i %s → %s', (statut, code, kind) =>
    expect(reaction(statut, { code, message: '' }).kind).toBe(kind),
  );

  test('NON_CONFIRME : le message propose de renvoyer la confirmation (§ 13)', () => {
    expect(reaction(403, { code: 'NON_CONFIRME', message: '' })).toEqual({
      kind: 'message',
      texte: t.compte.erreurs.nonConfirme,
      action: 'renvoyerConfirmation',
    });
  });

  test('401, quel que soit le code : la connexion', () => {
    expect(reaction(401, { code: 'AUTRE', message: '' })).toEqual({ kind: 'connexion' });
  });

  test('413 : le message dit quoi réduire (les pièces jointes), pas la liste des anomalies', () => {
    const r = reaction(413, {
      code: 'ANOMALIES',
      message: 'La requête dépasse 10 Mo.',
      details: [{ code: 'CORPS', path: '', message: 'Le corps de la requête dépasse 10 Mo.' }],
    });
    expect(r).toEqual({ kind: 'message', texte: t.compte.erreurs.tropGros });
  });

  test('DATE : les bornes du serveur, la basse quand elle existe', () => {
    expect(
      reaction(409, {
        code: 'DATE',
        message: '',
        details: { min: '2026-01-01', max: '2026-11-05' },
      }),
    ).toEqual({ kind: 'date', min: '2026-01-01', max: '2026-11-05' });
    expect(
      reaction(409, { code: 'DATE', message: '', details: { min: null, max: '2026-11-05' } }),
    ).toEqual({ kind: 'date', max: '2026-11-05' });
  });

  test('DATE sans borne haute lisible : un message, jamais une exception', () => {
    for (const details of [undefined, null, 'x', {}, { max: 12 }, { max: '05/11/2026' }]) {
      expect(reaction(409, { code: 'DATE', message: '', details })).toEqual({
        kind: 'message',
        texte: t.compte.erreurs.date,
      });
    }
  });

  test('ANOMALIES : les anomalies lisibles, au format des Issue ; le reste est écarté', () => {
    const r = reaction(422, {
      code: 'ANOMALIES',
      message: '',
      details: [
        { code: 'ORIGINE', path: 'references.precedingInvoices[0].id', message: 'Inconnue.' },
        { code: 'GLYPH_MISSING', path: 'appearance.font', message: 'ŋ absent.', extra: 1 },
        { code: 3, path: 'id', message: 'x' },
        null,
        'texte',
      ],
    });
    expect(r).toEqual({
      kind: 'controle',
      issues: [
        { code: 'ORIGINE', path: 'references.precedingInvoices[0].id', message: 'Inconnue.' },
        { code: 'GLYPH_MISSING', path: 'appearance.font', message: 'ŋ absent.' },
      ],
    });
    expect(reaction(422, { code: 'ANOMALIES', message: '', details: 'x' })).toEqual({
      kind: 'controle',
      issues: [],
    });
  });

  test('AVOIR_DEVISE : la devise en cause, avec la phrase de l’interface (Ruling 49)', () => {
    const r = reaction(422, {
      code: 'ANOMALIES',
      message: '',
      details: [
        {
          code: 'AVOIR_DEVISE',
          path: 'currency',
          message: 'L’avoir est en USD ; la facture F-1 qu’il cite est en EUR.',
        },
      ],
    });
    // La phrase du serveur n'est qu'en français : l'interface dit la sienne, dans sa langue.
    expect(r).toEqual({
      kind: 'devise',
      issues: [{ code: 'AVOIR_DEVISE', path: 'currency', message: t.compte.erreurs.avoirDevise }],
    });
    expect(t.compte.erreurs.avoirDevise).toMatch(/devise/);
  });

  test('les détails du serveur passent dans le message : numéro, identifiant, heure', () => {
    const doublon = reaction(409, {
      code: 'DOUBLON',
      message: '',
      details: { numero: 'F-2026-0007' },
    });
    expect(doublon).toEqual({ kind: 'message', texte: t.compte.erreurs.doublon('F-2026-0007') });
    const interne = reaction(500, {
      code: 'INTERNE',
      message: '',
      details: { requete: 'r-123' },
    });
    expect(interne).toEqual({ kind: 'message', texte: t.compte.erreurs.interne('r-123') });
    const limite = reaction(429, {
      code: 'LIMITE',
      message: '',
      details: { reessayerApres: '2026-11-05T14:07:00.000Z' },
    });
    expect(limite.kind).toBe('message');
    expect(limite).not.toEqual({ kind: 'message', texte: t.compte.erreurs.limite(undefined) });
    expect(
      reaction(429, { code: 'LIMITE', message: '', details: { reessayerApres: 'x' } }),
    ).toEqual({ kind: 'message', texte: t.compte.erreurs.limite(undefined) });
  });

  test('un code inconnu : le message générique, pas le texte du serveur', () => {
    expect(reaction(400, { code: 'NOUVEAU', message: 'Texte du serveur' })).toEqual({
      kind: 'message',
      texte: t.compte.erreurs.inconnue,
    });
  });
});
