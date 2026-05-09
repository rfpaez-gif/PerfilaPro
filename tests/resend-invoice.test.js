import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/resend-invoice.js';

const baseCard = {
  slug: 'maria-electricista',
  nombre: 'María Pérez',
  email: 'maria@test.com',
  plan: 'base',
  expires_at: new Date('2026-09-01').toISOString(),
  stripe_session_id: 'cs_test_abc',
  edit_token: 'tok-abc',
};

function buildEvent({ method = 'POST', body = { slug: 'maria-electricista' }, password = 'admin123' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password, 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  };
}

function buildDb({ card = baseCard, factura = null } = {}) {
  const cardSingle    = vi.fn().mockResolvedValue({ data: card, error: card ? null : { message: 'not found' } });
  const facturaSingle = vi.fn().mockResolvedValue({ data: factura, error: null });
  const cardSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: cardSingle })),
  }));
  const facturaSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: facturaSingle })),
  }));
  const facturaCountSelect = vi.fn(() => ({
    like: vi.fn().mockResolvedValue({ count: 0, error: null }),
  }));
  const facturaInsert = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn((table) => {
    if (table === 'cards') return { select: cardSelect };
    if (table === 'facturas') {
      return {
        select: vi.fn((cols, opts) => {
          if (opts && opts.count === 'exact') return facturaCountSelect();
          return facturaSelect();
        }),
        insert: facturaInsert,
      };
    }
    return {};
  });

  return { from };
}

function buildEmailClient(success = true) {
  return {
    emails: {
      send: success
        ? vi.fn().mockResolvedValue({ id: 'email-123' })
        : vi.fn().mockRejectedValue(new Error('SMTP error')),
    },
  };
}

describe('resend-invoice · idioma', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;
  });

  it('reenvía en español con prefix [Reenvío] cuando idioma=es', async () => {
    const emailClient = buildEmailClient();
    const res = await makeHandler(buildDb({ card: { ...baseCard, idioma: 'es' } }), emailClient)(buildEvent());
    expect(res.statusCode).toBe(200);
    const [payload] = emailClient.emails.send.mock.calls[0];
    expect(payload.subject).toMatch(/^\[Reenvío\]/);
    expect(payload.html).toContain('lang="es"');
    expect(payload.html).toContain('/es/terminos');
  }, 30000);

  it('reenvía en catalán con prefix [Reenviament] cuando idioma=ca', async () => {
    const emailClient = buildEmailClient();
    const res = await makeHandler(buildDb({ card: { ...baseCard, idioma: 'ca' } }), emailClient)(buildEvent());
    expect(res.statusCode).toBe(200);
    const [payload] = emailClient.emails.send.mock.calls[0];
    expect(payload.subject).toMatch(/^\[Reenviament\]/);
    expect(payload.html).toContain('lang="ca"');
    expect(payload.html).toContain('/ca/terminos');
  }, 30000);

  it('default a español cuando idioma no está en la card', async () => {
    const emailClient = buildEmailClient();
    const res = await makeHandler(buildDb({ card: baseCard }), emailClient)(buildEvent());
    expect(res.statusCode).toBe(200);
    const [payload] = emailClient.emails.send.mock.calls[0];
    expect(payload.subject).toMatch(/^\[Reenvío\]/);
    expect(payload.html).toContain('lang="es"');
  }, 30000);
});
