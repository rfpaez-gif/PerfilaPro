import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/stripe-connect-onboard.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);

function makeDb({ org = { id: 'club-1', slug: 'cd-test', name: 'CD Test', email: 'c@club.es', kind: 'sports_club', stripe_connect_account_id: null, deleted_at: null }, orgErr = null } = {}) {
  const updates = [];
  return {
    updates,
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: resolve({ data: org, error: orgErr }) }) }),
      update: (row) => { updates.push(row); return { eq: resolve({ error: null }) }; },
    })),
  };
}

function makeStripe({ acctId = 'acct_123', charges = false, payouts = false } = {}) {
  return {
    accounts: {
      create: vi.fn().mockResolvedValue({ id: acctId }),
      retrieve: vi.fn().mockResolvedValue({ id: acctId, charges_enabled: charges, payouts_enabled: payouts }),
    },
    accountLinks: { create: vi.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/abc' }) },
  };
}

const authHeader = (orgId = 'club-1') => `Bearer ${signPanelSession({ orgId, orgSlug: 'cd-test' })}`;
function ev({ method = 'POST', body = {}, auth = true, ip = '6.6.6.6' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = authHeader();
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

describe('stripe-connect-onboard', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    delete process.env.URL;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.ORG_PANEL_JWT_SECRET;
  });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeHandler(makeStripe(), makeDb())(ev({ body: { action: 'onboard' }, auth: false }));
    expect(res.statusCode).toBe(410);
  });

  it('503 sin Stripe configurado', async () => {
    const res = await makeHandler(null, makeDb())(ev({ body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(503);
  });

  it('401 sin JWT', async () => {
    const res = await makeHandler(makeStripe(), makeDb())(ev({ auth: false, body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(401);
  });

  it('403 si la org no es sports_club', async () => {
    const db = makeDb({ org: { id: 'club-1', kind: 'business', deleted_at: null } });
    const res = await makeHandler(makeStripe(), db)(ev({ body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(403);
  });

  it('onboard: crea cuenta, la persiste y devuelve Account Link', async () => {
    const db = makeDb();
    const stripe = makeStripe({ acctId: 'acct_new' });
    const res = await makeHandler(stripe, db)(ev({ body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.url).toContain('connect.stripe.com');
    expect(out.account_id).toBe('acct_new');
    expect(stripe.accounts.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'express',
      country: 'ES',
      capabilities: expect.objectContaining({ bizum_payments: { requested: true } }),
    }));
    expect(db.updates).toContainEqual({ stripe_connect_account_id: 'acct_new' });
    expect(stripe.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'account_onboarding',
      account: 'acct_new',
      collection_options: { fields: 'currently_due' },
    }));
  });

  it('onboard: reusa la cuenta existente sin crear otra', async () => {
    const db = makeDb({ org: { id: 'club-1', slug: 'cd-test', kind: 'sports_club', stripe_connect_account_id: 'acct_old', deleted_at: null } });
    const stripe = makeStripe();
    const res = await makeHandler(stripe, db)(ev({ body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(200);
    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(stripe.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: 'acct_old' }));
  });

  it('status: sin cuenta → connected:false', async () => {
    const res = await makeHandler(makeStripe(), makeDb())(ev({ body: { action: 'status' } }));
    expect(JSON.parse(res.body).connected).toBe(false);
  });

  it('status: retrieve + persiste flags', async () => {
    const db = makeDb({ org: { id: 'club-1', kind: 'sports_club', stripe_connect_account_id: 'acct_x', deleted_at: null } });
    const stripe = makeStripe({ charges: true, payouts: true });
    const res = await makeHandler(stripe, db)(ev({ body: { action: 'status' } }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out).toMatchObject({ connected: true, charges_enabled: true, payouts_enabled: true });
    expect(db.updates).toContainEqual({ stripe_connect_charges_enabled: true, stripe_connect_payouts_enabled: true });
  });

  it('502 si accounts.create falla', async () => {
    const stripe = makeStripe();
    stripe.accounts.create.mockRejectedValue(new Error('stripe down'));
    const res = await makeHandler(stripe, makeDb())(ev({ body: { action: 'onboard' } }));
    expect(res.statusCode).toBe(502);
  });

  it('400 con acción desconocida', async () => {
    const res = await makeHandler(makeStripe(), makeDb())(ev({ body: { action: 'foo' } }));
    expect(res.statusCode).toBe(400);
  });
});
