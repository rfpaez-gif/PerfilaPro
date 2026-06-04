'use strict';

// POST /api/create-enrollment-checkout { card_slug, campaign_id? }
//   Cantera · inscripción de temporada (capa I2)
//
// Genera la Checkout Session que cobra, en un solo pago:
//   - cuota mensual recurrente (subscription) +
//   - matrícula one-shot (add_invoice_items).
// Direct charge en la cuenta conectada del club, SEPA + tarjeta, con
// application_fee para PerfilaPro. La fila parent_subscriptions la
// materializa el webhook (capa 4d, enriquecido) al confirmarse el pago.
//
// Auth: JWT parent-panel (tutor) — mismo patrón que create-parent-checkout.
// La lo invoca el flujo de inscripción (I4) tras crear la ficha, o el
// padre desde su panel si eligió "pagar online" más tarde.
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { isPlayer } = require('./lib/card-kind');
const { buildEnrollmentSessionParams, buildPlanCheckoutSessionParams } = require('./lib/enrollment-checkout');
const { readPlan } = require('./lib/enrollment-campaign');
const { splitPlanByDue, sumCents, applicationFeeCents, buildChargeRows } = require('./lib/enrollment-charges');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

const PARENT_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self'];

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// Carril PLAN: materializa los cargos del plan e inicia el Checkout que
// cobra lo que vence ya + guarda el mandato. Idempotente por jugador: si ya
// hay cargos no cancelados, no duplica.
async function handlePlanCheckout({ db, stripe, org, card, parentEmail, plan, campaignId, feeBps, siteUrl }) {
  // Guard idempotencia: un plan activo por jugador.
  const { data: existing } = await db
    .from('enrollment_charges').select('id')
    .eq('card_slug', card.slug).neq('status', 'canceled').limit(1).maybeSingle();
  if (existing) return jsonResponse(409, { error: 'Ya hay un plan de pagos activo para este jugador' });

  const asOf = new Date().toISOString().slice(0, 10);
  const { dueNow } = splitPlanByDue(plan, asOf);
  const dueNowTotal = sumCents(dueNow);
  const dueNowFeeCents = applicationFeeCents(dueNowTotal, feeBps);

  // Materializa los cargos (todos 'scheduled'; el webhook marcará pagados
  // los que vencen ya y guardará el mandato en todos para el cron).
  const rows = buildChargeRows({ plan, cardSlug: card.slug, orgId: org.id, campaignId, feeBps });
  const { error: insErr } = await db.from('enrollment_charges').insert(rows);
  if (insErr) return jsonResponse(500, { error: insErr.message });

  const { params, options } = buildPlanCheckoutSessionParams({
    org, card, parentEmail, dueNowConcepts: dueNow, dueNowFeeCents, campaignId, siteUrl,
  });

  try {
    const checkout = await stripe.checkout.sessions.create(params, options);
    return jsonResponse(200, { ok: true, url: checkout.url, plan: true });
  } catch (err) {
    console.error('create-enrollment-checkout: Stripe error (plan):', err.message);
    return jsonResponse(502, { error: 'No se pudo iniciar el pago' });
  }
}

function makeHandler(stripe, db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!stripe) return jsonResponse(503, { error: 'Stripe no configurado' });

    const rl = checkRateLimit(event, { bucket: 'create-enrollment-checkout', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

    // Card del jugador.
    const { data: card, error: cardErr } = await db
      .from('cards').select('slug, card_kind, nombre, organization_id, deleted_at')
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

    // Club: conectado, acepta cobros y tiene cuota configurada.
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, name, stripe_connect_account_id, stripe_connect_charges_enabled, cantera_monthly_fee_cents, deleted_at')
      .eq('id', card.organization_id).maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return jsonResponse(409, { error: 'Club no disponible' });
    if (!org.stripe_connect_account_id || !org.stripe_connect_charges_enabled) {
      return jsonResponse(409, { error: 'El club aún no acepta pagos online' });
    }

    const feeBps = parseInt(process.env.STRIPE_PLATFORM_FEE_BPS, 10) || 0;
    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    // Campaña (opcional): si viene campaign_id, sus importes mandan sobre
    // la cuota base del club. Debe pertenecer al mismo club y estar abierta.
    let campaignId = null;
    let monthlyFeeCents = org.cantera_monthly_fee_cents;
    let matriculaCents = 0;
    let plan = [];
    const reqCampaignId = (body.campaign_id || '').trim();
    if (reqCampaignId) {
      const { data: campaign, error: cErr } = await db
        .from('enrollment_campaigns')
        .select('id, organization_id, status, matricula_cents, monthly_fee_cents, concepts_jsonb')
        .eq('id', reqCampaignId).maybeSingle();
      if (cErr) return jsonResponse(500, { error: cErr.message });
      if (!campaign || campaign.organization_id !== org.id || campaign.status !== 'open') {
        return jsonResponse(409, { error: 'Campaña de inscripción no disponible' });
      }
      campaignId = campaign.id;
      plan = readPlan(campaign.concepts_jsonb);
      if (Number.isInteger(campaign.monthly_fee_cents) && campaign.monthly_fee_cents > 0) {
        monthlyFeeCents = campaign.monthly_fee_cents;
      }
      if (Number.isInteger(campaign.matricula_cents) && campaign.matricula_cents > 0) {
        matriculaCents = campaign.matricula_cents;
      }
    }

    // ── Carril PLAN a medida ────────────────────────────────────────────
    // Si la campaña tiene conceptos, cobramos el plan (lo que vence ya +
    // mandato para los plazos futuros) en vez de la suscripción mensual.
    if (plan.length > 0) {
      return await handlePlanCheckout({
        db, stripe, org, card, parentEmail: session.email, plan, campaignId, feeBps, siteUrl,
      });
    }

    // ── Carril suscripción mensual (modelo original) ────────────────────
    // Una sola cuota activa por jugador.
    const { data: existing } = await db
      .from('parent_subscriptions').select('id')
      .eq('card_slug', cardSlug).is('canceled_at', null).limit(1).maybeSingle();
    if (existing) return jsonResponse(409, { error: 'Ya hay una cuota activa para este jugador' });

    if (!monthlyFeeCents || monthlyFeeCents <= 0) {
      return jsonResponse(409, { error: 'El club no ha configurado la cuota mensual' });
    }

    const { params, options } = buildEnrollmentSessionParams({
      org, card, parentEmail: session.email,
      monthlyFeeCents, matriculaCents, campaignId, feeBps, siteUrl,
    });

    try {
      const checkout = await stripe.checkout.sessions.create(params, options);
      return jsonResponse(200, { ok: true, url: checkout.url });
    } catch (err) {
      console.error('create-enrollment-checkout: Stripe error:', err.message);
      return jsonResponse(502, { error: 'No se pudo iniciar el pago' });
    }
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
