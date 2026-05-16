// Activación gratuita para cards de demostración (slug 'demo-*').
//
// Paralelo a claim-launch-promo pero recortado: solo cambia plan y marca
// kit_email_sent_at para que la card renderice como Pro (QR + stats) en
// /c/:slug. Sin email, sin comprobante PDF, sin factura — los demos
// no son una transacción, son material de marketing.
//
// Auth: slug + edit_token (mismo mecanismo que edit-card y claim-launch-promo).
// Gate por prefijo: solo activa cards cuyo slug empieza por 'demo-' para que
// el endpoint no pueda elevar cards reales aunque alguien tenga el token.
// Idempotente: si la card ya tiene kit_email_sent_at, devuelve 200 sin
// re-activar.

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { capture: phCapture } = require('./lib/posthog-server');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEMO_DAYS = 365;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'activate-demo', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { slug, token } = body;
    if (!slug || !token) {
      return jsonResponse(400, { error: 'Parámetros inválidos' });
    }

    // Sólo cards demo. Sin esto, cualquiera con un edit_token válido
    // podría saltarse el checkout de Stripe en cards reales.
    if (typeof slug !== 'string' || !slug.startsWith('demo-')) {
      return jsonResponse(403, { error: 'Endpoint reservado a cards demo' });
    }

    const { data: card, error: cardError } = await db
      .from('cards')
      .select('slug, plan, status, edit_token, edit_token_expires_at, stripe_session_id, kit_email_sent_at, idioma')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .single();

    if (cardError || !card) {
      return jsonResponse(401, { error: 'Enlace inválido o expirado' });
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return jsonResponse(401, { error: 'El enlace de edición ha expirado.' });
    }

    // Idempotencia: si ya está activada, devolvemos 200 sin re-tocar.
    if (card.kit_email_sent_at || card.stripe_session_id) {
      return jsonResponse(200, { ok: true, already_active: true, plan: card.plan });
    }

    const expiresAt = new Date(Date.now() + DEMO_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const activatedAt = new Date().toISOString();

    const { error: upErr } = await db
      .from('cards')
      .update({
        plan: 'pro',
        status: 'active',
        expires_at: expiresAt,
        kit_email_sent_at: activatedAt,
      })
      .eq('slug', slug);

    if (upErr) {
      console.error('Error activando demo:', upErr.message);
      return jsonResponse(500, { error: 'No se pudo activar la demo' });
    }

    phCapture(slug, 'demo_activated', {
      slug,
      idioma: card.idioma || 'es',
    }).catch(() => {});

    console.log(`Demo activada: ${slug} → pro (vence ${expiresAt})`);
    return jsonResponse(200, {
      ok: true,
      plan: 'pro',
      expires_at: expiresAt,
    });
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
