import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/lead-b2b.js';

const mockSend = vi.fn();
const mockEmailClient = { emails: { send: mockSend } };

const handler = makeHandler(mockEmailClient);

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
  sector: 'seguros',
  message: 'Tenemos 200 agentes y queremos digitalizarlos.',
};

describe('lead-b2b handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.B2B_LEAD_INBOX = 'leads@perfilapro.es';
    mockSend.mockResolvedValue({ id: 'msg_1' });
  });

  it('rechaza GET con 405', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('acepta un payload válido y envía el email', async () => {
    const res = await handler(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe('leads@perfilapro.es');
    expect(sent.replyTo).toBe('carlos@example.com');
    expect(sent.subject).toContain('Allianz España');
    expect(sent.subject).toContain('Seguros y agentes');
    expect(sent.html).toContain('Carlos García');
    expect(sent.html).toContain('Tenemos 200 agentes');
  });

  it('honeypot: si "website" viene relleno, devuelve 200 SIN enviar email', async () => {
    const res = await handler(buildEvent({ body: { ...validPayload, website: 'http://spam.com' } }));
    expect(res.statusCode).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rechaza si faltan campos obligatorios', async () => {
    const res = await handler(buildEvent({ body: { name: 'X', company: 'Y' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Faltan campos');
  });

  it('rechaza email mal formado', async () => {
    const res = await handler(buildEvent({ body: { ...validPayload, email: 'no-email' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Email');
  });

  it('rechaza team_size fuera del enum', async () => {
    const res = await handler(buildEvent({ body: { ...validPayload, team_size: '1000000' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('equipo');
  });

  it('rechaza sector fuera del enum', async () => {
    const res = await handler(buildEvent({ body: { ...validPayload, sector: 'ovnis' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Sector');
  });

  it('escapa HTML en el mensaje para evitar inyección en el email', async () => {
    const res = await handler(buildEvent({
      body: { ...validPayload, message: '<script>alert(1)</script>' },
    }));
    expect(res.statusCode).toBe(200);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.html).not.toContain('<script>alert');
    expect(sent.html).toContain('&lt;script&gt;');
  });

  it('devuelve 500 si B2B_LEAD_INBOX no está configurado', async () => {
    delete process.env.B2B_LEAD_INBOX;
    const res = await handler(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(500);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('devuelve 500 si Resend falla', async () => {
    mockSend.mockRejectedValue(new Error('rate limit'));
    const res = await handler(buildEvent({ body: validPayload }));
    expect(res.statusCode).toBe(500);
  });

  it('acepta payload sin mensaje (opcional)', async () => {
    const { message, ...rest } = validPayload;
    const res = await handler(buildEvent({ body: rest }));
    expect(res.statusCode).toBe(200);
  });
});
