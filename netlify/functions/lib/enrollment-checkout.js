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
  buildEnrollmentSessionParams,
};
