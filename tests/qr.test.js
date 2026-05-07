import { describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/qr.js';
import { _resetRateLimit } from '../netlify/functions/lib/rate-limit.js';

// Mock supabase: cards en memoria por slug. Tests inyectan el row mediante
// mockCards[slug] = { plan, stripe_session_id }. Si no está, el handler
// devuelve 404.
const mockCards = {};

function makeMockDb() {
  return {
    from(_table) {
      let _slug = null;
      const chain = {
        select() { return chain; },
        eq(_col, val) { _slug = val; return chain; },
        is() { return chain; },
        async single() {
          const card = mockCards[_slug];
          if (!card) return { data: null, error: { message: 'not found' } };
          return { data: card, error: null };
        },
      };
      return chain;
    },
  };
}

const handler = makeHandler({ db: makeMockDb() });

function buildEvent({ slug, query = {}, ip = '1.2.3.4', method = 'GET' } = {}) {
  return {
    httpMethod: method,
    path: slug ? `/.netlify/functions/qr/${slug}` : '/.netlify/functions/qr',
    queryStringParameters: query,
    headers: {
      'x-forwarded-for':   ip,
      'x-forwarded-proto': 'https',
      host:                'perfilapro.es',
    },
  };
}

// Helpers para preparar el estado del card mock antes de cada test.
function seedAnual(slug)    { mockCards[slug] = { plan: 'pro',  stripe_session_id: 'cs_test_1', deleted_at: null }; }
function seedTrimestral(slug) { mockCards[slug] = { plan: 'base', stripe_session_id: 'cs_test_2', deleted_at: null }; }
function seedFree(slug)     { mockCards[slug] = { plan: null,   stripe_session_id: null,        deleted_at: null }; }

describe('qr endpoint', () => {
  beforeEach(() => {
    _resetRateLimit();
    for (const k of Object.keys(mockCards)) delete mockCards[k];
  });

  it('rechaza método distinto de GET', async () => {
    seedAnual('maria');
    const res = await handler(buildEvent({ slug: 'maria', method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });

  it('400 si falta slug', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/.netlify/functions/qr', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(400);
  });

  it('400 si el slug tiene caracteres no permitidos', async () => {
    const res = await handler(buildEvent({ slug: 'María.Pérez' }));
    expect(res.statusCode).toBe(400);
  });

  it('404 si el slug no existe en BD', async () => {
    const res = await handler(buildEvent({ slug: 'no-existe' }));
    expect(res.statusCode).toBe(404);
  });

  describe('tier gating', () => {
    it('Anual: SVG disponible y cacheado un año', async () => {
      seedAnual('ana-anual');
      const res = await handler(buildEvent({ slug: 'ana-anual' }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toMatch(/svg/);
      expect(res.headers['Cache-Control']).toContain('immutable');
      expect(res.body).toMatch(/^<svg/);
      expect(res.body).not.toContain('Creado con perfilapro.es'); // sin marca
    });

    it('Trimestral: SVG bloqueado (404) — solo Anual descarga vectorial', async () => {
      seedTrimestral('toni-trim');
      const res = await handler(buildEvent({ slug: 'toni-trim' }));
      expect(res.statusCode).toBe(404);
    });

    it('Free: SVG bloqueado (404)', async () => {
      seedFree('fran-free');
      const res = await handler(buildEvent({ slug: 'fran-free' }));
      expect(res.statusCode).toBe(404);
    });

    it('Free: PNG con marca de agua + cache corta (5 min)', async () => {
      seedFree('fran-free');
      const res = await handler(buildEvent({ slug: 'fran-free', query: { format: 'png', size: '512' } }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('image/png');
      expect(res.headers['Cache-Control']).toContain('max-age=300');
      expect(res.headers['Cache-Control']).not.toContain('immutable');
      // PNG header en base64
      expect(res.body.startsWith('iVBORw0KGgo')).toBe(true);
    });

    it('Trimestral: PNG limpio + cache 1 año immutable', async () => {
      seedTrimestral('toni-trim');
      const res = await handler(buildEvent({ slug: 'toni-trim', query: { format: 'png', size: '512' } }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['Cache-Control']).toContain('immutable');
    });

    it('Anual: PNG limpio + cache 1 año immutable', async () => {
      seedAnual('ana-anual');
      const res = await handler(buildEvent({ slug: 'ana-anual', query: { format: 'png', size: '512' } }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['Cache-Control']).toContain('immutable');
    });

    it('Anual: el SVG NO contiene la cadena de marca de agua', async () => {
      seedAnual('ana-anual');
      const res = await handler(buildEvent({ slug: 'ana-anual' }));
      expect(res.body).not.toContain('Creado con perfilapro.es');
    });
  });

  it('acepta size válido para SVG (Anual: 280) y cae al default (200) si es inválido', async () => {
    seedAnual('m');
    const ok  = await handler(buildEvent({ slug: 'm', query: { size: '280' } }));
    const bad = await handler(buildEvent({ slug: 'm', query: { size: '999' } }));
    expect(ok.body).toContain('width="280"');
    expect(bad.body).toContain('width="200"');
  });

  it('format=png devuelve PNG base64 con Content-Disposition inline', async () => {
    seedAnual('paco-fontanero');
    const res = await handler(buildEvent({ slug: 'paco-fontanero', query: { format: 'png', size: '512' } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers['Content-Disposition']).toContain('paco-fontanero-512.png');
    expect(res.body.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('PNG cae al tamaño default 1024 si el size pedido no está en la whitelist', async () => {
    seedAnual('m');
    const res = await handler(buildEvent({ slug: 'm', query: { format: 'png', size: '777' } }));
    expect(res.headers['Content-Disposition']).toContain('m-1024.png');
  });

  it('rate-limita sólo el formato PNG (30 req/10 min por IP)', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      seedAnual(`slug-${i}`);
      const ok = await handler(buildEvent({ slug: `slug-${i}`, query: { format: 'png', size: '256' }, ip }));
      expect(ok.statusCode).toBe(200);
    }
    seedAnual('slug-30');
    const blocked = await handler(buildEvent({ slug: 'slug-30', query: { format: 'png', size: '256' }, ip }));
    expect(blocked.statusCode).toBe(429);
  });

  it('SVG no comparte rate-limit con PNG (peticiones SVG no consumen el bucket de PNG)', async () => {
    const ip = '8.8.8.8';
    for (let i = 0; i < 50; i++) {
      seedAnual(`svg-${i}`);
      const ok = await handler(buildEvent({ slug: `svg-${i}`, ip }));
      expect(ok.statusCode).toBe(200);
    }
  });
});
