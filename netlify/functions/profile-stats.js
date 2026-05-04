// Stats del perfil para usuarios Pro. Autorización por edit_token (mismo
// mecanismo que edit-card / send-edit-link). Sin token, no hay datos.
//
// Devuelve:
// {
//   total:    número total de visitas registradas
//   last7d:   visitas en los últimos 7 días
//   last30d:  visitas en los últimos 30 días
//   daily:    [{ date: 'YYYY-MM-DD', count }, ...] — 30 días, cero-padded
// }

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(visits, now = new Date()) {
  const buckets = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    buckets.set(ymd(d), 0);
  }
  for (const v of visits || []) {
    if (!v.visited_at) continue;
    const key = v.visited_at.slice(0, 10);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'profile-stats', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, token } = event.queryStringParameters || {};

    if (!slug || !token) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetros inválidos' }),
      };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, plan, edit_token_expires_at')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Enlace inválido o expirado' }),
      };
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El enlace ha expirado. Solicita uno nuevo.' }),
      };
    }

    if (card.plan !== 'pro') {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Estadísticas solo disponibles en plan Pro' }),
      };
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: total }    = { count: 0 },
      { count: last7d }   = { count: 0 },
      { data: last30Rows } = { data: [] },
    ] = await Promise.all([
      db.from('visits').select('*', { count: 'exact', head: true }).eq('slug', slug),
      db.from('visits').select('*', { count: 'exact', head: true }).eq('slug', slug).gte('visited_at', sevenDaysAgo),
      db.from('visits').select('visited_at').eq('slug', slug).gte('visited_at', thirtyDaysAgo),
    ]);

    const last30d = (last30Rows || []).length;
    const daily   = buildDailySeries(last30Rows, now);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
      body: JSON.stringify({
        total:   total   || 0,
        last7d:  last7d  || 0,
        last30d,
        daily,
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildDailySeries = buildDailySeries;
