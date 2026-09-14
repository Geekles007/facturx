import { describe, expect, it } from 'vitest';
import {
  assertValidLifecycleStatus,
  cents,
  FacturXLifecycleError,
  LIFECYCLE_STATUS_CODES,
  LIFECYCLE_STATUS_LABELS,
  type LifecycleStatus,
  REFUSAL_REASON_LABELS,
  validateLifecycleStatus,
} from '../src/index.js';

/** Facture visée par les statuts de ce fichier. SIREN valide au sens de Luhn. */
const invoice = {
  id: 'F-2026-0042',
  issueDate: '2026-09-11' as const,
  sellerSiren: '443061841',
};

const depose: LifecycleStatus = {
  code: '200',
  dateTime: '2026-09-15T08:30:00Z',
  invoice,
};

const codes = (result: ReturnType<typeof validateLifecycleStatus>) =>
  result.ok ? [] : result.issues.map((i) => i.code);

describe('liste officielle des statuts', () => {
  it("n'expose que les quatre statuts transmissibles (annexe 2, G7.44)", () => {
    expect([...LIFECYCLE_STATUS_CODES]).toEqual(['200', '210', '212', '213']);
    expect(LIFECYCLE_STATUS_LABELS['213']).toBe('Rejetée');
  });

  it('refuse un statut hors de cette liste', () => {
    const result = validateLifecycleStatus({
      ...depose,
      code: '208' as LifecycleStatus['code'],
    });
    expect(codes(result)).toContain('G7.44');
  });

  it('porte les 40 motifs de refus normalisés', () => {
    expect(Object.keys(REFUSAL_REASON_LABELS)).toHaveLength(40);
    expect(REFUSAL_REASON_LABELS.DEST_ERR).toBe('Erreur de destinataire');
  });
});

describe('statut déposée (200)', () => {
  it('se valide sans motif ni commentaire', () => {
    expect(validateLifecycleStatus(depose).ok).toBe(true);
  });

  it('exige un horodatage avec fuseau', () => {
    const result = validateLifecycleStatus({ ...depose, dateTime: '2026-09-15 08:30' });
    expect(codes(result)).toContain('FORMAT-DATETIME');
  });

  it('exige le SIREN du fournisseur, et le vérifie (G7.17)', () => {
    expect(
      codes(validateLifecycleStatus({ ...depose, invoice: { ...invoice, sellerSiren: '' } })),
    ).toContain('G7.17');
    // Neuf chiffres, mais clé de Luhn fausse.
    expect(
      codes(
        validateLifecycleStatus({ ...depose, invoice: { ...invoice, sellerSiren: '443061842' } }),
      ),
    ).toContain('G7.17');
  });

  it('refuse un numéro de facture de plus de 35 caractères', () => {
    const result = validateLifecycleStatus({
      ...depose,
      invoice: { ...invoice, id: 'F'.repeat(36) },
    });
    expect(codes(result)).toContain('FORMAT-INVOICE-ID');
  });
});

describe('statut refusée (210)', () => {
  const refuse: LifecycleStatus = {
    ...depose,
    code: '210',
    reasonCode: 'MONTANT_ERR',
    comment: 'Le total TTC ne correspond pas au bon de commande.',
  };

  it('se valide avec un motif et un commentaire', () => {
    expect(validateLifecycleStatus(refuse).ok).toBe(true);
  });

  it('exige un code motif (G7.08)', () => {
    const { reasonCode: _, ...sansMotif } = refuse;
    expect(codes(validateLifecycleStatus(sansMotif))).toContain('G7.08');
  });

  it('exige un commentaire (G7.25)', () => {
    const { comment: _, ...sansCommentaire } = refuse;
    expect(codes(validateLifecycleStatus(sansCommentaire))).toContain('G7.25');
    // Un commentaire vide ou fait d'espaces ne motive rien.
    expect(codes(validateLifecycleStatus({ ...refuse, comment: '   ' }))).toContain('G7.25');
  });

  it('restreint les motifs quand la facture est au cadre S6 (G7.39)', () => {
    const s6 = { ...refuse, businessProcess: 'S6' };
    expect(codes(validateLifecycleStatus(s6))).toContain('G7.39');
    expect(validateLifecycleStatus({ ...s6, reasonCode: 'ROUTAGE_ERR' }).ok).toBe(true);
  });

  it('laisse ce même motif passer hors du cadre S6', () => {
    expect(validateLifecycleStatus({ ...refuse, businessProcess: 'S1' }).ok).toBe(true);
  });

  it('refuse un motif hors de la liste officielle', () => {
    const result = validateLifecycleStatus({
      ...refuse,
      reasonCode: 'PARCE_QUE' as never,
    });
    expect(codes(result)).toContain('FORMAT-REASON-CODE');
  });
});

describe('statut rejetée (213)', () => {
  it('exige un code motif, mais pas de commentaire (G7.08 sans G7.25)', () => {
    const rejete: LifecycleStatus = { ...depose, code: '213' };
    expect(codes(validateLifecycleStatus(rejete))).toEqual(['G7.08']);
    expect(validateLifecycleStatus({ ...rejete, reasonCode: 'NON_CONFORME' }).ok).toBe(true);
  });
});

describe('statut encaissée (212)', () => {
  const encaisse: LifecycleStatus = {
    ...depose,
    code: '212',
    amount: { code: 'MEN', value: cents(200243), currency: 'EUR' },
  };

  it('se valide avec un montant encaissé en euros', () => {
    expect(validateLifecycleStatus(encaisse).ok).toBe(true);
  });

  it("impose l'euro pour le montant encaissé (G6.27)", () => {
    const result = validateLifecycleStatus({
      ...encaisse,
      amount: { code: 'MEN', value: cents(200243), currency: 'CHF' },
    });
    expect(codes(result)).toContain('G6.27');
  });

  it('refuse un code montant hors de la liste (G7.12)', () => {
    const result = validateLifecycleStatus({
      ...encaisse,
      amount: { code: 'XXX' as never, value: cents(1), currency: 'EUR' },
    });
    expect(codes(result)).toContain('G7.12');
  });

  it("n'exige pas de montant : la spécification ne le rend pas obligatoire", () => {
    const { amount: _, ...sansMontant } = encaisse;
    expect(validateLifecycleStatus(sansMontant).ok).toBe(true);
  });
});

describe('anomalies', () => {
  it("accumule toutes les anomalies plutôt que de s'arrêter à la première", () => {
    const result = validateLifecycleStatus({
      code: '210',
      dateTime: 'hier',
      invoice: { id: '', issueDate: '11/09/2026' as never, sellerSiren: 'X' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThanOrEqual(6);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['FORMAT-DATETIME', 'G7.17', 'FORMAT-INVOICE-ID', 'G7.08', 'G7.25']),
    );
  });

  it('localise chaque anomalie par son chemin', () => {
    const result = validateLifecycleStatus({ ...depose, code: '210' });
    if (result.ok) throw new Error('attendu invalide');
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['reasonCode', 'comment']),
    );
  });

  it('assertValidLifecycleStatus lève en portant les anomalies', () => {
    expect(() => assertValidLifecycleStatus({ ...depose, code: '210' })).toThrow(
      FacturXLifecycleError,
    );
    try {
      assertValidLifecycleStatus({ ...depose, code: '210' });
    } catch (error) {
      expect((error as FacturXLifecycleError).issues.map((i) => i.code)).toContain('G7.08');
    }
  });

  it('rend le statut tel quel quand il est valide', () => {
    expect(assertValidLifecycleStatus(depose)).toBe(depose);
  });
});
