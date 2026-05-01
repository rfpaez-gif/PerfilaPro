import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/admin-regenerate-seed.js';

const mockRegenerate = vi.fn();
const mockGetEnv = vi.fn();
const mockDb = { from: vi.fn(), storage: { from: vi.fn() } };

const handler = makeHandler({ db: mockDb, regenerate: mockRegenerate, getEnv: mockGetEnv });

function buildEvent({ method = 'POST', body = {}, password = 'admin123' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_PASSWORD = 'admin123';
  delete process.env.ADMIN_TOTP_SECRET;
  mockGetEnv.mockImplementation((k) => k === 'GEMINI_API_KEY' ? 'gem-key' : undefined);
});

describe('admin-regenerate-seed handler', () => {
  it('devuelve 405 si el método no es POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body).error).toBe('method_not_allowed');
  });

  it('devuelve 401 sin contraseña', async () => {
    const res = await handler(buildEvent({ password: '' }));
    expect(res.statusCode).toBe(401);
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it('devuelve 401 con contraseña incorrecta', async () => {
    const res = await handler(buildEvent({ password: 'wrong', body: { slug: 'x' } }));
    expect(res.statusCode).toBe(401);
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it('devuelve 400 si el JSON es inválido', async () => {
    const res = await handler(buildEvent({ body: '{not json' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_json');
  });

  it('devuelve 400 si falta el slug', async () => {
    const res = await handler(buildEvent({ body: {} }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('missing_slug');
  });

  it('devuelve 500 si no hay GEMINI_API_KEY configurada', async () => {
    mockGetEnv.mockImplementation(() => undefined);
    const res = await handler(buildEvent({ body: { slug: 'seed-x' } }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('no_api_key');
  });

  it('devuelve 200 + foto_url cuando regenerate tiene éxito', async () => {
    mockRegenerate.mockResolvedValueOnce({ slug: 'seed-x', foto_url: 'https://x/y.jpg?v=1' });
    const res = await handler(buildEvent({ body: { slug: 'seed-x' } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.foto_url).toBe('https://x/y.jpg?v=1');

    expect(mockRegenerate).toHaveBeenCalledOnce();
    const [db, slug, opts] = mockRegenerate.mock.calls[0];
    expect(db).toBe(mockDb);
    expect(slug).toBe('seed-x');
    expect(opts.apiKey).toBe('gem-key');
  });

  it('devuelve 404 si regenerate lanza card_not_found', async () => {
    mockRegenerate.mockRejectedValueOnce(new Error('card_not_found'));
    const res = await handler(buildEvent({ body: { slug: 'no-existe' } }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('card_not_found');
  });

  it('devuelve 502 si regenerate lanza gemini_http_429', async () => {
    mockRegenerate.mockRejectedValueOnce(new Error('gemini_http_429: quota exceeded'));
    const res = await handler(buildEvent({ body: { slug: 'seed-x' } }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toContain('gemini_http_429');
  });

  it('devuelve 502 si regenerate lanza no_image_returned', async () => {
    mockRegenerate.mockRejectedValueOnce(new Error('no_image_returned: blocked'));
    const res = await handler(buildEvent({ body: { slug: 'seed-x' } }));
    expect(res.statusCode).toBe(502);
  });

  it('devuelve 500 para errores genéricos (upload_error, update_error)', async () => {
    mockRegenerate.mockRejectedValueOnce(new Error('upload_error: bucket missing'));
    const res = await handler(buildEvent({ body: { slug: 'seed-x' } }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('upload_error');
  });

  it('trim del slug y rechazo de slug solo-espacios', async () => {
    const res = await handler(buildEvent({ body: { slug: '   ' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('missing_slug');
  });
});
