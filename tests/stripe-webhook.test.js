import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildEmail } from '../netlify/functions/stripe-webhook.js';

// --- Mocks de dependencias ---

const mockConstructEvent = vi.fn();
const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));
const mockEmailSend = vi.fn();

const mockStripe = { webhooks: { constructEvent: mockConstructEvent } };
const mockDb = { from: mockFrom };
const mockEmail = { emails: { send: mockEmailSend } };

const handler = makeHandler(mockStripe, mockDb, mockEmail);

// --- Helpers ---

function buildEvent({ method = 'POST', body = '{}', sig = 'valid-sig' } = {}) {
  return { httpMethod: method, headers: { 'stripe-signature': sig }, body };
}

function buildStripeEvent({ type = 'checkout.session.completed', metadata = {}, customerDetails = {} } = {}) {
  return { type, data: { object: { id: 'cs_test_123', metadata, customer_details: customerDetails } } };
}

// --- Tests ---

describe('stripe-webhook handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => ({ upsert: mockUpsert }));
    mockEmailSend.mockResolvedValue({ id: 'email-123' });
  });

  it('devuelve 405 para peticiones que no sean POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 cuando la firma de Stripe es inválida', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Webhook Error');
  });

  it('devuelve 200 sin tocar Supabase para tipos de evento no gestionados', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ type: 'payment_intent.created' }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devuelve 400 cuando falta el slug en los metadatos', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { nombre: 'Juan' } }));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Missing slug');
  });

  it('activa la tarjeta y devuelve 200 cuando el upsert es exitoso', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: {
          slug: 'juan-fontanero',
          nombre: 'Juan García',
          tagline: 'Fontanero profesional',
          whatsapp: '+34600000000',
          zona: 'Madrid',
          servicios: JSON.stringify(['Instalación · 80€', 'Reparación · 50€']),
          foto: 'https://example.com/foto.jpg',
          plan: 'pro',
        },
      })
    );

    const res = await handler(buildEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
    expect(mockFrom).toHaveBeenCalledWith('cards');

    const [upsertData] = mockUpsert.mock.calls[0];
    expect(upsertData.slug).toBe('juan-fontanero');
    expect(upsertData.status).toBe('active');
    expect(upsertData.plan).toBe('pro');
    expect(upsertData.servicios).toEqual(['Instalación · 80€', 'Reparación · 50€']);
    expect(upsertData.email).toBeNull();
    expect(upsertData.phone).toBeNull();
  });

  it('usa [] como valor por defecto de servicios cuando no está en los metadatos', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug' } }));
    await handler(buildEvent());
    const [upsertData] = mockUpsert.mock.calls[0];
    expect(upsertData.servicios).toEqual([]);
  });

  it('usa "base" como plan por defecto cuando no está en los metadatos', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug' } }));
    await handler(buildEvent());
    const [upsertData] = mockUpsert.mock.calls[0];
    expect(upsertData.plan).toBe('base');
  });

  it('establece expires_at en 90 días para plan base (por defecto)', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug' } }));
    const before = Date.now();
    await handler(buildEvent());
    const after = Date.now();

    const [upsertData] = mockUpsert.mock.calls[0];
    const expiresAt = new Date(upsertData.expires_at).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + ninetyDays);
    expect(expiresAt).toBeLessThanOrEqual(after + ninetyDays);
  });

  it('establece expires_at en 365 días para plan pro', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug', plan: 'pro' } }));
    const before = Date.now();
    await handler(buildEvent());
    const after = Date.now();

    const [upsertData] = mockUpsert.mock.calls[0];
    const expiresAt = new Date(upsertData.expires_at).getTime();
    const oneYear = 365 * 24 * 60 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + oneYear);
    expect(expiresAt).toBeLessThanOrEqual(after + oneYear);
  });

  it('devuelve 500 cuando Supabase falla en el upsert', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug' } }));
    mockUpsert.mockResolvedValue({ error: { message: 'connection timeout' } });

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Database error');
  });

  it('guarda email y phone de customer_details en Supabase', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'test-slug' },
        customerDetails: { email: 'cliente@email.com', phone: '+34666123456' },
      })
    );
    await handler(buildEvent());
    const [upsertData] = mockUpsert.mock.calls[0];
    expect(upsertData.email).toBe('cliente@email.com');
    expect(upsertData.phone).toBe('+34666123456');
  });

  it('envía email de confirmación tras activar la tarjeta', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'ana-abogada', nombre: 'Ana López', plan: 'base' },
        customerDetails: { email: 'ana@email.com' },
      })
    );
    await handler(buildEvent());

    expect(mockEmailSend).toHaveBeenCalledOnce();
    const [emailArgs] = mockEmailSend.mock.calls[0];
    expect(emailArgs.to).toBe('ana@email.com');
    expect(emailArgs.subject).toContain('Ana');
    expect(emailArgs.html).toContain('ana-abogada');
  });

  it('no envía email si el comprador no tiene email', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'test-slug', nombre: 'Sin Email' },
        customerDetails: {},
      })
    );
    await handler(buildEvent());
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('sigue devolviendo 200 aunque el envío de email falle', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'test-slug', nombre: 'Test' },
        customerDetails: { email: 'test@email.com' },
      })
    );
    mockEmailSend.mockRejectedValue(new Error('SMTP error'));

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
  });

  it('lanza un error cuando servicios contiene JSON inválido (caso no controlado)', async () => {
    // BUG: el handler no tiene try/catch alrededor de JSON.parse(servicios),
    // por lo que lanza una excepción en lugar de devolver una respuesta HTTP adecuada.
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({ metadata: { slug: 'test-slug', servicios: '{json-invalido' } })
    );
    await expect(handler(buildEvent())).rejects.toThrow();
  });
});

// --- Tests de buildEmail ---

describe('buildEmail', () => {
  const base = {
    nombre: 'María Pérez',
    slug: 'maria-electricista',
    plan: 'base',
    expiresAt: new Date('2026-07-20').toISOString(),
    siteUrl: 'https://perfilapro.com',
  };

  it('incluye el enlace a la tarjeta', () => {
    const { html } = buildEmail(base);
    expect(html).toContain('https://perfilapro.com/c/maria-electricista');
  });

  it('muestra "Base" para plan base y "Premium" para plan pro', () => {
    const { html: htmlBase } = buildEmail({ ...base, plan: 'base' });
    expect(htmlBase).toContain('Base');

    const { html: htmlPro } = buildEmail({ ...base, plan: 'pro' });
    expect(htmlPro).toContain('Premium');
  });

  it('el subject incluye el nombre del usuario', () => {
    const { subject } = buildEmail(base);
    expect(subject).toContain('María');
  });
});
