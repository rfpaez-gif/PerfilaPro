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

const PARENT_FEE_KIND = 'cantera-parent-fee';
const PRINT_KIND = 'cantera-print';

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
async function handleParentCheckoutCompleted({ db, session }) {
  const m = session.metadata || {};
  if (m.kind !== PARENT_FEE_KIND) return { ok: false, reason: 'not_parent_fee' };
  if (!session.subscription) return { ok: false, reason: 'no_subscription' };
  const row = {
    card_slug: m.card_slug,
    organization_id: m.org_id,
    parent_email: m.parent_email,
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: session.subscription,
    amount_cents: session.amount_total != null ? session.amount_total : 0,
    application_fee_bps: feeBps(),
    status: 'active',
  };
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
  handleAccountUpdated,
  handleParentCheckoutCompleted,
  handleParentSubscription,
  handlePrintCheckoutCompleted,
  isParentFeeSubscription,
  isParentFeeInvoice,
};
