import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/download-card.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const baseCard = {
  slug: 'maria-electricista',
  nombre: 'María Pérez',
  tagline: 'Electricista',
  whatsapp: '34633816729',
  edit_token_expires_at: null,
};

function buildEvent({ method = 'GET', slug = 'maria-electricista', token = 'tok-valid', ip = '1.2.3.4' } = {}) {
  const queryStringParameters = {};
  if (slug !== undefined)  queryStringParameters.slug  = slug;
  if (token !== undefined) queryStringParameters.token = token;
  return {
    httpMethod: method,
    queryStringParameters,
    headers: { 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', host: 'perfilapro.es' },
  };
}

function buildDb({ card = baseCard, error = null } = {}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error }),
  };
  return { from: vi.fn(() => builder), _builder: builder };
}

describe('download-card handler', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es GET', async () => {
    const res = await makeHandler(buildDb())({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug o token', async () => {
    const baseHeaders = { 'x-forwarded-for': '1.2.3.4', 'x-forwarded-proto': 'https', host: 'perfilapro.es' };
    const r1 = await makeHandler(buildDb())({
      httpMethod: 'GET',
      queryStringParameters: { token: 'tok' },
      headers: baseHeaders,
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await makeHandler(buildDb())({
      httpMethod: 'GET',
      queryStringParameters: { slug: 'foo' },
      headers: baseHeaders,
    });
    expect(r2.statusCode).toBe(400);
  });

  it('devuelve 401 si la card no existe o el token no coincide', async () => {
    const res = await makeHandler(buildDb({ card: null, error: { message: 'not found' } }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el token ha expirado', async () => {
    const expired = { ...baseCard, edit_token_expires_at: new Date(Date.now() - 1000).toISOString() };
    const res = await makeHandler(buildDb({ card: expired }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve PDF base64 con Content-Disposition correcto', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toContain('perfilapro-maria-electricista.pdf');
    expect(res.isBase64Encoded).toBe(true);
    // PDF base64 empieza con JVBERi (= "%PDF-")
    expect(res.body.startsWith('JVBERi')).toBe(true);
  });

  it('aplica filtros eq(edit_token, ...) e is(deleted_at, null)', async () => {
    const db = buildDb();
    await makeHandler(db)(buildEvent({ token: 'tok-abc' }));
    expect(db._builder.eq).toHaveBeenCalledWith('edit_token', 'tok-abc');
    expect(db._builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('Cache-Control es private/no-store (los assets no deben cachearse)', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('devuelve 429 al superar el rate limit por IP', async () => {
    const handler = makeHandler(buildDb());
    const ip = '8.8.8.8';
    for (let i = 0; i < 10; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
  });
});
