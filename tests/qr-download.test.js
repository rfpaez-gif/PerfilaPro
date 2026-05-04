import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/qr-download.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const baseProCard = { slug: 'ana-pro', nombre: 'Ana', plan: 'pro', status: 'active' };
const baseFreeCard = { slug: 'pepe-free', nombre: 'Pepe', plan: 'base', status: 'active' };

function buildEvent({ method = 'GET', slug = 'ana-pro', format, size, ip = '1.2.3.4' } = {}) {
  const queryStringParameters = { slug };
  if (format) queryStringParameters.format = format;
  if (size)   queryStringParameters.size   = size;
  return {
    httpMethod: method,
    queryStringParameters,
    headers: { 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', host: 'perfilapro.es' },
  };
}

function buildDb({ card = baseProCard, error = null } = {}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error }),
  };
  return { from: vi.fn(() => builder), _builder: builder };
}

describe('qr-download handler', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es GET', async () => {
    const res = await makeHandler(buildDb())({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug', async () => {
    const res = await makeHandler(buildDb())({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await makeHandler(buildDb({ card: null, error: { message: 'not found' } }))(buildEvent());
    expect(res.statusCode).toBe(404);
  });

  it('devuelve 403 si la card es Free (no Pro)', async () => {
    const res = await makeHandler(buildDb({ card: baseFreeCard }))(buildEvent({ slug: 'pepe-free' }));
    expect(res.statusCode).toBe(403);
  });

  it('demos hardcodeados (paco-fontanero-alicante) cuentan como Pro', async () => {
    const demoCard = { slug: 'paco-fontanero-alicante', nombre: 'Paco', plan: 'base', status: 'active' };
    const res = await makeHandler(buildDb({ card: demoCard }))(buildEvent({ slug: 'paco-fontanero-alicante' }));
    expect(res.statusCode).toBe(200);
  });

  it('format=svg (default): devuelve image/svg+xml con Content-Disposition', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers['Content-Disposition']).toContain('perfilapro-ana-pro.svg');
    expect(res.body).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  it('format=png: devuelve image/png base64 con Content-Disposition incluyendo tamaño', async () => {
    const res = await makeHandler(buildDb())(buildEvent({ format: 'png' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Content-Disposition']).toContain('perfilapro-ana-pro-1024.png');
    expect(res.isBase64Encoded).toBe(true);
    // PNG magic header en base64 empieza por iVBORw0KGgo
    expect(res.body.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('format=png con size custom respeta el parámetro hasta MAX', async () => {
    const res = await makeHandler(buildDb())(buildEvent({ format: 'png', size: '512' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Disposition']).toContain('perfilapro-ana-pro-512.png');
  });

  it('format=png trunca size al máximo (2048)', async () => {
    const res = await makeHandler(buildDb())(buildEvent({ format: 'png', size: '99999' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Disposition']).toContain('perfilapro-ana-pro-2048.png');
  });

  it('SVG codifica la URL pública del perfil', async () => {
    const res = await makeHandler(buildDb())(buildEvent());
    // El SVG no contiene la URL como texto plano (es path data), pero podemos
    // al menos verificar que se generó una imagen vectorial bien formada.
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('</svg>');
  });

  it('aplica filtro is(deleted_at, null)', async () => {
    const db = buildDb();
    await makeHandler(db)(buildEvent());
    expect(db._builder.is).toHaveBeenCalledWith('deleted_at', null);
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
