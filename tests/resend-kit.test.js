import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/resend-kit.js';

const baseCard = {
  slug: 'maria-electricista',
  nombre: 'María Pérez',
  tagline: 'Electricista',
  whatsapp: '34633816729',
  email: 'maria@email.com',
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

function buildDb({ card = baseCard, cardErr = null, factura = null, updateErr = null } = {}) {
  const cardSingle    = vi.fn().mockResolvedValue({ data: card, error: cardErr });
  const facturaSingle = vi.fn().mockResolvedValue({ data: factura, error: null });
  const updateEq      = vi.fn().mockResolvedValue({ error: updateErr });
  const update        = vi.fn(() => ({ eq: updateEq }));

  const cardSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: cardSingle })),
  }));
  const facturaSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: facturaSingle })),
  }));
  const facturaInsert = vi.fn().mockResolvedValue({ error: null });
  // El generador de número de factura llama a select con count exact + like.
  const facturaCountSelect = vi.fn(() => ({
    like: vi.fn().mockResolvedValue({ count: 0, error: null }),
  }));

  const from = vi.fn((table) => {
    if (table === 'cards') return { select: cardSelect, update };
    if (table === 'facturas') {
      // Distinguir uso: si la query trae { count: 'exact', head: true } es para getNextInvoiceNumber.
      // Usamos una select que devuelve ambos comportamientos.
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

  return { from, _updateEq: updateEq };
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

describe('resend-kit handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;
  });

  it('devuelve 405 si method no es POST', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient())({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 401 sin contraseña admin', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient())(buildEvent({ password: '' }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 con contraseña incorrecta', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient())(buildEvent({ password: 'wrong' }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 400 si falta slug en el body', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient())(buildEvent({ body: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 con JSON inválido', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient())({
      httpMethod: 'POST',
      headers: { 'x-admin-password': 'admin123' },
      body: '{not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 404 si la card no existe', async () => {
    const db = buildDb({ card: null, cardErr: { message: 'not found' } });
    const res = await makeHandler(db, buildEmailClient())(buildEvent());
    expect(res.statusCode).toBe(404);
  });

  it('devuelve 400 si el card no tiene email registrado', async () => {
    const db = buildDb({ card: { ...baseCard, email: null } });
    const res = await makeHandler(db, buildEmailClient())(buildEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/email/i);
  });

  it('devuelve 400 si el perfil aún es free (sin stripe_session_id)', async () => {
    const db = buildDb({ card: { ...baseCard, stripe_session_id: null } });
    const res = await makeHandler(db, buildEmailClient())(buildEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/free/i);
  });

  it('devuelve 500 si emailClient no está configurado', async () => {
    const res = await makeHandler(buildDb(), null)(buildEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/RESEND/);
  });

  it('reenvía el email con tarjeta + QR + factura adjuntos y prefix [Reenvío]', async () => {
    const emailClient = buildEmailClient();
    const res = await makeHandler(buildDb(), emailClient)(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(emailClient.emails.send).toHaveBeenCalledOnce();

    const [payload] = emailClient.emails.send.mock.calls[0];
    expect(payload.to).toBe('maria@email.com');
    expect(payload.subject).toMatch(/^\[Reenvío\]/);

    const filenames = payload.attachments.map(a => a.filename);
    expect(filenames).toContain('perfilapro-maria-electricista.pdf');
    expect(filenames).toContain('perfilapro-maria-electricista-qr.png');
    expect(filenames.some(f => f.startsWith('factura-'))).toBe(true);
  }, 30000);

  it('reenvía en catalán con prefix [Reenviament] cuando idioma=ca', async () => {
    const emailClient = buildEmailClient();
    const db = buildDb({ card: { ...baseCard, idioma: 'ca' } });
    const res = await makeHandler(db, emailClient)(buildEvent());
    expect(res.statusCode).toBe(200);
    const [payload] = emailClient.emails.send.mock.calls[0];
    expect(payload.subject).toMatch(/^\[Reenviament\]/);
    expect(payload.html).toContain('lang="ca"');
    expect(payload.html).toContain('/ca/terminos');
  }, 30000);

  it('marca cards.kit_email_sent_at en éxito', async () => {
    const db = buildDb();
    await makeHandler(db, buildEmailClient())(buildEvent());
    expect(db._updateEq).toHaveBeenCalled();
    // El primer (y único) update llama a from('cards').update({ kit_email_sent_at: ... })
  }, 30000);

  it('devuelve 500 si el envío de email falla', async () => {
    const res = await makeHandler(buildDb(), buildEmailClient(false))(buildEvent());
    expect(res.statusCode).toBe(500);
  }, 30000);
});
