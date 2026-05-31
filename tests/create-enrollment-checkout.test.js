import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/create-enrollment-checkout.js';
import { signParentSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);
const parentBearer = (email = 'madre@e.es') => `Bearer ${signParentSession({ email })}`;
function ev({ method = 'POST', body = {}, auth, ip = '2.2.2.2' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = auth;
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

// Mocks por tabla. Cada una expone solo la cadena que el endpoint usa.
function makeDb({
  card = { slug: 'p-1', card_kind: 'player', nombre: 'Leo', organization_id: 'club-1', deleted_at: null },
  admin = { id: 'a-1' },
  org = { id: 'club-1', name: 'EF Universal', stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true, cantera_monthly_fee_cents: 3000, deleted_at: null },
  existingSub = null,
  campaign = undefined, // undefined = tabla no consultada en happy path sin campaign_id
} = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ in: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: org, error: null }) }) }) };
      if (t === 'parent_subscriptions') return { select: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: existingSub, error: null }) }) }) }) }) };
      if (t === 'enrollment_campaigns') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: campaign, error: null }) }) }) };
      return {};
    }),
  };
}
function makeStripe() {
  const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' });
  return { create, checkout: { sessions: { create } } };
}

describe('create-enrollment-checkout', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
    process.env.STRIPE_PLATFORM_FEE_BPS = '300';
    process.env.SITE_URL = 'https://perfilapro.es';
    delete process.env.URL;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE; delete process.env.ORG_PANEL_JWT_SECRET;
    delete process.env.STRIPE_PLATFORM_FEE_BPS;
  });

  it('410 carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeStripe(), makeDb())(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(410);
  });
  it('503 sin Stripe', async () => {
    expect((await makeHandler(null, makeDb())(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(503);
  });
  it('401 sin JWT parent', async () => {
    expect((await makeHandler(makeStripe(), makeDb())(ev({ body: { card_slug: 'p-1' } }))).statusCode).toBe(401);
  });
  it('400 sin card_slug', async () => {
    expect((await makeHandler(makeStripe(), makeDb())(ev({ auth: parentBearer(), body: {} }))).statusCode).toBe(400);
  });
  it('404 si la card no es player / no existe', async () => {
    const db = makeDb({ card: { slug: 'p-1', card_kind: 'autonomo', deleted_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(404);
  });
  it('403 si el email no es tutor de la ficha', async () => {
    const db = makeDb({ admin: null });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(403);
  });
  it('409 si el club no acepta pagos online', async () => {
    const db = makeDb({ org: { id: 'club-1', name: 'X', stripe_connect_account_id: null, stripe_connect_charges_enabled: false, cantera_monthly_fee_cents: 3000, deleted_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(409);
  });
  it('409 si ya hay cuota activa', async () => {
    const db = makeDb({ existingSub: { id: 'sub-x' } });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(409);
  });
  it('409 si el club no tiene cuota configurada (y sin campaña)', async () => {
    const db = makeDb({ org: { id: 'club-1', name: 'X', stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true, cantera_monthly_fee_cents: null, deleted_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }))).statusCode).toBe(409);
  });

  it('200 crea checkout con cuota del club (sin campaña)', async () => {
    const stripe = makeStripe();
    const res = await makeHandler(stripe, makeDb())(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toContain('checkout.stripe.com');
    const [params, options] = stripe.create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(3000);
    expect(params.subscription_data.application_fee_percent).toBe(3);
    expect(options.stripeAccount).toBe('acct_1');
    expect(params.subscription_data.add_invoice_items).toBeUndefined(); // sin matrícula
  });

  it('200 con campaña: aplica matrícula + cuota de la campaña', async () => {
    const stripe = makeStripe();
    const db = makeDb({ campaign: { id: 'camp-1', organization_id: 'club-1', status: 'open', matricula_cents: 3500, monthly_fee_cents: 2800 } });
    const res = await makeHandler(stripe, db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1', campaign_id: 'camp-1' } }));
    expect(res.statusCode).toBe(200);
    const [params] = stripe.create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(2800); // cuota de campaña manda
    expect(params.subscription_data.add_invoice_items[0].price_data.unit_amount).toBe(3500);
    expect(params.metadata.enrollment_campaign_id).toBe('camp-1');
    expect(params.metadata.matricula_cents).toBe('3500');
  });

  it('409 si la campaña es de otro club o está cerrada', async () => {
    const db = makeDb({ campaign: { id: 'camp-1', organization_id: 'OTRO', status: 'open', matricula_cents: 3500, monthly_fee_cents: 2800 } });
    expect((await makeHandler(makeStripe(), db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1', campaign_id: 'camp-1' } }))).statusCode).toBe(409);
  });
});
