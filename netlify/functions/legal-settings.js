const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULTS = {
  legal_name: '',
  legal_nif: '',
  legal_address: '',
  legal_email: 'hola@perfilapro.com',
};

function makeHandler(db) {
  return async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

    if (event.httpMethod === 'GET') {
      const { data, error } = await db
        .from('settings')
        .select('key, value')
        .in('key', Object.keys(DEFAULTS));

      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

      const result = { ...DEFAULTS };
      for (const row of data || []) result[row.key] = row.value;

      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    if (event.httpMethod === 'POST') {
      const password = event.headers['x-admin-password'];
      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado' }) };
      }

      let body;
      try { body = JSON.parse(event.body || '{}'); } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) };
      }

      const allowed = Object.keys(DEFAULTS);
      const rows = Object.entries(body)
        .filter(([k]) => allowed.includes(k))
        .map(([key, value]) => ({ key, value: String(value).trim() }));

      if (!rows.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Sin campos válidos' }) };
      }

      const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
