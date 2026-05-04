import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/create-checkout.js';
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
  nombre:   'Paco García',
  zona:     'Alicante',
  whatsapp: '600111222',
  plan:     'base',
  servicios: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimit();
  process.env.SITE_URL = 'https://perfilapro.es';
  mockCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
  handler = makeHandler(mockStripe);
});

describe('create-checkout handler', () => {
  it('devuelve 405 si method no es POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si faltan campos obligatorios', async () => {
    const res = await handler(buildEvent({ body: { nombre: 'X' } }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si plan no es válido', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, plan: 'inexistente' } }));
    expect(res.statusCode).toBe(400);
  });

  it('crea sesión Stripe y devuelve URL', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toBe('https://checkout.stripe.com/test');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('devuelve 429 al superar el límite por IP (10 requests / 10 min)', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 10; i++) {
      const res = await handler(buildEvent({ body: validBody, ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ body: validBody, ip }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
  });
});
