import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildEditLinkEmail } from '../netlify/functions/send-edit-link.js';

// --- Mocks ---

const mockSingle = vi.fn();
const mockEqUpdate = vi.fn();
const mockFrom = vi.fn();

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };
const mockDb = { from: mockFrom };

// Reusable chainable builder — every method returns itself so
// any depth of .eq().eq().select().single() works.
function makeBuilder() {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    single: mockSingle,
    update: vi.fn(),
  };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.update.mockReturnValue({ eq: mockEqUpdate });
  return b;
}

// --- Helpers ---

function buildEvent({ method = 'POST', body = {} } = {}) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
  };
}

const baseCard = { slug: 'ana-electricista', nombre: 'Ana López' };

// --- Tests ---

describe('send-edit-link handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = 'https://perfilapro.es';

    mockSingle.mockResolvedValue({ data: baseCard, error: null });
    mockEqUpdate.mockResolvedValue({ error: null });
    mockEmailSend.mockResolvedValue({});

    mockFrom.mockImplementation(() => makeBuilder());

    handler = makeHandler(mockDb, mockEmail);
  });

  it('devuelve 405 para métodos que no sean POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta el email', async () => {
    const res = await handler(buildEvent({ body: {} }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Email');
  });

  it('devuelve 400 si el body no es JSON válido', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'not-json' });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 200 y envía email si la tarjeta existe', async () => {
    let capturedBuilder;
    mockFrom.mockImplementation(() => {
      capturedBuilder = makeBuilder();
      return capturedBuilder;
    });
    const res = await handler(buildEvent({ body: { email: 'ana@test.com' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(capturedBuilder.update).toHaveBeenCalled();
    expect(mockEmailSend).toHaveBeenCalledOnce();

    const emailArgs = mockEmailSend.mock.calls[0][0];
    expect(emailArgs.to).toBe('ana@test.com');
    expect(emailArgs.html).toContain('editar.html');
    expect(emailArgs.html).toContain('ana-electricista');
  });

  it('guarda el token con expiración de 15 minutos', async () => {
    let capturedBuilder;
    mockFrom.mockImplementation(() => {
      capturedBuilder = makeBuilder();
      return capturedBuilder;
    });
    await handler(buildEvent({ body: { email: 'ana@test.com' } }));

    const updateArgs = capturedBuilder.update.mock.calls[0][0];
    expect(updateArgs.edit_token).toBeDefined();
    expect(typeof updateArgs.edit_token).toBe('string');
    expect(updateArgs.edit_token.length).toBe(64); // 32 bytes hex

    const expiresAt = new Date(updateArgs.edit_token_expires_at).getTime();
    const in15min = Date.now() + 15 * 60 * 1000;
    expect(expiresAt).toBeGreaterThan(in15min - 5000);
    expect(expiresAt).toBeLessThanOrEqual(in15min + 5000);
  });

  it('devuelve 200 aunque el email no exista (previene enumeración)', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await handler(buildEvent({ body: { email: 'noexiste@test.com' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('no falla si el cliente de email lanza error', async () => {
    mockEmailSend.mockRejectedValue(new Error('SMTP error'));
    const res = await handler(buildEvent({ body: { email: 'ana@test.com' } }));
    expect(res.statusCode).toBe(200);
  });

  it('normaliza el email a minúsculas', async () => {
    const builders = [];
    mockFrom.mockImplementation(() => {
      const b = makeBuilder();
      builders.push(b);
      return b;
    });
    await handler(buildEvent({ body: { email: 'ANA@TEST.COM' } }));
    // builders[0] is the SELECT chain, builders[1] is the UPDATE chain
    const eqCalls = builders[0].eq.mock.calls;
    const emailArg = eqCalls.find(([field]) => field === 'email')?.[1];
    expect(emailArg).toBe('ana@test.com');
  });
});

describe('buildEditLinkEmail', () => {
  it('incluye el nombre y la URL de edición', () => {
    const html = buildEditLinkEmail({ nombre: 'Juan García', editUrl: 'https://perfilapro.es/editar.html?slug=juan&token=abc' });
    expect(html).toContain('Juan');
    expect(html).toContain('https://perfilapro.es/editar.html?slug=juan&token=abc');
    expect(html).toContain('15 minutos');
  });

  it('funciona sin nombre', () => {
    const html = buildEditLinkEmail({ nombre: '', editUrl: 'https://example.com' });
    expect(html).toContain('Hola');
  });
});
