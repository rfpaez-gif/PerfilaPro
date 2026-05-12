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
          organization_id: 'org1', created_at: '2026-05-01T00:00:00Z', redeemed_at: null, redeemed_card_slug: null },
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
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'org1' }, error: null }),
      };
      const leadUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'b2b_leads')     return { update: vi.fn(() => leadUpdate) };
        return {};
      });

      const res = await leadsHandler(buildEvent({
        body: { action: 'leads_assign', lead_id: '11111111-1111-1111-1111-111111111111', org_slug: 'allianz' },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organization_id).toBe('org1');
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

    it('leads_resend reenvía email con prefix [Reenvío]', async () => {
      const leadLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
            idioma: 'es', invite_token: 'a'.repeat(48), redeemed_at: null,
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
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.to).toBe('c@a.com');
      expect(sent.subject).toContain('[Reenvío]');
      expect(sent.html).toContain('/es/onboarding?token=' + 'a'.repeat(48));
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

  // ── invite_agent ──
  describe('invite_agent', () => {
    const mockEmailSend = vi.fn();
    const mockEmail = { emails: { send: mockEmailSend } };
    const inviteHandler = makeHandler(mockDb, mockEmail);

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ADMIN_PASSWORD = 'admin123';
      mockEmailSend.mockResolvedValue({ id: 'msg' });
    });

    function mockOrgLookupAndInsert({ org = { id: 'org1', slug: 'allianz', name: 'Allianz', logo_url: null, color_primary: '#003781' }, existingCard = null, insertError = null } = {}) {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: org, error: null }),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingCard, error: null }),
      };
      const cardInsert = vi.fn().mockResolvedValue({ error: insertError });
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        if (table === 'cards')         return { select: vi.fn(() => cardLookup), insert: cardInsert };
        return {};
      });
      return { orgLookup, cardLookup, cardInsert };
    }

    it('crea card B2B y envía email cuando todo es válido', async () => {
      const { cardInsert } = mockOrgLookupAndInsert();
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'carlos@allianz.es', nombre: 'Carlos Pérez' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.slug).toBe('carlos-perez');
      expect(json.edit_url).toContain('/es/editar?slug=carlos-perez&token=');
      expect(json.org.slug).toBe('allianz');

      // La card debe entrar con plan='b2b', organization_id pre-seteado y token de 64 chars
      expect(cardInsert).toHaveBeenCalledOnce();
      const inserted = cardInsert.mock.calls[0][0];
      expect(inserted.plan).toBe('b2b');
      expect(inserted.status).toBe('active');
      expect(inserted.organization_id).toBe('org1');
      expect(inserted.email).toBe('carlos@allianz.es');
      expect(inserted.nombre).toBe('Carlos Pérez');
      expect(inserted.edit_token).toMatch(/^[a-f0-9]{64}$/);
      expect(inserted.idioma).toBe('es');

      // Email a la dirección correcta, con branding de la org en el body
      expect(mockEmailSend).toHaveBeenCalledOnce();
      const sent = mockEmailSend.mock.calls[0][0];
      expect(sent.to).toBe('carlos@allianz.es');
      expect(sent.subject).toContain('Allianz');
      expect(sent.html).toContain('Allianz');
      expect(sent.html).toContain('#003781'); // color_primary visible en el banner
      expect(sent.html).toContain(inserted.edit_token);
    });

    it('genera slug aleatorio cuando no se pasa nombre', async () => {
      const { cardInsert } = mockOrgLookupAndInsert();
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'pendiente@allianz.es' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.slug).toMatch(/^agente-/);
      const inserted = cardInsert.mock.calls[0][0];
      expect(inserted.nombre).toBe('Nuevo profesional');
    });

    it('renombra el slug con sufijo cuando ya existe una card con ese slug', async () => {
      const { cardInsert } = mockOrgLookupAndInsert({
        existingCard: { slug: 'carlos-perez' },
      });
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'c@a.com', nombre: 'Carlos Pérez' },
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.slug).toMatch(/^carlos-perez-\d{4}$/);
      expect(cardInsert.mock.calls[0][0].slug).toBe(json.slug);
    });

    it('devuelve 400 si el email es inválido', async () => {
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'no-es-email' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('email');
    });

    it('devuelve 400 si el org_slug es inválido', async () => {
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'MAYUS', email: 'c@a.com' },
      }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 404 si la org no existe (o está soft-deleted)', async () => {
      const orgLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockImplementation((table) => {
        if (table === 'organizations') return { select: vi.fn(() => orgLookup) };
        return {};
      });
      const res = await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'no-existe', email: 'c@a.com' },
      }));
      expect(res.statusCode).toBe(404);
    });

    it('devuelve 500 si Resend no está configurado', async () => {
      const handlerSinEmail = makeHandler(mockDb, null);
      const res = await handlerSinEmail(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'c@a.com' },
      }));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain('Resend');
    });

    it('normaliza el email a lowercase', async () => {
      const { cardInsert } = mockOrgLookupAndInsert();
      await inviteHandler(buildEvent({
        body: { action: 'invite_agent', org_slug: 'allianz', email: 'Carlos@Allianz.ES', nombre: 'Carlos' },
      }));
      expect(cardInsert.mock.calls[0][0].email).toBe('carlos@allianz.es');
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
});
