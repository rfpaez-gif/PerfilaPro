import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler as makeSetup } from '../netlify/functions/create-setup-fee-checkout.js';
import { makeHandler as makeRecord } from '../netlify/functions/record-external-payment.js';
import { signPanelSession, signParentSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);
const orgBearer = (orgId = 'club-1', orgSlug = 'cd-test') => `Bearer ${signPanelSession({ orgId, orgSlug })}`;
function ev({ method = 'POST', body = {}, auth, ip = '1.1.1.1' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = auth;
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

// ─────────────────── create-setup-fee-checkout ───────────────────

function setupDb({ org = { id: 'club-1', kind: 'sports_club', deleted_at: null }, cards = [{ slug: 'p-1', organization_id: 'club-1', card_kind: 'player', deleted_at: null }], insErr = null } = {}) {
  const inserts = [];
  return {
    inserts,
    from: vi.fn((t) => {
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: org, error: null }) }) }) };
      if (t === 'cards') return { select: () => ({ in: resolve({ data: cards, error: null }) }) };
      if (t === 'card_print_orders') return { insert: (rows) => { inserts.push(rows); return Promise.resolve({ error: insErr }); } };
      return {};
    }),
  };
}
function setupStripe() {
  const create = vi.fn().mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/x' });
  return { create, checkout: { sessions: { create } } };
}

describe('create-setup-fee-checkout', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
    process.env.STRIPE_PRICE_PLAYER_SETUP_FEE = 'price_setup';
    process.env.SITE_URL = 'https://perfilapro.es';
    delete process.env.URL;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE; delete process.env.ORG_PANEL_JWT_SECRET;
    delete process.env.STRIPE_PRICE_PLAYER_SETUP_FEE; delete process.env.STRIPE_PRICE_PLAYER_RENEWAL;
  });

  it('410 carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeSetup(setupStripe(), setupDb())(ev({ auth: orgBearer(), body: { card_slugs: ['p-1'] } }))).statusCode).toBe(410);
  });
  it('503 sin Stripe', async () => {
    expect((await makeSetup(null, setupDb())(ev({ auth: orgBearer(), body: { card_slugs: ['p-1'] } }))).statusCode).toBe(503);
  });
  it('503 si el precio no está configurado', async () => {
    delete process.env.STRIPE_PRICE_PLAYER_SETUP_FEE;
    expect((await makeSetup(setupStripe(), setupDb())(ev({ auth: orgBearer(), body: { card_slugs: ['p-1'] } }))).statusCode).toBe(503);
  });
  it('400 sin card_slugs', async () => {
    expect((await makeSetup(setupStripe(), setupDb())(ev({ auth: orgBearer(), body: {} }))).statusCode).toBe(400);
  });
  it('400 si ningún jugador es válido del club', async () => {
    const db = setupDb({ cards: [{ slug: 'p-1', organization_id: 'OTRO', card_kind: 'player', deleted_at: null }] });
    expect((await makeSetup(setupStripe(), db)(ev({ auth: orgBearer(), body: { card_slugs: ['p-1'] } }))).statusCode).toBe(400);
  });
  it('200 crea checkout payment + print orders pending enlazados a la sesión', async () => {
    const db = setupDb({ cards: [{ slug: 'p-1', organization_id: 'club-1', card_kind: 'player', deleted_at: null }, { slug: 'p-2', organization_id: 'club-1', card_kind: 'player', deleted_at: null }] });
    const stripe = setupStripe();
    const res = await makeSetup(stripe, db)(ev({ auth: orgBearer(), body: { card_slugs: ['p-1', 'p-2'], kind: 'setup' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).count).toBe(2);
    const [params] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items[0]).toEqual({ price: 'price_setup', quantity: 2 });
    // print orders pending con la sesión
    expect(db.inserts[0]).toHaveLength(2);
    expect(db.inserts[0][0]).toMatchObject({ status: 'pending', kind: 'setup', stripe_payment_intent_id: 'cs_123', organization_id: 'club-1' });
  });
  it('403 si la org no es sports_club', async () => {
    const db = setupDb({ org: { id: 'club-1', kind: 'business', deleted_at: null } });
    expect((await makeSetup(setupStripe(), db)(ev({ auth: orgBearer(), body: { card_slugs: ['p-1'] } }))).statusCode).toBe(403);
  });
});

// ─────────────────── record-external-payment ───────────────────

function recDb({ org = { id: 'club-1', slug: 'cd-test', kind: 'sports_club', deleted_at: null }, card = { slug: 'p-1', organization_id: 'club-1', card_kind: 'player', deleted_at: null }, insertResult = { data: { id: 'pay-1' }, error: null }, listResult = { data: [{ id: 'x' }], error: null } } = {}) {
  const inserted = [];
  return {
    inserted,
    from: vi.fn((t) => {
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: org, error: null }) }) }) };
      if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
      if (t === 'external_payments') return {
        insert: (row) => { inserted.push(row); return { select: () => ({ single: resolve(insertResult) }) }; },
        select: () => ({ eq: () => ({ order: () => ({ limit: resolve(listResult) }) }) }),
      };
      return {};
    }),
  };
}

describe('record-external-payment', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
  });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; delete process.env.ORG_PANEL_JWT_SECRET; });

  const VALID = { action: 'record', card_slug: 'p-1', amount_cents: 4500, method: 'bizum', period: '2026-05' };

  it('401 sin JWT', async () => {
    expect((await makeRecord(recDb())(ev({ body: VALID }))).statusCode).toBe(401);
  });
  it('401 con JWT parent (purpose distinto)', async () => {
    process.env.PARENT_PANEL_JWT_SECRET = 'p';
    const auth = `Bearer ${signParentSession({ email: 'a@b.es' })}`;
    expect((await makeRecord(recDb())(ev({ auth, body: VALID }))).statusCode).toBe(401);
    delete process.env.PARENT_PANEL_JWT_SECRET;
  });
  it('404 si el jugador no es del club', async () => {
    const db = recDb({ card: { slug: 'p-1', organization_id: 'OTRO', card_kind: 'player', deleted_at: null } });
    expect((await makeRecord(db)(ev({ auth: orgBearer(), body: VALID }))).statusCode).toBe(404);
  });
  it('400 con method inválido', async () => {
    const res = await makeRecord(recDb())(ev({ auth: orgBearer(), body: { ...VALID, method: 'paypal' } }));
    expect(res.statusCode).toBe(400);
  });
  it('201 registra el cobro con recorded_by del club', async () => {
    const db = recDb();
    const res = await makeRecord(db)(ev({ auth: orgBearer(), body: VALID }));
    expect(res.statusCode).toBe(201);
    expect(db.inserted[0]).toMatchObject({ card_slug: 'p-1', organization_id: 'club-1', method: 'bizum', amount_cents: 4500, recorded_by: 'org:cd-test', period: '2026-05' });
  });
  it('list devuelve los cobros del club', async () => {
    const res = await makeRecord(recDb())(ev({ auth: orgBearer(), body: { action: 'list' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).payments).toHaveLength(1);
  });
});
