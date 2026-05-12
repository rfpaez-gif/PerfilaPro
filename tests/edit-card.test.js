import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/edit-card.js';

// --- Mocks ---

const mockSingle = vi.fn();                 // cards SELECT (auth + load)
const mockCategoryMaybeSingle = vi.fn();    // categories sector+specialty lookup
const mockPostalMaybeSingle = vi.fn();      // postal_codes CP lookup
const mockEqUpdate = vi.fn();               // cards UPDATE eq(slug)
const mockFrom = vi.fn();
const mockDb = { from: mockFrom };

function makeCardsBuilder() {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    single: mockSingle,
    update: vi.fn(),
  };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.in.mockReturnValue(b);
  b.is.mockReturnValue(b);
  b.update.mockReturnValue({ eq: mockEqUpdate });
  return b;
}

function makeCategoriesBuilder() {
  const b = { select: vi.fn(), eq: vi.fn(), maybeSingle: mockCategoryMaybeSingle };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  return b;
}

function makePostalBuilder() {
  const b = { select: vi.fn(), eq: vi.fn(), maybeSingle: mockPostalMaybeSingle };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  return b;
}

const mockOrgMaybeSingle = vi.fn();
function makeOrgBuilder() {
  const b = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: mockOrgMaybeSingle };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.is.mockReturnValue(b);
  return b;
}

let currentBuilder;

// --- Helpers ---

const VALID_TOKEN = 'a'.repeat(64);

const baseCard = {
  slug: 'ana-electricista',
  nombre: 'Ana López',
  tagline: 'Electricista en Madrid',
  cp: '28001',
  zona: 'Madrid',
  servicios: ['Instalación eléctrica · 80€', 'Revisión cuadro eléctrico'],
  whatsapp: '34612345678',
  telefono: '915001234',
  foto_url: null,
};

function buildEvent({ method = 'GET', slug = 'ana-electricista', token = VALID_TOKEN, body = null } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { slug, token },
    body: body ? JSON.stringify(body) : null,
  };
}

// --- Tests ---

describe('edit-card handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle.mockResolvedValue({ data: baseCard, error: null });
    mockEqUpdate.mockResolvedValue({ error: null });
    mockCategoryMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPostalMaybeSingle.mockResolvedValue({
      data: { cp: '28001', municipality_name: 'Madrid', province_slug: 'madrid' },
      error: null,
    });

    mockOrgMaybeSingle.mockResolvedValue({ data: null, error: null });

    mockFrom.mockImplementation((table) => {
      if (table === 'categories')    return makeCategoriesBuilder();
      if (table === 'postal_codes')  return makePostalBuilder();
      if (table === 'organizations') return makeOrgBuilder();
      currentBuilder = makeCardsBuilder();
      return currentBuilder;
    });

    handler = makeHandler(mockDb);
  });

  // ── Validación de parámetros ──

  it('devuelve 400 si falta slug', async () => {
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { token: VALID_TOKEN } });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si falta token', async () => {
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { slug: 'ana-electricista' } });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 400 si no hay queryStringParameters', async () => {
    const res = await handler({ httpMethod: 'GET', queryStringParameters: null });
    expect(res.statusCode).toBe(400);
  });

  // ── Token inválido ──

  it('devuelve 401 si el token no coincide en la BD', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  // ── GET: obtener datos ──

  describe('GET', () => {
    it('devuelve 200 con datos de la tarjeta sin token', async () => {
      const res = await handler(buildEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.nombre).toBe('Ana López');
      expect(data.servicios).toHaveLength(2);
      expect(data.edit_token).toBeUndefined();
      expect(data.edit_token_expires_at).toBeUndefined();
    });
  });

  // ── POST: actualizar perfil ──

  describe('POST', () => {
    const validBody = {
      nombre: 'Ana López Ruiz',
      tagline: 'Electricista en Madrid y alrededores',
      cp: '28001',
      servicios: ['Instalación eléctrica · 90€'],
      whatsapp: '34698765432',
      telefono: '915009876',
    };

    it('devuelve 200 y actualiza la tarjeta', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: validBody }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      expect(currentBuilder.update).toHaveBeenCalled();
    });

    it('no borra el token tras guardar (permite editar varias veces)', async () => {
      await handler(buildEvent({ method: 'POST', body: validBody }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.edit_token).toBeUndefined();
    });

    it('limpia caracteres no numéricos del whatsapp', async () => {
      await handler(buildEvent({ method: 'POST', body: { ...validBody, whatsapp: '+34 612-345-678' } }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.whatsapp).toBe('34612345678');
    });

    it('devuelve 400 si falta el nombre', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, nombre: '' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 400 si falta el cp', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, cp: '' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 400 si el cp es inválido', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, cp: '99999' } }));
      expect(res.statusCode).toBe(400);
    });

    it('re-resuelve zona + city_slug desde cp en cada POST', async () => {
      mockPostalMaybeSingle.mockResolvedValueOnce({
        data: { cp: '03001', municipality_name: 'Alicante', province_slug: 'alicante' },
        error: null,
      });
      await handler(buildEvent({ method: 'POST', body: { ...validBody, cp: '03001' } }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.cp).toBe('03001');
      expect(updateArgs.zona).toBe('Alicante');
      expect(updateArgs.city_slug).toBe('alicante');
    });

    it('auto directory_visible=true cuando hay category_id + city_slug resuelto', async () => {
      mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 'cat-uuid' }, error: null });
      const body = { ...validBody, sector: 'oficios', specialty: 'fontanero' };
      await handler(buildEvent({ method: 'POST', body }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.category_id).toBe('cat-uuid');
      expect(updateArgs.directory_visible).toBe(true);
    });

    it('directory_visible=false cuando no hay category_id', async () => {
      mockCategoryMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await handler(buildEvent({ method: 'POST', body: validBody }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.directory_visible).toBe(false);
    });

    it('directory_visible=false cuando cp no resuelve a city_slug', async () => {
      mockPostalMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockCategoryMaybeSingle.mockResolvedValueOnce({ data: { id: 'cat-uuid' }, error: null });
      const body = { ...validBody, cp: '28999', sector: 'oficios', specialty: 'fontanero' };
      await handler(buildEvent({ method: 'POST', body }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.directory_visible).toBe(false);
    });

    it('acepta servicios vacío (perfiles free sin completar)', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, servicios: [] } }));
      expect(res.statusCode).toBe(200);
    });

    it('devuelve 400 si servicios no es un array', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, servicios: 'un servicio' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 400 si el body no es JSON válido', async () => {
      const res = await handler({ ...buildEvent({ method: 'POST' }), body: 'not-json' });
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 500 si Supabase falla al actualizar', async () => {
      mockEqUpdate.mockResolvedValue({ error: { message: 'DB error' } });
      const res = await handler(buildEvent({ method: 'POST', body: validBody }));
      expect(res.statusCode).toBe(500);
    });

    it('guarda null para tagline vacío', async () => {
      await handler(buildEvent({ method: 'POST', body: { ...validBody, tagline: '' } }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.tagline).toBeNull();
    });

    it('guarda null para telefono vacío', async () => {
      await handler(buildEvent({ method: 'POST', body: { ...validBody, telefono: '' } }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.telefono).toBeNull();
    });

    // ── local_publico ──

    it('persiste local_publico=true cuando llega true Y dirección', async () => {
      const body = { ...validBody, direccion: 'Calle Mayor 23', local_publico: true };
      await handler(buildEvent({ method: 'POST', body }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.direccion).toBe('Calle Mayor 23');
      expect(updateArgs.local_publico).toBe(true);
    });

    it('fuerza local_publico=false si llega true pero dirección vacía', async () => {
      const body = { ...validBody, direccion: '', local_publico: true };
      await handler(buildEvent({ method: 'POST', body }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.direccion).toBeNull();
      expect(updateArgs.local_publico).toBe(false);
    });

    it('fuerza local_publico=false si llega true pero dirección es solo HTML/whitespace', async () => {
      const body = { ...validBody, direccion: '<script></script>   ', local_publico: true };
      await handler(buildEvent({ method: 'POST', body }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.local_publico).toBe(false);
    });

    it('persiste local_publico=false cuando body no lo incluye', async () => {
      await handler(buildEvent({ method: 'POST', body: validBody }));
      const updateArgs = currentBuilder.update.mock.calls[0][0];
      expect(updateArgs.local_publico).toBe(false);
    });
  });

  // ── Perfiles free ──

  it('acepta perfiles con status=free (plan gratuito)', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseCard, plan: 'free', status: 'free' }, error: null });
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.plan).toBe('free');
    expect(data.status).toBe('free');
  });

  it('GET expone plan y status en la respuesta', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseCard, plan: 'base', status: 'active' }, error: null });
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.plan).toBe('base');
    expect(data.status).toBe('active');
  });

  // ── Branding de organización (carril B2B) ──

  describe('GET con organization_id', () => {
    it('resuelve y devuelve los campos de branding de la org', async () => {
      mockSingle.mockResolvedValue({
        data: { ...baseCard, organization_id: 'org-uuid-1', plan: 'b2b', status: 'active' },
        error: null,
      });
      mockOrgMaybeSingle.mockResolvedValue({
        data: { slug: 'allianz', name: 'Allianz', logo_url: 'https://abc.supabase.co/storage/v1/object/public/Avatars/org-logos/allianz.png', color_primary: '#003781' },
        error: null,
      });

      const res = await handler(buildEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.organization).toEqual({
        slug: 'allianz',
        name: 'Allianz',
        logo_url: 'https://abc.supabase.co/storage/v1/object/public/Avatars/org-logos/allianz.png',
        color_primary: '#003781',
      });
    });

    it('devuelve organization=null cuando la org está soft-deleted o no existe', async () => {
      mockSingle.mockResolvedValue({
        data: { ...baseCard, organization_id: 'org-uuid-1', plan: 'b2b' },
        error: null,
      });
      mockOrgMaybeSingle.mockResolvedValue({ data: null, error: null });

      const res = await handler(buildEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organization).toBeNull();
    });

    it('NO consulta organizations cuando organization_id es null', async () => {
      mockSingle.mockResolvedValue({ data: { ...baseCard, organization_id: null }, error: null });
      const res = await handler(buildEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organization).toBeNull();
      expect(mockOrgMaybeSingle).not.toHaveBeenCalled();
    });
  });

  // ── Método no permitido ──

  it('devuelve 405 para métodos no permitidos', async () => {
    const res = await handler(buildEvent({ method: 'DELETE' }));
    expect(res.statusCode).toBe(405);
  });
});
