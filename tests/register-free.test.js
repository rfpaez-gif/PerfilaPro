import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler, buildWelcomeEmail } from '../netlify/functions/register-free.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Mock printable kit + posthog server para que el carril demo-funnel
// (register-free → activateAndSendDemoKit → buildPrintableCardPDF) no
// arranque pdfkit real ni mande tráfico a posthog en CI.
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildPrintableCardPDF: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));
vi.mock('../netlify/functions/lib/posthog-server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
}));

// --- Mocks ---

const mockMaybeSingle = vi.fn();             // cards slug-uniqueness check
const mockCategoryMaybeSingle = vi.fn();     // categories sector+specialty lookup
const mockPostalMaybeSingle = vi.fn();       // postal_codes CP lookup
const mockOcupacionMaybeSingle = vi.fn();    // ocupaciones SEPE lookup
const mockInsert = vi.fn();
const mockUpdate = vi.fn();                  // cards UPDATE (demo funnel activation)
const mockUpdateEq = vi.fn();
const mockFromSelect = vi.fn();
const mockFrom = vi.fn();

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

function makeSelectBuilder(maybeSingleFn) {
  const b = { select: vi.fn(), eq: vi.fn(), maybeSingle: maybeSingleFn };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  return b;
}

const mockDb = {
  from: mockFrom,
};

function buildEvent({ method = 'POST', body = {}, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    body:       typeof body === 'string' ? body : JSON.stringify(body),
    headers:    { 'x-forwarded-for': ip },
  };
}

const validBody = {
  nombre:   'Paco García',
  whatsapp: '600111222',
  sector:   'oficios',
  cp:       '03001',
  email:    'paco@example.com',
};

// --- Tests ---

describe('register-free handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.SITE_URL = 'https://perfilapro.es';

    // Default: no existing slug (no collision), no category match,
    // CP 03001 → Alicante / alicante (capital de provincia).
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCategoryMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPostalMaybeSingle.mockResolvedValue({
      data: { cp: '03001', municipality_name: 'Alicante', province_slug: 'alicante' },
      error: null,
    });
    mockOcupacionMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockImplementation(() => ({ eq: mockUpdateEq }));

    mockFrom.mockImplementation((table) => {
      if (table === 'cards') {
        const selectBuilder = makeSelectBuilder(mockMaybeSingle);
        selectBuilder.insert = mockInsert;
        selectBuilder.update = mockUpdate;
        return selectBuilder;
      }
      if (table === 'categories') {
        return makeSelectBuilder(mockCategoryMaybeSingle);
      }
      if (table === 'postal_codes') {
        return makeSelectBuilder(mockPostalMaybeSingle);
      }
      if (table === 'ocupaciones') {
        return makeSelectBuilder(mockOcupacionMaybeSingle);
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

  it('returns 400 for invalid CP (no 5 dígitos numéricos)', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, cp: 'abcde' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/digo postal/i);
  });

  it('returns 400 for CP fuera de rango (53xxx)', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, cp: '53000' } }));
    expect(res.statusCode).toBe(400);
  });

  it('persiste cp normalizado + zona resuelta + city_slug', async () => {
    await handler(buildEvent({ body: { ...validBody, cp: '3001' } })); // sin pad
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.cp).toBe('03001');                  // pad-left aplicado
    expect(insertCall.zona).toBe('Alicante');             // resuelto desde lookup
    expect(insertCall.city_slug).toBe('alicante');        // capital de provincia
  });

  it('persiste perfil sin city_slug si CP válido pero no hay match en BD', async () => {
    mockPostalMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await handler(buildEvent({ body: { ...validBody, cp: '28999' } }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.cp).toBe('28999');
    expect(insertCall.zona).toBe('');
    expect(insertCall.city_slug).toBeNull();
  });

  it('persiste direccion + local_publico=true cuando ambos llegan', async () => {
    const body = { ...validBody, direccion: 'Calle Mayor 23', local_publico: true };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.direccion).toBe('Calle Mayor 23');
    expect(insertCall.local_publico).toBe(true);
  });

  it('fuerza local_publico=false si llega true sin dirección efectiva', async () => {
    const body = { ...validBody, direccion: '', local_publico: true };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.direccion).toBeNull();
    expect(insertCall.local_publico).toBe(false);
  });

  it('por defecto local_publico=false cuando body no lo trae', async () => {
    await handler(buildEvent({ body: validBody }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.local_publico).toBe(false);
  });

  it('creates a free profile and returns slug + URLs', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.slug).toBe('paco-garcia');
    expect(json.card_url).toBe('https://perfilapro.es/c/paco-garcia');
    expect(json.edit_url).toContain('/es/editar?slug=paco-garcia&token=');
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

  it('resolves and persists category_id when archetype slugs are provided', async () => {
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 42 }, error: null });
    const body = { ...validBody, category_sector: 'oficios', category_specialty: 'fontanero' };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.category_id).toBe(42);
    // Confirm we hit the categories table with both filters
    expect(mockFrom).toHaveBeenCalledWith('categories');
  });

  it('persists category_id=null when archetype slugs are missing', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.category_id).toBeNull();
    // No categories lookup should happen if slugs are absent
    expect(mockCategoryMaybeSingle).not.toHaveBeenCalled();
  });

  it('persists category_id=null when sector+specialty pair has no DB match', async () => {
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const body = { ...validBody, category_sector: 'oficios', category_specialty: 'inexistente' };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.category_id).toBeNull();
  });

  it('persists specialty_custom only when category_specialty is otro-oficio', async () => {
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    const body = {
      ...validBody,
      category_sector:    'otros',
      category_specialty: 'otro-oficio',
      specialty_custom:   'Limpiacristales en altura',
    };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.specialty_custom).toBe('Limpiacristales en altura');
    expect(insertCall.category_id).toBe(99);
  });

  it('ignores specialty_custom when category_specialty is canonical', async () => {
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 1 }, error: null });
    const body = {
      ...validBody,
      category_sector:    'oficios',
      category_specialty: 'fontanero',
      specialty_custom:   'Fontanero <script>alert(1)</script>',
    };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.specialty_custom).toBeNull();
  });

  it('persiste ocupacion_code y usa el name SEPE como specialty_custom', async () => {
    mockOcupacionMaybeSingle.mockResolvedValueOnce({
      data: { code: '74301014', name: 'Mecánicos de Motor de Aviación' },
      error: null,
    });
    const body = { ...validBody, ocupacion_code: '74301014' };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.ocupacion_code).toBe('74301014');
    expect(insertCall.specialty_custom).toBe('Mecánicos de Motor de Aviación');
  });

  it('ignora ocupacion_code con formato inválido (no 8 dígitos)', async () => {
    const body = { ...validBody, ocupacion_code: '123' };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.ocupacion_code).toBeNull();
    expect(mockOcupacionMaybeSingle).not.toHaveBeenCalled();
  });

  it('persiste null si ocupacion_code formato OK pero no existe en BD', async () => {
    mockOcupacionMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const body = { ...validBody, ocupacion_code: '99999999' };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.ocupacion_code).toBeNull();
    expect(insertCall.specialty_custom).toBeNull();
  });

  it('ocupacion_code SEPE tiene prioridad sobre el specialty_custom legacy', async () => {
    mockOcupacionMaybeSingle.mockResolvedValueOnce({
      data: { code: '74301014', name: 'Mecánicos de Motor de Aviación' },
      error: null,
    });
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    const body = {
      ...validBody,
      ocupacion_code: '74301014',
      category_sector: 'otros',
      category_specialty: 'otro-oficio',
      specialty_custom: 'Otra cosa libre',
    };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.specialty_custom).toBe('Mecánicos de Motor de Aviación');
  });

  it('strips HTML tags from specialty_custom', async () => {
    mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    const body = {
      ...validBody,
      category_sector:    'otros',
      category_specialty: 'otro-oficio',
      specialty_custom:   '<b>Pulidor</b> de suelos',
    };
    const res = await handler(buildEvent({ body }));
    expect(res.statusCode).toBe(200);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.specialty_custom).toBe('Pulidor de suelos');
  });

  it('devuelve 429 al superar el límite por IP (5 requests / 10 min)', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 5; i++) {
      const res = await handler(buildEvent({ body: { ...validBody, nombre: `Paco ${i}` }, ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ body: validBody, ip }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
  });

  it('rate limit es por IP (otra IP pasa)', async () => {
    for (let i = 0; i < 5; i++) {
      await handler(buildEvent({ body: { ...validBody, nombre: `Paco ${i}` }, ip: '7.7.7.7' }));
    }
    const otherIp = await handler(buildEvent({ body: validBody, ip: '8.8.8.8' }));
    expect(otherIp.statusCode).toBe(200);
  });

  // ───────────────────────────── Demo funnel ─────────────────────────────
  // Cuando el usuario entra a /alta desde una card demo (?via=demo-*) y el
  // grifo DEMO_FUNNEL_FREE_ACTIVE está abierto, la card se activa como Pro
  // en la misma respuesta de register-free (sin Stripe, sin segundo click,
  // sin pantalla intermedia). El welcome email se sustituye por el email
  // demo con la tarjeta A6 adjunta.
  describe('demo funnel (via=demo-*)', () => {
    beforeEach(() => {
      process.env.DEMO_FUNNEL_FREE_ACTIVE = '1';
    });
    afterEach(() => {
      delete process.env.DEMO_FUNNEL_FREE_ACTIVE;
    });

    it('activa la card como Pro y responde demo_activated:true cuando via=demo-* + env on', async () => {
      const res = await handler(buildEvent({ body: { ...validBody, via: 'demo-wa' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.demo_activated).toBe(true);
      expect(json.plan).toBe('pro');
      expect(json.expires_at).toBeDefined();
      // Card se ha actualizado a plan=pro + kit_email_sent_at
      expect(mockUpdate).toHaveBeenCalledOnce();
      const updatePayload = mockUpdate.mock.calls[0][0];
      expect(updatePayload.plan).toBe('pro');
      expect(updatePayload.status).toBe('active');
      expect(updatePayload.kit_email_sent_at).toBeDefined();
      expect(updatePayload.expires_at).toBeDefined();
    });

    it('manda email demo (subject [Demo] + PDF adjunto) en lugar del welcome free', async () => {
      await handler(buildEvent({ body: { ...validBody, via: 'demo-wa' } }));
      await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.subject).toMatch(/^\[Demo\]/);
      expect(sent.attachments).toHaveLength(1);
      expect(sent.attachments[0].filename).toMatch(/^perfilapro-.*\.pdf$/);
    });

    it('acepta cualquier valor que empiece por demo- (demo-pill, demo-qr, etc)', async () => {
      for (const via of ['demo-pill', 'demo-qr', 'demo-rastro']) {
        mockUpdate.mockClear();
        const res = await handler(buildEvent({ body: { ...validBody, via, nombre: `Test ${via}` } }));
        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json.demo_activated, `via=${via} should activate`).toBe(true);
      }
    });

    it('ignora via cuando el env var DEMO_FUNNEL_FREE_ACTIVE está apagado', async () => {
      delete process.env.DEMO_FUNNEL_FREE_ACTIVE;
      const res = await handler(buildEvent({ body: { ...validBody, via: 'demo-wa' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.demo_activated).toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
      // Welcome email free (no [Demo] prefix)
      await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.subject).not.toMatch(/^\[Demo\]/);
    });

    it('ignora valores de via que no empiezan por demo-', async () => {
      const res = await handler(buildEvent({ body: { ...validBody, via: 'instagram' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.demo_activated).toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('si la activación demo falla en BD, cae al carril free normal (no pierde al usuario)', async () => {
      mockUpdateEq.mockResolvedValueOnce({ error: { message: 'BD caída' } });
      const res = await handler(buildEvent({ body: { ...validBody, via: 'demo-wa' } }));
      // La card free ya está insertada — devolvemos 200 con welcome email
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.demo_activated).toBeUndefined();
      expect(json.slug).toBeDefined();
      // Welcome email del carril free se manda como fallback
      await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.subject).not.toMatch(/^\[Demo\]/);
    });
  });

  // register-free es el carril autónomo: NUNCA debe tocar organizations
  // ni b2b_leads. El carril B2B vive en register-b2b.js.
  it('nunca toca organizations ni b2b_leads aunque lleguen esos campos en el body', async () => {
    await handler(buildEvent({ body: {
      ...validBody,
      organization_id: '11111111-2222-3333-4444-555555555555',
      redeemed_token: 'a'.repeat(48),
    } }));
    const tablesTouched = mockFrom.mock.calls.map(c => c[0]);
    expect(tablesTouched).not.toContain('organizations');
    expect(tablesTouched).not.toContain('b2b_leads');
    // Y el insert NO lleva organization_id
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.organization_id).toBeUndefined();
    expect(insertCall.plan).toBe('base');
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
    expect(html).toContain('https://perfilapro.es/es/editar?slug=ana-lopez&token=abc123');
  });
});
