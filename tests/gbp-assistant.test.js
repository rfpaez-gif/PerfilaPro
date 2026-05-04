import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, inferSector } from '../netlify/functions/gbp-assistant.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const VALID_TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const baseProCard = {
  slug:     'ana-pro',
  nombre:   'Ana López',
  tagline:  'Belleza y estética',
  zona:     'Madrid centro',
  servicios: ['Manicura', 'Pedicura'],
  foto_url: null,
  plan:     'pro',
  edit_token_expires_at: FUTURE,
};

function buildEvent({ method = 'GET', slug = 'ana-pro', token = VALID_TOKEN, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { slug, token },
    headers: { 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', host: 'perfilapro.es' },
  };
}

function buildDb({ card = baseProCard, error = null } = {}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error }),
  };
  return { from: vi.fn(() => builder), _builder: builder };
}

describe('gbp-assistant handler', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es GET', async () => {
    const res = await makeHandler(buildDb())({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug o token', async () => {
    const res = await makeHandler(buildDb())({ httpMethod: 'GET', queryStringParameters: { slug: 'x' }, headers: {} });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 401 si la card no existe', async () => {
    const res = await makeHandler(buildDb({ card: null, error: { message: 'nf' } }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el token ha expirado', async () => {
    const res = await makeHandler(buildDb({ card: { ...baseProCard, edit_token_expires_at: PAST } }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 403 si la card no es Pro', async () => {
    const res = await makeHandler(buildDb({ card: { ...baseProCard, plan: 'base' } }))(buildEvent());
    expect(res.statusCode).toBe(403);
  });

  it('aplica filtro is(deleted_at, null)', async () => {
    const db = buildDb();
    await makeHandler(db)(buildEvent());
    expect(db._builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('devuelve payload completo para Pro válido', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.card.slug).toBe('ana-pro');
    expect(json.sector).toBe('belleza');
    expect(json.categories).toContain('Peluquería');
    expect(json.description).toContain('Ana López');
    expect(json.posts).toHaveLength(5);
    expect(json.photo_slots).toHaveLength(5);
    expect(json.steps.length).toBeGreaterThan(5);
    expect(json.assets.qr_svg).toContain('/api/qr-download');
    expect(json.assets.cover_image).toContain('/api/share-image');
    expect(json.website_url).toBe('https://perfilapro.es/c/ana-pro');
  });

  it('devuelve 429 al superar el límite por IP (30 req / 10 min)', async () => {
    const handler = makeHandler(buildDb());
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
  });
});

describe('inferSector', () => {
  it('detecta belleza desde tagline', () => {
    expect(inferSector({ tagline: 'Belleza y estética' })).toBe('belleza');
  });

  it('detecta oficios cuando aparece la palabra exacta del slug', () => {
    expect(inferSector({ tagline: 'Servicio para oficios del hogar' })).toBe('oficios');
  });

  it('cae a "otro" cuando no hay match', () => {
    expect(inferSector({ tagline: 'Algo random sin relación' })).toBe('otro');
  });

  it('funciona sin tagline', () => {
    expect(inferSector({})).toBe('otro');
  });
});
