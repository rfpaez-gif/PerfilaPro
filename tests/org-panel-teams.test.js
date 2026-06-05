import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

// Mock chainable (mismo patrón que org-panel-enrollment.test.js).
function makeChain(resolver) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gte', 'update', 'insert']) {
    q[m] = vi.fn((...args) => { if (m === 'eq' && args.length >= 2) filters[args[0]] = args[1]; return q; });
  }
  q.maybeSingle = vi.fn(() => Promise.resolve(resolver(filters)));
  q.single = vi.fn(() => Promise.resolve(resolver(filters)));
  q.then = (res, rej) => Promise.resolve(resolver(filters)).then(res, rej);
  return q;
}
function makeDb(resolvers) {
  return { from: vi.fn((t) => makeChain(resolvers[t] || (() => ({ data: [], error: null })))) };
}

const SPORTS_ORG = {
  id: 'org-1', name: 'CD Test', slug: 'cd-test', kind: 'sports_club', sport: 'futbol',
  cantera_monthly_fee_cents: 3000, color_primary: '#00aa00', logo_url: null,
  stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: false, deleted_at: null,
};

const CAT_ALEVIN = '11111111-1111-4111-8111-111111111111';
const CAT_INFANTIL = '22222222-2222-4222-8222-222222222222';
const TEAM_A = '33333333-3333-4333-8333-333333333333';

const CATALOG = [
  { id: CAT_ALEVIN, sport: 'futbol', code: 'alevin', display_name_es: 'Alevín', display_name_ca: 'Aleví', min_birth_year_offset: -11, max_birth_year_offset: -10, sort_order: 30 },
  { id: CAT_INFANTIL, sport: 'futbol', code: 'infantil', display_name_es: 'Infantil', display_name_ca: 'Infantil', min_birth_year_offset: -13, max_birth_year_offset: -12, sort_order: 40 },
];

function event(action, body = {}, token) {
  const headers = { 'x-forwarded-for': '9.9.9.9' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: 'POST', headers, body: JSON.stringify({ action, ...body }) };
}

describe('org-panel · equipos del club (migración 040)', () => {
  let token;
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    token = signPanelSession({ orgId: 'org-1', orgSlug: 'cd-test' });
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.ORG_PANEL_JWT_SECRET;
  });

  const base = (extra = {}) => ({
    organizations: () => ({ data: SPORTS_ORG, error: null }),
    sports_categories: () => ({ data: CATALOG, error: null }),
    ...extra,
  });

  it('410 si el carril está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeHandler(makeDb(base()), null)(event('teams_list', {}, token));
    expect(res.statusCode).toBe(410);
  });

  it('400 si la org no es sports_club', async () => {
    const db = makeDb({ organizations: () => ({ data: { ...SPORTS_ORG, kind: 'business' }, error: null }) });
    const res = await makeHandler(db, null)(event('teams_list', {}, token));
    expect(res.statusCode).toBe(400);
  });

  it('teams_list devuelve equipos con categoría y conteo de jugadores', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: [{ id: TEAM_A, name: 'Cadete A', category_id: CAT_ALEVIN, color: '#112233', sort_order: 0 }], error: null }),
      member_club_seasons: () => ({ data: [
        { team_id: TEAM_A, role: 'jugador' },
        { team_id: TEAM_A, role: 'jugador' },
        { team_id: null, role: 'jugador' },
      ], error: null }),
    }));
    const res = await makeHandler(db, null)(event('teams_list', {}, token));
    expect(res.statusCode).toBe(200);
    const teams = JSON.parse(res.body).teams;
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ id: TEAM_A, name: 'Cadete A', category_name: 'Alevín', player_count: 2 });
  });

  it('team_create crea el equipo', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: { id: TEAM_A, name: 'Cadete A', category_id: CAT_ALEVIN, color: null, sort_order: 0 }, error: null }),
    }));
    const res = await makeHandler(db, null)(event('team_create', { name: 'Cadete A', category_id: CAT_ALEVIN }, token));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).team.name).toBe('Cadete A');
  });

  it('team_create 400 sin nombre', async () => {
    const res = await makeHandler(makeDb(base()), null)(event('team_create', { name: '', category_id: CAT_ALEVIN }, token));
    expect(res.statusCode).toBe(400);
  });

  it('team_create 400 si la categoría no es del club', async () => {
    const res = await makeHandler(makeDb(base()), null)(event('team_create', { name: 'X', category_id: '99999999-9999-4999-8999-999999999999' }, token));
    expect(res.statusCode).toBe(400);
  });

  it('team_create 409 si el nombre ya existe (unique)', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: null, error: { message: 'duplicate key value violates unique constraint' } }),
    }));
    const res = await makeHandler(db, null)(event('team_create', { name: 'Cadete A', category_id: CAT_ALEVIN }, token));
    expect(res.statusCode).toBe(409);
  });

  it('team_update renombra', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: [{ id: TEAM_A, name: 'Cadete B', category_id: CAT_ALEVIN, color: null, sort_order: 0 }], error: null }),
    }));
    const res = await makeHandler(db, null)(event('team_update', { team_id: TEAM_A, name: 'Cadete B' }, token));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).team.name).toBe('Cadete B');
  });

  it('team_delete soft-borra y desasigna jugadores', async () => {
    const updates = [];
    const db = {
      from: vi.fn((t) => {
        if (t === 'organizations') return makeChain(() => ({ data: SPORTS_ORG, error: null }));
        if (t === 'member_club_seasons') {
          const q = makeChain(() => ({ data: [], error: null }));
          const origUpdate = q.update;
          q.update = vi.fn((patch) => { updates.push(patch); return origUpdate(patch); });
          return q;
        }
        if (t === 'club_teams') return makeChain(() => ({ data: [{ id: TEAM_A }], error: null }));
        return makeChain(() => ({ data: [], error: null }));
      }),
    };
    const res = await makeHandler(db, null)(event('team_delete', { team_id: TEAM_A }, token));
    expect(res.statusCode).toBe(200);
    // Desasignó a los jugadores del equipo (team_id + team_name a null).
    expect(updates).toContainEqual({ team_id: null, team_name: null });
  });

  it('get_roster devuelve teams y resuelve team_name desde team_id', async () => {
    const db = makeDb(base({
      member_club_seasons: () => ({ data: [
        { card_slug: 'p-00000001', role: 'jugador', dorsal: 10, position: 'DEL', category_id: CAT_ALEVIN, team_id: TEAM_A, team_name: null, season: '2025-26', previous_club_name: null },
      ], error: null }),
      cards: () => ({ data: [{ slug: 'p-00000001', nombre: 'Ana', foto_url: null, public_card: false, birth_year: 2015, card_kind: 'player' }], error: null }),
      club_teams: () => ({ data: [{ id: TEAM_A, name: 'Cadete A', category_id: CAT_ALEVIN, color: null, sort_order: 0 }], error: null }),
    }));
    const res = await makeHandler(db, null)(event('get_roster', {}, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0]).toMatchObject({ id: TEAM_A, name: 'Cadete A', player_count: 1 });
    const player = body.categories[0].members[0];
    expect(player.team_id).toBe(TEAM_A);
    expect(player.team_name).toBe('Cadete A');
  });

  it('enrollment_assign rechaza un team_id que no es del club', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: [{ id: TEAM_A, name: 'Cadete A', category_id: CAT_ALEVIN, color: null, sort_order: 0 }], error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_assign', {
      assignments: [{ card_slug: 'p-00000001', team_id: '88888888-8888-4888-8888-888888888888' }],
    }, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.ok).toHaveLength(0);
    expect(body.results.failed[0].error).toMatch(/no pertenece/);
  });

  it('enrollment_assign acepta un team_id del club', async () => {
    const db = makeDb(base({
      club_teams: () => ({ data: [{ id: TEAM_A, name: 'Cadete A', category_id: CAT_ALEVIN, color: null, sort_order: 0 }], error: null }),
      member_club_seasons: () => ({ data: [{ card_slug: 'p-00000001' }], error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_assign', {
      assignments: [{ card_slug: 'p-00000001', team_id: TEAM_A, dorsal: 9 }],
    }, token));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).results.ok).toEqual(['p-00000001']);
  });
});
