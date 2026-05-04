import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/share-image.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const baseCard = {
  slug:     'ana-pro',
  nombre:   'Ana López',
  tagline:  'Electricista en Madrid',
  zona:     'Madrid centro',
  foto_url: null,
  status:   'active',
  plan:     'pro',
};

function buildEvent({ method = 'GET', slug = 'ana-pro', template, ip = '1.2.3.4' } = {}) {
  const queryStringParameters = { slug };
  if (template) queryStringParameters.template = template;
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

const FAKE_PNG = Buffer.from('mockedpng');
const fakeRender = vi.fn().mockResolvedValue(FAKE_PNG);

describe('share-image handler', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); fakeRender.mockResolvedValue(FAKE_PNG); });

  it('devuelve 405 si method no es GET', async () => {
    const res = await makeHandler(buildDb(), fakeRender)({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug', async () => {
    const res = await makeHandler(buildDb(), fakeRender)({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await makeHandler(buildDb({ card: null, error: { message: 'nf' } }), fakeRender)(buildEvent());
    expect(res.statusCode).toBe(404);
  });

  it('aplica filtro is(deleted_at, null) en el lookup', async () => {
    const db = buildDb();
    await makeHandler(db, fakeRender)(buildEvent());
    expect(db._builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('genera PNG con template=og por defecto', async () => {
    const res = await makeHandler(buildDb(), fakeRender)(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toContain('max-age=86400');
    expect(res.isBase64Encoded).toBe(true);
    expect(fakeRender).toHaveBeenCalledWith(expect.objectContaining({ template: 'og' }));
  });

  it.each(['square', 'story', 'linkedin'])('acepta template=%s', async (tpl) => {
    await makeHandler(buildDb(), fakeRender)(buildEvent({ template: tpl }));
    expect(fakeRender).toHaveBeenCalledWith(expect.objectContaining({ template: tpl }));
  });

  it('cae a "og" si el template solicitado no existe', async () => {
    await makeHandler(buildDb(), fakeRender)(buildEvent({ template: 'inexistente' }));
    expect(fakeRender).toHaveBeenCalledWith(expect.objectContaining({ template: 'og' }));
  });

  it('pasa siteUrl al renderer construido a partir de los headers', async () => {
    await makeHandler(buildDb(), fakeRender)({
      httpMethod: 'GET',
      queryStringParameters: { slug: 'ana-pro' },
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-forwarded-proto': 'https', host: 'perfilapro.es' },
    });
    expect(fakeRender).toHaveBeenCalledWith(expect.objectContaining({ siteUrl: 'https://perfilapro.es' }));
  });

  it('devuelve 500 si el renderer falla', async () => {
    fakeRender.mockRejectedValueOnce(new Error('satori boom'));
    const res = await makeHandler(buildDb(), fakeRender)(buildEvent());
    expect(res.statusCode).toBe(500);
  });

  it('devuelve 429 al superar el límite por IP (30 req / 10 min)', async () => {
    const handler = makeHandler(buildDb(), fakeRender);
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
  });
});
