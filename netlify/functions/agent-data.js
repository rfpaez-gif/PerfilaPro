const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { resolveJwtSecret } = require('./lib/jwt-secret');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const jwtSecret = () => resolveJwtSecret('agent-data', 'AGENT_JWT_SECRET');

const PLAN_PRICES = { base: 9, pro: 19, renovacion: 5 };

function verifyToken(event) {
  const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

function groupByMonth(items, dateKey = 'created_at') {
  const months = {};
  for (const item of items) {
    const period = (item[dateKey] || '').substring(0, 7); // 'YYYY-MM'
    if (!months[period]) months[period] = [];
    months[period].push(item);
  }
  return months;
}

function calcCommissions(cards, agentRate, overrideCards, overrideRate) {
  let total = 0;
  for (const c of cards) {
    const price = PLAN_PRICES[c.plan] || 9;
    total += price * (agentRate / 100);
  }
  for (const c of overrideCards) {
    const price = PLAN_PRICES[c.plan] || 9;
    total += price * (overrideRate / 100);
  }
  return Math.round(total * 100) / 100;
}

// Comisión sobre invoices B2B recurrentes (Bloque C). Cada org_invoice
// tiene amount_cents — la comisión es % directo sobre eso. El override
// L2-on-L1 (5% por defecto) aplica igual: si el invoice viene de una org
// vendida por un sub-agente, el padre cobra overrideRate del mismo amount.
function calcOrgCommissions(invoices, agentRate, subInvoices, overrideRate) {
  let total = 0;
  for (const inv of invoices) {
    total += (inv.amount_cents || 0) * (agentRate / 100);
  }
  for (const inv of subInvoices) {
    total += (inv.amount_cents || 0) * (overrideRate / 100);
  }
  // amount_cents → euros, redondeo 2 decimales
  return Math.round(total) / 100;
}

function makeHandler(db) {
  return async (event) => {
    const payload = verifyToken(event);
    if (!payload) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No autorizado' }),
      };
    }

    const { agentId, agentCode } = payload;

    // Load agent profile + parent info
    const { data: agent, error: agentErr } = await db
      .from('agents')
      .select('id, code, name, email, commission_rate, parent_agent_id, nif, address, business_name')
      .eq('id', agentId)
      .single();

    if (agentErr || !agent) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Agente no encontrado' }),
      };
    }

    // Load agent's own sales
    const { data: ownCards } = await db
      .from('cards')
      .select('slug, nombre, plan, status, created_at, expires_at')
      .eq('agent_code', agentCode)
      .order('created_at', { ascending: false });

    // Load sub-agents' sales (for override commission)
    const { data: subAgents } = await db
      .from('agents')
      .select('code')
      .eq('parent_agent_id', agentId)
      .eq('status', 'active');

    let subCards = [];
    let subOrgInvoices = [];
    const subCodes = (subAgents || []).map(a => a.code);
    if (subCodes.length > 0) {
      const { data } = await db
        .from('cards')
        .select('slug, nombre, plan, status, created_at, agent_code')
        .in('agent_code', subCodes)
        .order('created_at', { ascending: false });
      subCards = data || [];

      // Invoices B2B de orgs vendidas por sub-agentes (override L2-on-L1).
      // Tabla puede no existir en entornos pre-migración 029 — try/catch
      // defensivo para no romper agent-data si la migración aún no se ha
      // ejecutado en este entorno.
      try {
        const { data: subInv } = await db
          .from('org_invoices')
          .select('id, organization_id, amount_cents, currency, paid_at, agent_code, tier, cycle, seats')
          .in('agent_code', subCodes)
          .order('paid_at', { ascending: false });
        subOrgInvoices = subInv || [];
      } catch (err) {
        console.warn('org_invoices no disponible (migración 029 pendiente?):', err.message);
      }
    }

    // Invoices B2B propios (orgs cerradas por este agente). Try/catch
    // defensivo igual que el de sub-invoices.
    let ownOrgInvoices = [];
    try {
      const { data: ownInv } = await db
        .from('org_invoices')
        .select('id, organization_id, amount_cents, currency, paid_at, agent_code, tier, cycle, seats')
        .eq('agent_code', agentCode)
        .order('paid_at', { ascending: false });
      ownOrgInvoices = ownInv || [];
    } catch (err) {
      console.warn('org_invoices no disponible (migración 029 pendiente?):', err.message);
    }

    // Orgs activas atribuidas a este agente (para sumar MRR estimado y
    // mostrar el listado en la tab "Mis B2B" del portal — Bloque D).
    let ownOrgs = [];
    try {
      const { data: orgs } = await db
        .from('organizations')
        .select('id, slug, name, tier, cycle, seats, subscription_status, current_period_end, created_at')
        .eq('agent_code', agentCode)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      ownOrgs = orgs || [];
    } catch (err) {
      console.warn('organizations no disponible:', err.message);
    }

    // Load liquidations
    const { data: liquidations } = await db
      .from('agent_liquidations')
      .select('period, sales_count, gross_amount, commission_amount, status, paid_at')
      .eq('agent_id', agentId)
      .order('period', { ascending: false });

    const agentRate = agent.commission_rate || 15;
    const overrideRate = 5; // global override rate for L1 on L2 sales

    const allOwn = ownCards || [];
    const allSub = subCards || [];

    // Monthly breakdown — incluye cards autónomos + invoices B2B en la
    // misma agrupación por YYYY-MM. La métrica `gross` se mantiene en
    // euros (las cards usan PLAN_PRICES € y los invoices amount_cents/100).
    const ownByMonth     = groupByMonth(allOwn);
    const subByMonth     = groupByMonth(allSub);
    const ownInvByMonth  = groupByMonth(ownOrgInvoices, 'paid_at');
    const subInvByMonth  = groupByMonth(subOrgInvoices, 'paid_at');
    const allPeriods = [...new Set([
      ...Object.keys(ownByMonth),
      ...Object.keys(subByMonth),
      ...Object.keys(ownInvByMonth),
      ...Object.keys(subInvByMonth),
    ])].sort().reverse();

    const liquidatedPeriods = new Set((liquidations || []).map(l => l.period));

    const months = allPeriods.map(period => {
      const own    = ownByMonth[period]    || [];
      const sub    = subByMonth[period]    || [];
      const ownInv = ownInvByMonth[period] || [];
      const subInv = subInvByMonth[period] || [];

      const cardCommission = calcCommissions(own, agentRate, sub, overrideRate);
      const orgCommission  = calcOrgCommissions(ownInv, agentRate, subInv, overrideRate);

      const grossOwn = own.reduce((s, c) => s + (PLAN_PRICES[c.plan] || 9), 0);
      const grossSub = sub.reduce((s, c) => s + (PLAN_PRICES[c.plan] || 9), 0);
      const grossOwnInv = ownInv.reduce((s, i) => s + (i.amount_cents || 0), 0) / 100;
      const grossSubInv = subInv.reduce((s, i) => s + (i.amount_cents || 0), 0) / 100;

      return {
        period,
        own_sales:    own.length,
        sub_sales:    sub.length,
        own_org_invoices: ownInv.length,
        sub_org_invoices: subInv.length,
        gross:        Math.round((grossOwn + grossSub + grossOwnInv + grossSubInv) * 100) / 100,
        card_commission: cardCommission,
        org_commission:  orgCommission,
        commission:   Math.round((cardCommission + orgCommission) * 100) / 100,
        liquidated:   liquidatedPeriods.has(period),
      };
    });

    const pendingCommission = months
      .filter(m => !m.liquidated)
      .reduce((s, m) => s + m.commission, 0);

    // MRR estimado: suma del invoice más reciente por suscripción activa.
    // Aproximado — un cliente que pasó de monthly→annual reciente sesga,
    // pero sirve como indicador de salud del portfolio del agente.
    const activeOrgs = ownOrgs.filter(o => o.subscription_status === 'active');
    const latestInvBySub = new Map();
    for (const inv of ownOrgInvoices) {
      // ownOrgInvoices viene ordenado paid_at DESC; el primero encontrado
      // por organization_id es el más reciente.
      if (!latestInvBySub.has(inv.organization_id)) {
        latestInvBySub.set(inv.organization_id, inv);
      }
    }
    let orgMrrEur = 0;
    for (const org of activeOrgs) {
      const latest = latestInvBySub.get(org.id);
      if (!latest) continue;
      // Annual → dividir el invoice entre 12 para obtener MRR equivalente.
      const monthlyEquivCents = latest.cycle === 'annual'
        ? latest.amount_cents / 12
        : latest.amount_cents;
      orgMrrEur += monthlyEquivCents / 100;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: {
          name: agent.name,
          code: agent.code,
          email: agent.email,
          commission_rate: agentRate,
          nif: agent.nif,
          address: agent.address,
          business_name: agent.business_name,
        },
        summary: {
          total_sales: allOwn.length,
          sub_sales: allSub.length,
          org_count: activeOrgs.length,
          org_mrr_eur: Math.round(orgMrrEur * 100) / 100,
          pending_commission: Math.round(pendingCommission * 100) / 100,
        },
        months,
        recent_sales: allOwn.slice(0, 20),
        recent_org_invoices: ownOrgInvoices.slice(0, 20),
        orgs: ownOrgs,
        liquidations: liquidations || [],
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
