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

    it('persiste address y phone sanitizados al crear (campos opcionales)', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris',
        address: '  C/ Mayor 12, <b>Orihuela</b>  ',
        phone:   '+34 965 12 34 56',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.address).toBe('C/ Mayor 12, Orihuela'); // tags stripeados + trim
      expect(inserted.phone).toBe('+34 965 12 34 56');
    });

    it('persiste address/phone como null si vienen vacíos', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris', address: '', phone: '',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.address).toBeNull();
      expect(inserted.phone).toBeNull();
    });

    it('persiste hide_branding=true cuando llega true (white-label opt-in)', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'aossa', name: 'AOSSA', hide_branding: true,
      } }));
      expect(mockInsert.mock.calls[0][0].hide_branding).toBe(true);
    });

    it('persiste hide_branding=false por defecto (sin opt-in explícito)', async () => {
      await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris' } }));
      expect(mockInsert.mock.calls[0][0].hide_branding).toBe(false);
    });

    it('hide_branding distinto de true (string, 1, "true") se persiste como false', async () => {
      // Boolean estricto · evita toggle accidental por payload mal formado.
      await handler(buildEvent({ body: {
        action: 'create', slug: 'xx', name: 'XX', hide_branding: 'true',
      } }));
      expect(mockInsert.mock.calls[0][0].hide_branding).toBe(false);
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

    it('persiste description sanitizada (strip tags + trim + max 500)', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris',
        description: '  <b>Comercializadora</b> de energía renovable  ',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.description).toBe('Comercializadora de energía renovable');
    });

    it('rechaza description de más de 500 chars', async () => {
      const long = 'x'.repeat(501);
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', description: long } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('description');
    });

    it('persiste website válido', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris',
        website: 'https://irisenergia.es',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.website).toBe('https://irisenergia.es');
    });

    it('rechaza website con protocolo peligroso', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', website: 'javascript:alert(1)' } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('website');
    });

    it('rechaza website sin protocolo http(s)', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', website: 'irisenergia.es' } }));
      expect(res.statusCode).toBe(400);
    });

    it('persiste email válido', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris', email: 'hola@iris.es',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.email).toBe('hola@iris.es');
    });

    it('por defecto crea una org de negocio (kind=null, sport=null)', async () => {
      await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris' } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.kind).toBeNull();
      expect(inserted.sport).toBeNull();
    });

    it('crea un club deportivo con kind=sports_club y sport normalizado', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'cd-flota', name: 'CD La Flota',
        kind: 'sports_club', sport: 'Futbol',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.kind).toBe('sports_club');
      expect(inserted.sport).toBe('futbol'); // trim + lowercase
    });

    it('ignora el sport si la org no es club deportivo', async () => {
      await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris',
        kind: 'business', sport: 'futbol',
      } }));
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.kind).toBe('business');
      expect(inserted.sport).toBeNull();
    });

    it('rechaza kind fuera del CHECK con 400', async () => {
      const res = await handler(buildEvent({ body: {
        action: 'create', slug: 'iris', name: 'Iris', kind: 'ong',
      } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('kind');
    });

    it('rechaza sport mal formado con 400', async () => {
      const res = await handler(buildEvent({ body: {
        action: 'create', slug: 'cd-flota', name: 'CD La Flota',
        kind: 'sports_club', sport: 'Fútbol Sala',
      } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('sport');
    });

    it('rechaza email mal formado', async () => {
      const res = await handler(buildEvent({ body: { action: 'create', slug: 'iris', name: 'Iris', email: 'no-es-un-email' } }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('email');
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

    it('actualiza description, website y email cuando se envían', async () => {
      const res = await handler(buildEvent({
        body: {
          action: 'update', slug: 'iris',
          description: 'Nueva descripción',
          website: 'https://iris.es',
          email: 'hola@iris.es',
        },
      }));
      expect(res.statusCode).toBe(200);
    });

    it('rechaza website inválido en update', async () => {
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'iris', website: 'javascript:alert(1)' },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza description >500 en update', async () => {
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'iris', description: 'x'.repeat(501) },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('persiste hide_branding=true en update (white-label opt-in)', async () => {
      const updateMock = vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: null }),
      }));
      mockFrom.mockReturnValue({ update: updateMock });
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'aossa', hide_branding: true },
      }));
      expect(res.statusCode).toBe(200);
      expect(updateMock.mock.calls[0][0]).toEqual({ hide_branding: true });
    });

    it('hide_branding no-true en update se persiste como false (boolean estricto)', async () => {
      const updateMock = vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: null }),
      }));
      mockFrom.mockReturnValue({ update: updateMock });
      await handler(buildEvent({
        body: { action: 'update', slug: 'aossa', hide_branding: 'yes' },
      }));
      expect(updateMock.mock.calls[0][0]).toEqual({ hide_branding: false });
    });

    it('convierte una org existente en club deportivo (kind + sport)', async () => {
      const updateMock = vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: null }),
      }));
      mockFrom.mockReturnValue({ update: updateMock });
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'cd-flota', kind: 'sports_club', sport: 'Futbol' },
      }));
      expect(res.statusCode).toBe(200);
      expect(updateMock.mock.calls[0][0]).toEqual({ kind: 'sports_club', sport: 'futbol' });
    });

    it('al volver a negocio limpia el sport defensivamente', async () => {
      const updateMock = vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: null }),
      }));
      mockFrom.mockReturnValue({ update: updateMock });
      await handler(buildEvent({
        body: { action: 'update', slug: 'cd-flota', kind: 'business', sport: 'futbol' },
      }));
      expect(updateMock.mock.calls[0][0]).toEqual({ kind: 'business', sport: null });
    });

    it('rechaza kind inválido en update con 400', async () => {
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'iris', kind: 'club' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('kind');
    });

    it('rechaza sport inválido en update con 400', async () => {
      const res = await handler(buildEvent({
        body: { action: 'update', slug: 'cd-flota', sport: 'Fútbol' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('sport');
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

  // ── get_edit_url ──
  describe('get_edit_url', () => {
    function mockCardRead(card) {
      const lookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
      };
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: updateEq }));
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') return { select: vi.fn(() => lookup), update: cardsUpdate };
        return {};
      });
      return { cardsUpdate, updateEq };
    }

    it('reusa token vigente sin regenerar', async () => {
      const futureExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { cardsUpdate } = mockCardRead({
        slug: 'carlos-perez',
        idioma: 'es',
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: futureExpires,
      });
      const res = await handler(buildEvent({ body: { action: 'get_edit_url', card_slug: 'carlos-perez' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.edit_url).toContain('/es/editar?slug=carlos-perez&token=' + 'a'.repeat(64));
      expect(cardsUpdate).not.toHaveBeenCalled();
    });

    it('regenera token si está expirado', async () => {
      const pastExpires = new Date(Date.now() - 60_000).toISOString();
      const { cardsUpdate, updateEq } = mockCardRead({
        slug: 'ana-ruiz',
        idioma: 'es',
        edit_token: 'old-token',
        edit_token_expires_at: pastExpires,
      });
      const res = await handler(buildEvent({ body: { action: 'get_edit_url', card_slug: 'ana-ruiz' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.edit_url).toMatch(/\/es\/editar\?slug=ana-ruiz&token=[a-f0-9]{64}$/);
      expect(json.edit_url).not.toContain('old-token');
      expect(cardsUpdate).toHaveBeenCalledOnce();
      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.edit_token).toMatch(/^[a-f0-9]{64}$/);
      expect(new Date(payload.edit_token_expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(updateEq).toHaveBeenCalledWith('slug', 'ana-ruiz');
    });

    it('regenera token si la card no tiene token', async () => {
      const { cardsUpdate } = mockCardRead({
        slug: 'sin-token',
        idioma: 'es',
        edit_token: null,
        edit_token_expires_at: null,
      });
      const res = await handler(buildEvent({ body: { action: 'get_edit_url', card_slug: 'sin-token' } }));
      expect(res.statusCode).toBe(200);
      expect(cardsUpdate).toHaveBeenCalledOnce();
    });

    it('respeta idioma=ca en la URL', async () => {
      const futureExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      mockCardRead({
        slug: 'pere-cat',
        idioma: 'ca',
        edit_token: 'b'.repeat(64),
        edit_token_expires_at: futureExpires,
      });
      const res = await handler(buildEvent({ body: { action: 'get_edit_url', card_slug: 'pere-cat' } }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).edit_url).toContain('/ca/editar?');
    });

    it('devuelve 404 si la card no existe o está soft-deleted', async () => {
      mockCardRead(null);
      const res = await handler(buildEvent({ body: { action: 'get_edit_url', card_slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza si falta card_slug', async () => {
      const res = await handler(buildEvent({ body: { action: 'get_edit_url' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── delete_card ──
  describe('delete_card', () => {
    function mockCardLookup(card) {
      const lookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
      };
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: updateEq }));
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') return { select: vi.fn(() => lookup), update: cardsUpdate };
        return {};
      });
      return { cardsUpdate, updateEq };
    }

    it('soft-deleta la card (marca deleted_at, deja visits/facturas)', async () => {
      const { cardsUpdate, updateEq } = mockCardLookup({ slug: 'carlos-perez' });
      const res = await handler(buildEvent({ body: { action: 'delete_card', card_slug: 'carlos-perez' } }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).card_slug).toBe('carlos-perez');
      expect(cardsUpdate).toHaveBeenCalledOnce();
      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.deleted_at).toBeTruthy();
      expect(new Date(payload.deleted_at).getTime()).toBeLessThanOrEqual(Date.now());
      expect(updateEq).toHaveBeenCalledWith('slug', 'carlos-perez');
    });

    it('devuelve 404 si la card no existe o ya está borrada', async () => {
      const { cardsUpdate } = mockCardLookup(null);
      const res = await handler(buildEvent({ body: { action: 'delete_card', card_slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
      expect(cardsUpdate).not.toHaveBeenCalled();
    });

    it('rechaza si falta card_slug', async () => {
      const res = await handler(buildEvent({ body: { action: 'delete_card' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── offboard_card ──
  describe('offboard_card', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const offboardHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    function mockOffboardLookups({ card, orgName = 'Special Trainer' }) {
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { name: orgName }, error: null }),
      };
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: updateEq }));

      let cardsSelectCount = 0;
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') {
          cardsSelectCount++;
          return { select: vi.fn(() => cardLookup), update: cardsUpdate };
        }
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      return { cardsUpdate, updateEq };
    }

    it('aplica cortesía 90 días: organization_id=null, plan=base, expires_at=NOW+90, reset reminders', async () => {
      const card = {
        slug: 'olga', nombre: 'Olga Cardona', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st', expires_at: null,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      const { cardsUpdate } = mockOffboardLookups({ card });
      const res = await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.courtesy_days).toBe(90);

      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.organization_id).toBeNull();
      expect(payload.plan).toBe('base');
      expect(payload.reminder_30_sent).toBe(false);
      expect(payload.reminder_15_sent).toBe(false);
      expect(payload.reminder_7_sent).toBe(false);

      const expiresAt = new Date(payload.expires_at).getTime();
      const target = Date.now() + 90 * 86400000;
      expect(Math.abs(expiresAt - target)).toBeLessThan(5000);
    });

    it('envía email al trabajador con copy en castellano por defecto', async () => {
      const card = {
        slug: 'olga', nombre: 'Olga Cardona', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st', expires_at: null,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      mockOffboardLookups({ card, orgName: 'Special Trainer' });
      await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const args = mockEmailSend.mock.calls[0][0];
      expect(args.to).toBe('olga@gmail.com');
      expect(args.subject).toContain('Special Trainer');
      expect(args.subject).toContain('cortesía');
      expect(args.html).toContain('90 días');
    });

    it('respeta idioma catalán en el email', async () => {
      const card = {
        slug: 'olga', nombre: 'Olga Cardona', email: 'olga@gmail.com', idioma: 'ca',
        organization_id: 'org-st', expires_at: null,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      mockOffboardLookups({ card, orgName: 'Special Trainer' });
      await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      const args = mockEmailSend.mock.calls[0][0];
      expect(args.subject).toContain('cortesia');
      expect(args.html).toContain('90 dies');
    });

    it('regenera edit_token si está caducado', async () => {
      const card = {
        slug: 'olga', nombre: 'Olga', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st', expires_at: null,
        edit_token: 'old',
        edit_token_expires_at: new Date(Date.now() - 86400000).toISOString(),
      };
      const { cardsUpdate } = mockOffboardLookups({ card });
      await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.edit_token).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.edit_token).not.toBe('old');
    });

    it('preserva expires_at existente si es posterior a NOW+90d', async () => {
      const farFuture = new Date(Date.now() + 365 * 86400000).toISOString();
      const card = {
        slug: 'olga', nombre: 'Olga', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st', expires_at: farFuture,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      const { cardsUpdate } = mockOffboardLookups({ card });
      await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      expect(cardsUpdate.mock.calls[0][0].expires_at).toBe(farFuture);
    });

    it('devuelve 400 si la card no está asignada a ninguna org', async () => {
      const card = {
        slug: 'olga', nombre: 'Olga', email: 'olga@gmail.com', idioma: 'es',
        organization_id: null, expires_at: null,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      mockOffboardLookups({ card });
      const res = await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 404 si la card no existe', async () => {
      mockOffboardLookups({ card: null });
      const res = await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza si falta card_slug', async () => {
      const res = await offboardHandler(buildEvent({ body: { action: 'offboard_card' } }));
      expect(res.statusCode).toBe(400);
    });

    it('aplica el offboard aunque el email falle (defensivo)', async () => {
      mockEmailSend.mockRejectedValueOnce(new Error('Resend down'));
      const card = {
        slug: 'olga', nombre: 'Olga', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st', expires_at: null,
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      const { cardsUpdate } = mockOffboardLookups({ card });
      const res = await offboardHandler(buildEvent({ body: { action: 'offboard_card', card_slug: 'olga' } }));
      expect(res.statusCode).toBe(200);
      expect(cardsUpdate).toHaveBeenCalledOnce();
    });
  });

  // ── get_panel_url ──
  describe('get_panel_url', () => {
    beforeEach(() => {
      process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
      process.env.SITE_URL = 'https://perfilapro.es';
      delete process.env.URL;
    });

    it('firma un JWT actor=founder y devuelve la URL del panel', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía' },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });

      const res = await handler(buildEvent({ body: { action: 'get_panel_url', slug: 'iris-energia' } }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Convención del handler: callAdmin del frontend exige json.ok === true,
      // no basta con res.ok. Sin ok=true el frontend lanza "HTTP 200" engañoso.
      expect(body.ok).toBe(true);
      expect(body.org_name).toBe('Iris Energía');
      expect(body.url).toMatch(/^https:\/\/perfilapro\.es\/panel\.html\?session=/);

      // Verifica que el JWT lleva el claim actor=founder.
      const token = body.url.split('session=')[1];
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, 'test-org-panel-secret');
      expect(decoded.actor).toBe('founder');
      expect(decoded.orgSlug).toBe('iris-energia');
      expect(decoded.orgId).toBe('uuid-iris');
      expect(decoded.purpose).toBe('org-panel');
    });

    it('devuelve 404 si la org no existe', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await handler(buildEvent({ body: { action: 'get_panel_url', slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('devuelve 404 si la org está soft-deleted (la query filtra deleted_at IS NULL)', async () => {
      // El handler usa .is('deleted_at', null) en la query — mockeamos lookup
      // como si la org soft-deleted no apareciera (mismo comportamiento real).
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await handler(buildEvent({ body: { action: 'get_panel_url', slug: 'iris-energia' } }));
      expect(res.statusCode).toBe(404);
      expect(orgLookup.is).toHaveBeenCalledWith('deleted_at', null);
    });

    it('rechaza slug inválido con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'get_panel_url', slug: 'IRIS!' } }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza requests sin contraseña con 401 (no expone URL impersonate)', async () => {
      const res = await handler(buildEvent({ body: { action: 'get_panel_url', slug: 'iris-energia' }, password: '' }));
      expect(res.statusCode).toBe(401);
    });
  });

  // ── send_panel_invite ──
  describe('send_panel_invite', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const inviteHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
      process.env.SITE_URL = 'https://perfilapro.es';
      delete process.env.URL;
      mockEmailSend.mockResolvedValue({ id: 'msg-1' });
    });

    function withOrg(orgData) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: orgData, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      return orgLookup;
    }

    it('manda email con magic-link 7d (sin claim founder) al organizations.email', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: 'cliente@iris.es' });

      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
      }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.sent_to).toBe('cliente@iris.es');

      expect(mockEmailSend).toHaveBeenCalledOnce();
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.to).toBe('cliente@iris.es');
      expect(call.subject).toMatch(/Iris Energía/);
      expect(call.html).toMatch(/panel\.html\?session=/);

      // El magic-link del HTML NO debe llevar claim actor=founder (es para el cliente, TTL 7d).
      const m = call.html.match(/panel\.html\?session=([^"&]+)/);
      expect(m).toBeTruthy();
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(m[1], 'test-org-panel-secret');
      expect(decoded.actor).toBeUndefined();
      expect(decoded.orgSlug).toBe('iris-energia');
    });

    it('localiza el email en catalán cuando idioma=ca', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: 'cliente@iris.es' });

      await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia', idioma: 'ca' },
      }));
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.subject).toMatch(/El teu panell/);
      expect(call.html).toMatch(/Benvinguda/);
    });

    it('default a español si idioma no se especifica', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: 'cliente@iris.es' });

      await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
      }));
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.subject).toMatch(/Tu panel de PerfilaPro/);
      expect(call.html).toMatch(/Bienvenida/);
    });

    it('un club deportivo recibe copy deportivo (plantilla/inscripciones) + línea de reenvío', async () => {
      withOrg({ id: 'uuid-flota', slug: 'cd-flota', name: 'CD La Flota', email: 'club@flota.es', kind: 'sports_club' });

      await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'cd-flota' },
      }));
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.subject).toMatch(/CD La Flota/);
      expect(call.html).toMatch(/Plantilla/);
      expect(call.html).toMatch(/Inscripciones/);
      expect(call.html).toMatch(/cuotas/);
      // La línea de reenvío para el contacto que no es el responsable.
      expect(call.html).toMatch(/Reenvía este correo a la persona responsable/);
      // NO debe llevar el vocabulario B2B de oficina.
      expect(call.html).not.toMatch(/invitar profesionales en lote/);
    });

    it('club deportivo en catalán usa copy deportivo catalán', async () => {
      withOrg({ id: 'uuid-flota', slug: 'cd-flota', name: 'CD La Flota', email: 'club@flota.es', kind: 'sports_club' });

      await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'cd-flota', idioma: 'ca' },
      }));
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.html).toMatch(/Plantilla/);
      expect(call.html).toMatch(/Reenvia aquest correu/);
    });

    it('una org de negocio (kind null) mantiene el copy B2B y SIN línea de reenvío', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: 'cliente@iris.es', kind: null });

      await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
      }));
      const call = mockEmailSend.mock.calls[0][0];
      expect(call.html).toMatch(/invitar profesionales en lote/);
      expect(call.html).not.toMatch(/persona responsable/);
    });

    it('devuelve 400 si la org no tiene email registrado', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: null });

      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/email/i);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('devuelve 404 si la org no existe', async () => {
      withOrg(null);

      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'no-existe' },
      }));
      expect(res.statusCode).toBe(404);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('rechaza slug inválido con 400', async () => {
      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'IRIS!' },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza requests sin contraseña con 401', async () => {
      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
        password: '',
      }));
      expect(res.statusCode).toBe(401);
    });

    it('devuelve 500 si Resend falla y NO devuelve 200 engañoso', async () => {
      withOrg({ id: 'uuid-iris', slug: 'iris-energia', name: 'Iris Energía', email: 'cliente@iris.es' });
      mockEmailSend.mockRejectedValueOnce(new Error('Resend down'));

      const res = await inviteHandler(buildEvent({
        body: { action: 'send_panel_invite', slug: 'iris-energia' },
      }));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── list_offboarded_members ──
  describe('list_offboarded_members', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
    });

    it('devuelve cards offboarded en últimos 90d con flag restorable', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'uuid-aossa', name: 'AOSSA' } }),
      };
      const cardsChain = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { slug: 'maria', nombre: 'María', email: 'm@x.com', offboarded_at: '2026-05-01T00:00:00Z', offboarded_by: 'client', organization_id: null, expires_at: '2026-08-01T00:00:00Z' },
            { slug: 'paco', nombre: 'Paco',  email: 'p@x.com', offboarded_at: '2026-04-15T00:00:00Z', offboarded_by: 'founder', organization_id: 'otra-org', expires_at: '2026-07-15T00:00:00Z' },
          ],
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards') return { select: vi.fn(() => cardsChain) };
        return {};
      });

      const res = await handler(buildEvent({
        body: { action: 'list_offboarded_members', slug: 'aossa' },
      }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.members).toHaveLength(2);
      expect(body.members[0].restorable).toBe(true);  // organization_id NULL
      expect(body.members[1].restorable).toBe(false); // ya re-asignada
      expect(body.window_days).toBe(90);
    });

    it('devuelve 404 si la org no existe', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await handler(buildEvent({ body: { action: 'list_offboarded_members', slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza slug inválido con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'list_offboarded_members', slug: 'AOSSA!' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── restore_member ──
  describe('restore_member', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const restoreHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      process.env.SITE_URL = 'https://perfilapro.es';
      mockEmailSend.mockResolvedValue({ id: 'msg-restore' });
    });

    function withCardAndOrg(cardData, orgData) {
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: cardData }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: orgData }),
      };
      const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') return {
          select: vi.fn(() => cardLookup),
          update: vi.fn(() => updateChain),
        };
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
    }

    it('restaura card huérfana a su org original y envía email al trabajador', async () => {
      withCardAndOrg(
        {
          slug: 'maria', nombre: 'María López', email: 'maria@x.com', idioma: 'es',
          organization_id: null,
          previous_organization_id: 'uuid-aossa',
          offboarded_at: '2026-05-15T00:00:00Z',
        },
        { id: 'uuid-aossa', name: 'AOSSA' }
      );

      const res = await restoreHandler(buildEvent({
        body: { action: 'restore_member', card_slug: 'maria' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).org_name).toBe('AOSSA');
      expect(mockEmailSend).toHaveBeenCalledOnce();
      expect(mockEmailSend.mock.calls[0][0].subject).toMatch(/vuelves a formar parte/i);
    });

    it('rechaza con 400 si la card no está offboarded', async () => {
      withCardAndOrg(
        { slug: 'x', organization_id: 'uuid-org', previous_organization_id: null, offboarded_at: null },
        null
      );
      const res = await restoreHandler(buildEvent({
        body: { action: 'restore_member', card_slug: 'x' },
      }));
      expect(res.statusCode).toBe(400);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si la card ya pertenece a otra org', async () => {
      withCardAndOrg(
        {
          slug: 'movida', organization_id: 'uuid-otra-org',
          previous_organization_id: 'uuid-aossa',
          offboarded_at: '2026-05-15T00:00:00Z',
        },
        null
      );
      const res = await restoreHandler(buildEvent({
        body: { action: 'restore_member', card_slug: 'movida' },
      }));
      expect(res.statusCode).toBe(409);
    });

    it('rechaza requests sin contraseña con 401', async () => {
      const res = await restoreHandler(buildEvent({
        body: { action: 'restore_member', card_slug: 'x' },
        password: '',
      }));
      expect(res.statusCode).toBe(401);
    });
  });

  // ── delete_org ──
  describe('delete_org', () => {
    it('soft-deleta la org y desvincula sus cards', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'uuid-iris' }, error: null }),
      };
      const cardsUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const orgUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = { eq: cardsUpdateEq };
      const orgUpdate   = { eq: orgUpdateEq };

      let updateCallCount = 0;
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') {
          return {
            select: vi.fn(() => orgLookup),
            update: vi.fn((payload) => {
              updateCallCount++;
              return orgUpdate;
            }),
          };
        }
        if (table === 'cards') {
          return { update: vi.fn(() => cardsUpdate) };
        }
        return {};
      });

      const res = await handler(buildEvent({ body: { action: 'delete_org', slug: 'iris' } }));
      expect(res.statusCode).toBe(200);
      expect(cardsUpdateEq).toHaveBeenCalledWith('organization_id', 'uuid-iris');
      expect(orgUpdateEq).toHaveBeenCalledWith('id', 'uuid-iris');
    });

    it('devuelve 404 si la org no existe', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await handler(buildEvent({ body: { action: 'delete_org', slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza slug inválido', async () => {
      const res = await handler(buildEvent({ body: { action: 'delete_org', slug: 'IRIS' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── leads_list / leads_assign / leads_resend (Sprint 3 · pieza A) ──
  describe('leads endpoints', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const leadsHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    it('leads_list devuelve leads pendientes con la org asociada resuelta', async () => {
      const leads = [
        { id: 'l1', invite_token: 'a'.repeat(48), name: 'Carlos', company: 'Allianz', email: 'c@a.com',
          team_size: '100-500', sector: 'empresa', message: null, idioma: 'es',
          organization_id: 'org1', created_at: '2026-05-01T00:00:00Z', redeemed_at: null, redeemed_card_slug: null,
          agent_code: 'agent-MARTA01' },
      ];
      const leadsSelect = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        is:    vi.fn(() => Promise.resolve({ data: leads, error: null })),
      };
      const orgsSelect = {
        in: vi.fn(() => Promise.resolve({ data: [{ id: 'org1', slug: 'allianz', name: 'Allianz' }], error: null })),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads')     return { select: vi.fn(() => leadsSelect) };
        if (table === 'organizations') return { select: vi.fn(() => orgsSelect) };
        return {};
      });

      const res = await leadsHandler(buildEvent({ body: { action: 'leads_list' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.leads).toHaveLength(1);
      expect(json.leads[0].org.slug).toBe('allianz');
      // Bloque D · atribución comercial sobrevive al passthrough.
      expect(json.leads[0].agent_code).toBe('agent-MARTA01');
    });

    it('leads_list sin only_pending=false incluye también redimidos', async () => {
      // Validamos que NO se aplica .is('redeemed_at', null) cuando only_pending=false.
      // El handler en ese caso retorna directamente desde .limit() (no llega a .is()).
      // Lo modelamos haciendo que .limit() devuelva la promesa con los datos.
      const allLeads = [
        { id: 'l1', invite_token: 'x'.repeat(48), name: 'A', company: 'B', email: 'a@b.com',
          team_size: '5-20', sector: 'empresa', message: null, idioma: 'es',
          organization_id: null, created_at: '2026-05-01T00:00:00Z',
          redeemed_at: '2026-05-02T00:00:00Z', redeemed_card_slug: 'a-b' },
      ];
      // Trick: nuestro builder en el handler hace `q.is(...)` solo si only_pending.
      // Para only_pending=false, el `await` cae sobre el builder devuelto por .limit(),
      // que debe ser then-able.
      const builder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: allLeads, error: null }),
        is:    vi.fn().mockResolvedValue({ data: allLeads, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads')     return { select: vi.fn(() => builder) };
        return {};
      });

      const res = await leadsHandler(buildEvent({ body: { action: 'leads_list', only_pending: false } }));
      expect(res.statusCode).toBe(200);
      expect(builder.is).not.toHaveBeenCalled();
    });

    it('leads_assign vincula un lead a una org existente', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', agent_code: null }, error: null }),
      };
      const leadUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
      // El lead no trae agent_code → no hay carry-over de atribución.
      const leadSelect = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { agent_code: null }, error: null }) };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'b2b_leads')     return { update: vi.fn(() => leadUpdate), select: vi.fn(() => leadSelect) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_assign', lead_id: '11111111-1111-1111-1111-111111111111', org_slug: 'allianz' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.organization_id).toBe('org1');
      expect(json.agent_code_carried).toBeNull();
    });

    it('leads_assign carry-over: copia el agent_code del lead a una org sin atribución (Phase 2 · Bloque D)', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', agent_code: null }, error: null }),
      };
      const leadUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
      const leadSelect = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { agent_code: 'agent-MARTA01' }, error: null }) };
      const orgUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const orgUpdate = { eq: orgUpdateEq };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup), update: vi.fn(() => orgUpdate) };
        if (table === 'b2b_leads')     return { update: vi.fn(() => leadUpdate), select: vi.fn(() => leadSelect) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_assign', lead_id: '11111111-1111-1111-1111-111111111111', org_slug: 'allianz' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).agent_code_carried).toBe('agent-MARTA01');
      // La org recibió el UPDATE de agent_code.
      expect(orgUpdateEq).toHaveBeenCalledWith('id', 'org1');
    });

    it('leads_assign carry-over NO pisa una org que ya tiene agent_code', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', agent_code: 'agent-OTRO' }, error: null }),
      };
      const leadUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
      const orgUpdate = vi.fn();
      const leadSelect = vi.fn();
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup), update: orgUpdate };
        if (table === 'b2b_leads')     return { update: vi.fn(() => leadUpdate), select: leadSelect };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_assign', lead_id: '11111111-1111-1111-1111-111111111111', org_slug: 'allianz' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).agent_code_carried).toBeNull();
      // Ni se consultó el lead ni se actualizó la org (atribución preservada).
      expect(leadSelect).not.toHaveBeenCalled();
      expect(orgUpdate).not.toHaveBeenCalled();
    });

    it('leads_assign con org_slug=null desvincula sin pasar por organizations', async () => {
      const leadUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads') return { update: vi.fn(() => leadUpdate) };
        return {};
      });
      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_assign', lead_id: '11111111-1111-1111-1111-111111111111', org_slug: null },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organization_id).toBeNull();
    });

    it('leads_assign rechaza lead_id no-UUID', async () => {
      const res = await leadsHandler(buildEvent({ body: { action: 'leads_assign', lead_id: 'x', org_slug: 'allianz' } }));
      expect(res.statusCode).toBe(400);
    });

    it('leads_resend envía el magic-link sin prefix (es el primer envío manual)', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
            idioma: 'es', invite_token: 'a'.repeat(48), redeemed_at: null,
            organization_id: null,
          },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads') return { select: vi.fn(() => leadLookup) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_resend', lead_id: '11111111-1111-1111-1111-111111111111' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).branded).toBe(false);
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.to).toBe('c@a.com');
      expect(sent.subject).not.toContain('[Reenvío]');
      expect(sent.subject).toContain('[PerfilaPro · Onboarding]');
      expect(sent.html).toContain('/es/onboarding?token=' + 'a'.repeat(48));
      // Sin org asociada → sin banner branded.
      expect(sent.html).not.toContain('Demo personalizada');
    });

    it('leads_resend con org asociada incluye branding (logo + color) en el email', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
            idioma: 'es', invite_token: 'a'.repeat(48), redeemed_at: null,
            organization_id: 'org1',
          },
          error: null,
        }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            name: 'Allianz España',
            logo_url: 'https://supabase.co/storage/v1/object/public/Avatars/org-logos/allianz.png',
            color_primary: '#003781',
            deleted_at: null,
          },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads')     return { select: vi.fn(() => leadLookup) };
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_resend', lead_id: '11111111-1111-1111-1111-111111111111' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).branded).toBe(true);
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.html).toContain('Demo personalizada');
      expect(sent.html).toContain('Allianz España');
      expect(sent.html).toContain('#003781');
      expect(sent.html).toContain('allianz.png');
    });

    it('leads_resend con org soft-deleted → fallback a email genérico (sin branding)', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
            idioma: 'es', invite_token: 'a'.repeat(48), redeemed_at: null,
            organization_id: 'org1',
          },
          error: null,
        }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            name: 'Allianz', logo_url: null, color_primary: '#003781',
            deleted_at: '2026-05-01T00:00:00Z',
          },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads')     return { select: vi.fn(() => leadLookup) };
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_resend', lead_id: '11111111-1111-1111-1111-111111111111' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).branded).toBe(false);
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.html).not.toContain('Demo personalizada');
    });

    it('leads_resend devuelve 409 si el lead ya está redimido', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
            idioma: 'es', invite_token: 'a'.repeat(48), redeemed_at: '2026-05-02T00:00:00Z',
          },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads') return { select: vi.fn(() => leadLookup) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_resend', lead_id: '11111111-1111-1111-1111-111111111111' },
      }));
      expect(res.statusCode).toBe(409);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('leads_resend devuelve 404 si el lead no existe', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'b2b_leads') return { select: vi.fn(() => leadLookup) };
        return {};
      });
      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_resend', lead_id: '11111111-1111-1111-1111-111111111111' },
      }));
      expect(res.statusCode).toBe(404);
    });
  });

  // ── invite_team (bulk) ──
  describe('invite_team', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const inviteTeamHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    function mockBulkOrgAndCards({ org = { id: 'org1', slug: 'cch', name: 'CCH', logo_url: null, color_primary: '#FFA500' }, existingCards = {}, insertErrors = {} } = {}) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
      // Por cada llamada a maybeSingle (chequeo de slug existente), responder
      // con lo que indique el mapa existingCards (clave = slug, valor = card).
      let lookupIdx = 0;
      cardLookup.maybeSingle.mockImplementation(() => {
        const slugs = Object.keys(existingCards);
        const data = lookupIdx < slugs.length && existingCards[slugs[lookupIdx]] ? existingCards[slugs[lookupIdx]] : null;
        lookupIdx++;
        return Promise.resolve({ data, error: null });
      });
      const cardInsert = vi.fn();
      let insertIdx = 0;
      cardInsert.mockImplementation((row) => {
        const err = insertErrors[insertIdx] || null;
        insertIdx++;
        return Promise.resolve({ error: err });
      });
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards')         return { select: vi.fn(() => cardLookup), insert: cardInsert };
        return {};
      });
      return { orgLookup, cardLookup, cardInsert };
    }

    it('crea N cards con datos comunes y envía N emails con branding de la org', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      const res = await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: {
            tagline: 'Operario de obra · CCH',
            cp: '03300',
            zona: 'Orihuela',
            servicios: ['Albañilería', 'Reformas integrales'],
            descripcion: 'Equipo CCH',
          },
          team: [
            { email: 'pedro@cch.es', nombre: 'Pedro Pérez' },
            { email: 'ana@cch.es',   nombre: 'Ana Ruiz' },
            { email: 'juan@cch.es' }, // sin nombre → slug derivado
          ],
        },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.results.ok).toHaveLength(3);
      expect(json.results.failed).toHaveLength(0);
      expect(cardInsert).toHaveBeenCalledTimes(3);
      // Datos comunes aplicados a todas
      cardInsert.mock.calls.forEach((call) => {
        const row = call[0];
        expect(row.plan).toBe('b2b');
        expect(row.organization_id).toBe('org1');
        expect(row.tagline).toBe('Operario de obra · CCH');
        expect(row.cp).toBe('03300');
        expect(row.zona).toBe('Orihuela');
        expect(row.servicios).toEqual(['Albañilería', 'Reformas integrales']);
        expect(row.descripcion).toBe('Equipo CCH');
        expect(row.edit_token).toMatch(/^[a-f0-9]{64}$/);
      });
      // El tercero (sin nombre) tiene slug agente-{ts36}-{rnd}
      expect(cardInsert.mock.calls[2][0].slug).toMatch(/^agente-/);
      expect(mockEmailSend).toHaveBeenCalledTimes(3);
      expect(mockEmailSend.mock.calls[0][0].subject).toContain('CCH');
      expect(mockEmailSend.mock.calls[0][0].html).toContain('#FFA500');
    });

    it('aplica el cargo individual (ocupacion) por miembro · prevalece sobre template.tagline', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      const res = await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: { tagline: 'Equipo Special Trainer' },
          team: [
            { email: 'olga@st.es',   nombre: 'Olga Cardona', ocupacion: 'Entrenadora' },
            { email: 'juan@st.es',   nombre: 'Juan García',  ocupacion: 'Recepcionista' },
            { email: 'maria@st.es',  nombre: 'María López',  ocupacion: 'Fisioterapeuta' },
          ],
        },
      }));
      expect(res.statusCode).toBe(200);
      expect(cardInsert).toHaveBeenCalledTimes(3);
      expect(cardInsert.mock.calls[0][0].tagline).toBe('Entrenadora');
      expect(cardInsert.mock.calls[1][0].tagline).toBe('Recepcionista');
      expect(cardInsert.mock.calls[2][0].tagline).toBe('Fisioterapeuta');
    });

    it('cae al template.tagline cuando un miembro no trae ocupacion · mezcla OK', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: { tagline: 'Operario CCH' },
          team: [
            { email: 'pedro@cch.es', nombre: 'Pedro', ocupacion: 'Capataz' },
            { email: 'ana@cch.es',   nombre: 'Ana' },
            { email: 'juan@cch.es',  nombre: 'Juan', ocupacion: '' },
          ],
        },
      }));
      expect(cardInsert.mock.calls[0][0].tagline).toBe('Capataz');
      expect(cardInsert.mock.calls[1][0].tagline).toBe('Operario CCH');
      expect(cardInsert.mock.calls[2][0].tagline).toBe('Operario CCH');
    });

    it('sin template.tagline y sin ocupacion individual no añade tagline al row', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: {},
          team: [{ email: 'pedro@cch.es', nombre: 'Pedro' }],
        },
      }));
      expect(cardInsert.mock.calls[0][0].tagline).toBeUndefined();
    });

    it('pre-rellena direccion y local_publico desde org.address al invitar', async () => {
      // AOSSA-style: la org tiene sede central; los miembros la heredan
      // como emplazamiento por defecto y la editan desde /editar si están
      // en otra sede.
      const { cardInsert } = mockBulkOrgAndCards({
        org: { id: 'org1', slug: 'aossa', name: 'AOSSA', logo_url: null, color_primary: '#003781', address: 'Av. de la Innovación s/n, 41020 Sevilla' },
      });
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'aossa',
          template: {},
          team: [{ email: 'agente@aossa.es', nombre: 'Lucía Romero' }],
        },
      }));
      const row = cardInsert.mock.calls[0][0];
      expect(row.direccion).toBe('Av. de la Innovación s/n, 41020 Sevilla');
      expect(row.local_publico).toBe(true);
    });

    it('no añade direccion al row si la org no tiene address', async () => {
      // Caso común hoy: orgs sin address registrada → miembro queda sin
      // emplazamiento hasta que lo rellene él mismo en /editar.
      const { cardInsert } = mockBulkOrgAndCards();
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: {},
          team: [{ email: 'a@cch.es', nombre: 'Ana' }],
        },
      }));
      const row = cardInsert.mock.calls[0][0];
      expect(row.direccion).toBeUndefined();
      expect(row.local_publico).toBeUndefined();
    });

    it('sanitiza HTML del org.address al pre-rellenar direccion', async () => {
      const { cardInsert } = mockBulkOrgAndCards({
        org: { id: 'org1', slug: 'xx', name: 'X', logo_url: null, color_primary: '#000', address: '  <b>C/ Mayor</b> 12  ' },
      });
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'xx',
          template: {},
          team: [{ email: 'a@xx.es', nombre: 'A B' }],
        },
      }));
      expect(cardInsert.mock.calls[0][0].direccion).toBe('C/ Mayor 12');
    });

    it('sanitiza HTML y trunca la ocupacion individual a 140 chars', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      const long = 'X'.repeat(200);
      await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: {},
          team: [{ email: 'a@cch.es', nombre: 'A', ocupacion: `<script>alert(1)</script>${long}` }],
        },
      }));
      const tagline = cardInsert.mock.calls[0][0].tagline;
      expect(tagline).not.toContain('<script>');
      expect(tagline.length).toBeLessThanOrEqual(140);
    });

    it('reporta éxito parcial cuando un email del lote es inválido', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      const res = await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          template: {},
          team: [
            { email: 'pedro@cch.es', nombre: 'Pedro' },
            { email: 'no-es-email', nombre: 'Malo' },
            { email: 'ana@cch.es',   nombre: 'Ana' },
          ],
        },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.results.ok).toHaveLength(2);
      expect(json.results.failed).toHaveLength(1);
      expect(json.results.failed[0].email).toBe('no-es-email');
      expect(cardInsert).toHaveBeenCalledTimes(2); // solo los válidos
    });

    it('rechaza team vacío con 400', async () => {
      const res = await inviteTeamHandler(buildEvent({
        body: { action: 'invite_team', org_slug: 'cch', team: [] },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza team mayor de 100 con 400', async () => {
      const team = Array.from({ length: 101 }, (_, i) => ({ email: `a${i}@cch.es` }));
      const res = await inviteTeamHandler(buildEvent({
        body: { action: 'invite_team', org_slug: 'cch', team },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 404 si la org no existe', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await inviteTeamHandler(buildEvent({
        body: { action: 'invite_team', org_slug: 'no-existe', team: [{ email: 'a@b.com' }] },
      }));
      expect(res.statusCode).toBe(404);
    });

    it('plantilla vacía es válida (los operarios entran con datos mínimos)', async () => {
      const { cardInsert } = mockBulkOrgAndCards();
      const res = await inviteTeamHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'cch',
          team: [{ email: 'pedro@cch.es', nombre: 'Pedro' }],
        },
      }));
      expect(res.statusCode).toBe(200);
      const row = cardInsert.mock.calls[0][0];
      expect(row.plan).toBe('b2b');
      expect(row.organization_id).toBe('org1');
      expect(row.tagline).toBeUndefined();
      expect(row.servicios).toBeUndefined();
    });
  });

  // ── list_cards_for_assignment ──
  describe('list_cards_for_assignment', () => {
    it('devuelve cards activas con slug, nombre, organization_id', async () => {
      const cards = [
        { slug: 'ana', nombre: 'Ana', organization_id: 'uuid-iris', plan: 'pro', status: 'active' },
        { slug: 'beto', nombre: 'Beto', organization_id: null, plan: 'base', status: 'active' },
      ];
      const select = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: cards, error: null })),
      };
      mockFrom.mockReturnValue({ select: vi.fn(() => select) });

      const res = await handler(buildEvent({ body: { action: 'list_cards_for_assignment' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.cards).toEqual(cards);
    });

    it('devuelve 500 si la query falla', async () => {
      const select = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'db down' } })),
      };
      mockFrom.mockReturnValue({ select: vi.fn(() => select) });

      const res = await handler(buildEvent({ body: { action: 'list_cards_for_assignment' } }));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── send_edit_link · reenviar magic-link al miembro desde admin-orgs ──
  describe('send_edit_link', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const sendHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    // Lookup chain compartido: cards.select.eq.is.maybeSingle (card lookup) +
    // organizations.select.eq.maybeSingle (branding) + cards.update.eq (stamp).
    function mockSendLookups({ card, org = null }) {
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: updateEq }));
      mockFrom.mockImplementation((table) => {
        if (table === 'cards') {
          return { select: vi.fn(() => cardLookup), update: cardsUpdate };
        }
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      return { cardsUpdate, updateEq };
    }

    it('manda email branded con logo + color cuando la card está en una org', async () => {
      const card = {
        slug: 'olga-cardona', nombre: 'Olga Cardona', email: 'olga@gmail.com', idioma: 'es',
        organization_id: 'org-st',
        edit_token: 'a'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      const org = { name: 'Special Trainer', logo_url: 'https://x.supabase.co/storage/v1/logo.png', color_primary: '#FFA500' };
      mockSendLookups({ card, org });

      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'olga-cardona' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.branded).toBe(true);
      expect(json.email).toBe('olga@gmail.com');
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.to).toBe('olga@gmail.com');
      expect(sent.subject).toContain('[Reenvío]');
      expect(sent.subject).toContain('Special Trainer');
      expect(sent.html).toContain('#FFA500');
      expect(sent.html).toContain('Special Trainer');
    });

    it('manda email genérico cuando la card no tiene organización', async () => {
      const card = {
        slug: 'autonomo', nombre: 'Pedro Sin', email: 'pedro@x.es', idioma: 'es',
        organization_id: null,
        edit_token: 'b'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      mockSendLookups({ card });

      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'autonomo' } }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).branded).toBe(false);
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.subject).toContain('[Reenvío]');
      expect(sent.subject).toContain('Pedro');
      // El email genérico NO incluye banner de org
      expect(sent.html).not.toContain('Equipo de');
    });

    it('regenera token si está caducado y lo persiste con el timestamp', async () => {
      const card = {
        slug: 'caducado', nombre: 'X', email: 'x@y.es', idioma: 'es',
        organization_id: null,
        edit_token: 'old-token',
        edit_token_expires_at: new Date(Date.now() - 86400000).toISOString(),
      };
      const { cardsUpdate } = mockSendLookups({ card });
      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'caducado' } }));
      expect(res.statusCode).toBe(200);
      expect(cardsUpdate).toHaveBeenCalledOnce();
      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.edit_token).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.edit_token).not.toBe('old-token');
      expect(payload.edit_link_sent_at).toBeTruthy();
      // El email lleva el token nuevo, no el viejo
      expect(mockEmailSend.mock.calls[0][0].html).toContain(payload.edit_token);
    });

    it('reusa token vigente y solo marca edit_link_sent_at', async () => {
      const card = {
        slug: 'vigente', nombre: 'X', email: 'x@y.es', idioma: 'es',
        organization_id: null,
        edit_token: 'c'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      };
      const { cardsUpdate } = mockSendLookups({ card });
      await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'vigente' } }));
      const payload = cardsUpdate.mock.calls[0][0];
      expect(payload.edit_token).toBeUndefined();
      expect(payload.edit_link_sent_at).toBeTruthy();
    });

    it('respeta idioma=ca en subject y prefix', async () => {
      const card = {
        slug: 'pere', nombre: 'Pere', email: 'pere@x.cat', idioma: 'ca',
        organization_id: null,
        edit_token: 'd'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      mockSendLookups({ card });
      await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'pere' } }));
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.subject).toContain('[Reenviament]');
    });

    it('devuelve 400 si la card no tiene email registrado', async () => {
      const card = { slug: 'sin', nombre: 'X', email: null, idioma: 'es', organization_id: null, edit_token: null, edit_token_expires_at: null };
      mockSendLookups({ card });
      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'sin' } }));
      expect(res.statusCode).toBe(400);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('devuelve 404 si la card no existe', async () => {
      mockSendLookups({ card: null });
      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza si falta card_slug', async () => {
      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 500 si Resend falla', async () => {
      mockEmailSend.mockRejectedValueOnce(new Error('Resend down'));
      const card = {
        slug: 'x', nombre: 'X', email: 'x@y.es', idioma: 'es', organization_id: null,
        edit_token: 'e'.repeat(64),
        edit_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      mockSendLookups({ card });
      const res = await sendHandler(buildEvent({ body: { action: 'send_edit_link', card_slug: 'x' } }));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── org_card_stats · agregado de visitas + último email por card ──
  describe('org_card_stats', () => {
    function mockStatsLookups({ org, cards = [], visits = [] }) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const cardsSelect = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn(() => Promise.resolve({ data: cards, error: null })),
      };
      const visitsSelect = {
        in:  vi.fn().mockReturnThis(),
        gte: vi.fn(() => Promise.resolve({ data: visits, error: null })),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards')         return { select: vi.fn(() => cardsSelect) };
        if (table === 'visits')        return { select: vi.fn(() => visitsSelect) };
        return {};
      });
    }

    it('devuelve stats por card con conteo agregado de visitas', async () => {
      const org = { id: 'org-st' };
      const cards = [
        { slug: 'olga',  kit_email_sent_at: '2026-05-01T10:00:00Z', edit_link_sent_at: null },
        { slug: 'juan',  kit_email_sent_at: null,                    edit_link_sent_at: '2026-05-09T10:00:00Z' },
        { slug: 'maria', kit_email_sent_at: null,                    edit_link_sent_at: null },
      ];
      // 3 visitas para olga, 1 para juan, 0 para maria
      const visits = [
        { slug: 'olga' }, { slug: 'olga' }, { slug: 'olga' },
        { slug: 'juan' },
      ];
      mockStatsLookups({ org, cards, visits });

      const res = await handler(buildEvent({ body: { action: 'org_card_stats', org_slug: 'special-trainer' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.cards).toHaveLength(3);
      const bySlug = Object.fromEntries(json.cards.map(c => [c.slug, c]));
      expect(bySlug.olga.visits_30d).toBe(3);
      expect(bySlug.juan.visits_30d).toBe(1);
      expect(bySlug.maria.visits_30d).toBe(0);
      expect(bySlug.olga.kit_email_sent_at).toBe('2026-05-01T10:00:00Z');
      expect(bySlug.juan.edit_link_sent_at).toBe('2026-05-09T10:00:00Z');
      expect(bySlug.maria.kit_email_sent_at).toBeNull();
    });

    it('devuelve cards vacía si la org no tiene profesionales asignados', async () => {
      mockStatsLookups({ org: { id: 'vacia' }, cards: [], visits: [] });
      const res = await handler(buildEvent({ body: { action: 'org_card_stats', org_slug: 'vacia' } }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).cards).toEqual([]);
    });

    it('devuelve 404 si la org no existe', async () => {
      mockStatsLookups({ org: null });
      const res = await handler(buildEvent({ body: { action: 'org_card_stats', org_slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza org_slug inválido', async () => {
      const res = await handler(buildEvent({ body: { action: 'org_card_stats', org_slug: 'BAD UPPER' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('org_get_stats_link', () => {
    function mockOrgUpdate({ org, updateError = null }) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const updateChain = {
        eq: vi.fn().mockResolvedValue({ data: null, error: updateError }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') {
          return {
            select: vi.fn(() => orgLookup),
            update: vi.fn(() => updateChain),
          };
        }
        return {};
      });
      return { updateChain };
    }

    it('genera token nuevo y devuelve URL si la org no tiene token', async () => {
      mockOrgUpdate({ org: { id: 'o1', slug: 'acme', stats_token: null, stats_token_expires_at: null } });
      const res = await handler(buildEvent({
        body: { action: 'org_get_stats_link', org_slug: 'acme' },
        headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.just_created).toBe(true);
      expect(json.token).toMatch(/^[0-9a-f]{64}$/);
      expect(json.url).toBe(`https://perfilapro.es/e/acme/stats?token=${json.token}`);
      expect(new Date(json.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('reutiliza el token existente si está vigente', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
      const existingToken = 'c'.repeat(64);
      mockOrgUpdate({ org: { id: 'o1', slug: 'acme', stats_token: existingToken, stats_token_expires_at: futureExpiry } });
      const res = await handler(buildEvent({
        body: { action: 'org_get_stats_link', org_slug: 'acme' },
        headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(false);
      expect(json.token).toBe(existingToken);
      expect(json.expires_at).toBe(futureExpiry);
    });

    it('rota el token si force_refresh=true incluso si está vigente', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
      const existingToken = 'd'.repeat(64);
      mockOrgUpdate({ org: { id: 'o1', slug: 'acme', stats_token: existingToken, stats_token_expires_at: futureExpiry } });
      const res = await handler(buildEvent({
        body: { action: 'org_get_stats_link', org_slug: 'acme', force_refresh: true },
        headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(true);
      expect(json.token).not.toBe(existingToken);
    });

    it('regenera el token si está expirado', async () => {
      const pastExpiry = new Date(Date.now() - 86400000).toISOString();
      const oldToken = 'e'.repeat(64);
      mockOrgUpdate({ org: { id: 'o1', slug: 'acme', stats_token: oldToken, stats_token_expires_at: pastExpiry } });
      const res = await handler(buildEvent({
        body: { action: 'org_get_stats_link', org_slug: 'acme' },
        headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(true);
      expect(json.token).not.toBe(oldToken);
    });

    it('404 si la org no existe', async () => {
      mockOrgUpdate({ org: null });
      const res = await handler(buildEvent({ body: { action: 'org_get_stats_link', org_slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza org_slug inválido', async () => {
      const res = await handler(buildEvent({ body: { action: 'org_get_stats_link', org_slug: 'BAD UPPER' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── download_team_cards · PDF booklet con tarjeta de visita por miembro ──
  describe('download_team_cards', () => {
    function mockDownloadLookups({ org, cards = [] }) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const cardsSelect = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: cards, error: null })),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards')         return { select: vi.fn(() => cardsSelect) };
        return {};
      });
    }

    it('devuelve PDF base64 con todas las cards activas del equipo', async () => {
      const org = { id: 'org-st', slug: 'st', name: 'ST', logo_url: null, color_primary: '#FFA500', address: 'C/ X 1', phone: null };
      const cards = [
        { slug: 'olga', nombre: 'Olga', tagline: 'Entrenadora', whatsapp: '34633816729', email: 'olga@st.es', direccion: null },
        { slug: 'juan', nombre: 'Juan', tagline: 'Recepcionista', whatsapp: null, email: 'juan@st.es', direccion: 'C/ Propia 4' },
      ];
      mockDownloadLookups({ org, cards });
      const res = await handler(buildEvent({ body: { action: 'download_team_cards', org_slug: 'st' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.filename).toBe('tarjetas-st.pdf');
      expect(json.count).toBe(2);
      // Validamos que base64 decodifica a un PDF válido (header %PDF-)
      const pdfBytes = Buffer.from(json.base64, 'base64');
      expect(pdfBytes.slice(0, 5).toString()).toBe('%PDF-');
      // Multi-página: 2 cards → 2 marcadores /Type /Page
      const matches = pdfBytes.toString('binary').match(/\/Type\s*\/Page[^s]/g) || [];
      expect(matches.length).toBe(2);
    });

    it('devuelve 400 si la org no tiene profesionales activos', async () => {
      mockDownloadLookups({ org: { id: 'vacia', slug: 'vacia', name: 'V' }, cards: [] });
      const res = await handler(buildEvent({ body: { action: 'download_team_cards', org_slug: 'vacia' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 404 si la org no existe', async () => {
      mockDownloadLookups({ org: null });
      const res = await handler(buildEvent({ body: { action: 'download_team_cards', org_slug: 'no-existe' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza org_slug inválido', async () => {
      const res = await handler(buildEvent({ body: { action: 'download_team_cards', org_slug: '!!BAD!!' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── download_member_card · PDF individual de la tarjeta de visita 85×55mm ──
  describe('download_member_card', () => {
    function mockMemberLookups({ card, org }) {
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
      };
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'cards')         return { select: vi.fn(() => cardLookup) };
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
    }

    it('devuelve PDF base64 de un miembro asignado a una org', async () => {
      const card = { slug: 'olga', nombre: 'Olga', tagline: 'Entrenadora', whatsapp: '34633816729', email: 'olga@st.es', direccion: null, organization_id: 'org-st', status: 'active' };
      const org  = { id: 'org-st', slug: 'st', name: 'ST', logo_url: null, color_primary: '#FFA500', address: 'C/ X 1', phone: null };
      mockMemberLookups({ card, org });
      const res = await handler(buildEvent({ body: { action: 'download_member_card', card_slug: 'olga' } }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.filename).toBe('tarjeta-olga.pdf');
      const pdfBytes = Buffer.from(json.base64, 'base64');
      expect(pdfBytes.slice(0, 5).toString()).toBe('%PDF-');
      // Tarjeta individual = 1 sola página.
      const matches = pdfBytes.toString('binary').match(/\/Type\s*\/Page[^s]/g) || [];
      expect(matches.length).toBe(1);
    });

    it('devuelve 404 si la card no existe', async () => {
      mockMemberLookups({ card: null, org: null });
      const res = await handler(buildEvent({ body: { action: 'download_member_card', card_slug: 'fantasma' } }));
      expect(res.statusCode).toBe(404);
    });

    it('devuelve 400 si la card no pertenece a ninguna organización', async () => {
      const card = { slug: 'solo', nombre: 'Solo', organization_id: null, status: 'active' };
      mockMemberLookups({ card, org: null });
      const res = await handler(buildEvent({ body: { action: 'download_member_card', card_slug: 'solo' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 404 si la org asociada fue soft-deleted', async () => {
      const card = { slug: 'huerf', nombre: 'Huerfana', organization_id: 'org-borrada', status: 'active' };
      mockMemberLookups({ card, org: null });
      const res = await handler(buildEvent({ body: { action: 'download_member_card', card_slug: 'huerf' } }));
      expect(res.statusCode).toBe(404);
    });

    it('rechaza card_slug vacío con 400', async () => {
      const res = await handler(buildEvent({ body: { action: 'download_member_card', card_slug: '' } }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── invite_team · timestamp edit_link_sent_at en la card tras email OK ──
  // (antes marcaba kit_email_sent_at, pero eso colisionaba semánticamente
  // con el hook de welcome kit B2B en edit-card.js)
  describe('invite_team edit_link_sent_at stamping', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const inviteHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    it('marca edit_link_sent_at en cada card tras un email exitoso · NO toca kit_email_sent_at', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', slug: 'st', name: 'ST', logo_url: null, color_primary: null }, error: null }),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const cardInsert = vi.fn().mockResolvedValue({ error: null });
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: updateEq }));

      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards') {
          return { select: vi.fn(() => cardLookup), insert: cardInsert, update: cardsUpdate };
        }
        return {};
      });

      const res = await inviteHandler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'st',
          template: {},
          team: [
            { email: 'olga@st.es', nombre: 'Olga' },
            { email: 'juan@st.es', nombre: 'Juan' },
          ],
        },
      }));
      expect(res.statusCode).toBe(200);
      // 2 invitaciones OK → 2 updates de edit_link_sent_at
      expect(cardsUpdate).toHaveBeenCalledTimes(2);
      cardsUpdate.mock.calls.forEach((call) => {
        const payload = call[0];
        expect(payload.edit_link_sent_at).toBeTruthy();
        expect(new Date(payload.edit_link_sent_at).getTime()).toBeLessThanOrEqual(Date.now());
        // kit_email_sent_at queda intacto para que el hook B2B del welcome
        // kit en edit-card.js dispare cuando el miembro complete su perfil.
        expect(payload.kit_email_sent_at).toBeUndefined();
      });
    });

    it('adjunta la tarjeta de visita PDF (tarjeta-{slug}.pdf) al email de invitación', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', slug: 'st', name: 'ST', logo_url: null, color_primary: '#FFA500', address: 'C/ X 1', phone: null }, error: null }),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const cardInsert = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards') return { select: vi.fn(() => cardLookup), insert: cardInsert, update: cardsUpdate };
        return {};
      });

      await inviteHandler(buildEvent({
        body: {
          action: 'invite_team', org_slug: 'st', template: { tagline: 'Entrenadora' },
          team: [{ email: 'olga@st.es', nombre: 'Olga' }],
        },
      }));
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.attachments).toBeDefined();
      expect(sent.attachments).toHaveLength(1);
      const att = sent.attachments[0];
      expect(att.filename).toMatch(/^tarjeta-olga.*\.pdf$/);
      expect(Buffer.isBuffer(att.content)).toBe(true);
      expect(att.content.slice(0, 5).toString()).toBe('%PDF-');
    });

    it('NO marca edit_link_sent_at cuando el email falla', async () => {
      mockEmailSend.mockRejectedValue(new Error('Resend down'));
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1', slug: 'st', name: 'ST', logo_url: null, color_primary: null }, error: null }),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const cardInsert = vi.fn().mockResolvedValue({ error: null });
      const cardsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));

      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards') {
          return { select: vi.fn(() => cardLookup), insert: cardInsert, update: cardsUpdate };
        }
        return {};
      });

      const res = await inviteHandler(buildEvent({
        body: {
          action: 'invite_team', org_slug: 'st', template: {},
          team: [{ email: 'olga@st.es', nombre: 'Olga' }],
        },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.results.failed).toHaveLength(1);
      expect(cardsUpdate).not.toHaveBeenCalled();
    });
  });
});
