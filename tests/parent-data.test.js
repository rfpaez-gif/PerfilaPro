import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/parent-data.js';
import { signParentSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Chainable Supabase mock: cada from(table) lleva sus propios filtros .eq()
// y resuelve vía un resolver por tabla que los recibe.
function makeChain(resolver) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => { if (m === 'eq' && args.length >= 2) filters[args[0]] = args[1]; return q; });
  }
  q.then = (resolve, reject) => Promise.resolve(resolver(filters)).then(resolve, reject);
  return q;
}
function makeDb(resolvers) {
  return { from: vi.fn((t) => makeChain(resolvers[t] || (() => ({ data: [], error: null })))) };
}

const CLUB = {
  id: 'club-1', slug: 'cd-test', name: 'CD Test', logo_url: null,
  color_primary: '#00aa00', sport: 'futbol', kind: 'sports_club',
  cantera_monthly_fee_cents: 3000, deleted_at: null,
};
const CATALOG = [
  { id: 'cat-ale', sport: 'futbol', code: 'alevin', display_name_es: 'Alevín', display_name_ca: 'Aleví', min_birth_year_offset: -11, max_birth_year_offset: -10, sort_order: 30 },
];

function baseResolvers(overrides = {}) {
  return {
    card_admins: () => ({ data: [{ card_slug: 'p-1', role: 'tutor_legal' }], error: null }),
    cards: () => ({ data: [{ slug: 'p-1', nombre: 'Ana', foto_url: null, card_kind: 'player', idioma: 'es', organization_id: 'club-1', public_card: false, birth_year: 2015, gender: 'F', status: 'active', deleted_at: null }], error: null }),
    member_club_seasons: () => ({ data: [
      { card_slug: 'p-1', organization_id: 'club-1', season: '2025-26', role: 'jugador', category_id: 'cat-ale', team_name: 'Alevín A', dorsal: 10, position: 'DEL', joined_at: '2025-09-01T00:00:00Z', left_at: null, exit_reason: null, stats_jsonb: { goles: 3 }, closed_snapshot_jsonb: null, previous_club_name: null },
      { card_slug: 'p-1', organization_id: 'club-1', season: '2024-25', role: 'jugador', category_id: 'cat-ale', team_name: 'Benjamín B', dorsal: 7, position: 'MC', joined_at: '2024-09-01T00:00:00Z', left_at: '2025-06-30T00:00:00Z', exit_reason: 'fin_temporada', stats_jsonb: {}, closed_snapshot_jsonb: {}, previous_club_name: 'Otro CF' },
    ], error: null }),
    organizations: () => ({ data: [CLUB], error: null }),
    sports_categories: () => ({ data: CATALOG, error: null }),
    parent_subscriptions: () => ({ data: [], error: null }),
    external_payments: () => ({ data: [{ card_slug: 'p-1', method: 'bizum', amount_cents: 3000, period: '2026-03' }], error: null }),
    club_transfers: () => ({ data: [], error: null }),
    ...overrides,
  };
}

function event(body = {}, token) {
  const headers = { 'x-forwarded-for': '4.4.4.4' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: 'POST', headers, body: JSON.stringify(body) };
}

describe('parent-data · panel del padre (capa 6c)', () => {
  let token;
  beforeEach(() => {
    _resetRateLimit();
    process.env.PARENT_PANEL_JWT_SECRET = 'test-parent-secret';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    token = signParentSession({ email: 'madre@email.com' });
  });
  afterEach(() => { vi.useRealTimers(); delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('410 cuando el carril está off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }, token));
    expect(res.statusCode).toBe(410);
  });

  it('401 sin JWT parent-panel', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }));
    expect(res.statusCode).toBe(401);
  });

  it('405 si no es POST', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve [] si el tutor no administra ninguna card', async () => {
    const db = makeDb(baseResolvers({ card_admins: () => ({ data: [], error: null }) }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.children).toEqual([]);
    expect(body.email).toBe('madre@email.com');
  });

  it('ignora roles club_admin (no entran por el panel del padre)', async () => {
    const db = makeDb(baseResolvers({ card_admins: () => ({ data: [{ card_slug: 'p-1', role: 'club_admin' }], error: null }) }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children).toEqual([]);
  });

  it('compone el hijo con club, membresía, categoría, cuota e histórico', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.season).toBe('2025-26');
    expect(body.children).toHaveLength(1);
    const c = body.children[0];
    expect(c.nombre).toBe('Ana');
    expect(c.my_role).toBe('tutor_legal');
    expect(c.club.name).toBe('CD Test');
    expect(c.club.monthly_fee_cents).toBe(3000);
    expect(c.membership).toMatchObject({ dorsal: 10, team_name: 'Alevín A', category: 'Alevín', season: '2025-26' });
    expect(c.membership.stats).toEqual({ goles: 3 });
    // pago manual del periodo actual (2026-03)
    expect(c.payment).toMatchObject({ source: 'manual', status: 'paid', method: 'bizum' });
    // histórico: la temporada cerrada
    expect(c.history).toHaveLength(1);
    expect(c.history[0]).toMatchObject({ season: '2024-25', exit_reason: 'fin_temporada' });
    expect(c.pending_transfer).toBeNull();
    // jugador con club activo y sin foto → avisamos al tutor de la foto del carnet
    expect(c.carnet_photo_missing).toBe(true);
  });

  it('no avisa de la foto del carnet si el jugador ya tiene foto', async () => {
    const db = makeDb(baseResolvers({
      cards: () => ({ data: [{ slug: 'p-1', nombre: 'Ana', foto_url: 'https://x/ana.png', card_kind: 'player', idioma: 'es', organization_id: 'club-1', public_card: false, birth_year: 2015, gender: 'F', status: 'active', deleted_at: null }], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children[0].carnet_photo_missing).toBe(false);
  });

  it('cuota Stripe activa gana sobre pago manual', async () => {
    const db = makeDb(baseResolvers({
      parent_subscriptions: () => ({ data: [{ card_slug: 'p-1', status: 'active', amount_cents: 3000, current_period_end: '2026-04-01T00:00:00Z' }], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children[0].payment).toMatchObject({ source: 'stripe', status: 'active' });
  });

  it('marca pago pendiente cuando no hay cuota ni pago del mes', async () => {
    const db = makeDb(baseResolvers({ external_payments: () => ({ data: [], error: null }) }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children[0].payment).toMatchObject({ status: 'unpaid' });
  });

  it('expone el traspaso pendiente que el tutor debe aprobar', async () => {
    const db = makeDb(baseResolvers({
      club_transfers: () => ({ data: [{ id: 'tr-1', card_slug: 'p-1', from_org_id: 'club-1', to_org_id: 'club-2', status: 'pending', season: '2026-27', dorsal: 9, position: 'DEL', team_name: 'Cadete A', created_at: '2026-03-10T00:00:00Z' }], error: null }),
      organizations: () => ({ data: [CLUB, { ...CLUB, id: 'club-2', slug: 'otro-cd', name: 'Otro CD' }], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    const c = JSON.parse(res.body).children[0];
    expect(c.pending_transfer).toMatchObject({ transfer_id: 'tr-1', to_club_name: 'Otro CD', season: '2026-27', dorsal: 9 });
  });

  it('filtra cards soft-deleted', async () => {
    const db = makeDb(baseResolvers({
      cards: () => ({ data: [{ slug: 'p-1', nombre: 'Ana', organization_id: 'club-1', deleted_at: '2026-01-01T00:00:00Z', card_kind: 'player' }], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children).toEqual([]);
  });

  it('NO expone birth_date_encrypted en la respuesta', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }, token));
    expect(res.body).not.toContain('birth_date_encrypted');
  });

  it('rechaza acción desconocida con 400', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'borrar' }, token));
    expect(res.statusCode).toBe(400);
  });

  it('sin plan ni campaña: child.plan es null (modelo cuota mensual)', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }, token));
    expect(JSON.parse(res.body).children[0].plan).toBeNull();
  });

  it('plan materializado (enrollment_charges): has_charges, no pagable, paid_cents', async () => {
    const db = makeDb(baseResolvers({
      enrollment_charges: () => ({ data: [
        { card_slug: 'p-1', concepto: 'Inscripción', amount_cents: 16000, due_date: '2025-09-01', status: 'paid', paid_at: '2025-09-02T00:00:00Z' },
        { card_slug: 'p-1', concepto: '2º plazo', amount_cents: 10000, due_date: '2026-01-10', status: 'scheduled', paid_at: null },
        { card_slug: 'p-1', concepto: 'Cancelado', amount_cents: 5000, due_date: '2026-02-01', status: 'canceled', paid_at: null },
      ], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    const plan = JSON.parse(res.body).children[0].plan;
    expect(plan).toMatchObject({ has_charges: true, payable: false, campaign_id: null });
    expect(plan.concepts).toHaveLength(2); // el cancelado se excluye
    expect(plan.total_cents).toBe(26000);
    expect(plan.paid_cents).toBe(16000);
  });

  it('campaña abierta con plan y sin cargos: pagable con campaign_id', async () => {
    const db = makeDb(baseResolvers({
      enrollment_campaigns: () => ({ data: [
        { id: 'camp-1', organization_id: 'club-1', status: 'open', concepts_jsonb: { plan: [{ concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' }] } },
      ], error: null }),
    }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    const plan = JSON.parse(res.body).children[0].plan;
    expect(plan).toMatchObject({ has_charges: false, payable: true, campaign_id: 'camp-1' });
    expect(plan.concepts).toHaveLength(1);
    expect(plan.total_cents).toBe(16000);
  });

  it('club sin Stripe Connect → pay_online false y sin instrucciones', async () => {
    const res = await makeHandler(makeDb(baseResolvers()))(event({ action: 'get_children' }, token));
    const child = JSON.parse(res.body).children[0];
    expect(child.club.pay_online).toBe(false);
    expect(child.club.pay_instructions).toEqual({ iban: null, bizum: null, text: null });
  });

  it('club con Stripe Connect y datos de pago → pay_online true + instrucciones', async () => {
    const club = { ...CLUB, stripe_connect_charges_enabled: true, payment_iban: 'ES99 1234', payment_bizum: '600111222', payment_instructions: 'Indica el nombre' };
    const db = makeDb(baseResolvers({ organizations: () => ({ data: [club], error: null }) }));
    const res = await makeHandler(db)(event({ action: 'get_children' }, token));
    const child = JSON.parse(res.body).children[0];
    expect(child.club.pay_online).toBe(true);
    expect(child.club.pay_instructions).toEqual({ iban: 'ES99 1234', bizum: '600111222', text: 'Indica el nombre' });
  });
});
