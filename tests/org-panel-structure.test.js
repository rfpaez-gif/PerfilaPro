import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

const CAT_BEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEAM_A = '33333333-3333-3333-3333-333333333333';
const STAFF_ID = '55555555-5555-5555-5555-555555555555';

// Registro de escrituras, para comprobar QUÉ se persiste y no sólo el código.
let writes;

function makeChain(resolver, table) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'delete', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...a) => { if (m === 'eq' && a.length >= 2) filters[a[0]] = a[1]; return q; });
  }
  for (const m of ['insert', 'update', 'upsert']) {
    q[m] = vi.fn((payload) => { writes.push({ table, op: m, payload }); return q; });
  }
  q.then = (res, rej) => Promise.resolve(resolver(filters)).then(res, rej);
  return q;
}

function makeDb(resolvers) {
  return { from: vi.fn((t) => makeChain(resolvers[t] || (() => ({ data: [], error: null })), t)) };
}

const ORG = {
  id: 'org-1', slug: 'catorzefc', name: 'CatorzeFc', kind: 'sports_club',
  sport: 'futbol', deleted_at: null, email: 'mariona@example.org',
  tagline: null, description: null, website: null, address: null, phone: null,
  logo_url: null, color_primary: '#00aa00', hide_branding: false,
  created_at: '2026-01-01T00:00:00Z', panel_last_login_at: null,
};

function base(overrides = {}) {
  return {
    organizations: () => ({ data: ORG, error: null }),
    club_teams: () => ({ data: [{ id: TEAM_A, name: 'Benjamí A', category_id: CAT_BEN, sort_order: 0 }], error: null }),
    sports_categories: () => ({ data: [{ id: CAT_BEN, code: 'benjamin', display_name_es: 'Benjamín', sort_order: 20 }], error: null }),
    expediente_modulos: () => ({ data: [
      { id: 'identidad', orden: 1, nombre_es: 'Identidad', default_role_code: 'entrenador', activo: true },
      { id: 'perfil_fisico', orden: 3, nombre_es: 'Perfil físico', default_role_code: 'preparador', activo: true },
    ], error: null }),
    expediente_matriz: () => ({ data: [], error: null }),
    org_roles: () => ({ data: [{ id: 'r-1', role_code: 'preparador', label: 'Mister físico', sort_order: 0 }], error: null }),
    org_admins: () => ({ data: [], error: null }),
    org_admin_roles: () => ({ data: [], error: null }),
    member_club_seasons: () => ({ data: [
      { card_slug: 'p-1', category_id: CAT_BEN, joined_at: '2026-07-01', role: 'jugador' },
      { card_slug: 'p-2', category_id: CAT_BEN, joined_at: '2026-07-01', role: 'jugador' },
      { card_slug: 's-1', category_id: null, joined_at: '2026-07-01', role: 'entrenador' },
    ], error: null }),
    ...overrides,
  };
}

function ownerEvent(action, extra = {}) {
  const token = signPanelSession({ orgId: 'org-1', orgSlug: 'catorzefc' });
  return { httpMethod: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '8.8.8.8' },
    body: JSON.stringify({ action, ...extra }) };
}

function staffEvent(action, extra = {}) {
  const token = signPanelSession({ orgId: 'org-1', orgSlug: 'catorzefc', staffId: STAFF_ID });
  return { httpMethod: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ action, ...extra }) };
}

const run = (resolvers, ev) => makeHandler(makeDb(resolvers), null)(ev);

describe('org-panel · alta autoservicio del club (migración 050)', () => {
  beforeEach(() => {
    writes = [];
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CANTERA_VERTICAL_ACTIVE;
  });

  it('410 si el carril Cantera está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await run(base(), ownerEvent('structure_get'));
    expect(res.statusCode).toBe(410);
  });

  describe('el cuerpo técnico no puede tocar la estructura', () => {
    const staffResolvers = base({
      org_admins: () => ({ data: { id: STAFF_ID, organization_id: 'org-1', email: 'c@x.es', revoked_at: null }, error: null }),
    });

    for (const action of ['structure_get', 'role_upsert', 'role_delete', 'staff_invite',
      'staff_revoke', 'expediente_get', 'expediente_preview', 'expediente_save']) {
      it(`403 en ${action}`, async () => {
        const res = await run(staffResolvers, staffEvent(action));
        expect(res.statusCode).toBe(403);
      });
    }
  });

  describe('roles del club', () => {
    it('declara un rol con etiqueta propia', async () => {
      const res = await run(base({ org_roles: () => ({ data: null, error: null }) }),
        ownerEvent('role_upsert', { role_code: 'preparador', label: 'Mister físico' }));
      expect(res.statusCode).toBe(200);
      const w = writes.find((x) => x.table === 'org_roles' && x.op === 'insert');
      expect(w.payload.role_code).toBe('preparador');
      expect(w.payload.label).toBe('Mister físico');
    });

    it('rechaza un rol fuera del catálogo', async () => {
      const res = await run(base(), ownerEvent('role_upsert', { role_code: 'mister_fisico' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/no reconocido/i);
    });

    it('sanea la etiqueta', async () => {
      await run(base({ org_roles: () => ({ data: null, error: null }) }),
        ownerEvent('role_upsert', { role_code: 'fisio', label: '<script>x</script>Fisio' }));
      const w = writes.find((x) => x.table === 'org_roles' && x.op === 'insert');
      expect(w.payload.label).toBe('xFisio');
    });

    it('renombrar un rol ya declarado actualiza, no duplica', async () => {
      const res = await run(base(), ownerEvent('role_upsert', { role_code: 'preparador', label: 'Preparación física' }));
      expect(JSON.parse(res.body).updated).toBe(true);
      expect(writes.some((x) => x.table === 'org_roles' && x.op === 'insert')).toBe(false);
    });

    it('borrar avisa de los módulos que se quedan sin responsable', async () => {
      const res = await run(base({
        org_roles: () => ({ data: { id: 'r-1' }, error: null }),
        expediente_matriz: () => ({ data: [{ modulo_id: 'perfil_fisico' }, { modulo_id: 'perfil_fisico' }], error: null }),
      }), ownerEvent('role_delete', { role_code: 'preparador' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).modulos_sin_responsable).toEqual(['perfil_fisico']);
    });

    it('borrar un rol es soft-delete, no borrado', async () => {
      await run(base({ org_roles: () => ({ data: { id: 'r-1' }, error: null }) }),
        ownerEvent('role_delete', { role_code: 'preparador' }));
      const w = writes.find((x) => x.table === 'org_roles' && x.op === 'update');
      expect(w.payload.deleted_at).toBeTruthy();
      expect(writes.some((x) => x.op === 'delete')).toBe(false);
    });
  });

  describe('expediente', () => {
    it('get devuelve catálogo, categorías del club y periodicidades', async () => {
      const res = await run(base(), ownerEvent('expediente_get'));
      const b = JSON.parse(res.body);
      expect(b.modulos.map((m) => m.id)).toEqual(['identidad', 'perfil_fisico']);
      expect(b.categories.map((c) => c.code)).toEqual(['benjamin']);
      expect(b.periodicidades.length).toBe(6);
      expect(b.configurado).toBe(false);
    });

    it('preview proyecta las obligaciones y las atribuye', async () => {
      const res = await run(base({
        org_admins: () => ({ data: [{ id: 'a-1', name: 'Carmen R.', email: 'c@x.es' }], error: null }),
        org_admin_roles: () => ({ data: [{ org_admin_id: 'a-1', role_code: 'preparador' }], error: null }),
      }), ownerEvent('expediente_preview', {
        seleccion: [{ modulo_id: 'perfil_fisico', category_id: CAT_BEN, aplica: true, periodicidad: 'trimestral', role_code: 'preparador' }],
      }));
      const b = JSON.parse(res.body);
      expect(b.proyeccion.jugadoras).toBe(2);     // el entrenador no cuenta
      expect(b.proyeccion.por_responsable['Carmen R.']).toBe(b.proyeccion.total);
      expect(b.proyeccion.total).toBeGreaterThan(0);
    });

    it('preview enseña el hueco cuando nadie cubre el rol', async () => {
      const res = await run(base(), ownerEvent('expediente_preview', {
        seleccion: [{ modulo_id: 'perfil_fisico', category_id: CAT_BEN, aplica: true, periodicidad: 'trimestral', role_code: 'preparador' }],
      }));
      const b = JSON.parse(res.body);
      expect(b.proyeccion.sin_responsable).toBe(b.proyeccion.total);
    });

    it('preview sin selección devuelve 400', async () => {
      const res = await run(base(), ownerEvent('expediente_preview', {}));
      expect(res.statusCode).toBe(400);
    });

    it('save sella activated_at con la fecha de hoy al activar', async () => {
      await run(base(), ownerEvent('expediente_save', {
        seleccion: [{ modulo_id: 'identidad', category_id: CAT_BEN, aplica: true, periodicidad: 'alta' }],
      }));
      const w = writes.find((x) => x.table === 'expediente_matriz' && x.op === 'upsert');
      expect(w.payload[0].activated_at).toBe('2026-09-15');
    });

    it('save NO mueve activated_at de un módulo ya activo', async () => {
      // El suelo de generación no puede desplazarse cada vez que el club
      // edita una nota: borraría el histórico de lo ya exigido.
      await run(base({
        expediente_matriz: () => ({ data: [
          { modulo_id: 'identidad', category_id: CAT_BEN, aplica: true, activated_at: '2026-07-05' },
        ], error: null }),
      }), ownerEvent('expediente_save', {
        seleccion: [{ modulo_id: 'identidad', category_id: CAT_BEN, aplica: true, periodicidad: 'alta', variante_notas: 'nota nueva' }],
      }));
      const w = writes.find((x) => x.table === 'expediente_matriz' && x.op === 'upsert');
      expect(w.payload[0].activated_at).toBe('2026-07-05');
    });

    it('save guarda también los módulos desactivados, sin sellar fecha', async () => {
      await run(base(), ownerEvent('expediente_save', {
        seleccion: [{ modulo_id: 'identidad', category_id: CAT_BEN, aplica: false, periodicidad: 'alta' }],
      }));
      const w = writes.find((x) => x.table === 'expediente_matriz' && x.op === 'upsert');
      expect(w.payload[0].aplica).toBe(false);
      expect(w.payload[0].activated_at).toBeNull();
    });

    it('save rechaza una categoría que no es del club', async () => {
      const res = await run(base(), ownerEvent('expediente_save', {
        seleccion: [{ modulo_id: 'identidad', category_id: 'cat-ajena', aplica: true, periodicidad: 'alta' }],
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/Categoría/);
    });

    it('save pide crear equipos antes si el club no tiene categorías', async () => {
      const res = await run(base({ club_teams: () => ({ data: [], error: null }) }),
        ownerEvent('expediente_save', { seleccion: [] }));
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toMatch(/equipos/i);
    });
  });

  describe('cuerpo técnico desde el panel del club', () => {
    it('la dueña da de alta a una técnica con su equipo', async () => {
      const res = await run(base({
        org_admins: () => ({ data: { id: 'new-1' }, error: null }),
      }), ownerEvent('staff_invite', {
        email: 'Carmen@Example.ORG', name: 'Carmen R.',
        roles: [{ role_code: 'preparador', team_id: TEAM_A }],
      }));
      expect(res.statusCode).toBe(200);
      const w = writes.find((x) => x.table === 'org_admins' && x.op === 'insert');
      expect(w.payload.email).toBe('carmen@example.org');   // normalizado
      expect(w.payload.organization_id).toBe('org-1');
    });

    it('rechaza un equipo que no es del club', async () => {
      const res = await run(base({
        club_teams: () => ({ data: [], error: null }),      // ningún equipo casa
      }), ownerEvent('staff_invite', {
        email: 'x@y.es', roles: [{ role_code: 'fisio', team_id: TEAM_A }],
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/no pertenece/i);
    });

    it('exige al menos un rol', async () => {
      const res = await run(base(), ownerEvent('staff_invite', { email: 'x@y.es', roles: [] }));
      expect(res.statusCode).toBe(400);
    });

    it('email duplicado devuelve 409', async () => {
      const res = await run(base({
        org_admins: () => ({ data: null, error: { message: 'duplicate key value violates unique constraint' } }),
      }), ownerEvent('staff_invite', { email: 'x@y.es', roles: [{ role_code: 'fisio' }] }));
      expect(res.statusCode).toBe(409);
    });

    it('revocar marca revoked_at y no borra', async () => {
      const res = await run(base({
        org_admins: () => ({ data: { id: STAFF_ID, email: 'c@x.es' }, error: null }),
      }), ownerEvent('staff_revoke', { staff_id: STAFF_ID }));
      expect(res.statusCode).toBe(200);
      const w = writes.find((x) => x.table === 'org_admins' && x.op === 'update');
      expect(w.payload.revoked_at).toBeTruthy();
    });
  });
});
