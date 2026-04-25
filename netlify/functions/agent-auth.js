const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.AGENT_JWT_SECRET || 'changeme';
const TOKEN_TTL = '7d';

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email y contraseña requeridos' }),
      };
    }

    const { data: agent, error } = await db
      .from('agents')
      .select('id, code, name, email, password_hash, commission_rate, parent_agent_id, status')
      .eq('email', email)
      .eq('status', 'active')
      .single();

    if (error || !agent) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Credenciales incorrectas' }),
      };
    }

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Credenciales incorrectas' }),
      };
    }

    const token = jwt.sign(
      { agentId: agent.id, agentCode: agent.code },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        agent: { name: agent.name, code: agent.code, email: agent.email },
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
