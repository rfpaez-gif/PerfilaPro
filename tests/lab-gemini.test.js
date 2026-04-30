import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/lab-gemini.js';

const mockFetch = vi.fn();
const mockGetEnv = vi.fn();

const handler = makeHandler({ fetch: mockFetch, getEnv: mockGetEnv });

function buildEvent(body, method = 'POST') {
  return { httpMethod: method, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnv.mockImplementation((k) => {
    if (k === 'ADMIN_PASSWORD') return 'secret';
    if (k === 'GEMINI_API_KEY') return 'gem-key';
    return undefined;
  });
});

describe('lab-gemini handler', () => {
  it('rechaza método != POST', async () => {
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('rechaza JSON inválido', async () => {
    const res = await handler(buildEvent('{not json'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_json');
  });

  it('rechaza contraseña incorrecta', async () => {
    const res = await handler(buildEvent({ password: 'nope', prompt: 'x' }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza prompt vacío', async () => {
    const res = await handler(buildEvent({ password: 'secret', prompt: '   ' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('empty_prompt');
  });

  it('rechaza prompt demasiado largo', async () => {
    const res = await handler(buildEvent({ password: 'secret', prompt: 'a'.repeat(4001) }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('prompt_too_long');
  });

  it('falla si no hay ADMIN_PASSWORD configurada', async () => {
    mockGetEnv.mockImplementation(() => undefined);
    const res = await handler(buildEvent({ password: 'x', prompt: 'y' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('admin_password_not_configured');
  });

  it('falla si no hay GEMINI_API_KEY configurada', async () => {
    mockGetEnv.mockImplementation((k) => k === 'ADMIN_PASSWORD' ? 'secret' : undefined);
    const res = await handler(buildEvent({ password: 'secret', prompt: 'hola' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('no_api_key');
  });

  it('devuelve dataUrl cuando Gemini contesta con imagen', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
          },
        }],
      }),
    });
    const res = await handler(buildEvent({ password: 'secret', prompt: 'mujer albañil' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dataUrl).toBe('data:image/png;base64,AAAA');
    expect(body.bytes).toBeGreaterThan(0);
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('propaga 502 con detalles cuando Gemini devuelve error HTTP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'quota exceeded' } }),
    });
    const res = await handler(buildEvent({ password: 'secret', prompt: 'x' }));
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('gemini_http_429');
    expect(body.details).toBe('quota exceeded');
  });

  it('devuelve 502 si Gemini contesta sin imagen', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'no puedo generar eso' }] } }],
      }),
    });
    const res = await handler(buildEvent({ password: 'secret', prompt: 'x' }));
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('no_image_returned');
    expect(body.modelText).toBe('no puedo generar eso');
  });

  it('atrapa errores de red', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    const res = await handler(buildEvent({ password: 'secret', prompt: 'x' }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe('network_error');
  });
});
