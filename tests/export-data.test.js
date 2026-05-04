import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/export-data.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const VALID_TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const baseCard = {
  slug: 'ana-electricista',
  nombre: 'Ana López',
  email: 'ana@example.com',
  whatsapp: '34612345678',
  edit_token: VALID_TOKEN,
  edit_token_expires_at: FUTURE,
};

function buildEvent({ method = 'GET', slug = 'ana-electricista', token = VALID_TOKEN, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { slug, token },
    headers: { 'x-forwarded-for': ip },
  };
}

function buildDb({ card = baseCard, cardError = null, visits = [], facturas = [] } = {}) {
  const cardBuilder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error: cardError }),
  };
  const visitsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({ data: visits, error: null }),
  };
  const facturasBuilder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({ data: facturas, error: null }),
  };
  return {
    from: vi.fn((table) => {
      if (table === 'cards')    return cardBuilder;
      if (table === 'visits')   return visitsBuilder;
      if (table === 'facturas') return facturasBuilder;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe('export-data handler', () => {
  let handler;
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es GET', async () => {
    handler = makeHandler(buildDb());
    const res = await handler({ httpMethod: 'POST', queryStringParameters: {} });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug', async () => {
    handler = makeHandler(buildDb());
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { token: VALID_TOKEN } });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si falta token', async () => {
    handler = makeHandler(buildDb());
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { slug: 'ana-electricista' } });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 401 si la card no existe (token incorrecto)', async () => {
    handler = makeHandler(buildDb({ card: null, cardError: { message: 'not found' } }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el token ha expirado', async () => {
    handler = makeHandler(buildDb({ card: { ...baseCard, edit_token_expires_at: PAST } }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 200 con payload sin edit_token cuando todo es correcto', async () => {
    const visits   = [{ visited_at: '2026-01-01T10:00:00Z' }];
    const facturas = [{ numero: 'FAC-2026-0001', created_at: '2026-01-01T10:00:00Z' }];
    handler = makeHandler(buildDb({ visits, facturas }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="perfilapro-export-ana-electricista.json"');
    const payload = JSON.parse(res.body);
    expect(payload.card.slug).toBe('ana-electricista');
    expect(payload.card.edit_token).toBeUndefined();
    expect(payload.card.edit_token_expires_at).toBeUndefined();
    expect(payload.visits).toEqual(visits);
    expect(payload.facturas).toEqual(facturas);
    expect(payload.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('devuelve 429 al superar el límite por IP (10 requests / 10 min)', async () => {
    handler = makeHandler(buildDb());
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
