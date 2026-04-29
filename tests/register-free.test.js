import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildWelcomeEmail } from '../netlify/functions/register-free.js';

// --- Mocks ---

const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockFromSelect = vi.fn();
const mockFrom = vi.fn();

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

function makeSelectBuilder() {
  const b = { select: vi.fn(), eq: vi.fn(), maybeSingle: mockMaybeSingle };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  return b;
}

const mockDb = {
  from: mockFrom,
};

function buildEvent({ method = 'POST', body = {} } = {}) {
  return { httpMethod: method, body: JSON.stringify(body) };
}

const validBody = {
  nombre:   'Paco García',
  whatsapp: '600111222',
  sector:   'oficios',
  zona:     'Alicante',
  email:    'paco@example.com',
};

// --- Tests ---

describe('register-free handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = 'https://perfilapro.es';

    // Default: no existing slug (no collision)
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsert.mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table) => {
      if (table === 'cards') {
        const selectBuilder = makeSelectBuilder();
        selectBuilder.insert = mockInsert;
        return selectBuilder;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle };
    });

    mockEmailSend.mockResolvedValue({ id: 'email-id' });

    handler = makeHandler(mockDb, mockEmail);
  });

  it('returns 405 for GET requests', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'not-json' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await handler(buildEvent({ body: { nombre: 'Paco' } }));
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toMatch(/obligatorios/);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, email: 'not-an-email' } }));
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toMatch(/email/i);
  });

  it('creates a free profile and returns slug + URLs', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.slug).toBe('paco-garcia');
    expect(json.card_url).toBe('https://perfilapro.es/c/paco-garcia');
    expect(json.edit_url).toContain('/editar.html?slug=paco-garcia&token=');
  });

  it('inserts plan=free, status=active, no directory_visible', async () => {
    await handler(buildEvent({ body: validBody }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.plan).toBe('base');
    expect(insertCall.status).toBe('active');
    expect(insertCall.directory_visible).toBeUndefined();
  });

  it('stores email and generates edit_token', async () => {
    await handler(buildEvent({ body: validBody }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.email).toBe('paco@example.com');
    expect(insertCall.edit_token).toHaveLength(64);
    expect(insertCall.edit_token_expires_at).toBeDefined();
  });

  it('sends welcome email (fire-and-forget)', async () => {
    await handler(buildEvent({ body: validBody }));
    // Email is sent async, check it was called
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toBe('paco@example.com');
    expect(call.subject).toContain('Paco');
  });

  it('appends suffix when slug already exists', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { slug: 'paco-garcia' }, error: null });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.slug).not.toBe('paco-garcia');
    expect(json.slug).toMatch(/^paco-garcia.*-\d{4}$/);
  });

  it('returns 500 when Supabase insert fails', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'DB error' } });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(500);
  });

  it('handles optional servicios array', async () => {
    const bodyWithServices = { ...validBody, servicios: ['Fontanería', 'Urgencias 24h'] };
    const res = await handler(buildEvent({ body: bodyWithServices }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.servicios).toEqual(['Fontanería', 'Urgencias 24h']);
  });

  it('defaults servicios to empty array when not provided', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.servicios).toEqual([]);
  });

  it('strips HTML tags from nombre', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, nombre: '<b>Paco</b> García' } }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.nombre).toBe('Paco García');
  });
});

describe('buildWelcomeEmail', () => {
  it('includes card_url and edit_url', () => {
    const { subject, html } = buildWelcomeEmail({
      nombre: 'Ana López',
      slug: 'ana-lopez',
      siteUrl: 'https://perfilapro.es',
      editToken: 'abc123',
    });
    expect(subject).toContain('Ana');
    expect(html).toContain('https://perfilapro.es/c/ana-lopez');
    expect(html).toContain('https://perfilapro.es/editar.html?slug=ana-lopez&token=abc123');
  });
});
