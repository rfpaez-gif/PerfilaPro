import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/upload-player-photo.js';
import { signParentSession, signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);

// Un PNG mínimo válido en base64 (1x1 transparente).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeStorage({ uploadError = null } = {}) {
  return {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ error: uploadError }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://xyz.supabase.co/storage/v1/object/public/Avatars/players/p-1-123.png' } })),
    })),
  };
}

function makeDb({
  card = { slug: 'p-1', card_kind: 'player', deleted_at: null },
  admin = { id: 'a1' },
  updateError = null,
  storage = makeStorage(),
} = {}) {
  const updateEq = vi.fn(resolve({ error: updateError }));
  const db = {
    storage,
    from: vi.fn((t) => {
      if (t === 'cards') return {
        select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }),
        update: () => ({ eq: updateEq }),
      };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ in: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      return {};
    }),
    _updateEq: updateEq,
  };
  return db;
}

const authHeader = (email = 'tutor@example.com') => `Bearer ${signParentSession({ email })}`;
function ev({ method = 'POST', body = { card_slug: 'p-1', base64: PNG_BASE64, contentType: 'image/png' }, auth = true, ip = '3.3.3.3' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = authHeader();
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

describe('upload-player-photo', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.PARENT_PANEL_JWT_SECRET = 'parent-secret';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.PARENT_PANEL_JWT_SECRET;
    delete process.env.ORG_PANEL_JWT_SECRET;
  });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeDb())(ev())).statusCode).toBe(410);
  });

  it('405 si no es POST', async () => {
    expect((await makeHandler(makeDb())(ev({ method: 'GET' }))).statusCode).toBe(405);
  });

  it('401 sin sesión parent', async () => {
    expect((await makeHandler(makeDb())(ev({ auth: false }))).statusCode).toBe(401);
  });

  it('401 con JWT org (purpose distinto)', async () => {
    const headers = { 'x-forwarded-for': '3.3.3.3', authorization: `Bearer ${signPanelSession({ orgId: 'o', orgSlug: 's' })}` };
    const res = await makeHandler(makeDb())({ httpMethod: 'POST', headers, body: JSON.stringify({ card_slug: 'p-1', base64: PNG_BASE64, contentType: 'image/png' }) });
    expect(res.statusCode).toBe(401);
  });

  it('400 sin card_slug', async () => {
    expect((await makeHandler(makeDb())(ev({ body: { base64: PNG_BASE64, contentType: 'image/png' } }))).statusCode).toBe(400);
  });

  it('400 sin base64/contentType', async () => {
    expect((await makeHandler(makeDb())(ev({ body: { card_slug: 'p-1' } }))).statusCode).toBe(400);
  });

  it('404 si la card no existe', async () => {
    expect((await makeHandler(makeDb({ card: null }))(ev())).statusCode).toBe(404);
  });

  it('404 si la card no es de jugador', async () => {
    expect((await makeHandler(makeDb({ card: { slug: 'p-1', card_kind: 'autonomo', deleted_at: null } }))(ev())).statusCode).toBe(404);
  });

  it('404 si la card está soft-deleted', async () => {
    expect((await makeHandler(makeDb({ card: { slug: 'p-1', card_kind: 'player', deleted_at: '2026-01-01' } }))(ev())).statusCode).toBe(404);
  });

  it('403 si el email no es tutor de la card', async () => {
    expect((await makeHandler(makeDb({ admin: null }))(ev())).statusCode).toBe(403);
  });

  it('400 si el MIME no está permitido', async () => {
    const res = await makeHandler(makeDb())(ev({ body: { card_slug: 'p-1', base64: PNG_BASE64, contentType: 'image/gif' } }));
    expect(res.statusCode).toBe(400);
  });

  it('200 sube la foto y actualiza foto_url', async () => {
    const db = makeDb();
    const res = await makeHandler(db)(ev());
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.foto_url).toContain('supabase.co/storage');
    expect(db._updateEq).toHaveBeenCalledWith('slug', 'p-1');
  });

  it('500 si falla la subida al bucket', async () => {
    const db = makeDb({ storage: makeStorage({ uploadError: { message: 'boom' } }) });
    expect((await makeHandler(db)(ev())).statusCode).toBe(500);
  });

  it('500 si falla el update de foto_url', async () => {
    const db = makeDb({ updateError: { message: 'db down' } });
    expect((await makeHandler(db)(ev())).statusCode).toBe(500);
  });
});
