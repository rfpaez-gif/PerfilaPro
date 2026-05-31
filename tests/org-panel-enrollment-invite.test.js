import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

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
  id: 'org-1', name: 'EF Universal', slug: 'ef-universal', kind: 'sports_club', sport: 'futbol',
  cantera_monthly_fee_cents: 3000, color_primary: '#1b9e57', logo_url: null,
  stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: true, deleted_at: null,
};
const OPEN_CAMPAIGN = { public_token: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', season: '2026-27', status: 'open' };

function event(action, body, token) {
  return { httpMethod: 'POST', headers: { 'x-forwarded-for': '8.8.8.8', authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...body }) };
}

describe('org-panel · enrollment_invite (invitación múltiple, Opción A)', () => {
  let token;
  const mockSend = vi.fn();
  const emailClient = { emails: { send: mockSend } };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    token = signPanelSession({ orgId: 'org-1', orgSlug: 'ef-universal' });
  });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; delete process.env.ORG_PANEL_JWT_SECRET; });

  const base = (extra = {}) => ({ organizations: () => ({ data: SPORTS_ORG, error: null }), ...extra });

  it('envía invitaciones con el enlace de la campaña abierta', async () => {
    const db = makeDb(base({ enrollment_campaigns: () => ({ data: OPEN_CAMPAIGN, error: null }) }));
    const res = await makeHandler(db, emailClient)(event('enrollment_invite', {
      invites: [{ email: 'madre@e.es', nombre: 'Ana' }, { email: 'padre@e.es' }],
    }, token));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.results.ok).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    // El email lleva el enlace público de la campaña.
    expect(mockSend.mock.calls[0][0].html).toContain('inscripcion/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
  });

  it('409 si no hay campaña abierta', async () => {
    const db = makeDb(base({ enrollment_campaigns: () => ({ data: null, error: null }) }));
    const res = await makeHandler(db, emailClient)(event('enrollment_invite', { invites: [{ email: 'a@b.es' }] }, token));
    expect(res.statusCode).toBe(409);
  });

  it('400 si no hay emails válidos', async () => {
    const db = makeDb(base({ enrollment_campaigns: () => ({ data: OPEN_CAMPAIGN, error: null }) }));
    const res = await makeHandler(db, emailClient)(event('enrollment_invite', { invites: [{ email: 'malo' }] }, token));
    expect(res.statusCode).toBe(400);
  });

  it('reporta inválidos junto a los enviados', async () => {
    const db = makeDb(base({ enrollment_campaigns: () => ({ data: OPEN_CAMPAIGN, error: null }) }));
    const res = await makeHandler(db, emailClient)(event('enrollment_invite', {
      invites: [{ email: 'ok@e.es' }, { email: 'malo' }],
    }, token));
    const out = JSON.parse(res.body);
    expect(out.results.ok).toEqual(['ok@e.es']);
    expect(out.results.failed.some(f => f.email === 'malo' || /malo/.test(JSON.stringify(f)))).toBe(true);
  });

  it('410 si el carril está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const db = makeDb(base());
    const res = await makeHandler(db, emailClient)(event('enrollment_invite', { invites: [{ email: 'a@b.es' }] }, token));
    expect(res.statusCode).toBe(410);
  });
});
