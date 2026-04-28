import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/edit-card.js';

// --- Mocks ---

const mockSingle = vi.fn();
const mockEqUpdate = vi.fn();
const mockFrom = vi.fn();
const mockDb = { from: mockFrom };

function makeBuilder() {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    single: mockSingle,
    update: vi.fn(),
  };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.in.mockReturnValue(b);
  b.update.mockReturnValue({ eq: mockEqUpdate });
  return b;
}

let currentBuilder;

// --- Helpers ---

const VALID_TOKEN = 'a'.repeat(64);

const baseCard = {
  slug: 'ana-electricista',
  nombre: 'Ana López',
  tagline: 'Electricista en Madrid',
  zona: 'Madrid centro',
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

    mockFrom.mockImplementation(() => {
      currentBuilder = makeBuilder();
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
      zona: 'Madrid y sur',
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

    it('devuelve 400 si falta la zona', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { ...validBody, zona: '' } }));
      expect(res.statusCode).toBe(400);
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

  // ── Método no permitido ──

  it('devuelve 405 para métodos no permitidos', async () => {
    const res = await handler(buildEvent({ method: 'DELETE' }));
    expect(res.statusCode).toBe(405);
  });
});
