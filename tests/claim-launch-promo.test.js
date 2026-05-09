import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/claim-launch-promo.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Mock printable kit + sendConfirmationEmail con módulos cargados
// estáticamente. Reemplazamos sus exports vía vi.mock.
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildPrintableCardPDF: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  buildEscaparateQrPng:  vi.fn().mockResolvedValue(Buffer.from('png-bytes')),
}));
vi.mock('../netlify/functions/stripe-webhook', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(true),
}));
vi.mock('../netlify/functions/lib/posthog-server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
}));
// Evitamos cargar PDFKit + fuentes durante los tests — la generación
// real del comprobante se valida con un test de integración aparte
// (o manualmente). Aquí solo verificamos el contrato del handler.
vi.mock('../netlify/functions/invoice-utils', () => ({
  calcIva: (total) => ({ base: total / 1.21, iva: total - total / 1.21 }),
  getNextInvoiceNumber: vi.fn().mockResolvedValue('FAC-2026-9999'),
  buildPDF: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PLAN_INFO: {
    base: { label: 'Trimestral', duration: '3 meses', total: 9.0 },
    pro:  { label: 'Anual',      duration: '1 año',   total: 19.0 },
  },
  roundTwo: (n) => Math.round(n * 100) / 100,
}));

const baseCard = {
  slug: 'paco-fontanero',
  nombre: 'Paco García',
  tagline: 'Fontanería',
  whatsapp: '+34600111222',
  direccion: null,
  zona: null,
  email: 'paco@example.com',
  plan: null,
  status: 'free',
  edit_token: 't'.repeat(64),
  edit_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
  idioma: 'es',
  stripe_session_id: null,
  categories: null,
};

function buildDb({ card = baseCard, updateError = null } = {}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: card, error: card ? null : { message: 'not found' } }),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: updateError }),
      })),
    })),
  };
}

const emailClient = { emails: { send: vi.fn().mockResolvedValue({ id: 'e1' }) } };

function buildEvent({ method = 'POST', body = {}, ip = '5.5.5.5' } = {}) {
  return {
    httpMethod: method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'x-forwarded-for': ip },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimit();
  process.env.LAUNCH_PROMO_ACTIVE = '1';
});

describe('claim-launch-promo handler', () => {
  it('410 cuando LAUNCH_PROMO_ACTIVE no está', async () => {
    delete process.env.LAUNCH_PROMO_ACTIVE;
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ body: { slug: 'x', token: 'y', plan: 'base' } }));
    expect(res.statusCode).toBe(410);
  });

  it('405 en GET', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('400 si plan es inválido', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ body: { slug: 's', token: 't', plan: 'enterprise' } }));
    expect(res.statusCode).toBe(400);
  });

  it('401 si la card no existe / token no coincide', async () => {
    const handler = makeHandler(buildDb({ card: null }), emailClient);
    const res = await handler(buildEvent({ body: { slug: 's', token: 't', plan: 'base' } }));
    expect(res.statusCode).toBe(401);
  });

  it('401 si el edit_token está expirado', async () => {
    const expired = { ...baseCard, edit_token_expires_at: new Date(Date.now() - 1000).toISOString() };
    const handler = makeHandler(buildDb({ card: expired }), emailClient);
    const res = await handler(buildEvent({ body: { slug: baseCard.slug, token: baseCard.edit_token, plan: 'base' } }));
    expect(res.statusCode).toBe(401);
  });

  it('409 si ya tiene plan activo (idempotencia)', async () => {
    const active = { ...baseCard, plan: 'pro', status: 'active' };
    const handler = makeHandler(buildDb({ card: active }), emailClient);
    const res = await handler(buildEvent({ body: { slug: baseCard.slug, token: baseCard.edit_token, plan: 'base' } }));
    expect(res.statusCode).toBe(409);
  });

  it('200 en happy path: activa plan y devuelve expires_at', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ body: { slug: baseCard.slug, token: baseCard.edit_token, plan: 'pro' } }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.plan).toBe('pro');
    expect(new Date(json.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('429 al superar rate limit (5 req / 10 min)', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const ip = '7.7.7.7';
    for (let i = 0; i < 5; i++) {
      const res = await handler(buildEvent({ body: { slug: baseCard.slug, token: baseCard.edit_token, plan: 'base' }, ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ body: { slug: baseCard.slug, token: baseCard.edit_token, plan: 'base' }, ip }));
    expect(blocked.statusCode).toBe(429);
  });
});
