import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/delete-account.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const VALID_TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const baseCard = {
  slug: 'ana-electricista',
  edit_token_expires_at: FUTURE,
};

function buildEvent({ method = 'POST', body = { slug: 'ana-electricista', token: VALID_TOKEN }, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    body:       body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body)),
    headers:    { 'x-forwarded-for': ip },
  };
}

function buildDb({ card = baseCard, cardError = null, updateError = null } = {}) {
  // SELECT chain: from('cards').select().eq().eq().is().single()
  const cardSelectBuilder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error: cardError }),
  };

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const cardUpdateBuilder = {
    update: vi.fn(() => ({ eq: updateEq })),
  };

  return {
    from: vi.fn((table) => {
      if (table === 'cards') {
        return { ...cardSelectBuilder, ...cardUpdateBuilder };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    _updateEq: updateEq,
    _cardUpdate: cardUpdateBuilder,
    _cardSelect: cardSelectBuilder,
  };
}

describe('delete-account handler (soft-delete)', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es POST', async () => {
    const handler = makeHandler(buildDb());
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si JSON inválido', async () => {
    const handler = makeHandler(buildDb());
    const res = await handler({ httpMethod: 'POST', body: '{not json' });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si falta slug', async () => {
    const handler = makeHandler(buildDb());
    const res = await handler(buildEvent({ body: { token: VALID_TOKEN } }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si falta token', async () => {
    const handler = makeHandler(buildDb());
    const res = await handler(buildEvent({ body: { slug: 'ana-electricista' } }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 401 si la card no existe (token incorrecto)', async () => {
    const handler = makeHandler(buildDb({ card: null, cardError: { message: 'not found' } }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el token ha expirado', async () => {
    const handler = makeHandler(buildDb({ card: { ...baseCard, edit_token_expires_at: PAST } }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('select aplica filtro is(deleted_at, null) en el lookup', async () => {
    const db = buildDb();
    await makeHandler(db)(buildEvent());
    expect(db._cardSelect.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('soft-deletea: hace UPDATE deleted_at, no DELETE', async () => {
    const db = buildDb();
    const res = await makeHandler(db)(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    // Verifica UPDATE { deleted_at: <ISO> } sobre cards
    const updateArg = db._cardUpdate.update.mock.calls[0][0];
    expect(updateArg.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db._updateEq).toHaveBeenCalledWith('slug', 'ana-electricista');
  });

  it('devuelve 500 si falla el UPDATE', async () => {
    const db = buildDb({ updateError: { message: 'fail' } });
    const res = await makeHandler(db)(buildEvent());
    expect(res.statusCode).toBe(500);
  });

  it('devuelve 429 al superar el límite por IP (10 requests / 10 min)', async () => {
    const handler = makeHandler(buildDb());
    const ip = '9.9.9.9';
    for (let i = 0; i < 10; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
  });
});
