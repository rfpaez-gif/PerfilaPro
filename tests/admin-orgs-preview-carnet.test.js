import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/admin-orgs.js';

const resolve = (v) => () => Promise.resolve(v);

// Mocks por tabla. El render del carnet (buildPlayerCardPVC) corre de verdad
// pero offline: con logo/sponsor/foto en null no hace ninguna fetch (el QR se
// genera local y las fuentes son ficheros locales).
function makeDb({
  card = { slug: 'p-1', nombre: 'Leo', foto_url: null, card_kind: 'player', organization_id: 'club-1' },
  org = { id: 'club-1', slug: 'cd', name: 'CD Test', color_primary: '#00C277', logo_url: null, carnet_sponsor_url: null, sport: 'futbol' },
  ms = { dorsal: 9, team_name: 'Alevín A', category_id: 'cat-1', season: '2025-26' },
  cat = { display_name_es: 'Alevín' },
} = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'cards') return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) }) };
      if (t === 'organizations') return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: org, error: null }) }) }) }) };
      if (t === 'member_club_seasons') return { select: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: () => ({ maybeSingle: resolve({ data: ms, error: null }) }) }) }) }) }) };
      if (t === 'sports_categories') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: cat, error: null }) }) }) };
      return {};
    }),
  };
}

function ev({ method = 'POST', body = { action: 'cantera_preview_carnet', card_slug: 'p-1' }, password = 'admin123' } = {}) {
  const headers = {};
  if (password) headers['x-admin-password'] = password;
  return { httpMethod: method, headers, body: JSON.stringify(body) };
}

describe('admin-orgs · cantera_preview_carnet', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
  });

  it('401 sin password admin', async () => {
    expect((await makeHandler(makeDb())(ev({ password: null }))).statusCode).toBe(401);
  });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeDb())(ev())).statusCode).toBe(410);
  });

  it('400 sin card_slug', async () => {
    const res = await makeHandler(makeDb())(ev({ body: { action: 'cantera_preview_carnet' } }));
    expect(res.statusCode).toBe(400);
  });

  it('404 si la card no existe', async () => {
    expect((await makeHandler(makeDb({ card: null }))(ev())).statusCode).toBe(404);
  });

  it('404 si la card no es de jugador', async () => {
    const card = { slug: 'x', card_kind: 'autonomo', organization_id: 'club-1' };
    expect((await makeHandler(makeDb({ card }))(ev())).statusCode).toBe(404);
  });

  it('400 si el jugador no tiene club activo', async () => {
    const card = { slug: 'p-1', nombre: 'Leo', foto_url: null, card_kind: 'player', organization_id: null };
    expect((await makeHandler(makeDb({ card }))(ev())).statusCode).toBe(400);
  });

  it('404 si el club no existe / está borrado', async () => {
    expect((await makeHandler(makeDb({ org: null }))(ev())).statusCode).toBe(404);
  });

  it('200 genera el carnet en PDF (sin foto → has_photo false)', async () => {
    const res = await makeHandler(makeDb())(ev());
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.filename).toBe('carnet-p-1.pdf');
    expect(json.has_photo).toBe(false);
    // base64 de un PDF real (cabecera %PDF = "JVBER" en base64).
    expect(json.base64.startsWith('JVBER')).toBe(true);
  });

  it('200 también sin membresía activa (season null)', async () => {
    const res = await makeHandler(makeDb({ ms: null }))(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });
});
