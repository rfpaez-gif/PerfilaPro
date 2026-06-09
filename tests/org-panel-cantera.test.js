import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// El handler importa printable-card-utils al cargar el módulo; lo mockeamos
// para no arrastrar PDFKit en estos tests de lectura (no se usa aquí).
vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

// --- Mock chainable Supabase ---
// Cada from(table) devuelve una chain nueva (filtros aislados). El valor
// terminal lo da un resolver por tabla que recibe los filtros .eq()
// acumulados, para que club_transfers pueda responder distinto a la query
// entrante (to_org_id) y a la saliente (from_org_id).
function makeChain(resolver) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => {
      if (m === 'eq' && args.length >= 2) filters[args[0]] = args[1];
      return q;
    });
  }
  q.then = (resolve, reject) => Promise.resolve(resolver(filters)).then(resolve, reject);
  return q;
}

function makeDb(resolvers) {
  return {
    from: vi.fn((table) => makeChain(resolvers[table] || (() => ({ data: [], error: null })))),
  };
}

const SPORTS_ORG = {
  id: 'org-1',
  name: 'CD Test',
  slug: 'cd-test',
  kind: 'sports_club',
  sport: 'futbol',
  cantera_monthly_fee_cents: 3000,
  color_primary: '#00aa00',
  logo_url: null,
  carnet_sponsor_url: 'https://x/sponsor.png',
  stripe_connect_account_id: 'acct_1',
  stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: false,
  deleted_at: null,
};

const CATALOG = [
  { id: 'cat-inf', sport: 'futbol', code: 'infantil', display_name_es: 'Infantil', display_name_ca: 'Infantil', min_birth_year_offset: -13, max_birth_year_offset: -12, sort_order: 40 },
  { id: 'cat-ale', sport: 'futbol', code: 'alevin', display_name_es: 'Alevín', display_name_ca: 'Aleví', min_birth_year_offset: -11, max_birth_year_offset: -10, sort_order: 30 },
];

const ROSTER_RESOLVERS = {
  organizations: () => ({ data: SPORTS_ORG, error: null }),
  member_club_seasons: () => ({
    data: [
      { card_slug: 'p-1', role: 'jugador', dorsal: 10, position: 'DEL', category_id: 'cat-ale', team_name: 'Alevín A', season: '2025-26', previous_club_name: null },
      { card_slug: 'p-2', role: 'jugador', dorsal: 7, position: 'MC', category_id: 'cat-ale', team_name: 'Alevín A', season: '2025-26', previous_club_name: 'Otro CF' },
      { card_slug: 'p-3', role: 'jugador', dorsal: 1, position: 'POR', category_id: 'cat-inf', team_name: 'Infantil B', season: '2025-26', previous_club_name: null },
      { card_slug: 's-1', role: 'entrenador', dorsal: null, position: null, category_id: null, team_name: 'Alevín A', season: '2025-26', previous_club_name: null },
    ],
    error: null,
  }),
  cards: () => ({
    data: [
      { slug: 'p-1', nombre: 'Ana', foto_url: null, public_card: true, birth_year: 2015, card_kind: 'player' },
      { slug: 'p-2', nombre: 'Beto', foto_url: null, public_card: false, birth_year: 2015, card_kind: 'player' },
      { slug: 'p-3', nombre: 'Carla', foto_url: null, public_card: false, birth_year: 2013, card_kind: 'player' },
      { slug: 's-1', nombre: 'Diego', foto_url: null, public_card: false, birth_year: 1985, card_kind: 'club_staff' },
    ],
    error: null,
  }),
  parent_subscriptions: () => ({
    data: [{ card_slug: 'p-1', status: 'active', amount_cents: 3000, current_period_end: '2026-04-01T00:00:00Z' }],
    error: null,
  }),
  external_payments: () => ({
    data: [{ card_slug: 'p-2', method: 'bizum', amount_cents: 3000, period: '2026-03', paid_at: '2026-03-05T10:00:00Z' }],
    error: null,
  }),
  sports_categories: () => ({ data: CATALOG, error: null }),
};

function event(action, body = {}, token) {
  const headers = { 'x-forwarded-for': '9.9.9.9' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: 'POST', headers, body: JSON.stringify({ action, ...body }) };
}

describe('org-panel · Cantera reads (layer 6a)', () => {
  let token;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.SITE_URL = 'https://perfilapro.es';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    token = signPanelSession({ orgId: 'org-1', orgSlug: 'cd-test' });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CANTERA_VERTICAL_ACTIVE;
  });

  it('returns 410 for sports reads when the vertical is off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const handler = makeHandler(makeDb(ROSTER_RESOLVERS), null);
    const res = await handler(event('get_roster', {}, token));
    expect(res.statusCode).toBe(410);
  });

  it('rejects a non-sports org with 400', async () => {
    const db = makeDb({ ...ROSTER_RESOLVERS, organizations: () => ({ data: { ...SPORTS_ORG, kind: 'business' }, error: null }) });
    const handler = makeHandler(db, null);
    const res = await handler(event('get_roster', {}, token));
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when the org is missing/soft-deleted', async () => {
    const db = makeDb({ ...ROSTER_RESOLVERS, organizations: () => ({ data: null, error: null }) });
    const handler = makeHandler(db, null);
    const res = await handler(event('get_roster', {}, token));
    expect(res.statusCode).toBe(401);
  });

  it('get_roster groups players by category (catalog order) with payment state', async () => {
    const handler = makeHandler(makeDb(ROSTER_RESOLVERS), null);
    const res = await handler(event('get_roster', {}, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.season).toBe('2025-26');
    expect(body.org.monthly_fee_cents).toBe(3000);
    expect(body.org.kind).toBe('sports_club');
    // patrocinador del carnet expuesto al Studio para previsualizar/reemplazar
    expect(body.org.carnet_sponsor_url).toBe('https://x/sponsor.png');

    // sort_order: alevin (30) before infantil (40)
    expect(body.categories.map((c) => c.code)).toEqual(['alevin', 'infantil']);
    expect(body.categories[0].display_name).toBe('Alevín');

    // alevin players sorted by dorsal (7 before 10)
    expect(body.categories[0].members.map((m) => m.dorsal)).toEqual([7, 10]);

    const bySlug = {};
    for (const cat of body.categories) for (const m of cat.members) bySlug[m.slug] = m;
    expect(bySlug['p-1'].payment).toMatchObject({ source: 'stripe', status: 'active' });

    // Regla "carnet listo": p-1 tiene equipo+dorsal pero NO foto → falta foto.
    expect(bySlug['p-1'].carnet_ready).toBe(false);
    expect(bySlug['p-1'].carnet_missing).toEqual(['foto']);
    expect(bySlug['p-2'].payment).toMatchObject({ source: 'manual', status: 'paid', method: 'bizum' });
    expect(bySlug['p-3'].payment).toMatchObject({ status: 'unpaid' });
    expect(bySlug['p-2'].previous_club_name).toBe('Otro CF');

    expect(body.staff).toHaveLength(1);
    expect(body.staff[0].role).toBe('entrenador');
    // ninguno de los 3 jugadores tiene foto en el seed → 0 carnets listos
    expect(body.totals).toEqual({ players: 3, staff: 1, paying: 2, unpaid: 1, carnet_ready: 0 });
  });

  it('get_club_stats aggregates members, payments coverage, MRR and transfers', async () => {
    const resolvers = {
      ...ROSTER_RESOLVERS,
      club_transfers: (f) => (f.to_org_id ? { data: [{ id: 't-in' }], error: null } : { data: [], error: null }),
    };
    const handler = makeHandler(makeDb(resolvers), null);
    const res = await handler(event('get_club_stats', {}, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.members).toEqual({ players: 3, staff: 1, total: 4 });
    expect(body.payments.paying).toBe(2);
    expect(body.payments.unpaid).toBe(1);
    expect(body.payments.coverage_pct).toBe(67);
    expect(body.payments.stripe_active).toBe(1);
    expect(body.payments.manual_this_period).toBe(1);
    expect(body.payments.mrr_cents).toBe(3000);
    expect(body.payments.period).toBe('2026-03');
    expect(body.transfers).toEqual({ pending_in: 1, pending_out: 0 });
    // La agregación de visitas la cubre org-stats-utils.test; aquí sólo
    // verificamos que get_club_stats expone la forma esperada.
    expect(body.visits).toHaveProperty('total');
    expect(body.visits).toHaveProperty('last7');
    expect(body.visits).toHaveProperty('last30');
    expect(Array.isArray(body.visits.by_day)).toBe(true);
    expect(body.connect).toMatchObject({ account_id: 'acct_1', charges_enabled: true });
  });

  it('get_club_stats switches payment KPIs to the plan model when the club bills by concept', async () => {
    // Plan a medida: 2 conceptos (Inscripción 100€ + Material 50€ = 150€).
    const plan = [
      { concepto: 'Inscripción', amount_cents: 10000, due_date: '2026-09-01' },
      { concepto: 'Material', amount_cents: 5000, due_date: '2026-09-15' },
    ];
    const resolvers = {
      ...ROSTER_RESOLVERS,
      enrollment_campaigns: () => ({ data: { id: 'camp-1', season: '2026-27', status: 'open', concepts_jsonb: { plan } }, error: null }),
      // Ana y Beto pagaron la Inscripción por Stripe.
      enrollment_charges: () => ({ data: [
        { card_slug: 'p-1', concepto: 'Inscripción', status: 'paid' },
        { card_slug: 'p-2', concepto: 'Inscripción', status: 'paid' },
      ], error: null }),
      // Ana además pagó el Material a mano (concepto apuntado).
      external_payments: () => ({ data: [
        { card_slug: 'p-1', concepto: 'Material', amount_cents: 5000, method: 'bizum' },
      ], error: null }),
    };
    const handler = makeHandler(makeDb(resolvers), null);
    const res = await handler(event('get_club_stats', {}, token));
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).payments;

    expect(p.model).toBe('plan');
    expect(p.season).toBe('2026-27');
    expect(p.plan_total_cents).toBe(15000);
    // Ana completó el plan; Beto y Carla no.
    expect(p.paying).toBe(1);
    expect(p.unpaid).toBe(2);
    // Recaudado: Ana 150€ + Beto 100€ + Carla 0 = 250€ de 450€ esperados.
    expect(p.collected_cents).toBe(25000);
    expect(p.expected_cents).toBe(45000);
    expect(p.coverage_pct).toBe(56); // round(250/450*100)
    expect(p.concepts_paid).toBe(3); // Ana 2 + Beto 1
    expect(p.concepts_total).toBe(6); // 3 jugadores × 2 conceptos
    // No filtra campos del modelo mensual en el payload de plan.
    expect(p.mrr_cents).toBeUndefined();

    // Progreso por jugador para la tabla "Estado por jugador".
    const ana = p.players.find((x) => x.slug === 'p-1');
    expect(ana).toMatchObject({ status: 'paid', concepts_paid: 2, concepts_total: 2, paid_cents: 15000, total_cents: 15000 });
    const beto = p.players.find((x) => x.slug === 'p-2');
    expect(beto).toMatchObject({ status: 'partial', concepts_paid: 1, paid_cents: 10000 });
    const carla = p.players.find((x) => x.slug === 'p-3');
    expect(carla).toMatchObject({ status: 'pending', concepts_paid: 0, paid_cents: 0 });
  });

  it('get_club_stats keeps the monthly payment model when there is no plan campaign', async () => {
    // Campaña abierta SIN plan (cuota mensual) → KPIs mensuales intactos.
    const resolvers = {
      ...ROSTER_RESOLVERS,
      enrollment_campaigns: () => ({ data: { id: 'camp-1', season: '2026-27', status: 'open', monthly_fee_cents: 3000, num_installments: 9, concepts_jsonb: null }, error: null }),
    };
    const handler = makeHandler(makeDb(resolvers), null);
    const res = await handler(event('get_club_stats', {}, token));
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).payments;
    expect(p.model).toBe('monthly');
    expect(p.mrr_cents).toBe(3000);
    expect(p.period).toBe('2026-03');
    expect(p.players).toBeUndefined();
  });

  it('get_transfers returns incoming + outgoing trays with resolved names', async () => {
    const resolvers = {
      organizations: () => ({ data: SPORTS_ORG, error: null }),
      club_transfers: (f) => {
        if (f.to_org_id) {
          return {
            data: [
              { id: 't1', card_slug: 'p-9', to_org_id: 'org-1', from_org_id: 'org-2', status: 'pending', season: '2025-26', dorsal: 9, created_at: '2026-03-10T00:00:00Z' },
              { id: 't2', card_slug: 'p-8', to_org_id: 'org-1', from_org_id: 'org-3', status: 'accepted', created_at: '2026-02-10T00:00:00Z' },
            ],
            error: null,
          };
        }
        if (f.from_org_id) {
          return {
            data: [
              { id: 't3', card_slug: 'p-7', to_org_id: 'org-4', from_org_id: 'org-1', status: 'pending', created_at: '2026-03-11T00:00:00Z' },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
      cards: () => ({
        data: [
          { slug: 'p-9', nombre: 'Nuevo Nueve' },
          { slug: 'p-8', nombre: 'Viejo Ocho' },
          { slug: 'p-7', nombre: 'Sale Siete' },
        ],
        error: null,
      }),
    };
    const handler = makeHandler(makeDb(resolvers), null);
    const res = await handler(event('get_transfers', {}, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.incoming).toHaveLength(2);
    expect(body.outgoing).toHaveLength(1);
    expect(body.incoming[0]).toMatchObject({ id: 't1', direction: 'incoming', nombre: 'Nuevo Nueve', status: 'pending' });
    expect(body.outgoing[0]).toMatchObject({ id: 't3', direction: 'outgoing', nombre: 'Sale Siete' });
    expect(body.pending).toEqual({ incoming: 1, outgoing: 1 });
  });

  it('requires a valid panel JWT (401 without token)', async () => {
    const handler = makeHandler(makeDb(ROSTER_RESOLVERS), null);
    const res = await handler(event('get_roster', {}));
    expect(res.statusCode).toBe(401);
  });

  it('get_org enriches the response with kind/sport when the vertical is active', async () => {
    // Reusa los resolvers de roster: organizations devuelve el club deportivo,
    // cards/visits vacíos (computeOrgStats real agrega sin error sobre [] ).
    const handler = makeHandler(makeDb(ROSTER_RESOLVERS), null);
    const res = await handler(event('get_org', {}, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.org.kind).toBe('sports_club');
    expect(body.org.sport).toBe('futbol');
  });
});
