import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/upload-org-logo-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Espejo del test de upload-org-logo.js pero con auth JWT del panel
// (lib/panel-auth) y sin slug en el body — viene del JWT.

const mockUpload       = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorageBucket = { upload: mockUpload, getPublicUrl: mockGetPublicUrl };
const mockStorage = { from: vi.fn(() => mockStorageBucket) };

const mockMaybeSingle = vi.fn();
const mockDbUpdate    = vi.fn();
const mockDbFrom      = vi.fn();
const mockDb = { from: mockDbFrom };

const handler = makeHandler(mockStorage, mockDb);

const tinyPngBase64 = Buffer.from('PNGDATA').toString('base64');

function buildEvent({ method = 'POST', body = {}, token, ip = '8.8.8.8' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    httpMethod: method,
    headers,
    body: JSON.stringify(body),
  };
}

describe('upload-org-logo-panel handler', () => {
  let validToken;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-panel-secret';
    validToken = signPanelSession({ orgId: 'uuid-iris', orgSlug: 'iris' });

    mockMaybeSingle.mockResolvedValue({
      data: { id: 'uuid-iris', slug: 'iris' },
      error: null,
    });

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    };
    const updateChain = { eq: vi.fn(() => Promise.resolve({ error: null })) };
    mockDbUpdate.mockReturnValue(updateChain);
    mockDbFrom.mockReturnValue({
      select: vi.fn(() => selectChain),
      update: mockDbUpdate,
    });

    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://abc.supabase.co/storage/v1/object/public/Avatars/org-logos/iris-123.png' },
    });
  });

  it('rechaza GET con 405', async () => {
    const res = await handler(buildEvent({ method: 'GET', token: validToken }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza sin Authorization con 401', async () => {
    const res = await handler(buildEvent({ body: { base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza JWT mal firmado con 401', async () => {
    const res = await handler(buildEvent({
      token: 'not.a.real.jwt',
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza si faltan campos', async () => {
    const res = await handler(buildEvent({ token: validToken, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Faltan campos');
  });

  it('rechaza mime no permitido', async () => {
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'application/pdf' },
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Tipo no permitido');
  });

  it('rechaza archivo vacío', async () => {
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: '', contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(400);
  });

  it('rechaza archivo de más de 2 MB', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: Buffer.from(big).toString('base64'), contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('demasiado grande');
  });

  it('rechaza si la org del JWT no existe (soft-deleted o desaparecida)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    // La org del JWT no resuelve → sesión inservible → 401, mismo patrón que org-panel.
    expect(res.statusCode).toBe(401);
  });

  it('sube el logo y actualiza la org del JWT', async () => {
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.slug).toBe('iris');
    expect(json.logo_url).toContain('supabase.co');

    // Filename derivado del slug del JWT (org.slug).
    const uploadCall = mockUpload.mock.calls[0];
    expect(uploadCall[0]).toMatch(/^org-logos\/iris-\d+\.png$/);
    expect(uploadCall[2].contentType).toBe('image/png');
    expect(uploadCall[2].upsert).toBe(false);

    expect(mockDbUpdate).toHaveBeenCalledWith({ logo_url: json.logo_url });
  });

  it('acepta image/svg+xml y le pone extensión svg', async () => {
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/svg+xml' },
    }));
    expect(res.statusCode).toBe(200);
    expect(mockUpload.mock.calls[0][0]).toMatch(/\.svg$/);
  });

  it('un slug en el body NO afecta — sólo se usa el del JWT', async () => {
    // Aunque el atacante mande `slug: 'otra-org'`, el handler debe ignorarlo:
    // el filename y el UPDATE van sobre la org del JWT (iris).
    const res = await handler(buildEvent({
      token: validToken,
      body: { slug: 'otra-org', base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(200);
    expect(mockUpload.mock.calls[0][0]).toMatch(/^org-logos\/iris-\d+\.png$/);
  });

  it('devuelve 500 si Supabase storage falla al subir', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'bucket not found' } });
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('bucket not found');
  });

  it('devuelve 500 si el UPDATE de organizations falla', async () => {
    mockDbUpdate.mockReturnValue({
      eq: vi.fn(() => Promise.resolve({ error: { message: 'db down' } })),
    });
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(500);
  });

  it('un JWT del agente NO funciona aquí (purpose=org-panel obligatorio)', async () => {
    // Forjamos un token con purpose distinto al esperado por authFromEvent.
    const jwt = require('jsonwebtoken');
    const wrongToken = jwt.sign(
      { purpose: 'agent', orgId: 'uuid-iris', orgSlug: 'iris' },
      'test-panel-secret',
      { expiresIn: '7d' }
    );
    const res = await handler(buildEvent({
      token: wrongToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(401);
  });

  it('rate-limit: el 21º POST en la misma ventana devuelve 429', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await handler(buildEvent({
        token: validToken,
        body: { base64: tinyPngBase64, contentType: 'image/png' },
      }));
      expect(res.statusCode).toBe(200);
    }
    const res = await handler(buildEvent({
      token: validToken,
      body: { base64: tinyPngBase64, contentType: 'image/png' },
    }));
    expect(res.statusCode).toBe(429);
  });
});
