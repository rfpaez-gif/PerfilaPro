'use strict';

// Endpoint admin: regenera la foto de un perfil semilla por slug.
// Protegido por ADMIN_PASSWORD + TOTP (acción destructiva: sobrescribe foto_url).
// POST { slug } → 200 { ok: true, foto_url } | 4xx/5xx { error }

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');
const { regenerateSeedCard } = require('./lib/seed-generator');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function statusCodeForError(msg) {
  if (msg.startsWith('card_not_found')) return 404;
  if (msg.startsWith('missing_slug') || msg.startsWith('empty_prompt')) return 400;
  if (msg.startsWith('gemini_http_') || msg.startsWith('no_image_returned') ||
      msg.startsWith('network_error') || msg.startsWith('invalid_gemini_response')) return 502;
  return 500;
}

function makeHandler(deps) {
  const { db, regenerate, getEnv } = deps;

  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return jsonResponse(400, { error: 'invalid_json' }); }

    const slug = (body.slug || '').toString().trim();
    if (!slug) return jsonResponse(400, { error: 'missing_slug' });

    const apiKey = getEnv('GEMINI_API_KEY');
    if (!apiKey) return jsonResponse(500, { error: 'no_api_key' });

    try {
      const result = await regenerate(db, slug, { apiKey });
      return jsonResponse(200, { ok: true, foto_url: result.foto_url });
    } catch (err) {
      const msg = (err && err.message) || 'unknown_error';
      return jsonResponse(statusCodeForError(msg), { error: msg });
    }
  };
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = makeHandler({
  db: supabase,
  regenerate: regenerateSeedCard,
  getEnv: (k) => process.env[k],
});
exports.makeHandler = makeHandler;
