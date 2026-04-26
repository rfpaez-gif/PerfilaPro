const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    const auth = checkAdminAuth(event);
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    // GET — list all agents
    if (event.httpMethod === 'GET') {
      const { data, error } = await db
        .from('agents')
        .select('id, code, name, email, commission_rate, parent_agent_id, status, nif, address, business_name, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error agents query:', JSON.stringify(error));
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
      }

      // Count cards per agent — ignora errores si la columna agent_code aún no existe
      const salesByCode = {};
      try {
        const { data: cards } = await db
          .from('cards')
          .select('agent_code')
          .not('agent_code', 'is', null);
        for (const c of cards || []) {
          salesByCode[c.agent_code] = (salesByCode[c.agent_code] || 0) + 1;
        }
      } catch (e) {
        console.warn('Cards agent_code query skipped:', e.message);
      }

      const agents = (data || []).map(a => ({ ...a, sales_count: salesByCode[a.code] || 0 }));

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents }),
      };
    }

    // POST — create or update agent
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body); } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
      }

      const { action } = body;

      if (action === 'create') {
        const { name, email, code, password, commission_rate, parent_agent_id, nif, address, business_name } = body;

        if (!name || !email || !code || !password) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
        }

        const password_hash = await bcrypt.hash(password, 10);

        const { error } = await db.from('agents').insert({
          name,
          email: email.toLowerCase().trim(),
          code: code.toUpperCase().trim(),
          password_hash,
          commission_rate: commission_rate || 15,
          parent_agent_id: parent_agent_id || null,
          nif: nif || null,
          address: address || null,
          business_name: business_name || null,
          status: 'active',
        });

        if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'update') {
        const { id, name, commission_rate, status, parent_agent_id, nif, address, business_name, password } = body;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };

        const update = { name, commission_rate, status, parent_agent_id: parent_agent_id || null, nif, address, business_name };
        if (password) update.password_hash = await bcrypt.hash(password, 10);

        const { error } = await db.from('agents').update(update).eq('id', id);
        if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'liquidate') {
        // Mark a period as liquidated for an agent
        const { agent_id, period, sales_count, gross_amount, commission_amount } = body;
        if (!agent_id || !period) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos' }) };

        const { error } = await db.from('agent_liquidations').upsert({
          agent_id,
          period,
          sales_count: sales_count || 0,
          gross_amount: gross_amount || 0,
          commission_amount: commission_amount || 0,
          status: 'paid',
          paid_at: new Date().toISOString(),
        }, { onConflict: 'agent_id,period' });

        if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, body: JSON.stringify({ error: 'Acción desconocida' }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
