import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/agent-data.js';
const jwt = require('jsonwebtoken');

// ── Mock builder ─────────────────────────────────────────────────────────────
//
// agent-data hace queries con shape variable según la tabla:
//   * agents:  .eq('id', agentId).single()      → perfil
//              .eq('parent_agent_id', id).eq('status', 'active')  → sub-agentes (Promise)
//   * cards / org_invoices: distinguen own ('eq' por agent_code) vs sub ('in')
//   * organizations: .eq().is().order()
//   * agent_liquidations: .eq().order()
//
// El builder rastrea las llamadas a .eq() / .in() / .is() y delega en una
// fixture-source por tabla que decide qué devolver. Esto evita anidar mocks
// y permite tests legibles donde cada fixture es un array plano.

function makeDb(fixtures) {
  return {
    from: vi.fn((table) => {
      const builder = {
        _eqCalls: [],
        _inCalls: [],
        _isCalls: [],
        select: vi.fn(function () { return this; }),
        eq: vi.fn(function (col, val) { this._eqCalls.push({ col, val }); return this; }),
        in: vi.fn(function (col, val) { this._inCalls.push({ col, val }); return this; }),
        is: vi.fn(function (col, val) { this._isCalls.push({ col, val }); return this; }),
        single: vi.fn(function () {
          if (table === 'agents') {
            const data = fixtures.agent || null;
            return Promise.resolve({ data, error: data ? null : { message: 'not found' } });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        order: vi.fn(function () {
          return Promise.resolve({ data: resolveListData(table, this, fixtures), error: null });
        }),
        // Chain thenable: cuando la query termina sin .order() ni .single()
        // (caso de agents sub-list: .eq().eq() y await), el await dispara
        // .then() del propio builder.
        then: function (resolve, reject) {
          Promise.resolve({ data: resolveListData(table, this, fixtures), error: null })
            .then(resolve, reject);
        },
      };
      return builder;
    }),
  };
}

function resolveListData(table, builder, fixtures) {
  if (table === 'agents') {
    // sub-agents query: .eq('parent_agent_id', ...).eq('status', 'active')
    return fixtures.subAgents || [];
  }
  if (table === 'cards') {
    return builder._inCalls.length > 0
      ? (fixtures.subCards || [])
      : (fixtures.ownCards || []);
  }
  if (table === 'org_invoices') {
    return builder._inCalls.length > 0
      ? (fixtures.subInvoices || [])
      : (fixtures.ownInvoices || []);
  }
  if (table === 'organizations') return fixtures.ownOrgs || [];
  if (table === 'agent_liquidations') return fixtures.liquidations || [];
  return [];
}

// agent-data.js lee AGENT_JWT_SECRET en import-time; el valor real lo setea
// tests/setup.js para que coincida con el secret usado al firmar el JWT aquí.
const JWT_SECRET = process.env.AGENT_JWT_SECRET || 'test-agent-jwt-secret';

function makeJwt(agentId = 'agent-uuid-1', agentCode = 'AGENT01') {
  return jwt.sign({ agentId, agentCode }, JWT_SECRET, { expiresIn: '7d' });
}

function buildEvent({ token, method = 'GET' } = {}) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

const baseAgent = {
  id: 'agent-uuid-1',
  code: 'AGENT01',
  name: 'María Vendedora',
  email: 'maria@agentes.com',
  commission_rate: 15,
  parent_agent_id: null,
  nif: null,
  address: null,
  business_name: null,
};

beforeEach(() => {
  // No-op: AGENT_JWT_SECRET ya está seteado por tests/setup.js
});

describe('agent-data handler', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await makeHandler(makeDb({ agent: baseAgent }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 con JWT inválido', async () => {
    const res = await makeHandler(makeDb({ agent: baseAgent }))(buildEvent({ token: 'not-a-jwt' }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el agente del JWT no existe en BD', async () => {
    const res = await makeHandler(makeDb({ agent: null }))(buildEvent({ token: makeJwt() }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve summary con agent profile + zero state', async () => {
    const res = await makeHandler(makeDb({ agent: baseAgent }))(buildEvent({ token: makeJwt() }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.agent.code).toBe('AGENT01');
    expect(body.agent.commission_rate).toBe(15);
    expect(body.summary.total_sales).toBe(0);
    expect(body.summary.org_count).toBe(0);
    expect(body.summary.org_mrr_eur).toBe(0);
    expect(body.summary.pending_commission).toBe(0);
    expect(body.months).toEqual([]);
    expect(body.recent_org_invoices).toEqual([]);
    expect(body.orgs).toEqual([]);
  });

  it('calcula comisión sobre cards (15% de plan base 9€ = 1.35€)', async () => {
    const db = makeDb({
      agent: baseAgent,
      ownCards: [
        { slug: 'a', nombre: 'A', plan: 'base', status: 'active', created_at: '2026-05-10T10:00:00Z' },
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    expect(body.summary.total_sales).toBe(1);
    expect(body.months[0].card_commission).toBe(1.35);
    expect(body.months[0].org_commission).toBe(0);
    expect(body.months[0].commission).toBe(1.35);
  });

  it('calcula comisión sobre org_invoices (15% de 5000c = 7.50€)', async () => {
    const db = makeDb({
      agent: baseAgent,
      ownInvoices: [
        {
          id: 'inv-1', organization_id: 'org-1',
          amount_cents: 5000, currency: 'eur',
          paid_at: '2026-05-10T10:00:00Z',
          agent_code: 'AGENT01', tier: 'team', cycle: 'monthly', seats: 10,
        },
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    expect(body.months).toHaveLength(1);
    expect(body.months[0].own_org_invoices).toBe(1);
    expect(body.months[0].org_commission).toBe(7.5);
    expect(body.months[0].commission).toBe(7.5);
    expect(body.recent_org_invoices).toHaveLength(1);
  });

  it('suma comisión de cards + org_invoices en el mismo mes', async () => {
    const db = makeDb({
      agent: baseAgent,
      ownCards: [
        { slug: 'a', plan: 'pro', status: 'active', created_at: '2026-05-01T10:00:00Z' }, // 19€ × 15% = 2.85
      ],
      ownInvoices: [
        { id: 'inv-1', organization_id: 'org-1', amount_cents: 10000, paid_at: '2026-05-15T10:00:00Z', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' }, // 100€ × 15% = 15
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    const m = body.months.find(x => x.period === '2026-05');
    expect(m.card_commission).toBe(2.85);
    expect(m.org_commission).toBe(15);
    expect(m.commission).toBe(17.85);
  });

  it('override L2-on-L1 al 5% sobre invoices de sub-agentes', async () => {
    const db = makeDb({
      agent: baseAgent,
      subAgents: [{ code: 'SUBAG02' }],
      subInvoices: [
        { id: 'inv-sub', organization_id: 'org-sub', amount_cents: 20000, paid_at: '2026-05-15T10:00:00Z', agent_code: 'SUBAG02', tier: 'org', cycle: 'monthly' }, // 200€ × 5% override = 10€
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    const m = body.months.find(x => x.period === '2026-05');
    expect(m.sub_org_invoices).toBe(1);
    expect(m.org_commission).toBe(10);
  });

  it('MRR estimado: monthly → directo, annual → /12', async () => {
    const db = makeDb({
      agent: baseAgent,
      ownOrgs: [
        { id: 'org-m', slug: 'orgm', name: 'OrgM', subscription_status: 'active', tier: 'team', cycle: 'monthly', seats: 10, created_at: '2026-04-01' },
        { id: 'org-a', slug: 'orga', name: 'OrgA', subscription_status: 'active', tier: 'org',  cycle: 'annual',  seats: 5,  created_at: '2026-04-01' },
        { id: 'org-c', slug: 'orgc', name: 'OrgC', subscription_status: 'canceled', tier: 'team', cycle: 'monthly', seats: 3, created_at: '2026-01-01' },
      ],
      ownInvoices: [
        { id: 'inv-m', organization_id: 'org-m', amount_cents: 5000,  paid_at: '2026-05-10', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' }, // 50€ MRR
        { id: 'inv-a', organization_id: 'org-a', amount_cents: 60000, paid_at: '2026-05-10', agent_code: 'AGENT01', tier: 'org',  cycle: 'annual'  }, // 600€/12 = 50€ MRR
        { id: 'inv-c', organization_id: 'org-c', amount_cents: 1000,  paid_at: '2026-01-10', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' }, // org canceled → no cuenta
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    expect(body.summary.org_count).toBe(2);
    expect(body.summary.org_mrr_eur).toBe(100);
    expect(body.orgs).toHaveLength(3);
  });

  it('pending_commission excluye periodos ya liquidados', async () => {
    const db = makeDb({
      agent: baseAgent,
      ownInvoices: [
        { id: 'inv-may', organization_id: 'org-1', amount_cents: 10000, paid_at: '2026-05-15', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' }, // 15€ comisión
        { id: 'inv-apr', organization_id: 'org-1', amount_cents: 10000, paid_at: '2026-04-15', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' }, // 15€ comisión (liquidado)
      ],
      liquidations: [{ period: '2026-04', status: 'paid', paid_at: '2026-05-01' }],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    expect(body.summary.pending_commission).toBe(15);
    const apr = body.months.find(m => m.period === '2026-04');
    expect(apr.liquidated).toBe(true);
  });

  it('respeta commission_rate custom del agente (no hardcoded 15%)', async () => {
    const customAgent = { ...baseAgent, commission_rate: 20 };
    const db = makeDb({
      agent: customAgent,
      ownInvoices: [
        { id: 'inv-1', organization_id: 'org-1', amount_cents: 10000, paid_at: '2026-05-10', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly' },
      ],
    });
    const res = await makeHandler(db)(buildEvent({ token: makeJwt() }));
    const body = JSON.parse(res.body);
    expect(body.agent.commission_rate).toBe(20);
    expect(body.months[0].org_commission).toBe(20);   // 100€ × 20% = 20€
  });
});
