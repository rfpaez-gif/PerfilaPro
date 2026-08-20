import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Igual que org-panel-cantera.test.js: el handler importa PDFKit al cargar.
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

function makeChain(resolver) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'delete', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => {
      if (m === 'eq' && args.length >= 2) filters[args[0]] = args[1];
      return q;
    });
  }
  q.then = (resolve, reject) => Promise.resolve(resolver(filters)).then(resolve, reject);
  return q;
}

function makeDb(resolvers) {
  return { from: vi.fn((t) => makeChain(resolvers[t] || (() => ({ data: [], error: null })))) };
}

const TEAM_A = '33333333-3333-3333-3333-333333333333';
const TEAM_B = '44444444-4444-4444-4444-444444444444';
const STAFF_ID = '55555555-5555-5555-5555-555555555555';

const ORG = {
  id: 'org-1', slug: 'catorzefc', name: 'CatorzeFc',
  kind: 'sports_club', sport: 'futbol', deleted_at: null,
  tagline: null, description: null, website: null, email: 'mariona@example.org',
  address: null, phone: null, logo_url: null, color_primary: '#00aa00',
  hide_branding: false, created_at: '2026-01-01T00:00:00Z', panel_last_login_at: null,
};

function baseResolvers(overrides = {}) {
  return {
    organizations: () => ({ data: ORG, error: null }),
    org_admins: () => ({
      data: { id: STAFF_ID, organization_id: 'org-1', email: 'carmen@example.org', name: 'Carmen R.', revoked_at: null },
      error: null,
    }),
    org_admin_roles: () => ({ data: [{ role_code: 'preparador', team_id: TEAM_A }], error: null }),
    cards: () => ({ data: [{ slug: 'p-1', nombre: 'Jugadora 1', plan: 'b2b', status: 'active', created_at: '2026-01-01' }], error: null }),
    visits: () => ({ data: [], error: null }),
    ...overrides,
  };
}

function staffEvent(action, extra = {}) {
  const token = signPanelSession({ orgId: 'org-1', orgSlug: 'catorzefc', staffId: STAFF_ID });
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ action, ...extra }),
  };
}

function ownerEvent(action, extra = {}) {
  const token = signPanelSession({ orgId: 'org-1', orgSlug: 'catorzefc' });
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '8.8.8.8' },
    body: JSON.stringify({ action, ...extra }),
  };
}

describe('org-panel · cuerpo técnico (migración 049)', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
  });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('deja pasar una lectura permitida', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(staffEvent('get_org'));
    expect(res.statusCode).toBe(200);
  });

  it('bloquea con 403 una acción de escritura', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(
      staffEvent('update_branding', { tagline: 'pirata' })
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/no permite/i);
  });

  it('bloquea con 403 el invite de equipo', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(
      staffEvent('invite_team', { team: [{ nombre: 'X', email: 'x@y.z' }] })
    );
    expect(res.statusCode).toBe(403);
  });

  it('mata la sesión si el acceso fue revocado', async () => {
    const db = makeDb(baseResolvers({
      org_admins: () => ({
        data: { id: STAFF_ID, organization_id: 'org-1', email: 'carmen@example.org', revoked_at: '2026-08-01T00:00:00Z' },
        error: null,
      }),
    }));
    const res = await makeHandler(db, null)(staffEvent('get_org'));
    expect(res.statusCode).toBe(401);
  });

  it('mata la sesión si la fila ya no existe', async () => {
    const db = makeDb(baseResolvers({ org_admins: () => ({ data: null, error: null }) }));
    const res = await makeHandler(db, null)(staffEvent('get_org'));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza un staffId que pertenece a OTRO club', async () => {
    // Defensa en profundidad: aunque el JWT sea válido y apunte a org-1, la
    // persona tiene que ser de org-1. Sin esta comprobación, un staffId
    // ajeno colado en un token daría acceso cruzado entre clubes.
    const db = makeDb(baseResolvers({
      org_admins: () => ({
        data: { id: STAFF_ID, organization_id: 'org-OTRO', email: 'carmen@example.org', revoked_at: null },
        error: null,
      }),
    }));
    const res = await makeHandler(db, null)(staffEvent('get_org'));
    expect(res.statusCode).toBe(401);
  });

  it('get_org no le entrega el listado completo del club', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(staffEvent('get_org'));
    const body = JSON.parse(res.body);
    expect(body.members).toEqual([]);
    expect(body.staff_session.roles).toEqual(['preparador']);
    expect(body.staff_session.all_teams).toBe(false);
    expect(body.staff_session.team_ids).toEqual([TEAM_A]);
  });

  it('get_org sí entrega branding y nombre del club', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(staffEvent('get_org'));
    const body = JSON.parse(res.body);
    expect(body.org.name).toBe('CatorzeFc');
    expect(body.org.color_primary).toBe('#00aa00');
  });

  it('la dueña del club conserva members y stats intactos', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(ownerEvent('get_org'));
    const body = JSON.parse(res.body);
    expect(body.members.length).toBe(1);
    expect(body.staff_session).toBeUndefined();
  });

  it('la dueña sigue pudiendo escribir', async () => {
    const res = await makeHandler(makeDb(baseResolvers()), null)(
      ownerEvent('update_branding', { tagline: 'Cantera femenina' })
    );
    expect(res.statusCode).not.toBe(403);
  });

  it('sin equipos asignados entra pero con alcance vacío', async () => {
    const db = makeDb(baseResolvers({ org_admin_roles: () => ({ data: [], error: null }) }));
    const res = await makeHandler(db, null)(staffEvent('get_org'));
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.staff_session.all_teams).toBe(false);
    expect(body.staff_session.team_ids).toEqual([]);
  });

  it('dirección deportiva ve todo el club', async () => {
    const db = makeDb(baseResolvers({
      org_admin_roles: () => ({ data: [{ role_code: 'direccion_deportiva', team_id: TEAM_B }], error: null }),
    }));
    const res = await makeHandler(db, null)(staffEvent('get_org'));
    expect(JSON.parse(res.body).staff_session.all_teams).toBe(true);
  });
});
