import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/admin-orgs.js';

// --- Mocks ---

const mockMaybeSingle    = vi.fn();
const mockSingle         = vi.fn();
const mockInsertSelect   = vi.fn(() => ({ single: mockSingle }));
const mockInsert         = vi.fn(() => ({ select: mockInsertSelect }));

const mockSelectChain    = {};
const mockUpdateChain    = {};

const mockFrom = vi.fn();
const mockDb   = { from: mockFrom };

const handler = makeHandler(mockDb);

// --- Helpers ---

function buildEvent({ method = 'POST', body = {}, password = 'admin123' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password },
    body: JSON.stringify(body),
  };
}

// La chain para SELECT (.select().eq().is().maybeSingle()):
function makeSelectChain(maybeSingleResult) {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn(() => Promise.resolve(maybeSingleResult.listResult || { data: [], error: null })),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult.maybeSingleResult ?? { data: null, error: null }),
  };
  return { select: vi.fn(() => chain), insert: mockInsert };
}

// La chain para UPDATE (.update().eq().is()):
function makeUpdateChain(eqResult) {
  const finalEq = {
    is: vi.fn().mockResolvedValue(eqResult),
  };
  const chain = {
    eq: vi.fn(() => ({
      // Cuando hay solo .eq() (sin .is()) — assign_card
      then: (resolve) => Promise.resolve(eqResult).then(resolve),
      // Cuando hay .eq().is() — update org
      is: finalEq.is,
    })),
  };
  return chain;
}

// --- Tests ---

describe('admin-orgs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;

    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({ data: { id: 'uuid-1', slug: 'iris', name: 'Iris', tagline: null, logo_url: null, color_primary: null }, error: null });
  });

  it('rechaza GET con 405', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza requests sin contraseña con 401', async () => {
    const res = await handler(buildEvent({ password: '' }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza acción desconocida con 400', async () => {
    mockFrom.mockReturnValue(makeSelectChain({}));
    const res = await handler(buildEvent({ body: { action: 'borrar' } }));
    expect(res.statusCode).toBe(400);
  });

  // ── list ──
  describe('list', () => {
    it('devuelve la lista de orgs activas', async () => {
      const orgs = [{ id: 'u1', slug: 'iris', name: 'Iris' }];
      const select = {
        is: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: orgs, error: null })),
      };
      mockFrom.mockReturnValue({ select: vi.fn(() => select) });

      const res = await handler(buildEvent({ body: { action: 'list' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.orgs).toEqual(orgs);
    });

    it('devuelve 500 si la query falla', async () => {
      const select = {
        is: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'db down' } })),
      };
      mockFrom.mockReturnValue({ select: vi.fn(() => select) });

      const res = await handler(buildEvent({ body: { action: 'list' } }));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── create ──
  describe('create', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({ insert: mockInsert });
    });

    it('crea una org con campos mínimos y devuelve 200', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.org.slug).toBe('iris');
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.slug).toBe('iris');
      expect(inserted.name).toBe('Iris');
    });

    it('rechaza slug inválido con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'IRIS-MAYUS', name: 'Iris' } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('slug');
    });

    it('rechaza name corto con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'I' } }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza color_primary mal formado con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', color_primary: 'rojo' } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('color_primary');
    });

    it('rechaza logo_url fuera del whitelist con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', logo_url: 'https://evil.com/x.png' } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('logo_url');
    });

    it('acepta color_primary hex válido y logo_url whitelisted', async () => {
      const res = await handler(buildEvent({
        body: {
          action: 'create', slug: 'iris', name: 'Iris',
          color_primary: '#FF6600',
          logo_url: 'https://abc.supabase.co/storage/v1/object/public/logos/iris.png',
        },
      }));
      expect(res.statusCode).toBe(200);
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.color_primary).toBe('#FF6600');
      expect(inserted.logo_url).toContain('supabase.co');
    });

    it('devuelve 409 cuando hay conflicto de unicidad en BD', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris' } }));
      expect(res.statusCode).toBe(409);
    });

    it('rechaza tagline de más de 140 chars', async () => {
      const long = 'x'.repeat(141);
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', tagline: long } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── update ──
  describe('update', () => {
    beforeEach(() => {
      const chain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: null }),
      };
      mockFrom.mockReturnValue({ update: vi.fn(() => chain) });
    });

    it('actualiza tagline y color_primary', async () => {
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'iris', tagline: 'Nuevo claim', color_primary: '#123456' },
      }));
      expect(res.statusCode).toBe(200);
    });

    it('rechaza si no hay nada para actualizar', async () => {
      const res = await handler(buildEvent({ body: { action: 'update', slug: 'iris' } }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza slug inválido', async () => {
      const res = await handler(buildEvent({ body: { action: 'update', slug: 'X', tagline: 'foo' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── assign_card ──
  describe('assign_card', () => {
    it('vincula una card a una org existente', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'uuid-iris' }, error: null }),
      };
      const cardUpdate = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards')         return { update: vi.fn(() => cardUpdate) };
        return {};
      });

      const res = await handler(buildEvent({ body: { action: 'assign_card', card_slug: 'ana', org_slug: 'iris' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.organization_id).toBe('uuid-iris');
    });

    it('desvincula (null) cuando org_slug=null', async () => {
      const cardUpdate = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') return { update: vi.fn(() => cardUpdate) };
        return {};
      });

      const res = await handler(buildEvent({ body: { action: 'assign_card', card_slug: 'ana', org_slug: null } }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organization_id).toBeNull();
    });

    it('devuelve 404 cuando la org no existe', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });

      const res = await handler(buildEvent({ body: { action: 'assign_card', card_slug: 'ana', org_slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza si falta card_slug', async () => {
      const res = await handler(buildEvent({ body: { action: 'assign_card', org_slug: 'iris' } }));
      expect(res.statusCode).toBe(400);
    });
  });
});
