import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/renew-checkout.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);

function makeDb({
  card = {
    slug: 'ana-fontanera', nombre: 'Ana', email: 'ana@test.com', plan: 'base',
    status: 'active', card_kind: 'autonomo', organization_id: null,
    edit_token_expires_at: null, idioma: 'es',
  },
} = {}) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: resolve({ data: card, error: null }) }),
          }),
        }),
      }),
    })),
  };
}

function makeStripe() {
  const create = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/renew123' });
  return { checkout: { sessions: { create } } };
}

function ev({ method = 'POST', body = { slug: 'ana-fontanera', token: 'tok123' }, ip = '3.3.3.3' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

describe('renew-checkout', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.STRIPE_PRICE_RENOVACION = 'price_renov_123';
    process.env.SITE_URL = 'https://perfilapro.es';
    delete process.env.URL;
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_RENOVACION;
  });

  it('405 en método no-POST', async () => {
    expect((await makeHandler(makeStripe(), makeDb())(ev({ method: 'GET' }))).statusCode).toBe(405);
  });

  it('503 sin Stripe configurado', async () => {
    expect((await makeHandler(null, makeDb())(ev())).statusCode).toBe(503);
  });

  it('503 sin STRIPE_PRICE_RENOVACION', async () => {
    delete process.env.STRIPE_PRICE_RENOVACION;
    expect((await makeHandler(makeStripe(), makeDb())(ev())).statusCode).toBe(503);
  });

  it('400 sin slug o token', async () => {
    expect((await makeHandler(makeStripe(), makeDb())(ev({ body: { slug: 'x' } }))).statusCode).toBe(400);
  });

  it('401 si la card no existe / token no coincide', async () => {
    const db = makeDb({ card: null });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(401);
  });

  it('401 si el edit_token ya expiró', async () => {
    const db = makeDb({ card: { slug: 'a', plan: 'base', status: 'active', card_kind: 'autonomo', organization_id: null, edit_token_expires_at: new Date(Date.now() - 1000).toISOString() } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(401);
  });

  it('409 si la card es B2B (organization_id)', async () => {
    const db = makeDb({ card: { slug: 'a', plan: 'base', status: 'active', card_kind: 'autonomo', organization_id: 'org-1', edit_token_expires_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('409 si el plan no es renovable (free)', async () => {
    const db = makeDb({ card: { slug: 'a', plan: 'free', status: 'active', card_kind: 'autonomo', organization_id: null, edit_token_expires_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('409 si card_kind no es autonomo (player/club_staff)', async () => {
    const db = makeDb({ card: { slug: 'a', plan: 'base', status: 'active', card_kind: 'player', organization_id: null, edit_token_expires_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('409 si la card no está activa', async () => {
    const db = makeDb({ card: { slug: 'a', plan: 'base', status: 'inactive', card_kind: 'autonomo', organization_id: null, edit_token_expires_at: null } });
    expect((await makeHandler(makeStripe(), db)(ev())).statusCode).toBe(409);
  });

  it('200 crea la sesión de checkout con el price de renovación', async () => {
    const stripe = makeStripe();
    const res = await makeHandler(stripe, makeDb())(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toContain('checkout.stripe.com');
    const [params] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items[0]).toEqual({ price: 'price_renov_123', quantity: 1 });
    expect(params.metadata).toEqual({ kind: 'renewal', slug: 'ana-fontanera' });
    expect(params.customer_email).toBe('ana@test.com');
    expect(params.success_url).toContain('/es/success?slug=ana-fontanera&renewed=1');
    expect(params.cancel_url).toContain('/es/editar?slug=ana-fontanera&token=tok123');
  });

  it('funciona igual para plan pro y para renovaciones sucesivas (plan=renovacion)', async () => {
    const stripe = makeStripe();
    const db = makeDb({ card: { slug: 'a', plan: 'renovacion', status: 'active', card_kind: 'autonomo', organization_id: null, edit_token_expires_at: null, idioma: 'ca' } });
    const res = await makeHandler(stripe, db)(ev());
    expect(res.statusCode).toBe(200);
    const [params] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.success_url).toContain('/ca/success');
  });

  it('502 si Stripe falla', async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockRejectedValue(new Error('stripe down'));
    expect((await makeHandler(stripe, makeDb())(ev())).statusCode).toBe(502);
  });
});
