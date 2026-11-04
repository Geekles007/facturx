import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ auth: {} })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

beforeEach(() => {
  vi.resetModules();
  createClient.mockClear();
});

describe('client', () => {
  it('demande le flux PKCE : sans lui, un lien fabriqué avec des jetons ouvrirait une session', async () => {
    const { client } = await import('./client.js');
    client();
    expect(createClient).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledWith('', '', { auth: { flowType: 'pkce' } });
  });

  it('crée le client une fois, au premier appel', async () => {
    const { client } = await import('./client.js');
    expect(createClient).not.toHaveBeenCalled();
    expect(client()).toBe(client());
    expect(createClient).toHaveBeenCalledOnce();
  });
});
