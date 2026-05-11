import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/upload-org-logo.js';

// --- Mocks ---

const mockUpload       = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorageBucket = {
  upload:       mockUpload,
  getPublicUrl: mockGetPublicUrl,
};
const mockStorage = { from: vi.fn(() => mockStorageBucket) };

const mockMaybeSingle = vi.fn();
const mockDbUpdate    = vi.fn();
const mockDbFrom = vi.fn();
const mockDb = { from: mockDbFrom };

const handler = makeHandler(mockStorage, mockDb);

// --- Helpers ---

function buildEvent({ method = 'POST', body = {}, password = 'admin123' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password },
    body: JSON.stringify(body),
  };
}

const tinyPngBase64 = Buffer.from('PNGDATA').toString('base64');

// --- Tests ---

describe('upload-org-logo handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;

    mockMaybeSingle.mockResolvedValue({
      data: { id: 'uuid-iris', slug: 'iris', logo_url: null },
      error: null,
    });

    // db.from('organizations').select(...).eq().is().maybeSingle()
    //  + db.from('organizations').update(...).eq(...)
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    };
    const updateChain = {
      eq: vi.fn(() => Promise.resolve({ error: null })),
    };
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
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza sin auth con 401', async () => {
    const res = await handler(buildEvent({ password: 'wrong', body: { slug: 'iris', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza si faltan campos', async () => {
    const res = await handler(buildEvent({ body: { slug: 'iris' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Faltan campos');
  });

  it('rechaza slug inválido', async () => {
    const res = await handler(buildEvent({ body: { slug: 'IRIS', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('slug');
  });

  it('rechaza mime no permitido', async () => {
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: tinyPngBase64, contentType: 'application/pdf' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Tipo no permitido');
  });

  it('rechaza archivo vacío', async () => {
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: '', contentType: 'image/png' } }));
    expect(res.statusCode).toBe(400);
  });

  it('rechaza archivo de más de 2 MB', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: Buffer.from(big).toString('base64'), contentType: 'image/png' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('demasiado grande');
  });

  it('devuelve 404 si la org no existe', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await handler(buildEvent({ body: { slug: 'no-existe', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(404);
  });

  it('sube el logo y actualiza la org', async () => {
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.logo_url).toContain('supabase.co');

    // Verifica que el filename empieza con org-logos/iris-
    const uploadCall = mockUpload.mock.calls[0];
    expect(uploadCall[0]).toMatch(/^org-logos\/iris-\d+\.png$/);
    expect(uploadCall[2].contentType).toBe('image/png');
    expect(uploadCall[2].upsert).toBe(false);

    // Verifica que se llamó UPDATE en organizations
    expect(mockDbUpdate).toHaveBeenCalledWith({ logo_url: json.logo_url });
  });

  it('acepta image/svg+xml y le pone extensión svg', async () => {
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: tinyPngBase64, contentType: 'image/svg+xml' } }));
    expect(res.statusCode).toBe(200);
    expect(mockUpload.mock.calls[0][0]).toMatch(/\.svg$/);
  });

  it('devuelve 500 si Supabase storage falla al subir', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'bucket not found' } });
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('bucket not found');
  });

  it('devuelve 500 si el UPDATE de organizations falla', async () => {
    mockDbUpdate.mockReturnValue({
      eq: vi.fn(() => Promise.resolve({ error: { message: 'db down' } })),
    });
    const res = await handler(buildEvent({ body: { slug: 'iris', base64: tinyPngBase64, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(500);
  });
});
