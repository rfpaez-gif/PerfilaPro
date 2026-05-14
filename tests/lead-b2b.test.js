import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildLeadEmail, buildLeadAckEmail } from '../netlify/functions/lead-b2b.js';

// --- DB mock builder ---------------------------------------------------
// El handler hace exactamente UNA llamada a db.from('b2b_leads'):
//   .from('b2b_leads').insert({...}).select('id, invite_token').single()
// devolviendo { data: { id, invite_token }, error }.
function makeMockDb({ insertResult } = {}) {
  const mockSingle = vi.fn().mockResolvedValue(
    insertResult || { data: { id: 'lead-uuid', invite_token: 'a'.repeat(48) }, error: null }
  );
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: mockSingle,
  };
  const from = vi.fn(() => chain);
  return { db: { from }, chain, from };
}

const mockSend = vi.fn();
const mockEmailClient = { emails: { send: mockSend } };

function buildEvent({ method = 'POST', body = {} } = {}) {
  return {
    httpMethod: method,
    headers: {},
    body: JSON.stringify(body),
  };
}

const validPayload = {
  name: 'Carlos García',
  company: 'Allianz España',
  email: 'carlos@example.com',
  team_size: '100-500',
  sector: 'empresa',
  message: 'Tenemos 200 agentes y queremos digitalizarlos.',
};

describe('lead-b2b handler', () => {
  let db;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.B2B_LEAD_INBOX = 'leads@perfilapro.es';
    process.env.SITE_URL = 'https://perfilapro.es';
    mockSend.mockResolvedValue({ id: 'msg_1' });
    ({ db } = makeMockDb());
  });

  function handler() {
    return makeHandler({ db, emailClient: mockEmailClient });
  }

  it('rechaza GET con 405', async () => {
    const res = await handler()(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('persiste el lead y envía dos emails (interno con magic-link + acuse al lead sin magic-link)', async () => {
    const res = await handler()(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);

    // BD insert con todos los campos
    expect(db.from).toHaveBeenCalledWith('b2b_leads');
    const insertArg = db.from.mock.results[0].value.insert.mock.calls[0][0];
    expect(insertArg.name).toBe('Carlos García');
    expect(insertArg.company).toBe('Allianz España');
    expect(insertArg.email).toBe('carlos@example.com');
    expect(insertArg.team_size).toBe('100-500');
    expect(insertArg.sector).toBe('empresa');
    expect(insertArg.idioma).toBe('es');

    // Email 1 · inbox interno (sí lleva el magic-link, para que el founder lo vea)
    expect(mockSend).toHaveBeenCalledTimes(2);
    const internalEmail = mockSend.mock.calls[0][0];
    expect(internalEmail.to).toBe('leads@perfilapro.es');
    expect(internalEmail.replyTo).toBe('carlos@example.com');
    expect(internalEmail.subject).toContain('Allianz España');
    expect(internalEmail.html).toContain('/es/onboarding?token=');

    // Email 2 · acuse de recibo al lead — SIN magic-link en el cuerpo.
    const leadEmail = mockSend.mock.calls[1][0];
    expect(leadEmail.to).toBe('carlos@example.com');
    expect(leadEmail.subject).toContain('[PerfilaPro]');
    expect(leadEmail.subject).not.toContain('Onboarding');
    expect(leadEmail.html).toContain('Allianz España');
    expect(leadEmail.html).toContain('24-48');
    expect(leadEmail.html).not.toContain('/onboarding?token=');
  });

  it('respeta idioma=ca en el subject del acuse de recibo', async () => {
    const res = await handler()(buildEvent({ body: { ...validPayload, idioma: 'ca' } }));
    expect(res.statusCode).toBe(200);
    const insertArg = db.from.mock.results[0].value.insert.mock.calls[0][0];
    expect(insertArg.idioma).toBe('ca');
    const leadEmail = mockSend.mock.calls[1][0];
    expect(leadEmail.subject).toMatch(/hem rebut/i);
    expect(leadEmail.html).not.toContain('/onboarding?token=');
  });

  it.each([
    ['empresa',  'Empresa'],
    ['despacho', 'Despacho'],
    ['colegio',  'Colegio'],
    ['publico',  'Administración'],
    ['ong',      'ONG'],
    ['otro',     'Otro'],
  ])('acepta el sector "%s" y lo etiqueta como "%s" en el subject interno', async (sector, label) => {
    const res = await handler()(buildEvent({ body: { ...validPayload, sector } }));
    expect(res.statusCode).toBe(200);
    const internalEmail = mockSend.mock.calls[0][0];
    expect(internalEmail.subject).toContain(label);
  });

  it('honeypot: si "website" viene relleno, devuelve 200 sin tocar BD ni emails', async () => {
    const res = await handler()(buildEvent({ body: { ...validPayload, website: 'http://spam.com' } }));
    expect(res.statusCode).toBe(200);
    expect(db.from).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rechaza si faltan campos obligatorios (sin tocar BD)', async () => {
    const res = await handler()(buildEvent({ body: { name: 'X', company: 'Y' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Faltan campos');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rechaza email mal formado', async () => {
    const res = await handler()(buildEvent({ body: { ...validPayload, email: 'no-email' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Email');
  });

  it('rechaza team_size fuera del enum', async () => {
    const res = await handler()(buildEvent({ body: { ...validPayload, team_size: '1000000' } }));
    expect(res.statusCode).toBe(400);
  });

  it('rechaza sector fuera del enum', async () => {
    const res = await handler()(buildEvent({ body: { ...validPayload, sector: 'ovnis' } }));
    expect(res.statusCode).toBe(400);
  });

  it('con idioma=ca devuelve los errores de validación en catalán', async () => {
    const res = await handler()(buildEvent({
      body: { idioma: 'ca', name: 'X', company: 'Y' },
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Falten camps: nom, empresa, email');
  });

  it('con idioma=ca el error de email también vuelve en catalán', async () => {
    const res = await handler()(buildEvent({
      body: { ...validPayload, idioma: 'ca', email: 'no-email' },
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Email invàlid');
  });

  it('escapa HTML en el mensaje para evitar inyección en el email interno', async () => {
    const res = await handler()(buildEvent({
      body: { ...validPayload, message: '<script>alert(1)</script>' },
    }));
    expect(res.statusCode).toBe(200);
    const internalEmail = mockSend.mock.calls[0][0];
    expect(internalEmail.html).not.toContain('<script>alert');
    expect(internalEmail.html).toContain('&lt;script&gt;');
  });

  it('devuelve 500 si B2B_LEAD_INBOX no está configurado (sin tocar BD)', async () => {
    delete process.env.B2B_LEAD_INBOX;
    const res = await handler()(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(500);
    expect(db.from).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('devuelve 500 si el insert en BD falla, sin enviar emails', async () => {
    ({ db } = makeMockDb({ insertResult: { data: null, error: { message: 'unique violation' } } }));
    const res = await handler()(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(500);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('si Resend falla, sigue devolviendo 200 (el lead ya está persistido)', async () => {
    mockSend.mockRejectedValue(new Error('rate limit'));
    const res = await handler()(buildEvent({ body: validPayload }));
    // El lead se capturó, el form al usuario no debería ver el fallo de email
    expect(res.statusCode).toBe(200);
    // Aun así intentamos enviar los dos emails (los dos fallan)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('acepta payload sin mensaje (opcional)', async () => {
    const { message, ...rest } = validPayload;
    const res = await handler()(buildEvent({ body: rest }));
    expect(res.statusCode).toBe(200);
  });
});

describe('buildLeadEmail', () => {
  it('genera CTA con URL onboarding en es por defecto', () => {
    const { subject, html } = buildLeadEmail({
      name: 'Carlos García', company: 'Allianz', inviteToken: 'a'.repeat(48), siteUrl: 'https://perfilapro.es',
    });
    expect(subject).toContain('Carlos');
    expect(html).toContain('https://perfilapro.es/es/onboarding?token=' + 'a'.repeat(48));
    expect(html).toContain('Allianz');
  });

  it('en idioma=ca usa /ca/onboarding', () => {
    const { html } = buildLeadEmail({
      name: 'Marta', company: 'Despacho X', inviteToken: 'b'.repeat(48), idioma: 'ca', siteUrl: 'https://perfilapro.es',
    });
    expect(html).toContain('https://perfilapro.es/ca/onboarding?token=' + 'b'.repeat(48));
  });

  it('sin org → no pinta banner branded', () => {
    const { html } = buildLeadEmail({
      name: 'Marta', company: 'Despacho X', inviteToken: 'b'.repeat(48), siteUrl: 'https://perfilapro.es',
    });
    expect(html).not.toContain('Demo personalizada');
  });

  it('con org → pinta banner con logo + color + nombre de la org', () => {
    const { html } = buildLeadEmail({
      name: 'Carlos', company: 'Allianz', inviteToken: 'c'.repeat(48), siteUrl: 'https://perfilapro.es',
      org: { name: 'Allianz', logoUrl: 'https://example.com/allianz.png', color: '#003781' },
    });
    expect(html).toContain('Demo personalizada');
    expect(html).toContain('Allianz');
    expect(html).toContain('background:#003781');
    expect(html).toContain('https://example.com/allianz.png');
  });

  it('con org sin logo → banner solo con color + nombre', () => {
    const { html } = buildLeadEmail({
      name: 'Carlos', company: 'Allianz', inviteToken: 'c'.repeat(48), siteUrl: 'https://perfilapro.es',
      org: { name: 'Allianz', logoUrl: null, color: '#003781' },
    });
    expect(html).toContain('Demo personalizada');
    expect(html).toContain('background:#003781');
    expect(html).not.toContain('<img');
  });

  it('con org color inválido → fallback sin banner branded (no inyecta CSS arbitrario)', () => {
    const { html } = buildLeadEmail({
      name: 'X', company: 'Y', inviteToken: 'd'.repeat(48), siteUrl: 'https://perfilapro.es',
      org: { name: 'Y', logoUrl: null, color: 'red; background:url(evil)' },
    });
    expect(html).not.toContain('Demo personalizada');
    expect(html).not.toContain('evil');
  });

  it('en idioma=ca el banner branded usa "Demo personalitzada"', () => {
    const { html } = buildLeadEmail({
      name: 'Marta', company: 'Despatx', inviteToken: 'e'.repeat(48), idioma: 'ca',
      siteUrl: 'https://perfilapro.es',
      org: { name: 'Despatx X', logoUrl: null, color: '#003781' },
    });
    expect(html).toContain('Demo personalitzada');
  });
});

describe('buildLeadAckEmail', () => {
  it('en es genera acuse de recibo sin magic-link', () => {
    const { subject, html } = buildLeadAckEmail({
      name: 'Carlos García', company: 'Allianz', siteUrl: 'https://perfilapro.es',
    });
    expect(subject).toContain('[PerfilaPro]');
    expect(subject).toContain('Carlos');
    expect(html).toContain('Allianz');
    expect(html).toContain('24-48');
    expect(html).not.toContain('/onboarding?token=');
  });

  it('en ca traduce el subject y el cuerpo', () => {
    const { subject, html } = buildLeadAckEmail({
      name: 'Marta', company: 'Despatx X', idioma: 'ca', siteUrl: 'https://perfilapro.es',
    });
    expect(subject).toMatch(/hem rebut/i);
    expect(html).toMatch(/Hem rebut/);
    expect(html).not.toContain('/onboarding?token=');
  });

  it('escapa el nombre de la empresa en el cuerpo HTML', () => {
    const { html } = buildLeadAckEmail({
      name: 'X', company: '<script>alert(1)</script>', siteUrl: 'https://perfilapro.es',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
