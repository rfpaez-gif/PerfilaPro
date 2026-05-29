import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/create-parent-checkout.js';
import { signParentSession, signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);

function makeDb({
  card = { slug: 'p-1', card_kind: 'player', nombre: 'Leo', idioma: 'es', organization_id: 'club-1', deleted_at: null },
  admin = { id: 'a1' },
  org = { id: 'club-1', name: 'CD Test', stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true, cantera_monthly_fee_cents: 3000, deleted_at: null },
  existingSub = null,
} = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ in: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: org, error: null }) }) }) };
      if (t === 'parent_subscriptions') return { select: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: existingSub, error: null }) }) }) }) }) };
      return {};
    }),
  };
}

function makeStripe() {
  const create = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/abc' });
  return { create, checkout: { sessions: { create } } };
}

const authHeader = (email = 'tutor@example.com') => `Bearer ${signParentSession({ email })}`;
function ev({ method = 'POST', body = { card_slug: 'p-1' }, auth = true, ip = '2.2.2.2' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = authHeader();
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

describe('create-parent-checkout', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.PARENT_PANEL_JWT_SECRET = 'parent-secret';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    process.env.STRIPE_PLATFORM_FEE_BPS = '250';
    delete process.env.URL;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.PARENT_PANEL_JWT_SECRET;
    delete process.env.ORG_PANEL_JWT_SECRET;
    delete process.env.STRIPE_PLATFORM_FEE_BPS;
  });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeStripe(), makeDb())(ev())).statusCode).toBe(410);
  });

  it('503 sin Stripe', async () => {
    expect((await makeHandler(null, makeDb())(ev())).statusCode).toBe(503);
  });

  it('401 sin sesión parent', async () => {
    expect((await makeHandler(makeStripe(), makeDb())(ev({ auth: false }))).statusCode).toBe(401);
  });

  it('401 con JWT org (purpose distinto)', async () => {
    const headers = { 'x-forwarded-for': '2.2.2.2', authorization: `Bearer ${signPanelSession({ orgId: 'o', orgSlug: 's' })}` };
    const res = await makeHandler(makeStripe(), makeDb())({ httpMethod: 'POST', headers, body: JSON.stringify({ card_slug: 'p-1' }) });
    expect(res.statusCode).toBe(401);
  });

  it('403 si el email no es tutor de la card', async () => {
    expect((await makeHandler(makeStripe(), makeDb({ admin: null }))(ev())).statusCode).toBe(403);
  });

  it('409 si el club no acepta cobros', async () => {
    const db = makeDb({ org: { id: 'club-1', name: 'X', stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: false, cantera_monthly_fee_cents: 3000, deleted_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('409 si el club no tiene cuota configurada', async () => {
    const db = makeDb({ org: { id: 'club-1', name: 'X', stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true, cantera_monthly_fee_cents: null, deleted_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('409 si ya hay cuota activa', async () => {
    const db = makeDb({ existingSub: { id: 'sub-1' } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('200 crea checkout como direct charge con application_fee_percent', async () => {
    const stripe = makeStripe();
    const res = await makeHandler(stripe, makeDb())(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toContain('checkout.stripe.com');
    const [params, opts] = stripe.checkout.sessions.create.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: 'acct_1' }); // direct charge en la cuenta del club
    expect(params.mode).toBe('subscription');
    expect(params.line_items[0].price_data.unit_amount).toBe(3000);
    expect(params.line_items[0].price_data.recurring.interval).toBe('month');
    expect(params.subscription_data.application_fee_percent).toBe(2.5); // 250 bps
    expect(params.metadata).toMatchObject({ kind: 'cantera-parent-fee', card_slug: 'p-1', org_id: 'club-1' });
  });

  it('sin fee bps → no manda application_fee_percent', async () => {
    delete process.env.STRIPE_PLATFORM_FEE_BPS;
    const stripe = makeStripe();
    await makeHandler(stripe, makeDb())(ev());
    const [params] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.subscription_data.application_fee_percent).toBeUndefined();
  });

  it('502 si Stripe falla', async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockRejectedValue(new Error('stripe down'));
    expect((await makeHandler(stripe, makeDb())(ev())).statusCode).toBe(502);
  });
});
