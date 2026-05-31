import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

// Mock chainable: cada from(table) acumula filtros .eq() y resuelve vía
// resolver por tabla en .then / .maybeSingle / .single.
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

function event(action, body = {}, token) {
  const headers = { 'x-forwarded-for': '9.9.9.9' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: 'POST', headers, body: JSON.stringify({ action, ...body }) };
}

describe('org-panel · Cantera enrollment (capa I3)', () => {
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

  // El SELECT compartido de arriba pide la org base; loadSportsOrg re-resuelve
  // con SELECT *. Ambos van a resolvers['organizations'].
  const baseResolvers = (extra = {}) => ({
    organizations: () => ({ data: SPORTS_ORG, error: null }),
    ...extra,
  });

  it('410 si el carril está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const db = makeDb(baseResolvers());
    const res = await makeHandler(db, null)(event('enrollment_get', {}, token));
    expect(res.statusCode).toBe(410);
  });

  it('400 si la org no es sports_club', async () => {
    const db = makeDb({ organizations: () => ({ data: { ...SPORTS_ORG, kind: 'business' }, error: null }) });
    const res = await makeHandler(db, null)(event('enrollment_open', {}, token));
    expect(res.statusCode).toBe(400);
  });

  it('enrollment_get sin campaña abierta → campaign null', async () => {
    const db = makeDb(baseResolvers({ enrollment_campaigns: () => ({ data: null, error: null }) }));
    const res = await makeHandler(db, null)(event('enrollment_get', {}, token));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).campaign).toBeNull();
  });

  it('enrollment_get con campaña abierta → url + submitted_count', async () => {
    const campaign = { id: 'camp-1', organization_id: 'org-1', season: '2025-26', status: 'open', public_token: 'abc123', matricula_cents: 3500, monthly_fee_cents: 3000, num_installments: 9, created_at: '2025-08-01T00:00:00Z' };
    const db = makeDb(baseResolvers({
      enrollment_campaigns: () => ({ data: campaign, error: null }),
      member_club_seasons: () => ({ data: [{ id: 'm1' }, { id: 'm2' }], error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_get', {}, token));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body).campaign;
    expect(out.url).toBe('https://perfilapro.es/es/inscripcion/abc123');
    expect(out.submitted_count).toBe(2);
    expect(out.matricula_cents).toBe(3500);
  });

  it('enrollment_open crea campaña con token y cuota del club por defecto', async () => {
    let inserted = null;
    const db = makeDb(baseResolvers({
      enrollment_campaigns: (filters) => {
        // El check de existente (status=open) devuelve null; el insert
        // devuelve la fila creada.
        if (inserted) return { data: inserted, error: null };
        return { data: null, error: null };
      },
    }));
    // Interceptamos el insert para capturar la fila y devolverla en single().
    const origFrom = db.from;
    db.from = vi.fn((t) => {
      const chain = origFrom(t);
      if (t === 'enrollment_campaigns') {
        chain.insert = vi.fn((row) => { inserted = { ...row, id: 'camp-new', created_at: '2025-08-10T00:00:00Z' }; return chain; });
        chain.single = vi.fn(() => Promise.resolve({ data: inserted, error: null }));
      }
      return chain;
    });
    const res = await makeHandler(db, null)(event('enrollment_open', { season: '2025-26', matricula_cents: 4000 }, token));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body).campaign;
    expect(out.public_token).toMatch(/^[0-9a-f]{32}$/);
    expect(out.matricula_cents).toBe(4000);
    expect(out.monthly_fee_cents).toBe(3000); // cuota del club
    expect(out.num_installments).toBe(9);
    expect(inserted.organization_id).toBe('org-1');
  });

  it('enrollment_open 409 si ya hay campaña abierta esa temporada', async () => {
    const db = makeDb(baseResolvers({
      enrollment_campaigns: () => ({ data: { id: 'camp-existing' }, error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_open', { season: '2025-26' }, token));
    expect(res.statusCode).toBe(409);
  });

  it('enrollment_open 400 con importe inválido', async () => {
    const db = makeDb(baseResolvers());
    const res = await makeHandler(db, null)(event('enrollment_open', { matricula_cents: -5 }, token));
    expect(res.statusCode).toBe(400);
  });

  it('enrollment_close cierra una campaña del propio club', async () => {
    const db = makeDb(baseResolvers({
      enrollment_campaigns: () => ({ data: { id: 'camp-1', organization_id: 'org-1', status: 'open' }, error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_close', { campaign_id: 'camp-1' }, token));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('closed');
  });

  it('enrollment_close 404 si la campaña es de otro club', async () => {
    const db = makeDb(baseResolvers({
      enrollment_campaigns: () => ({ data: { id: 'camp-1', organization_id: 'OTRO', status: 'open' }, error: null }),
    }));
    const res = await makeHandler(db, null)(event('enrollment_close', { campaign_id: 'camp-1' }, token));
    expect(res.statusCode).toBe(404);
  });

  it('enrollment_close 400 sin campaign_id', async () => {
    const db = makeDb(baseResolvers());
    const res = await makeHandler(db, null)(event('enrollment_close', {}, token));
    expect(res.statusCode).toBe(400);
  });
});
