'use strict';

// POST /api/create-setup-fee-checkout { card_slugs, kind }   ·   Cantera 4c
//
// El club paga a PerfilaPro la impresión del carnet PVC+NFC: 19€ setup
// por fichaje nuevo, 9€ renovación anual. Cobro DIRECTO a la plataforma
// (no Connect — esto lo factura PerfilaPro, no el club). Una sesión de
// Checkout en modo `payment` con quantity = nº de carnets.
//
// Crea filas card_print_orders en estado 'pending' enlazadas a la
// sesión (stripe_payment_intent_id = session.id); el webhook (4d) las
// marca 'paid'.
//
// Auth: JWT org-panel del club. Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

// kind → env var con el Price ID de Stripe.
const KIND_PRICE_ENV = {
  setup: 'STRIPE_PRICE_PLAYER_SETUP_FEE',
  renewal: 'STRIPE_PRICE_PLAYER_RENEWAL',
};
const MAX_CARDS = 200;

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(stripe, db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!stripe) return jsonResponse(503, { error: 'Stripe no configurado' });

    const rl = checkRateLimit(event, { bucket: 'setup-fee-checkout', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const kind = body.kind || 'setup';
    const priceEnv = KIND_PRICE_ENV[kind];
    if (!priceEnv) return jsonResponse(400, { error: 'kind debe ser setup o renewal' });
    const priceId = process.env[priceEnv];
    if (!priceId) return jsonResponse(503, { error: `Precio ${kind} no configurado` });

    const slugs = Array.isArray(body.card_slugs)
      ? [...new Set(body.card_slugs.map(s => String(s || '').trim()).filter(Boolean))]
      : [];
    if (slugs.length === 0) return jsonResponse(400, { error: 'card_slugs requerido (array no vacío)' });
    if (slugs.length > MAX_CARDS) return jsonResponse(400, { error: `máximo ${MAX_CARDS} carnets por pedido` });

    // Club (scoped al JWT).
    const { data: org, error: orgErr } = await db
      .from('organizations').select('id, kind, deleted_at').eq('id', session.orgId).maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return unauthorizedResponse();
    if (org.kind !== 'sports_club') return jsonResponse(403, { error: 'Solo disponible para clubes deportivos' });

    // Solo carnets de jugadores que pertenecen a este club.
    const { data: cards, error: cardsErr } = await db
      .from('cards').select('slug, organization_id, card_kind, deleted_at').in('slug', slugs);
    if (cardsErr) return jsonResponse(500, { error: cardsErr.message });
    const validSlugs = (cards || [])
      .filter(c => c.organization_id === org.id && c.card_kind === 'player' && !c.deleted_at)
      .map(c => c.slug);
    if (validSlugs.length === 0) return jsonResponse(400, { error: 'Ningún jugador válido de tu club en card_slugs' });

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    let checkout;
    try {
      checkout = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: priceId, quantity: validSlugs.length }],
        metadata: { kind: 'cantera-print', org_id: org.id, order_kind: kind, card_count: String(validSlugs.length) },
        success_url: `${siteUrl}/panel.html?print=done`,
        cancel_url: `${siteUrl}/panel.html?print=cancel`,
      });
    } catch (err) {
      console.error('create-setup-fee-checkout: Stripe error:', err.message);
      return jsonResponse(502, { error: 'No se pudo iniciar el pago' });
    }

    // Pedidos pendientes enlazados a la sesión (el webhook 4d los marca pagados).
    const rows = validSlugs.map(slug => ({
      card_slug: slug,
      organization_id: org.id,
      status: 'pending',
      kind,
      stripe_payment_intent_id: checkout.id,
    }));
    const { error: insErr } = await db.from('card_print_orders').insert(rows);
    if (insErr) {
      // El pago sigue siendo válido; el webhook puede reconstruir desde metadata.
      console.error('create-setup-fee-checkout: print orders no creados:', insErr.message);
    }

    return jsonResponse(200, { ok: true, url: checkout.url, count: validSlugs.length });
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
exports.KIND_PRICE_ENV = KIND_PRICE_ENV;
