// Activación gratuita para cards de demostración (slug 'demo-*').
//
// Paralelo a claim-launch-promo pero recortado: cambia plan y marca
// kit_email_sent_at para que la card renderice como Pro (QR + stats) en
// /c/:slug, y envía un email breve con la tarjeta imprimible A6 adjunta.
// Sin factura, sin QR PNG suelto, sin comprobante — los demos no son
// una transacción, son material de marketing.
//
// Auth: slug + edit_token (mismo mecanismo que edit-card y claim-launch-promo).
// Gate por prefijo: solo activa cards cuyo slug empieza por 'demo-' para que
// el endpoint no pueda elevar cards reales aunque alguien tenga el token.
// Idempotente: si la card ya tiene kit_email_sent_at, devuelve 200 sin
// re-activar.
//
// La lógica de activación (UPDATE + PDF + email + posthog) vive en
// lib/demo-activation.js para reusarse desde register-free.js cuando un
// usuario entra a /alta vía ?via=demo-*.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { activateAndSendDemoKit, buildDemoActivationEmail } = require('./lib/demo-activation');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function makeHandler(db, emailClient = resend) {
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
      .select('slug, nombre, tagline, whatsapp, direccion, zona, email, plan, status, edit_token, edit_token_expires_at, stripe_session_id, kit_email_sent_at, idioma, categories(specialty_label)')
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

    // Idempotencia: si ya está activada, devolvemos 200 sin re-tocar
    // ni re-enviar email.
    if (card.kit_email_sent_at || card.stripe_session_id) {
      return jsonResponse(200, { ok: true, already_active: true, plan: card.plan });
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const result = await activateAndSendDemoKit({ db, emailClient, card, siteUrl });

    if (!result.ok) {
      console.error('Error activando demo:', result.error?.message);
      return jsonResponse(500, { error: 'No se pudo activar la demo' });
    }

    console.log(`Demo activada: ${slug} → pro (vence ${result.expires_at}, email: ${result.email_sent})`);
    return jsonResponse(200, {
      ok: true,
      plan: 'pro',
      expires_at: result.expires_at,
      email_sent: result.email_sent,
    });
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
exports.buildDemoActivationEmail = buildDemoActivationEmail;
