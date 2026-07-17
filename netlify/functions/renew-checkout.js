'use strict';

// POST /api/renew-checkout { slug, token }
//
// Vía comercial específica para la RENOVACIÓN de un autónomo que ya activó
// su tarjeta (Base/Pro/renovación previa) y se acerca a su fecha de
// caducidad. Antes, el único CTA que le llegaba (remind-expiry.js) apuntaba
// a la landing genérica de alta — el cliente tenía que rellenar el
// formulario desde cero como si fuera nuevo. Este endpoint reusa la card
// existente (auth por slug + edit_token, mismo mecanismo que edit-card) y
// cobra el precio de renovación (STRIPE_PRICE_RENOVACION → plan
// 'renovacion', 5€/12 meses — ver invoice-utils.PLAN_INFO), sin repetir
// datos.
//
// El webhook (stripe-webhook.js → handleRenewalCheckout) extiende
// expires_at de la MISMA fila (no crea una card nueva) y reactiva los
// recordatorios (reminder_X_sent → false) para el siguiente ciclo.

const stripeLib = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isAutonomo } = require('./lib/card-kind');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

const RENEWABLE_PLANS = ['base', 'pro', 'renovacion'];

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(stripe, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!stripe) return jsonResponse(503, { error: 'Stripe no configurado' });

    const priceId = process.env.STRIPE_PRICE_RENOVACION;
    if (!priceId) return jsonResponse(503, { error: 'Renovación no disponible todavía' });

    const rl = checkRateLimit(event, { bucket: 'renew-checkout', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const slug = (body.slug || '').trim();
    const token = (body.token || '').trim();
    if (!slug || !token) return jsonResponse(400, { error: 'Parámetros inválidos' });

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, email, plan, status, card_kind, organization_id, edit_token_expires_at, idioma')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !card) return jsonResponse(401, { error: 'Enlace inválido o expirado' });

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return jsonResponse(401, { error: 'El enlace ha expirado. Solicita uno nuevo desde /editar.' });
    }

    // Gate comercial: solo autónomos (no player/club_staff/B2B) con un plan
    // de pago reconocido pueden auto-renovarse por este carril.
    if (!isAutonomo(card) || card.organization_id || !RENEWABLE_PLANS.includes(card.plan)) {
      return jsonResponse(409, { error: 'Esta tarjeta no admite renovación por esta vía' });
    }

    if (card.status !== 'active') {
      return jsonResponse(409, { error: 'Tu tarjeta no está activa. Contacta con soporte para renovarla.' });
    }

    const idioma = card.idioma === 'ca' ? 'ca' : 'es';
    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    const sessionParams = {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { kind: 'renewal', slug },
      success_url: `${siteUrl}/${idioma}/success?slug=${slug}&renewed=1`,
      cancel_url: `${siteUrl}/${idioma}/editar?slug=${slug}&token=${token}`,
    };

    if (card.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(card.email)) {
      sessionParams.customer_email = card.email;
    }

    try {
      const session = await stripe.checkout.sessions.create(sessionParams);
      return jsonResponse(200, { url: session.url });
    } catch (err) {
      console.error('renew-checkout: Stripe error:', err.message);
      return jsonResponse(502, { error: 'No se pudo iniciar el pago' });
    }
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
