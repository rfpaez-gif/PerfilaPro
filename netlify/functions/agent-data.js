const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.AGENT_JWT_SECRET || 'changeme';

const PLAN_PRICES = { base: 9, pro: 19, renovacion: 5 };

function verifyToken(event) {
  const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function groupByMonth(cards) {
  const months = {};
  for (const card of cards) {
    const period = (card.created_at || '').substring(0, 7); // 'YYYY-MM'
    if (!months[period]) months[period] = [];
    months[period].push(card);
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
    if (subAgents && subAgents.length > 0) {
      const subCodes = subAgents.map(a => a.code);
      const { data } = await db
        .from('cards')
        .select('slug, nombre, plan, status, created_at, agent_code')
        .in('agent_code', subCodes)
        .order('created_at', { ascending: false });
      subCards = data || [];
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

    // Monthly breakdown
    const ownByMonth = groupByMonth(allOwn);
    const subByMonth = groupByMonth(allSub);
    const allPeriods = [...new Set([...Object.keys(ownByMonth), ...Object.keys(subByMonth)])].sort().reverse();

    const liquidatedPeriods = new Set((liquidations || []).map(l => l.period));

    const months = allPeriods.map(period => {
      const own = ownByMonth[period] || [];
      const sub = subByMonth[period] || [];
      const commission = calcCommissions(own, agentRate, sub, overrideRate);
      const grossOwn = own.reduce((s, c) => s + (PLAN_PRICES[c.plan] || 9), 0);
      const grossSub = sub.reduce((s, c) => s + (PLAN_PRICES[c.plan] || 9), 0);
      return {
        period,
        own_sales: own.length,
        sub_sales: sub.length,
        gross: grossOwn + grossSub,
        commission,
        liquidated: liquidatedPeriods.has(period),
      };
    });

    const pendingCommission = months
      .filter(m => !m.liquidated)
      .reduce((s, m) => s + m.commission, 0);

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
          pending_commission: Math.round(pendingCommission * 100) / 100,
        },
        months,
        recent_sales: allOwn.slice(0, 20),
        liquidations: liquidations || [],
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
