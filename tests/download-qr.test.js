import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/download-qr.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const baseCard = {
  slug: 'maria-electricista',
  edit_token_expires_at: null,
};

function buildEvent({ method = 'GET', slug = 'maria-electricista', token = 'tok-valid', size, ip = '1.2.3.4' } = {}) {
  const queryStringParameters = {};
  if (slug !== undefined)  queryStringParameters.slug  = slug;
  if (token !== undefined) queryStringParameters.token = token;
  if (size)                queryStringParameters.size  = size;
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

describe('download-qr handler', () => {
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

  it('devuelve PNG base64 con Content-Disposition correcto', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Content-Disposition']).toContain('perfilapro-maria-electricista-qr.png');
    expect(res.isBase64Encoded).toBe(true);
    // PNG magic en base64: iVBORw0KGgo
    expect(res.body.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('respeta size custom hasta el máximo (2048)', async () => {
    const r1 = await makeHandler(buildDb())(buildEvent({ size: '512' }));
    expect(r1.statusCode).toBe(200);
    const r2 = await makeHandler(buildDb())(buildEvent({ size: '99999' }));
    expect(r2.statusCode).toBe(200);
  });

  it('Cache-Control es private/no-store', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('devuelve 429 al superar el rate limit por IP', async () => {
    const handler = makeHandler(buildDb());
    const ip = '7.7.7.7';
    for (let i = 0; i < 10; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
  });
});
