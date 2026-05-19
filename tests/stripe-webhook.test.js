import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildEmail } from '../netlify/functions/stripe-webhook.js';

// --- Mocks de dependencias ---

const mockConstructEvent = vi.fn();
const mockUpsert = vi.fn();
const mockUpdateEq = vi.fn();
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockPostalMaybeSingle = vi.fn();   // postal_codes lookup
const mockCardSelectSingle = vi.fn();    // cards SELECT post-upsert (category_id + categories)
const mockEmailSend = vi.fn();

function makePostalSelectChain() {
  const c = { select: vi.fn(), eq: vi.fn(), maybeSingle: mockPostalMaybeSingle };
  c.select.mockReturnValue(c);
  c.eq.mockReturnValue(c);
  return c;
}

function makeCardSelectChain() {
  const c = { select: vi.fn(), eq: vi.fn(), single: mockCardSelectSingle };
  c.select.mockReturnValue(c);
  c.eq.mockReturnValue(c);
  return c;
}

const mockStripe = { webhooks: { constructEvent: mockConstructEvent } };
const mockEmail = { emails: { send: mockEmailSend } };

// El mockFrom es un dispatch por nombre de tabla. Las builders de cards
// son dinámicas según el método llamado: upsert para writes, select+single
// para el read post-upsert (category_id + specialty_label), update+eq para
// directory_visible y kit_email_sent_at.
const mockFrom = vi.fn();

function defaultFromImpl(table) {
  if (table === 'postal_codes') return makePostalSelectChain();
  if (table === 'cards') {
    return {
      upsert: mockUpsert,
      update: mockUpdate,
      ...makeCardSelectChain(),
    };
  }
  return { upsert: mockUpsert, update: mockUpdate };
}

const mockDb = { from: mockFrom };
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
    mockUpdateEq.mockResolvedValue({ error: null });
    // Default: CP no resuelve (los tests existentes no envían cp). Los tests
    // específicos de CP sobreescriben este mock.
    mockPostalMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCardSelectSingle.mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation(defaultFromImpl);
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
    mockPostalMaybeSingle.mockResolvedValueOnce({
      data: { cp: '28001', municipality_name: 'Madrid', province_slug: 'madrid' },
      error: null,
    });
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: {
          slug: 'juan-fontanero',
          nombre: 'Juan García',
          tagline: 'Fontanero profesional',
          whatsapp: '+34600000000',
          cp: '28001',
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
    expect(upsertData.cp).toBe('28001');
    expect(upsertData.zona).toBe('Madrid');
    expect(upsertData.city_slug).toBe('madrid');
    expect(upsertData.servicios).toEqual(['Instalación · 80€', 'Reparación · 50€']);
    expect(upsertData.email).toBeNull();
    expect(upsertData.phone).toBeUndefined();
    expect(upsertData.telefono).toBeUndefined();
  });

  it('auto-publica directory_visible=true cuando hay category_id + city_slug', async () => {
    mockPostalMaybeSingle.mockResolvedValueOnce({
      data: { cp: '28001', municipality_name: 'Madrid', province_slug: 'madrid' },
      error: null,
    });
    mockCardSelectSingle.mockResolvedValueOnce({
      data: { category_id: 'cat-uuid', categories: { specialty_label: 'Fontaneros' } },
      error: null,
    });
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'juan-fontanero', nombre: 'Juan', cp: '28001', plan: 'base' },
      })
    );
    await handler(buildEvent());
    // El UPDATE de directory_visible se llama con eq(slug, ...).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ directory_visible: true })
    );
  });

  it('NO publica en directorio si CP no resuelve a city_slug', async () => {
    mockPostalMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockCardSelectSingle.mockResolvedValueOnce({
      data: { category_id: 'cat-uuid', categories: { specialty_label: 'Fontaneros' } },
      error: null,
    });
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'juan-fontanero', nombre: 'Juan', cp: '99999', plan: 'base' },
      })
    );
    await handler(buildEvent());
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ directory_visible: true })
    );
  });

  it('NO publica en directorio si no hay category_id en cards', async () => {
    mockPostalMaybeSingle.mockResolvedValueOnce({
      data: { cp: '28001', municipality_name: 'Madrid', province_slug: 'madrid' },
      error: null,
    });
    mockCardSelectSingle.mockResolvedValueOnce({
      data: { category_id: null, categories: null },
      error: null,
    });
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'juan', nombre: 'Juan', cp: '28001', plan: 'base' },
      })
    );
    await handler(buildEvent());
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ directory_visible: true })
    );
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

  it('persiste idioma="es" por defecto cuando no llega en metadata', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug' } }));
    await handler(buildEvent());
    expect(mockUpsert.mock.calls[0][0].idioma).toBe('es');
  });

  it('persiste idioma="ca" cuando llega en metadata', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug', idioma: 'ca' } }));
    await handler(buildEvent());
    expect(mockUpsert.mock.calls[0][0].idioma).toBe('ca');
  });

  it('idioma desconocido en metadata cae a "es"', async () => {
    mockConstructEvent.mockReturnValue(buildStripeEvent({ metadata: { slug: 'test-slug', idioma: 'fr' } }));
    await handler(buildEvent());
    expect(mockUpsert.mock.calls[0][0].idioma).toBe('es');
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

  it('guarda email de customer_details pero NO sobrescribe telefono/phone', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'test-slug' },
        customerDetails: { email: 'cliente@email.com', phone: '+34666123456' },
      })
    );
    await handler(buildEvent());
    const [upsertData] = mockUpsert.mock.calls[0];
    expect(upsertData.email).toBe('cliente@email.com');
    // El phone de Stripe ya no se persiste: confunde con cards.telefono (campo
    // separado del usuario para "teléfono fijo opcional"). Ver phone-utils.
    expect(upsertData.phone).toBeUndefined();
    expect(upsertData.telefono).toBeUndefined();
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
    editToken: 'tok-abc-123',
  };

  it('incluye el enlace a la tarjeta', () => {
    const { html } = buildEmail(base);
    expect(html).toContain('https://perfilapro.com/c/maria-electricista');
  });

  it('muestra "Trimestral" para plan base y "Anual" para plan pro', () => {
    const { html: htmlBase } = buildEmail({ ...base, plan: 'base' });
    expect(htmlBase).toContain('Trimestral');

    const { html: htmlPro } = buildEmail({ ...base, plan: 'pro' });
    expect(htmlPro).toContain('Anual');
  });

  it('el subject incluye el nombre del usuario', () => {
    const { subject } = buildEmail(base);
    expect(subject).toContain('María');
  });

  it('incluye los enlaces de re-descarga (kit físico) cuando hay editToken', () => {
    const { html } = buildEmail(base);
    expect(html).toContain('/api/download-card?slug=maria-electricista&token=tok-abc-123');
    expect(html).toContain('/api/qr/maria-electricista?format=png&size=1024');
  });

  it('omite la sección kit cuando no hay editToken', () => {
    const { html } = buildEmail({ ...base, editToken: null });
    expect(html).not.toContain('Tu kit físico');
    expect(html).not.toContain('/api/download-card');
    expect(html).not.toContain('/api/qr/');
  });

  it('incluye la sección "Dónde ponerlo" con los 3 lugares clave', () => {
    const { html } = buildEmail(base);
    expect(html).toContain('Dónde ponerlo');
    expect(html).toContain('Instagram');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('furgo');
  });

  it('renderiza la fecha de expiración en formato es-ES', () => {
    const { html } = buildEmail(base);
    expect(html).toMatch(/20 de julio de 2026/);
  });

  it('el botón principal "Ver mi perfil" apunta al cardUrl', () => {
    const { html } = buildEmail(base);
    expect(html).toMatch(/href="https:\/\/perfilapro\.com\/c\/maria-electricista"[^>]*>[^<]*Ver mi perfil/);
  });

  it('genera email en catalán cuando idioma="ca"', () => {
    const { html, subject } = buildEmail({ ...base, idioma: 'ca' });
    expect(html).toContain('<html lang="ca">');
    expect(html).toContain('Veure el meu perfil');
    expect(html).toContain('El teu kit físic');
    expect(html).toContain('Targeta imprimible');
    expect(html).toContain('Codi QR');
    expect(html).toContain('Editar el meu perfil');
    expect(subject).toContain('al món');
  });

  it('editUrl en catalán apunta a /ca/editar', () => {
    const { html } = buildEmail({ ...base, idioma: 'ca' });
    expect(html).toContain('https://perfilapro.com/ca/editar?slug=maria-electricista&token=tok-abc-123');
    expect(html).not.toContain('/es/editar?slug=maria-electricista');
  });

  it('idioma="es" por defecto cuando no se pasa', () => {
    const { html } = buildEmail(base);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Ver mi perfil');
    expect(html).toContain('https://perfilapro.com/es/editar?slug=maria-electricista&token=tok-abc-123');
  });
});

// --- Tests de adjuntos en sendConfirmationEmail (vía handler) ---

describe('stripe-webhook adjuntos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockPostalMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCardSelectSingle.mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table) => {
      if (table === 'postal_codes') return makePostalSelectChain();
      if (table === 'cards')    return { upsert: mockUpsert, update: mockUpdate, ...makeCardSelectChain() };
      if (table === 'facturas') return {
        select: vi.fn().mockReturnThis(),
        like:   vi.fn().mockResolvedValue({ count: 0, error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
      return { upsert: mockUpsert, update: mockUpdate };
    });
    mockEmailSend.mockResolvedValue({ id: 'email-123' });
  });

  it('marca cards.kit_email_sent_at tras envío exitoso del email', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'ana-electricista', nombre: 'Ana', plan: 'base' },
        customerDetails: { email: 'ana@email.com' },
      })
    );
    await handler(buildEvent());

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ kit_email_sent_at: expect.any(String) })
    );
  }, 30000);

  it('NO marca kit_email_sent_at si el envío falla', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: { slug: 'ana-fail', nombre: 'Ana', plan: 'base' },
        customerDetails: { email: 'ana@email.com' },
      })
    );
    mockEmailSend.mockRejectedValue(new Error('SMTP error'));
    await handler(buildEvent());

    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ kit_email_sent_at: expect.anything() })
    );
  }, 30000);

  it('adjunta tarjeta PDF y QR PNG en el email post-pago', async () => {
    mockConstructEvent.mockReturnValue(
      buildStripeEvent({
        metadata: {
          slug: 'carlos-fontanero',
          nombre: 'Carlos Pérez',
          tagline: 'Fontanero',
          whatsapp: '34633816729',
          plan: 'base',
        },
        customerDetails: { email: 'carlos@email.com' },
      })
    );
    await handler(buildEvent());

    expect(mockEmailSend).toHaveBeenCalledOnce();
    const [emailArgs] = mockEmailSend.mock.calls[0];
    expect(emailArgs.attachments).toBeDefined();
    const filenames = emailArgs.attachments.map(a => a.filename);
    expect(filenames).toContain('perfilapro-carlos-fontanero.pdf');
    expect(filenames).toContain('perfilapro-carlos-fontanero-qr.png');
  });

  // ─── Routing B2B (Bloque B) ────────────────────────────────────────────────
  // Tests focalizados a verificar que los eventos de subscription entran al
  // lib org-subscription en vez de al carril autónomo. La lógica del lib se
  // valida exhaustivamente en tests/org-subscription.test.js.

  describe('routing B2B subscription events', () => {
    function makeOrgChain(maybeSingleData) {
      const c = {
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        is:     vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: maybeSingleData, error: null }),
        single:      vi.fn().mockResolvedValue({ data: maybeSingleData, error: null }),
      };
      return c;
    }

    it('customer.subscription.updated entra al lib (UPDATE organizations)', async () => {
      const orgChain = makeOrgChain({ id: 'org-1' });
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return orgChain;
        return defaultFromImpl(table);
      });
      mockConstructEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test',
            status: 'active',
            current_period_end: 1900000000,
            items: { data: [{ quantity: 8 }] },
          },
        },
      });
      const res = await handler(buildEvent());
      expect(res.statusCode).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith('organizations');
      expect(orgChain.update).toHaveBeenCalled();
      const updateArg = orgChain.update.mock.calls[0][0];
      expect(updateArg.seats).toBe(8);
      expect(updateArg.subscription_status).toBe('active');
    });

    it('customer.subscription.deleted marca canceled (no soft-delete)', async () => {
      const orgChain = makeOrgChain({ id: 'org-1' });
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return orgChain;
        return defaultFromImpl(table);
      });
      mockConstructEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_test' } },
      });
      await handler(buildEvent());
      expect(orgChain.update).toHaveBeenCalledWith({ subscription_status: 'canceled' });
    });

    it('invoice.paid escribe en org_invoices (no en cards)', async () => {
      const invoiceChain = makeOrgChain(null);
      const orgChain = makeOrgChain({ id: 'org-1', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly', seats: 5 });
      let firstFromOrgsCall = true;
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') {
          // El primer lookup ('org_invoices' resolver) entra al campo `organizations` para resolver la org
          if (firstFromOrgsCall) { firstFromOrgsCall = false; return orgChain; }
          return orgChain;
        }
        if (table === 'org_invoices') return invoiceChain;
        return defaultFromImpl(table);
      });
      mockConstructEvent.mockReturnValue({
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test',
            subscription: 'sub_test',
            amount_paid: 9900,
            currency: 'eur',
            period_start: 1700000000,
            period_end:   1702592000,
            status_transitions: { paid_at: 1700000010 },
            subscription_details: { metadata: { tier: 'team', cycle: 'monthly', seats: '5', agent_code: 'AGENT01' } },
          },
        },
      });
      const res = await handler(buildEvent());
      expect(res.statusCode).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith('org_invoices');
      expect(invoiceChain.upsert).toHaveBeenCalled();
      const row = invoiceChain.upsert.mock.calls[0][0];
      expect(row.stripe_invoice_id).toBe('in_test');
      expect(row.amount_cents).toBe(9900);
      expect(row.agent_code).toBe('AGENT01');
      // El carril autónomo (cards.upsert) NO debe haberse tocado.
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('checkout.session.completed con kind=org-subscription NO entra al carril autónomo', async () => {
      const orgChain = makeOrgChain(null);
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return orgChain;
        return defaultFromImpl(table);
      });
      // El insert chain también necesita .single() para devolver la org creada.
      orgChain.single = vi.fn().mockResolvedValue({
        data: { id: 'org-new', slug: 'acme', email: 'admin@acme.com' }, error: null,
      });

      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_b2b',
            subscription: 'sub_new',
            customer: 'cus_new',
            customer_details: { email: 'admin@acme.com' },
            metadata: {
              kind: 'org-subscription',
              tier: 'team', cycle: 'monthly', seats: '10',
              org_name: 'Acme', slug: 'acme', agent_code: 'AGENT01', idioma: 'es',
            },
          },
        },
      });
      const res = await handler(buildEvent());
      expect(res.statusCode).toBe(200);
      // cards.upsert NO debe haberse llamado (es el indicador del carril autónomo).
      expect(mockUpsert).not.toHaveBeenCalled();
      // organizations.insert SÍ debe haberse llamado.
      expect(orgChain.insert).toHaveBeenCalled();
    });

    it('payment_intent.created y otros eventos siguen siendo no-op', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'customer.created',
        data: { object: { id: 'cus_xyz' } },
      });
      const res = await handler(buildEvent());
      expect(res.statusCode).toBe(200);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
}, 30000);
