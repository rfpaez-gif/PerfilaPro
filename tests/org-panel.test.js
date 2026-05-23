import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// --- Mocks ---

const VALID_ORG = {
  id: 'org-uuid-1',
  slug: 'acme',
  name: 'Acme S.A.',
  tagline: 'Equipo de Acme',
  description: 'Somos un equipo de profesionales.',
  website: 'https://acme.com',
  email: 'admin@acme.com',
  address: 'Calle Mayor 1',
  phone: '+34911223344',
  logo_url: null,
  color_primary: '#FFA500',
  created_at: '2025-01-01T00:00:00Z',
  deleted_at: null,
  panel_last_login_at: null,
};

function makeDb({ org = VALID_ORG, cards = [], visits = [], updateError = null, insertError = null } = {}) {
  const orgMaybeSingle = vi.fn().mockResolvedValue({ data: org, error: null });
  const orgUpdateEq = vi.fn().mockResolvedValue({ error: updateError });

  // El cards SELECT primero (lista de miembros para get_org) usa is(...)
  // como terminal awaitable; para el resto (org-stats-utils computeOrgStats)
  // también termina en is(...). Ambos comparten chain compatible.
  const cardsSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: cards, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  // Para que la chain devuelva la lista cuando NO hay .order al final
  // (caso computeOrgStats), .is() devuelve thenable.
  cardsSelectChain.is.mockImplementation(function () {
    return {
      ...cardsSelectChain,
      then: (resolve) => Promise.resolve({ data: cards, error: null }).then(resolve),
    };
  });

  const cardsInsert = vi.fn().mockResolvedValue({ error: insertError });

  const visitsSelectIn = vi.fn().mockResolvedValue({ data: visits, error: null });
  const visitsChain = {
    select: vi.fn().mockReturnThis(),
    in: visitsSelectIn,
  };

  const orgChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: orgMaybeSingle,
    update: vi.fn(() => ({
      eq: orgUpdateEq,
      then: (resolve) => Promise.resolve({ error: updateError }).then(resolve),
    })),
  };

  const cardsChain = {
    ...cardsSelectChain,
    insert: cardsInsert,
    update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
  };

  const from = vi.fn((table) => {
    if (table === 'organizations') return orgChain;
    if (table === 'cards')         return cardsChain;
    if (table === 'visits')        return visitsChain;
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    db: { from },
    orgChain,
    orgMaybeSingle,
    orgUpdateEq,
    cardsChain,
    cardsInsert,
    visitsChain,
  };
}

function buildEvent({ method = 'POST', body = {}, token, ip = '7.7.7.7' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    httpMethod: method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

// Mock printable-card-utils so invite_team doesn't try to render real PDFs.
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('fake-booklet')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

// --- Tests ---

describe('org-panel handler', () => {
  let validToken;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    mockEmailSend.mockResolvedValue({ id: 'msg-1' });
    validToken = signPanelSession({ orgId: 'org-uuid-1', orgSlug: 'acme' });
  });

  it('rechaza GET con 405', async () => {
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ method: 'GET', token: validToken }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza requests sin Authorization con 401', async () => {
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' } }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza JWT con purpose distinto con 401', async () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'admin-session' },
      'test-org-panel-secret',
      { expiresIn: '1h' }
    );
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: bad }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza JWT expirado con 401', async () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'org-panel', orgId: 'x', orgSlug: 'y' },
      'test-org-panel-secret',
      { expiresIn: '-1s' }
    );
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: bad }));
    expect(res.statusCode).toBe(401);
  });

  it('JWT founder (actor=founder) opera igual que cliente normal', async () => {
    const founderToken = signPanelSession({
      orgId: 'org-uuid-1',
      orgSlug: 'acme',
      actor: 'founder',
    });
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: founderToken }));
    // get_org devuelve 200 igual que con JWT cliente — el founder hereda los
    // mismos permisos scoped a la org del JWT. La diferencia (TTL corto +
    // franja "operando como founder") vive en el frontend.
    expect(res.statusCode).toBe(200);
  });

  it('rechaza body no-JSON con 400', async () => {
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${validToken}`, 'x-forwarded-for': '1.1.1.1' },
      body: 'not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza acción desconocida con 400', async () => {
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'borrar_universo' }, token: validToken }));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 401 si la org del JWT está soft-deleted', async () => {
    const { db } = makeDb({ org: { ...VALID_ORG, deleted_at: '2025-01-01T00:00:00Z' } });
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: validToken }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si la org del JWT ya no existe', async () => {
    const { db } = makeDb({ org: null });
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: validToken }));
    expect(res.statusCode).toBe(401);
  });

  // ── get_org ──
  describe('get_org', () => {
    it('devuelve la org + miembros + stats', async () => {
      const cards = [
        { slug: 'pedro', nombre: 'Pedro', tagline: 'Albañil', foto_url: null, plan: 'b2b', status: 'active', created_at: '2025-01-01' },
        { slug: 'ana',   nombre: 'Ana',   tagline: 'Capataz', foto_url: null, plan: 'b2b', status: 'active', created_at: '2025-01-02' },
      ];
      const visits = [
        { slug: 'pedro', visited_at: new Date(Date.now() - 1 * 86400000).toISOString() },
        { slug: 'pedro', visited_at: new Date(Date.now() - 2 * 86400000).toISOString() },
        { slug: 'ana',   visited_at: new Date(Date.now() - 1 * 86400000).toISOString() },
      ];
      const { db } = makeDb({ cards, visits });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({ body: { action: 'get_org' }, token: validToken }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.org).toMatchObject({
        slug: 'acme',
        name: 'Acme S.A.',
        color_primary: '#FFA500',
      });
      expect(json.members).toHaveLength(2);
      expect(json.members.find(m => m.slug === 'pedro').visits_30d).toBe(2);
      expect(json.members.find(m => m.slug === 'ana').visits_30d).toBe(1);
      expect(json.stats.totals.visits_30d).toBe(3);
      expect(Array.isArray(json.stats.by_day)).toBe(true);
      expect(json.stats.by_day.length).toBe(30);
    });

    it('actualiza panel_last_login_at (best-effort) cuando se llama get_org', async () => {
      const { db, orgChain } = makeDb();
      const handler = makeHandler(db, mockEmail);
      await handler(buildEvent({ body: { action: 'get_org' }, token: validToken }));
      // Debe haberse llamado orgChain.update con panel_last_login_at en algún momento.
      expect(orgChain.update).toHaveBeenCalled();
      const updateArg = orgChain.update.mock.calls[0][0];
      expect(updateArg).toHaveProperty('panel_last_login_at');
    });
  });

  // ── update_branding ──
  describe('update_branding', () => {
    it('actualiza tagline / description / website / address / phone / color_primary', async () => {
      const { db, orgChain, orgUpdateEq } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: {
          action: 'update_branding',
          tagline: 'Nuevo tagline',
          description: 'Nueva descripción',
          website: 'https://nuevo.com',
          address: 'Nueva calle 2',
          phone: '+34666555444',
          color_primary: '#00C277',
        },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      expect(orgChain.update).toHaveBeenCalledWith(expect.objectContaining({
        tagline: 'Nuevo tagline',
        description: 'Nueva descripción',
        website: 'https://nuevo.com',
        address: 'Nueva calle 2',
        phone: '+34666555444',
        color_primary: '#00C277',
      }));
    });

    it('NO permite cambiar name / slug / email / logo_url (silently ignorados)', async () => {
      const { db, orgChain } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: {
          action: 'update_branding',
          name: 'Hackeado S.A.',
          slug: 'hackeado',
          email: 'evil@hack.com',
          logo_url: 'https://evil.com/logo.png',
          tagline: 'OK',
        },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const updateCall = orgChain.update.mock.calls[0][0];
      expect(updateCall).not.toHaveProperty('name');
      expect(updateCall).not.toHaveProperty('slug');
      expect(updateCall).not.toHaveProperty('email');
      expect(updateCall).not.toHaveProperty('logo_url');
      expect(updateCall.tagline).toBe('OK');
    });

    it('rechaza color_primary que no sea #RRGGBB con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'update_branding', color_primary: 'red' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza website javascript: con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'update_branding', website: 'javascript:alert(1)' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza tagline > 140 chars con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'update_branding', tagline: 'x'.repeat(141) },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza description > 500 chars con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'update_branding', description: 'x'.repeat(501) },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('strip HTML del address y phone', async () => {
      const { db, orgChain } = makeDb();
      const handler = makeHandler(db, mockEmail);
      await handler(buildEvent({
        body: {
          action: 'update_branding',
          address: '<script>alert(1)</script>Calle Real',
          phone: '<b>+34911</b>',
        },
        token: validToken,
      }));
      const update = orgChain.update.mock.calls[0][0];
      expect(update.address).not.toContain('<script>');
      expect(update.address).toContain('Calle Real');
      expect(update.phone).not.toContain('<b>');
    });

    it('rechaza body vacío con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'update_branding' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('UPDATE de la org está scoped a id del JWT (no acepta org_slug del body)', async () => {
      const { db, orgChain } = makeDb();
      const handler = makeHandler(db, mockEmail);
      await handler(buildEvent({
        body: {
          action: 'update_branding',
          tagline: 'x',
          org_slug: 'otra-org-distinta',  // intento de cambiar de org via body
        },
        token: validToken,
      }));
      // El UPDATE debe haber usado .eq('id', org.id) — verificamos que
      // se llamó con el id del JWT y no con el slug ajeno.
      const updateChain = orgChain.update.mock.results[0].value;
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'org-uuid-1');
    });
  });

  // ── invite_team ──
  describe('invite_team', () => {
    it('crea cards y envía emails reusando lib/team-invite', async () => {
      const { db, cardsInsert } = makeDb({ cards: [] });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: {
          action: 'invite_team',
          team: [
            { email: 'pedro@acme.com', nombre: 'Pedro' },
            { email: 'ana@acme.com',   nombre: 'Ana' },
          ],
        },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.results.ok).toHaveLength(2);
      expect(cardsInsert).toHaveBeenCalledTimes(2);
      cardsInsert.mock.calls.forEach((call) => {
        const row = call[0];
        expect(row.plan).toBe('b2b');
        expect(row.organization_id).toBe('org-uuid-1');
      });
      expect(mockEmailSend).toHaveBeenCalledTimes(2);
    });

    it('rechaza team vacío con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'invite_team', team: [] },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza team > 100 con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const team = Array.from({ length: 101 }, (_, i) => ({ email: `a${i}@test.com` }));
      const res = await handler(buildEvent({
        body: { action: 'invite_team', team },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('invitación scoped a la org del JWT (NO acepta org_slug del body)', async () => {
      const { db, cardsInsert } = makeDb();
      const handler = makeHandler(db, mockEmail);
      await handler(buildEvent({
        body: {
          action: 'invite_team',
          org_slug: 'otra-org-evil',   // intento de invitar a otra org
          team: [{ email: 'pedro@acme.com', nombre: 'Pedro' }],
        },
        token: validToken,
      }));
      // El INSERT debe usar organization_id del JWT (no del body)
      const row = cardsInsert.mock.calls[0][0];
      expect(row.organization_id).toBe('org-uuid-1');
    });

    it('respeta ocupacion individual (mismo behavior que admin-orgs)', async () => {
      const { db, cardsInsert } = makeDb();
      const handler = makeHandler(db, mockEmail);
      await handler(buildEvent({
        body: {
          action: 'invite_team',
          template: { tagline: 'Equipo Acme' },
          team: [
            { email: 'olga@acme.com', nombre: 'Olga', ocupacion: 'Diseñadora' },
            { email: 'juan@acme.com', nombre: 'Juan' },
          ],
        },
        token: validToken,
      }));
      expect(cardsInsert.mock.calls[0][0].tagline).toBe('Diseñadora');
      expect(cardsInsert.mock.calls[1][0].tagline).toBe('Equipo Acme');
    });

    it('reporta éxito parcial cuando un email del lote es inválido', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: {
          action: 'invite_team',
          team: [
            { email: 'ok@acme.com', nombre: 'OK' },
            { email: 'no-es-email', nombre: 'Malo' },
          ],
        },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.results.ok).toHaveLength(1);
      expect(json.results.failed).toHaveLength(1);
    });
  });

  // ── offboard_member ──
  describe('offboard_member', () => {
    /**
     * Mock específico para offboard. El handler hace 3 SELECTs en
     * 'cards' (lookup de pertenencia, lookup del lib, sin más) + 1
     * UPDATE. La pertenencia es la primera lookup; controlamos su
     * organization_id para probar el guard.
     */
    function makeOffboardDb({ ownershipOrgId = 'org-uuid-1', cardFull = null }) {
      const orgMaybeSingle = vi.fn().mockResolvedValue({ data: VALID_ORG, error: null });
      const orgChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: orgMaybeSingle,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
          then: (r) => Promise.resolve({ error: null }).then(r),
        })),
      };

      // Pertenencia (1st cards lookup) + full lookup desde lib (2nd).
      const cardLookups = [
        { data: { slug: 'maria', organization_id: ownershipOrgId }, error: null },
        { data: cardFull || {
          slug: 'maria', nombre: 'María', email: null, idioma: 'es',
          organization_id: ownershipOrgId, expires_at: null,
          edit_token: 'tok', edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        }, error: null },
      ];
      let cardSelectIdx = 0;
      const cardsChain = {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(cardLookups[cardSelectIdx++] || cardLookups[cardLookups.length - 1])),
        })),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      };

      const from = vi.fn((table) => {
        if (table === 'organizations') return orgChain;
        if (table === 'cards') return cardsChain;
        throw new Error(`unexpected table: ${table}`);
      });
      return { db: { from }, cardsChain };
    }

    it('da de baja a un miembro de la propia org (delega al lib y devuelve 200)', async () => {
      const { db } = makeOffboardDb({ ownershipOrgId: 'org-uuid-1' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'offboard_member', card_slug: 'maria' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.courtesy_days).toBe(90);
      expect(json.card_slug).toBe('maria');
    });

    it('devuelve 403 si la card pertenece a OTRA org (guard de cross-tenant)', async () => {
      const { db } = makeOffboardDb({ ownershipOrgId: 'otra-org-uuid' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'offboard_member', card_slug: 'cross' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/no pertenece a tu organización/i);
    });

    it('rechaza body sin card_slug con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'offboard_member' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });

    it('rechaza JWT inválido con 401 (no llega siquiera al guard)', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'offboard_member', card_slug: 'maria' },
        // sin token
      }));
      expect(res.statusCode).toBe(401);
    });
  });

  // ── resend_edit_link ──
  describe('resend_edit_link', () => {
    function makeResendDb({ ownershipOrgId = 'org-uuid-1', cardEmail = 'maria@x.com', editToken = 'tok-existing', tokenExpiresAt = new Date(Date.now() + 5 * 86400000).toISOString() }) {
      const orgMaybeSingle = vi.fn().mockResolvedValue({ data: VALID_ORG, error: null });
      const orgChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: orgMaybeSingle,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
          then: (r) => Promise.resolve({ error: null }).then(r),
        })),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            slug: 'maria', nombre: 'María', email: cardEmail, idioma: 'es',
            organization_id: ownershipOrgId,
            edit_token: editToken, edit_token_expires_at: tokenExpiresAt,
          },
        }),
      };
      const cardsChain = {
        select: vi.fn(() => cardLookup),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      };
      const from = vi.fn((table) => {
        if (table === 'organizations') return orgChain;
        if (table === 'cards') return cardsChain;
        throw new Error(`unexpected table: ${table}`);
      });
      return { db: { from } };
    }

    it('reenvía el edit-link al email del miembro y devuelve 200', async () => {
      const { db } = makeResendDb({ ownershipOrgId: 'org-uuid-1' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'resend_edit_link', card_slug: 'maria' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.email).toBe('maria@x.com');
      expect(mockEmailSend).toHaveBeenCalledOnce();
      // El subject lleva el prefix de reenvío.
      expect(mockEmailSend.mock.calls[0][0].subject).toMatch(/^\[Reenvío\]/);
    });

    it('devuelve 403 si la card pertenece a OTRA org (guard cross-tenant)', async () => {
      const { db } = makeResendDb({ ownershipOrgId: 'otra-org-uuid' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'resend_edit_link', card_slug: 'cross' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(403);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('devuelve 400 si la card no tiene email registrado', async () => {
      const { db } = makeResendDb({ ownershipOrgId: 'org-uuid-1', cardEmail: null });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'resend_edit_link', card_slug: 'maria' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('rechaza body sin card_slug con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'resend_edit_link' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── download_member_card ──
  describe('download_member_card', () => {
    function makeDownloadDb({ ownershipOrgId = 'org-uuid-1' }) {
      const orgMaybeSingle = vi.fn().mockResolvedValue({ data: VALID_ORG, error: null });
      const orgChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: orgMaybeSingle,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
          then: (r) => Promise.resolve({ error: null }).then(r),
        })),
      };
      const cardLookup = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            slug: 'maria', nombre: 'María', tagline: 'Sales',
            whatsapp: '+34911111111', email: 'maria@x.com', direccion: null,
            organization_id: ownershipOrgId, status: 'active',
          },
        }),
      };
      const cardsChain = {
        select: vi.fn(() => cardLookup),
      };
      const from = vi.fn((table) => {
        if (table === 'organizations') return orgChain;
        if (table === 'cards') return cardsChain;
        throw new Error(`unexpected table: ${table}`);
      });
      return { db: { from } };
    }

    it('devuelve base64 del PDF de la tarjeta del miembro', async () => {
      const { db } = makeDownloadDb({ ownershipOrgId: 'org-uuid-1' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_member_card', card_slug: 'maria' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.filename).toBe('tarjeta-maria.pdf');
      // El mock de printable-card-utils no intercepta require() CJS;
      // verificamos formato base64 válido en vez de contenido exacto.
      expect(json.base64).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(json.base64.length).toBeGreaterThan(50);
    });

    it('devuelve 403 si la card pertenece a otra org', async () => {
      const { db } = makeDownloadDb({ ownershipOrgId: 'otra-org-uuid' });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_member_card', card_slug: 'cross' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(403);
    });

    it('rechaza body sin card_slug con 400', async () => {
      const { db } = makeDb();
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_member_card' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ── download_team_cards ──
  describe('download_team_cards', () => {
    function makeBookletDb({ cards = [] }) {
      const orgMaybeSingle = vi.fn().mockResolvedValue({ data: VALID_ORG, error: null });
      const orgChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: orgMaybeSingle,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
          then: (r) => Promise.resolve({ error: null }).then(r),
        })),
      };
      const cardsListChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: cards, error: null }),
      };
      const cardsChain = {
        select: vi.fn(() => cardsListChain),
      };
      const from = vi.fn((table) => {
        if (table === 'organizations') return orgChain;
        if (table === 'cards') return cardsChain;
        throw new Error(`unexpected table: ${table}`);
      });
      return { db: { from } };
    }

    it('devuelve base64 del booklet PDF con todas las cards del equipo', async () => {
      const { db } = makeBookletDb({
        cards: [
          { slug: 'maria', nombre: 'María', tagline: 'Sales', whatsapp: '+34', email: 'm@x.com', direccion: null },
          { slug: 'paco',  nombre: 'Paco',  tagline: 'Dev',   whatsapp: '+34', email: 'p@x.com', direccion: null },
        ],
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_team_cards' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.filename).toBe('tarjetas-acme.pdf');
      expect(json.count).toBe(2);
      expect(json.base64).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(json.base64.length).toBeGreaterThan(50);
    });

    it('devuelve 400 si el equipo no tiene profesionales activos', async () => {
      const { db } = makeBookletDb({ cards: [] });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_team_cards' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/no tiene profesionales/i);
    });

    it('NO acepta org_slug del body (siempre usa session.orgSlug)', async () => {
      // Aunque el body lleve org_slug='otra-org', el handler ignora ese
      // campo y opera sobre el orgId del JWT (scope blindado por diseño).
      const { db } = makeBookletDb({
        cards: [{ slug: 'a', nombre: 'A', tagline: null, whatsapp: '+34', email: null, direccion: null }],
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'download_team_cards', org_slug: 'otra-org' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).filename).toBe('tarjetas-acme.pdf'); // del JWT, no del body
    });
  });

  // ── get_stats_link ──
  describe('get_stats_link', () => {
    it('genera token nuevo si la org no tiene', async () => {
      const { db, orgChain } = makeDb({
        org: { ...VALID_ORG, stats_token: null, stats_token_expires_at: null },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.just_created).toBe(true);
      expect(json.token).toMatch(/^[0-9a-f]{64}$/);
      expect(json.url).toContain('/e/acme/stats?token=');
      expect(json.url.endsWith(json.token)).toBe(true);
      expect(new Date(json.expires_at).getTime()).toBeGreaterThan(Date.now());
      // Persistió el token nuevo
      const updateCall = orgChain.update.mock.calls.find(c => c[0].stats_token);
      expect(updateCall).toBeTruthy();
      expect(updateCall[0].stats_token).toBe(json.token);
    });

    it('reutiliza el token vigente si no se pide force_refresh', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
      const existingToken = 'c'.repeat(64);
      const { db, orgChain } = makeDb({
        org: { ...VALID_ORG, stats_token: existingToken, stats_token_expires_at: futureExpiry },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(false);
      expect(json.token).toBe(existingToken);
      expect(json.expires_at).toBe(futureExpiry);
      // No debe haber UPDATE de stats_token cuando se reusa
      const updateCalls = orgChain.update.mock.calls.filter(c => c[0].stats_token);
      expect(updateCalls).toHaveLength(0);
    });

    it('rota el token con force_refresh=true aunque esté vigente', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
      const existingToken = 'd'.repeat(64);
      const { db } = makeDb({
        org: { ...VALID_ORG, stats_token: existingToken, stats_token_expires_at: futureExpiry },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link', force_refresh: true },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(true);
      expect(json.token).not.toBe(existingToken);
      expect(json.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('regenera el token si está expirado', async () => {
      const pastExpiry = new Date(Date.now() - 86400000).toISOString();
      const oldToken = 'e'.repeat(64);
      const { db } = makeDb({
        org: { ...VALID_ORG, stats_token: oldToken, stats_token_expires_at: pastExpiry },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.just_created).toBe(true);
      expect(json.token).not.toBe(oldToken);
    });

    it('compone la URL usando host + proto de los headers', async () => {
      const { db } = makeDb({
        org: { ...VALID_ORG, stats_token: null, stats_token_expires_at: null },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler({
        httpMethod: 'POST',
        headers: {
          authorization: `Bearer ${validToken}`,
          host: 'deploy-preview-42--perfilapro.netlify.app',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '7.7.7.7',
        },
        body: JSON.stringify({ action: 'get_stats_link' }),
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.url.startsWith('https://deploy-preview-42--perfilapro.netlify.app/e/acme/stats?token=')).toBe(true);
    });

    it('devuelve 500 si falla el UPDATE del token nuevo', async () => {
      const { db } = makeDb({
        org: { ...VALID_ORG, stats_token: null, stats_token_expires_at: null },
        updateError: { message: 'db boom' },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(500);
    });

    it('respeta el scope del JWT — no acepta org_slug del body', async () => {
      // El SELECT inicial pega .eq('id', session.orgId), así que aunque el
      // body trajera org_slug='otra', se ignora y se opera sobre la del JWT.
      const { db } = makeDb({
        org: { ...VALID_ORG, stats_token: null, stats_token_expires_at: null },
      });
      const handler = makeHandler(db, mockEmail);
      const res = await handler(buildEvent({
        body: { action: 'get_stats_link', org_slug: 'otra-org' },
        token: validToken,
      }));
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.url).toContain('/e/acme/stats?token='); // del JWT, no del body
    });
  });

  // ── rate limit ──
  it('rate-limita después de 120 requests en 10min desde la misma IP', async () => {
    const { db } = makeDb();
    const handler = makeHandler(db, mockEmail);
    // Hacemos 120 OK + 1 rate-limited
    for (let i = 0; i < 120; i++) {
      const res = await handler(buildEvent({ body: { action: 'get_org' }, token: validToken, ip: '8.8.8.8' }));
      expect(res.statusCode).toBe(200);
    }
    const res = await handler(buildEvent({ body: { action: 'get_org' }, token: validToken, ip: '8.8.8.8' }));
    expect(res.statusCode).toBe(429);
  });
});
