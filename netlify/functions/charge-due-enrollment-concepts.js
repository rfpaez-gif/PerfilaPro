'use strict';

// Cron diario · Cantera (Fase 3) · cobra los plazos futuros del plan de
// pagos a medida cuando llega su fecha.
//
// Busca los enrollment_charges 'scheduled' ya vencidos que tienen mandato
// guardado (customer + payment_method, los puso el webhook del checkout) y
// crea un PaymentIntent off-session en la cuenta conectada del club, con
// nuestra application_fee. SEPA liquida en diferido → el cargo queda
// 'processing' y lo cierra el webhook payment_intent.{succeeded,failed}.
//
// Idempotencia: la creación del PI usa idempotencyKey por cargo, así que un
// re-run no duplica el cobro en Stripe. Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { isCanteraActive } = require('./lib/cantera-flag');
const { PLAN_KIND } = require('./lib/enrollment-checkout');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

const BATCH = 200;

async function processDueCharges(stripe, db, asOf) {
  const { data: charges, error } = await db
    .from('enrollment_charges')
    .select('id, card_slug, organization_id, amount_cents, currency, application_fee_cents, stripe_customer_id, stripe_payment_method_id, attempts')
    .eq('status', 'scheduled')
    .lte('due_date', asOf)
    .not('stripe_customer_id', 'is', null)
    .not('stripe_payment_method_id', 'is', null)
    .limit(BATCH);
  if (error) { console.error('charge cron: query error', error.message); return { charged: 0, failed: 0 }; }
  if (!charges || !charges.length) return { charged: 0, failed: 0 };

  // Cuentas Connect de los clubes implicados (una query, no N).
  const orgIds = [...new Set(charges.map(c => c.organization_id))];
  const { data: orgs } = await db.from('organizations')
    .select('id, stripe_connect_account_id').in('id', orgIds);
  const acctById = {};
  (orgs || []).forEach(o => { acctById[o.id] = o.stripe_connect_account_id; });

  let charged = 0, failed = 0, skipped = 0;
  for (const ch of charges) {
    const account = acctById[ch.organization_id];
    if (!account) { skipped++; continue; } // club sin cuenta → no se cobra
    try {
      const params = {
        amount: ch.amount_cents,
        currency: ch.currency || 'eur',
        customer: ch.stripe_customer_id,
        payment_method: ch.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: { kind: PLAN_KIND, charge_id: ch.id, card_slug: ch.card_slug, org_id: ch.organization_id },
      };
      if (ch.application_fee_cents > 0) params.application_fee_amount = ch.application_fee_cents;
      const pi = await stripe.paymentIntents.create(
        params,
        { stripeAccount: account, idempotencyKey: 'enrcharge_' + ch.id }
      );
      // succeeded (tarjeta) → paid; processing (SEPA) → processing y lo cierra
      // el webhook. Cualquier otro estado lo dejamos en processing a la espera.
      const status = pi.status === 'succeeded' ? 'paid' : 'processing';
      const patch = { status, stripe_payment_intent_id: pi.id, attempts: (ch.attempts || 0) + 1 };
      if (status === 'paid') patch.paid_at = new Date().toISOString();
      await db.from('enrollment_charges').update(patch).eq('id', ch.id);
      charged++;
    } catch (e) {
      await db.from('enrollment_charges')
        .update({ status: 'failed', last_error: e.message, attempts: (ch.attempts || 0) + 1 })
        .eq('id', ch.id);
      failed++;
    }
  }
  return { charged, failed, skipped };
}

function makeHandler(stripe, db) {
  return async () => {
    if (!isCanteraActive()) return { statusCode: 200, body: JSON.stringify({ skipped: 'cantera_off' }) };
    if (!stripe) return { statusCode: 200, body: JSON.stringify({ skipped: 'no_stripe' }) };
    const asOf = new Date().toISOString().slice(0, 10);
    const res = await processDueCharges(stripe, db, asOf);
    console.log('charge-due-enrollment-concepts:', JSON.stringify(res));
    return { statusCode: 200, body: JSON.stringify(res) };
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
exports.processDueCharges = processDueCharges;
