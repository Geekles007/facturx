import { describe, expect, it } from 'vitest';
import { verifierCleSupabase } from './cle-supabase.mjs';

/** Un JWT tel que Supabase en délivre : trois segments, le second portant les revendications. */
const jwt = (charge) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(charge)).toString('base64url'),
    'signature',
  ].join('.');

/**
 * Le bundle du Studio est public : la clé qu'on y injecte l'est aussi. Une clé de service y
 * donnerait à n'importe quel visiteur les droits de l'administrateur de la base.
 */
describe('clé Supabase du bundle', () => {
  it('accepte l’absence de clé : le Studio est alors construit sans compte', () => {
    expect(() => verifierCleSupabase('')).not.toThrow();
    expect(() => verifierCleSupabase(undefined)).not.toThrow();
  });

  it('accepte une clé publique, ancienne (JWT anon) ou nouvelle (sb_publishable_)', () => {
    expect(() => verifierCleSupabase(jwt({ iss: 'supabase-demo', role: 'anon' }))).not.toThrow();
    expect(() => verifierCleSupabase('sb_publishable_AbCdEf0123456789')).not.toThrow();
  });

  it('refuse un JWT dont le rôle est service_role', () => {
    const cle = jwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 });
    expect(() => verifierCleSupabase(cle)).toThrow(/FACTURX_SUPABASE_KEY.*service/);
  });

  it('refuse une clé secrète du nouveau format', () => {
    expect(() => verifierCleSupabase('sb_secret_AbCdEf0123456789')).toThrow(
      /FACTURX_SUPABASE_KEY.*secrète/,
    );
  });

  it('ne cite pas la clé refusée dans son message', () => {
    const cle = 'sb_secret_ne-doit-pas-apparaitre-dans-un-journal-de-construction';
    expect(() => verifierCleSupabase(cle)).toThrow(/^(?!.*ne-doit-pas-apparaitre)/s);
  });

  it('laisse passer ce qui n’est pas un JWT lisible : rien n’y atteste un rôle de service', () => {
    expect(() => verifierCleSupabase('une-cle-quelconque')).not.toThrow();
    expect(() => verifierCleSupabase('a.b.c')).not.toThrow();
    expect(() =>
      verifierCleSupabase(`x.${Buffer.from('pas du json').toString('base64url')}.z`),
    ).not.toThrow();
  });
});
