'use strict';

// Webhook Cantera (capa 4d) · cierra el carril de cobros.
//
// Lo invoca stripe-webhook.js para eventos cuyo metadata.kind ∈
// {cantera-parent-fee, cantera-print} y para account.updated de Connect.
// Materializa parent_subscriptions, marca card_print_orders pagados y
// refresca los flags de la cuenta conectada del club.
//
// Las cuotas padre→club son direct charges en la cuenta conectada, así
// que sus eventos llegan con event.account (la cuenta del club) y, según
// la config, firmados con STRIPE_CONNECT_WEBHOOK_SECRET. La verificación
// dual vive en stripe-webhook.js; aquí solo está la lógica de negocio.

const { isDueNow } = require('./enrollment-charges');

const PARENT_FEE_KIND = 'cantera-parent-fee';
const PRINT_KIND = 'cantera-print';
const PLAN_KIND = 'cantera-plan';

function feeBps() { return parseInt(process.env.STRIPE_PLATFORM_FEE_BPS, 10) || 0; }
function tsFromUnix(s) { return s ? new Date(s * 1000).toISOString() : null; }

// account.updated → refresca charges/payouts_enabled del club.
async function handleAccountUpdated({ db, account }) {
  if (!account || !account.id) return { ok: false, reason: 'no_account' };
  const { error } = await db.from('organizations')
    .update({
      stripe_connect_charges_enabled: !!account.charges_enabled,
      stripe_connect_payouts_enabled: !!account.payouts_enabled,
    })
    .eq('stripe_connect_account_id', account.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// checkout.session.completed (kind=cantera-parent-fee) → materializa la
// fila parent_subscriptions. Idempotente: upsert por stripe_subscription_id.
//
// La inscripción de temporada (capa I2) reusa este kind pero añade
// metadata extra: matricula_cents (one-shot vía add_invoice_items),
// monthly_fee_cents y enrollment_campaign_id. Cuando vienen, se snapshotean
// en la fila y la matrícula queda marcada como pagada (matricula_paid_at).
// El alta de cuota suelta (create-parent-checkout) no los lleva → se
// comporta igual que antes.
async function handleParentCheckoutCompleted({ db, session }) {
  const m = session.metadata || {};
  if (m.kind !== PARENT_FEE_KIND) return { ok: false, reason: 'not_parent_fee' };
  if (!session.subscription) return { ok: false, reason: 'no_subscription' };

  const monthly = parseInt(m.monthly_fee_cents, 10);
  const matricula = parseInt(m.matricula_cents, 10);
  const hasMatricula = Number.isInteger(matricula) && matricula > 0;

  const row = {
    card_slug: m.card_slug,
    organization_id: m.org_id,
    parent_email: m.parent_email,
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: session.subscription,
    // amount_cents = cuota recurrente. Si la metadata trae la cuota
    // explícita (inscripción), úsala; si no, cae a amount_total (cuota
    // suelta sin matrícula, donde amount_total == cuota).
    amount_cents: Number.isInteger(monthly) && monthly > 0
      ? monthly
      : (session.amount_total != null ? session.amount_total : 0),
    application_fee_bps: feeBps(),
    status: 'active',
  };
  if (m.enrollment_campaign_id) row.enrollment_campaign_id = m.enrollment_campaign_id;
  if (hasMatricula) {
    row.matricula_cents = matricula;
    row.matricula_paid_at = new Date().toISOString();
  }

  const { error } = await db.from('parent_subscriptions')
    .upsert(row, { onConflict: 'stripe_subscription_id' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, subscription_id: session.subscription };
}

// customer.subscription.{created,updated,deleted} (kind=cantera-parent-fee)
// → actualiza estado/periodo/importe. deleted marca canceled.
async function handleParentSubscription({ db, subscription, deleted = false }) {
  const m = subscription.metadata || {};
  if (m.kind !== PARENT_FEE_KIND) return { ok: false, reason: 'not_parent_fee' };
  const patch = {
    status: deleted ? 'canceled' : subscription.status,
    current_period_end: tsFromUnix(subscription.current_period_end),
  };
  if (deleted) patch.canceled_at = new Date().toISOString();
  const amount = subscription.items && subscription.items.data && subscription.items.data[0]
    && subscription.items.data[0].price && subscription.items.data[0].price.unit_amount;
  if (amount != null) patch.amount_cents = amount;
  const { error } = await db.from('parent_subscriptions')
    .update(patch).eq('stripe_subscription_id', subscription.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// checkout.session.completed (kind=cantera-print) → carnets pagados.
async function handlePrintCheckoutCompleted({ db, session }) {
  const m = session.metadata || {};
  if (m.kind !== PRINT_KIND) return { ok: false, reason: 'not_print' };
  const { error } = await db.from('card_print_orders')
    .update({ status: 'paid' })
    .eq('stripe_payment_intent_id', session.id)
    .eq('status', 'pending');
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// checkout.session.completed (kind=cantera-plan) → cierra el alta del plan
// a medida: guarda el mandato (customer + payment_method) en los cargos del
// jugador para que el cron cobre los plazos futuros, y marca pagados los
// conceptos que vencían ya (cobrados en este checkout). Necesita stripe +
// account (cuenta conectada del club) para resolver el payment_method.
async function handlePlanCheckoutCompleted({ db, stripe, session, account }) {
  const m = session.metadata || {};
  if (m.kind !== PLAN_KIND) return { ok: false, reason: 'not_plan' };
  const cardSlug = m.card_slug;
  if (!cardSlug) return { ok: false, reason: 'no_card_slug' };

  const customerId = session.customer || null;

  // Resolver el método guardado (mandato SEPA/tarjeta) para cobros futuros.
  let paymentMethodId = null;
  try {
    const opts = account ? { stripeAccount: account } : {};
    if (session.mode === 'setup' && session.setup_intent && stripe) {
      const si = await stripe.setupIntents.retrieve(session.setup_intent, opts);
      paymentMethodId = si && si.payment_method ? String(si.payment_method) : null;
    } else if (session.payment_intent && stripe) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, opts);
      paymentMethodId = pi && pi.payment_method ? String(pi.payment_method) : null;
    }
  } catch (e) {
    // Sin método resuelto guardamos al menos el customer; el cron lo
    // reintentará o el admin reenvía. No bloqueamos el webhook.
    console.log('cantera plan: no se pudo resolver payment_method:', e.message);
  }

  // Guarda customer + mandato en TODOS los cargos pendientes del jugador.
  const patch = { stripe_customer_id: customerId };
  if (paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;
  const { error: upErr } = await db.from('enrollment_charges')
    .update(patch).eq('card_slug', cardSlug).eq('status', 'scheduled');
  if (upErr) return { ok: false, reason: upErr.message };

  // Marca pagados los conceptos que vencían ya (cobro combinado en este
  // checkout). Se identifican por fecha, mismo criterio que el endpoint.
  let paidNow = 0;
  if (session.mode === 'payment') {
    const asOf = new Date().toISOString().slice(0, 10);
    const { data: charges } = await db.from('enrollment_charges')
      .select('id, due_date').eq('card_slug', cardSlug).eq('status', 'scheduled');
    const dueNowIds = (charges || []).filter(c => isDueNow(c.due_date, asOf)).map(c => c.id);
    if (dueNowIds.length) {
      const { error: paidErr } = await db.from('enrollment_charges')
        .update({ status: 'paid', paid_at: new Date().toISOString() }).in('id', dueNowIds);
      if (paidErr) return { ok: false, reason: paidErr.message };
      paidNow = dueNowIds.length;
    }
  }

  return { ok: true, card_slug: cardSlug, paid_now: paidNow };
}

// Discriminadores que usa stripe-webhook.js para enrutar.
function isParentFeeSubscription(subscription) {
  return !!(subscription && subscription.metadata && subscription.metadata.kind === PARENT_FEE_KIND);
}
function isParentFeeInvoice(invoice) {
  const md = invoice && invoice.subscription_details && invoice.subscription_details.metadata;
  return !!(md && md.kind === PARENT_FEE_KIND);
}

module.exports = {
  PARENT_FEE_KIND,
  PRINT_KIND,
  PLAN_KIND,
  handleAccountUpdated,
  handleParentCheckoutCompleted,
  handleParentSubscription,
  handlePrintCheckoutCompleted,
  handlePlanCheckoutCompleted,
  isParentFeeSubscription,
  isParentFeeInvoice,
};
