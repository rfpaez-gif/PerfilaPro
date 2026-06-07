import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/upload-carnet-sponsor-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Espejo de upload-org-logo-panel: auth JWT del panel, sin slug en el body.
// Escribe organizations.carnet_sponsor_url y solo aplica a sports_club.

const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorage = { from: vi.fn(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl })) };

const mockMaybeSingle = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbFrom = vi.fn();
const mockDb = { from: mockDbFrom };

const handler = makeHandler(mockStorage, mockDb);
const png = Buffer.from('PNGDATA').toString('base64');

function ev({ method = 'POST', body = {}, token, ip = '8.8.8.8' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: method, headers, body: JSON.stringify(body) };
}

describe('upload-carnet-sponsor-panel', () => {
  let token;
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'test-panel-secret';
    token = signPanelSession({ orgId: 'club-1', orgSlug: 'cd-test' });

    mockMaybeSingle.mockResolvedValue({ data: { id: 'club-1', slug: 'cd-test', kind: 'sports_club' }, error: null });
    const selectChain = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle };
    mockDbUpdate.mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) });
    mockDbFrom.mockReturnValue({ select: vi.fn(() => selectChain), update: mockDbUpdate });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/Avatars/carnet-sponsors/cd-test-1.png' } });
  });

  it('410 si el carril cantera está off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await handler(ev({ token, body: { base64: png, contentType: 'image/png' } }))).statusCode).toBe(410);
  });
  it('401 sin token', async () => {
    expect((await handler(ev({ body: { base64: png, contentType: 'image/png' } }))).statusCode).toBe(401);
  });
  it('400 sin campos', async () => {
    expect((await handler(ev({ token, body: {} }))).statusCode).toBe(400);
  });
  it('400 MIME no permitido', async () => {
    expect((await handler(ev({ token, body: { base64: png, contentType: 'image/gif' } }))).statusCode).toBe(400);
  });
  it('409 si la org no es sports_club', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'club-1', slug: 'cd-test', kind: 'business' }, error: null });
    expect((await handler(ev({ token, body: { base64: png, contentType: 'image/png' } }))).statusCode).toBe(409);
  });
  it('200 sube y escribe carnet_sponsor_url', async () => {
    const res = await handler(ev({ token, body: { base64: png, contentType: 'image/png' } }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.carnet_sponsor_url).toContain('/Avatars/carnet-sponsors/');
    expect(mockUpload.mock.calls[0][0]).toMatch(/^carnet-sponsors\/cd-test-\d+\.png$/);
    expect(mockDbUpdate).toHaveBeenCalledWith({ carnet_sponsor_url: out.carnet_sponsor_url });
  });
});
