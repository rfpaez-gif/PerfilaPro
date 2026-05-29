'use strict';

// POST /api/create-parent-checkout { card_slug }   ·   Cantera capa 4b
//
// Cuota mensual padre→club vía Stripe Connect. El tutor, desde su panel,
// activa la cuota de su hijo/a (Q3 = upgrade voluntario). Creamos una
// Checkout Session en modo subscription como DIRECT CHARGE sobre la
// cuenta conectada del club (stripeAccount header); PerfilaPro retiene
// application_fee_percent (STRIPE_PLATFORM_FEE_BPS).
//
// El precio es ad-hoc (price_data inline) con la cuota que el club
// configuró en organizations.cantera_monthly_fee_cents — así no hay que
// pre-crear Prices en la cuenta del club.
//
// La fila parent_subscriptions la materializa el webhook (capa 4d) al
// confirmarse el pago; aquí solo se genera la sesión.
//
// Auth: JWT parent-panel (tutor). Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { isPlayer } = require('./lib/card-kind');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

const PARENT_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self'];

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(stripe, db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!stripe) return jsonResponse(503, { error: 'Stripe no configurado' });

    const rl = checkRateLimit(event, { bucket: 'create-parent-checkout', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

    // Card del jugador.
    const { data: card, error: cardErr } = await db
      .from('cards').select('slug, card_kind, nombre, idioma, organization_id, deleted_at')
      .eq('slug', cardSlug).maybeSingle();
    if (cardErr) return jsonResponse(500, { error: cardErr.message });
    if (!card || card.deleted_at || !isPlayer(card)) return jsonResponse(404, { error: 'Jugador no encontrado' });
    if (!card.organization_id) return jsonResponse(409, { error: 'El jugador no tiene club activo' });

    // El email de la sesión debe ser tutor activo de la card.
    const { data: admin, error: aErr } = await db
      .from('card_admins').select('id')
      .eq('card_slug', cardSlug).eq('email', session.email).is('revoked_at', null)
      .in('role', PARENT_ROLES).limit(1).maybeSingle();
    if (aErr) return jsonResponse(500, { error: aErr.message });
    if (!admin) return jsonResponse(403, { error: 'No eres tutor de esta ficha' });

    // Club: debe estar conectado a Stripe, aceptar cobros y tener cuota.
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, name, stripe_connect_account_id, stripe_connect_charges_enabled, cantera_monthly_fee_cents, deleted_at')
      .eq('id', card.organization_id).maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return jsonResponse(409, { error: 'Club no disponible' });
    if (!org.stripe_connect_account_id || !org.stripe_connect_charges_enabled) {
      return jsonResponse(409, { error: 'El club aún no acepta pagos online' });
    }
    if (!org.cantera_monthly_fee_cents || org.cantera_monthly_fee_cents <= 0) {
      return jsonResponse(409, { error: 'El club no ha configurado la cuota mensual' });
    }

    // Una sola cuota activa por jugador.
    const { data: existing } = await db
      .from('parent_subscriptions').select('id')
      .eq('card_slug', cardSlug).is('canceled_at', null).limit(1).maybeSingle();
    if (existing) return jsonResponse(409, { error: 'Ya hay una cuota activa para este jugador' });

    const feeBps = parseInt(process.env.STRIPE_PLATFORM_FEE_BPS, 10) || 0;
    const appFeePercent = feeBps > 0 ? feeBps / 100 : null; // bps → %

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const metadata = {
      kind: 'cantera-parent-fee',
      card_slug: cardSlug,
      org_id: org.id,
      parent_email: session.email,
    };

    const subscriptionData = { metadata };
    if (appFeePercent) subscriptionData.application_fee_percent = appFeePercent;

    try {
      const checkout = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: `Cuota mensual · ${org.name} · ${card.nombre || cardSlug}` },
            unit_amount: org.cantera_monthly_fee_cents,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        customer_email: session.email,
        subscription_data: subscriptionData,
        metadata,
        success_url: `${siteUrl}/panel.html?fee=done`,
        cancel_url: `${siteUrl}/panel.html?fee=cancel`,
      }, { stripeAccount: org.stripe_connect_account_id });

      return jsonResponse(200, { ok: true, url: checkout.url });
    } catch (err) {
      console.error('create-parent-checkout: Stripe error:', err.message);
      return jsonResponse(502, { error: 'No se pudo iniciar el pago' });
    }
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
