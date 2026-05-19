import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/create-org-checkout.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const mockCreate = vi.fn();
const mockStripe = { checkout: { sessions: { create: mockCreate } } };

let handler;

function buildEvent({ method = 'POST', body = {}, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    body:       typeof body === 'string' ? body : JSON.stringify(body),
    headers:    { 'x-forwarded-for': ip },
  };
}

const validBody = {
  tier:     'team',
  cycle:    'monthly',
  seats:    5,
  org_name: 'Acme Studio',
  email:    'admin@acme.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimit();
  process.env.SITE_URL = 'https://perfilapro.es';
  process.env.STRIPE_PRICE_TEAM_MONTHLY = 'price_team_m_mock';
  process.env.STRIPE_PRICE_TEAM_ANNUAL  = 'price_team_a_mock';
  process.env.STRIPE_PRICE_ORG_MONTHLY  = 'price_org_m_mock';
  process.env.STRIPE_PRICE_ORG_ANNUAL   = 'price_org_a_mock';
  mockCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test-sub' });
  handler = makeHandler(mockStripe);
});

describe('create-org-checkout handler', () => {
  it('devuelve 405 si method no es POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si body es JSON inválido', async () => {
    const res = await handler(buildEvent({ body: 'not-json' }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si tier no está en {team, org}', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, tier: 'enterprise' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/tier/);
  });

  it('devuelve 400 si cycle no está en {monthly, annual}', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, cycle: 'weekly' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/cycle/);
  });

  it('devuelve 400 si seats < 1 o > 500', async () => {
    expect((await handler(buildEvent({ body: { ...validBody, seats: 0   } }))).statusCode).toBe(400);
    expect((await handler(buildEvent({ body: { ...validBody, seats: 501 } }))).statusCode).toBe(400);
    expect((await handler(buildEvent({ body: { ...validBody, seats: 'x' } }))).statusCode).toBe(400);
  });

  it('devuelve 400 si org_name < 2 chars', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, org_name: 'X' } }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si email no es válido', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, email: 'not-an-email' } }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 503 si el price del tier+cycle no está configurado en env', async () => {
    delete process.env.STRIPE_PRICE_ORG_ANNUAL;
    const res = await handler(buildEvent({ body: { ...validBody, tier: 'org', cycle: 'annual' } }));
    expect(res.statusCode).toBe(503);
  });

  it('crea checkout subscription con price correcto + quantity=seats', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, seats: 12 } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toBe('https://checkout.stripe.com/test-sub');
    const params = mockCreate.mock.calls[0][0];
    expect(params.mode).toBe('subscription');
    expect(params.line_items).toEqual([{ price: 'price_team_m_mock', quantity: 12 }]);
    expect(params.customer_email).toBe('admin@acme.com');
  });

  it('mapea cada (tier, cycle) al env var correcto', async () => {
    const cases = [
      { tier: 'team', cycle: 'monthly', expected: 'price_team_m_mock' },
      { tier: 'team', cycle: 'annual',  expected: 'price_team_a_mock' },
      { tier: 'org',  cycle: 'monthly', expected: 'price_org_m_mock'  },
      { tier: 'org',  cycle: 'annual',  expected: 'price_org_a_mock'  },
    ];
    for (const c of cases) {
      mockCreate.mockClear();
      _resetRateLimit();
      await handler(buildEvent({ body: { ...validBody, tier: c.tier, cycle: c.cycle } }));
      expect(mockCreate.mock.calls[0][0].line_items[0].price).toBe(c.expected);
    }
  });

  it('persiste agent_code en metadata DEL session Y de subscription_data', async () => {
    await handler(buildEvent({ body: { ...validBody, agent_code: 'agent-MARIA01' } }));
    const params = mockCreate.mock.calls[0][0];
    expect(params.metadata.agent_code).toBe('agent-MARIA01');
    expect(params.subscription_data.metadata.agent_code).toBe('agent-MARIA01');
  });

  it('agent_code malformado se silencia (no rompe el checkout)', async () => {
    await handler(buildEvent({ body: { ...validBody, agent_code: '<script>' } }));
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0].metadata.agent_code).toBe('');
  });

  it('sin agent_code → metadata.agent_code = "" (bolsa founder)', async () => {
    await handler(buildEvent({ body: validBody }));
    expect(mockCreate.mock.calls[0][0].metadata.agent_code).toBe('');
  });

  it('idioma="es" por defecto + success_url bajo /es/', async () => {
    await handler(buildEvent({ body: validBody }));
    const params = mockCreate.mock.calls[0][0];
    expect(params.metadata.idioma).toBe('es');
    expect(params.success_url).toContain('/es/empresas');
    expect(params.cancel_url).toContain('/es/empresas');
  });

  it('idioma="ca" del body llega a metadata + URLs catalanas', async () => {
    await handler(buildEvent({ body: { ...validBody, idioma: 'ca' } }));
    const params = mockCreate.mock.calls[0][0];
    expect(params.metadata.idioma).toBe('ca');
    expect(params.success_url).toContain('/ca/empresas');
    expect(params.cancel_url).toContain('/ca/empresas');
  });

  it('slug válido del body llega a metadata; inválido se silencia', async () => {
    await handler(buildEvent({ body: { ...validBody, slug: 'acme-studio' } }));
    expect(mockCreate.mock.calls[0][0].metadata.slug).toBe('acme-studio');

    mockCreate.mockClear();
    _resetRateLimit();
    await handler(buildEvent({ body: { ...validBody, slug: '-bad-' } }));
    expect(mockCreate.mock.calls[0][0].metadata.slug).toBe('');
  });

  it('metadata.tier / cycle / seats / org_name viajan correctamente', async () => {
    await handler(buildEvent({ body: { ...validBody, tier: 'org', cycle: 'annual', seats: 25 } }));
    const md = mockCreate.mock.calls[0][0].metadata;
    expect(md.kind).toBe('org-subscription');
    expect(md.tier).toBe('org');
    expect(md.cycle).toBe('annual');
    expect(md.seats).toBe('25');           // Stripe metadata son strings
    expect(md.org_name).toBe('Acme Studio');
  });

  it('subscription_data.metadata replica session.metadata (para invoice.paid)', async () => {
    await handler(buildEvent({ body: { ...validBody, agent_code: 'agent-X1', seats: 3 } }));
    const params = mockCreate.mock.calls[0][0];
    expect(params.subscription_data.metadata).toEqual(params.metadata);
  });

  it('devuelve 429 al superar el límite por IP (10 req / 10 min)', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 10; i++) {
      const res = await handler(buildEvent({ body: validBody, ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ body: validBody, ip }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
  });

  it('errores de Stripe (5xx) se propagan como 500 con mensaje', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Stripe boom'));
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('Stripe boom');
  });
});
