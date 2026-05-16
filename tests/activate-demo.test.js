import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/activate-demo.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Mock printable kit + posthog server. El email layout es puro template
// y no necesita mock.
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildPrintableCardPDF: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));
vi.mock('../netlify/functions/lib/posthog-server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
}));

const baseCard = {
  slug: 'demo-mariola-peluquera',
  nombre: 'Mariola Sánchez',
  tagline: 'Peluquera a domicilio',
  whatsapp: '+34600111222',
  direccion: null,
  zona: 'Lavapiés',
  email: 'mariola@example.com',
  plan: 'base',
  status: 'active',
  edit_token: 't'.repeat(64),
  edit_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
  idioma: 'es',
  stripe_session_id: null,
  kit_email_sent_at: null,
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

describe('activate-demo', () => {
  beforeEach(() => {
    _resetRateLimit();
    emailClient.emails.send.mockClear();
  });

  it('rechaza slugs no-demo con 403', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ body: { slug: 'mariola-peluquera', token: 't'.repeat(64) } }));
    expect(res.statusCode).toBe(403);
  });

  it('activa una card demo: plan=pro + kit_email_sent_at + envía email con PDF', async () => {
    const db = buildDb();
    const handler = makeHandler(db, emailClient);
    const res = await handler(buildEvent({ body: { slug: 'demo-mariola-peluquera', token: 't'.repeat(64) } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.plan).toBe('pro');
    expect(body.email_sent).toBe(true);
    expect(emailClient.emails.send).toHaveBeenCalledTimes(1);
    const sent = emailClient.emails.send.mock.calls[0][0];
    expect(sent.subject).toMatch(/^\[Demo\]/);
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe('perfilapro-demo-mariola-peluquera.pdf');
  });

  it('idempotente: no re-activa cards con kit_email_sent_at ya marcado', async () => {
    const db = buildDb({ card: { ...baseCard, kit_email_sent_at: new Date().toISOString() } });
    const handler = makeHandler(db, emailClient);
    const res = await handler(buildEvent({ body: { slug: 'demo-mariola-peluquera', token: 't'.repeat(64) } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.already_active).toBe(true);
    expect(emailClient.emails.send).not.toHaveBeenCalled();
  });

  it('401 con token inválido', async () => {
    const db = buildDb({ card: null });
    const handler = makeHandler(db, emailClient);
    const res = await handler(buildEvent({ body: { slug: 'demo-mariola-peluquera', token: 'x'.repeat(64) } }));
    expect(res.statusCode).toBe(401);
  });

  it('400 con parámetros faltantes', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ body: { slug: 'demo-mariola-peluquera' } }));
    expect(res.statusCode).toBe(400);
  });

  it('405 con método no-POST', async () => {
    const handler = makeHandler(buildDb(), emailClient);
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });
});
