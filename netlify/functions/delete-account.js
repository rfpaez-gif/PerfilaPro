const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'delete-account', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'JSON inválido' }),
      };
    }

    const { slug, token } = body;

    if (!slug || !token) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetros inválidos' }),
      };
    }

    // Sólo se puede borrar una card no-borrada (deleted_at IS NULL).
    // Si ya está soft-deleted, el token ya no aplica → 401 "enlace inválido".
    const { data: card, error } = await db
      .from('cards')
      .select('slug, edit_token_expires_at')
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

    // Soft-delete: marca deleted_at, deja visits y facturas intactas.
    // Las facturas son de relevancia fiscal (AEAT) y nunca se borran físicamente
    // hasta el job de purga a 30 días, que es el periodo de gracia GDPR.
    const { error: updateError } = await db
      .from('cards')
      .update({ deleted_at: new Date().toISOString() })
      .eq('slug', slug);

    if (updateError) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No se pudo borrar la cuenta' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
