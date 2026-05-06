import { describe, it, expect, beforeEach } from 'vitest';
import { handler } from '../netlify/functions/qr.js';
import { _resetRateLimit } from '../netlify/functions/lib/rate-limit.js';

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

describe('qr endpoint', () => {
  beforeEach(() => _resetRateLimit());

  it('rechaza método distinto de GET', async () => {
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

  it('por defecto sirve SVG cacheado un año', async () => {
    const res = await handler(buildEvent({ slug: 'maria-electricista' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/svg/);
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.body).toMatch(/^<svg/);
    expect(res.body).toContain('width="200"');
    expect(res.body).toContain('fill="#0A1F44"');
  });

  it('acepta size válido para SVG (200) y cae al default si es inválido', async () => {
    const ok  = await handler(buildEvent({ slug: 'm', query: { size: '280' } }));
    const bad = await handler(buildEvent({ slug: 'm', query: { size: '999' } }));
    expect(ok.body).toContain('width="280"');
    expect(bad.body).toContain('width="200"');
  });

  it('format=png devuelve PNG base64 con Content-Disposition inline', async () => {
    const res = await handler(buildEvent({ slug: 'paco-fontanero', query: { format: 'png', size: '512' } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers['Content-Disposition']).toContain('paco-fontanero-512.png');
    // Header PNG en base64 empieza por "iVBORw0KGgo"
    expect(res.body.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('PNG cae al tamaño default 1024 si el size pedido no está en la whitelist', async () => {
    const res = await handler(buildEvent({ slug: 'm', query: { format: 'png', size: '777' } }));
    expect(res.headers['Content-Disposition']).toContain('m-1024.png');
  });

  it('rate-limita sólo el formato PNG (30 req/10 min por IP)', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      const ok = await handler(buildEvent({ slug: `slug-${i}`, query: { format: 'png', size: '256' }, ip }));
      expect(ok.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ slug: 'slug-30', query: { format: 'png', size: '256' }, ip }));
    expect(blocked.statusCode).toBe(429);
  });

  it('SVG no comparte rate-limit con PNG (peticiones SVG no consumen el bucket de PNG)', async () => {
    const ip = '8.8.8.8';
    for (let i = 0; i < 50; i++) {
      const ok = await handler(buildEvent({ slug: `svg-${i}`, ip }));
      expect(ok.statusCode).toBe(200);
    }
  });
});
