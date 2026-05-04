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

function buildDb({ card = baseCard, cardError = null, deleteErrors = {} } = {}) {
  const cardSelectBuilder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error: cardError }),
  };
  const deletes = {
    visits:   vi.fn().mockResolvedValue({ error: deleteErrors.visits   || null }),
    facturas: vi.fn().mockResolvedValue({ error: deleteErrors.facturas || null }),
    cards:    vi.fn().mockResolvedValue({ error: deleteErrors.cards    || null }),
  };
  function makeDeleteBuilder(table) {
    return {
      delete: vi.fn(() => ({ eq: deletes[table] })),
    };
  }
  return {
    from: vi.fn((table) => {
      if (table === 'cards') {
        return {
          ...cardSelectBuilder,
          ...makeDeleteBuilder('cards'),
        };
      }
      if (table === 'visits')   return makeDeleteBuilder('visits');
      if (table === 'facturas') return makeDeleteBuilder('facturas');
      throw new Error(`unexpected table: ${table}`);
    }),
    _deletes: deletes,
  };
}

describe('delete-account handler', () => {
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

  it('borra visits, facturas y card en orden y devuelve 200', async () => {
    const db = buildDb();
    const handler = makeHandler(db);
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(db._deletes.visits).toHaveBeenCalledWith('slug', 'ana-electricista');
    expect(db._deletes.facturas).toHaveBeenCalledWith('slug', 'ana-electricista');
    expect(db._deletes.cards).toHaveBeenCalledWith('slug', 'ana-electricista');
  });

  it('devuelve 500 si falla el borrado de visits y no continua', async () => {
    const db = buildDb({ deleteErrors: { visits: { message: 'fail' } } });
    const handler = makeHandler(db);
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(500);
    expect(db._deletes.facturas).not.toHaveBeenCalled();
    expect(db._deletes.cards).not.toHaveBeenCalled();
  });

  it('devuelve 500 si falla el borrado de facturas y no borra la card', async () => {
    const db = buildDb({ deleteErrors: { facturas: { message: 'fail' } } });
    const handler = makeHandler(db);
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(500);
    expect(db._deletes.cards).not.toHaveBeenCalled();
  });

  it('devuelve 500 si falla el borrado de la card', async () => {
    const db = buildDb({ deleteErrors: { cards: { message: 'fail' } } });
    const handler = makeHandler(db);
    const res = await handler(buildEvent());
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
