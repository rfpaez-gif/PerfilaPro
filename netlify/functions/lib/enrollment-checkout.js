'use strict';

// Construcción de la Checkout Session de inscripción de temporada
// (capa I2 · docs/cantera-inscripcion-temporada.md §5/§11).
//
// La inscripción combina, en UN SOLO pago/checkout:
//   - CUOTA mensual recurrente  → line_items subscription.
//   - MATRÍCULA one-shot        → add_invoice_items (se cobra en la
//     primera factura de la suscripción, una sola vez).
// Direct charge sobre la cuenta conectada del club (Connect), con
// application_fee_percent para PerfilaPro. Métodos: SEPA + tarjeta.
//
// Reusa kind='cantera-parent-fee' para que el ciclo de vida de la
// suscripción (customer.subscription.*) y el invoice.paid ya enrutados
// en stripe-webhook funcionen sin tocar nada. La metadata extra
// (matricula_cents, enrollment_campaign_id, monthly_fee_cents) la lee el
// webhook enriquecido para materializar parent_subscriptions con la
// matrícula marcada.
//
// Lib PURO: no toca BD ni Stripe. Devuelve los params listos para
// stripe.checkout.sessions.create(params, { stripeAccount }).

const PARENT_FEE_KIND = 'cantera-parent-fee';
// Plan de pagos a medida (conceptos con fecha) cobrado por Stripe Connect.
const PLAN_KIND = 'cantera-plan';

// Construye la Checkout Session del PLAN de pagos a medida. A diferencia de
// la inscripción por suscripción, aquí:
//   - lo que vence ya (dueNowConcepts) se cobra en modo `payment`, con
//     setup_future_usage='off_session' para guardar el mandato SEPA/tarjeta
//     que el cron usará para los plazos futuros;
//   - si no vence nada al firmar, modo `setup` (solo guarda el mandato).
// Direct charge en la cuenta conectada del club, con application_fee_amount
// (céntimos) sobre el total que se cobra ahora.
//
// Entradas (ya resueltas por el endpoint):
//   org              — { id, name, stripe_connect_account_id }
//   card             — { slug, nombre }
//   parentEmail      — email del tutor
//   dueNowConcepts   — conceptos que se cobran al firmar (puede ser [])
//   dueNowFeeCents   — application_fee (céntimos) sobre el total de arriba
//   campaignId       — enrollment_campaigns.id (o null)
//   siteUrl          — base success/cancel
function buildPlanCheckoutSessionParams({
  org, card, parentEmail,
  dueNowConcepts = [], dueNowFeeCents = 0,
  campaignId = null, siteUrl = 'https://perfilapro.es',
}) {
  const metadata = {
    kind: PLAN_KIND,
    card_slug: card.slug,
    org_id: org.id,
    parent_email: parentEmail,
  };
  if (campaignId) metadata.enrollment_campaign_id = campaignId;

  const dueNow = (dueNowConcepts || []).filter(c => Number(c.amount_cents) > 0);
  const dueNowTotal = dueNow.reduce((s, c) => s + Number(c.amount_cents), 0);

  const base = {
    payment_method_types: ['card', 'sepa_debit'],
    customer_email: parentEmail,
    metadata,
    success_url: `${siteUrl}/panel.html?enroll=done`,
    cancel_url: `${siteUrl}/panel.html?enroll=cancel`,
  };

  let params;
  if (dueNowTotal > 0) {
    // Cobra lo que vence ya + guarda el método para los plazos futuros.
    const piData = { setup_future_usage: 'off_session', metadata };
    if (dueNowFeeCents > 0) piData.application_fee_amount = dueNowFeeCents;
    params = {
      ...base,
      mode: 'payment',
      customer_creation: 'always',
      line_items: dueNow.map(c => ({
        price_data: {
          currency: 'eur',
          product_data: { name: `${c.concepto} · ${org.name}` },
          unit_amount: Number(c.amount_cents),
        },
        quantity: 1,
      })),
      payment_intent_data: piData,
    };
  } else {
    // Nada vence al firmar → solo guardar el mandato (sin cobro).
    params = { ...base, mode: 'setup', setup_intent_data: { metadata } };
  }

  return { params, options: { stripeAccount: org.stripe_connect_account_id } };
}

// Construye los parámetros de la Checkout Session. Entradas (ya
// resueltas/validadas por el endpoint):
//   org            — { id, name, stripe_connect_account_id }
//   card           — { slug, nombre }
//   parentEmail    — email del tutor (de la sesión parent-panel)
//   monthlyFeeCents— cuota mensual (>0)
//   matriculaCents — matrícula one-shot (>=0; 0/null = sin matrícula)
//   campaignId     — enrollment_campaigns.id (o null si alta suelta)
//   feeBps         — STRIPE_PLATFORM_FEE_BPS (0 = sin application_fee)
//   siteUrl        — base para success/cancel
//
// Devuelve { params, options } donde options = { stripeAccount }.
function buildEnrollmentSessionParams({
  org, card, parentEmail,
  monthlyFeeCents, matriculaCents = 0,
  campaignId = null, feeBps = 0, siteUrl = 'https://perfilapro.es',
}) {
  const matricula = Number.isInteger(matriculaCents) && matriculaCents > 0 ? matriculaCents : 0;
  const appFeePercent = feeBps > 0 ? feeBps / 100 : null;

  const metadata = {
    kind: PARENT_FEE_KIND,
    card_slug: card.slug,
    org_id: org.id,
    parent_email: parentEmail,
    monthly_fee_cents: String(monthlyFeeCents),
  };
  if (matricula > 0) metadata.matricula_cents = String(matricula);
  if (campaignId) metadata.enrollment_campaign_id = campaignId;

  const subscriptionData = { metadata };
  if (appFeePercent) subscriptionData.application_fee_percent = appFeePercent;

  // La matrícula viaja como add_invoice_items: se factura una vez en la
  // primera invoice de la suscripción, no se repite en renovaciones.
  if (matricula > 0) {
    subscriptionData.add_invoice_items = [{
      price_data: {
        currency: 'eur',
        product_data: { name: `Matrícula · ${org.name}` },
        unit_amount: matricula,
      },
      quantity: 1,
    }];
  }

  const params = {
    mode: 'subscription',
    payment_method_types: ['card', 'sepa_debit'],
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: `Cuota mensual · ${org.name} · ${card.nombre || card.slug}` },
        unit_amount: monthlyFeeCents,
        recurring: { interval: 'month' },
      },
      quantity: 1,
    }],
    customer_email: parentEmail,
    subscription_data: subscriptionData,
    metadata,
    success_url: `${siteUrl}/panel.html?enroll=done`,
    cancel_url: `${siteUrl}/panel.html?enroll=cancel`,
  };

  return { params, options: { stripeAccount: org.stripe_connect_account_id } };
}

module.exports = {
  PARENT_FEE_KIND,
  PLAN_KIND,
  buildEnrollmentSessionParams,
  buildPlanCheckoutSessionParams,
};
