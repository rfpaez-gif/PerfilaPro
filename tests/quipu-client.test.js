import { describe, it, expect } from 'vitest';
import { makeClient } from '../netlify/functions/lib/quipu-client.js';

describe('quipu-client (skeleton)', () => {
  it('makeClient devuelve un objeto con la interfaz esperada', () => {
    const c = makeClient({ clientId: 'x', clientSecret: 'y', apiBase: 'https://example.com', env: 'sandbox' });
    expect(typeof c.createInvoice).toBe('function');
    expect(typeof c.voidInvoice).toBe('function');
    expect(typeof c.getInvoice).toBe('function');
  });

  it('expone la config inyectada (para verificacion en tests futuros)', () => {
    const c = makeClient({ clientId: 'cid', clientSecret: 'sec', apiBase: 'https://api', env: 'sandbox' });
    expect(c._config).toEqual({ clientId: 'cid', clientSecret: 'sec', apiBase: 'https://api', env: 'sandbox' });
  });

  it('createInvoice lanza not-implemented hasta Sprint 3', async () => {
    const c = makeClient({});
    await expect(c.createInvoice({ cardSlug: 's', email: 'e', amount: 4.9, concept: 'c', period: 'monthly' }))
      .rejects.toThrow(/not implemented/);
  });

  it('voidInvoice lanza not-implemented hasta Sprint 3', async () => {
    const c = makeClient({});
    await expect(c.voidInvoice('id-1', 'rectificacion')).rejects.toThrow(/not implemented/);
  });

  it('getInvoice lanza not-implemented hasta Sprint 3', async () => {
    const c = makeClient({});
    await expect(c.getInvoice('id-1')).rejects.toThrow(/not implemented/);
  });
});
