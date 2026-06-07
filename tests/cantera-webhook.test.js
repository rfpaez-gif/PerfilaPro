import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as cw from '../netlify/functions/lib/cantera-webhook.js';
import { makeHandler } from '../netlify/functions/stripe-webhook.js';

const resolve = (v) => () => Promise.resolve(v);

// ───────────────────────── lib ─────────────────────────

describe('handleAccountUpdated', () => {
  it('refresca flags por stripe_connect_account_id', async () => {
    const updates = [];
    const db = { from: () => ({ update: (p) => { updates.push(p); return { eq: resolve({ error: null }) }; } }) };
    const r = await cw.handleAccountUpdated({ db, account: { id: 'acct_1', charges_enabled: true, payouts_enabled: false } });
    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual({ stripe_connect_charges_enabled: true, stripe_connect_payouts_enabled: false });
  });
  it('falla sin account', async () => {
    expect((await cw.handleAccountUpdated({ db: {}, account: null })).ok).toBe(false);
  });
});

describe('handleParentCheckoutCompleted', () => {
  function db() { const ups = []; return { ups, from: () => ({ upsert: (row, opts) => { ups.push([row, opts]); return Promise.resolve({ error: null }); } }) }; }
  it('upsert parent_subscriptions por stripe_subscription_id', async () => {
    const d = db();
    const session = { subscription: 'sub_1', customer: 'cus_1', amount_total: 3000, metadata: { kind: 'cantera-parent-fee', card_slug: 'p-1', org_id: 'club-1', parent_email: 't@e.es' } };
    const r = await cw.handleParentCheckoutCompleted({ db: d, session });
    expect(r.ok).toBe(true);
    expect(d.ups[0][0]).toMatchObject({ stripe_subscription_id: 'sub_1', card_slug: 'p-1', organization_id: 'club-1', parent_email: 't@e.es', status: 'active' });
    expect(d.ups[0][1]).toEqual({ onConflict: 'stripe_subscription_id' });
  });
  it('ignora si no es parent-fee', async () => {
    expect((await cw.handleParentCheckoutCompleted({ db: db(), session: { metadata: { kind: 'other' } } })).ok).toBe(false);
  });
  it('ignora si no hay subscription', async () => {
    expect((await cw.handleParentCheckoutCompleted({ db: db(), session: { metadata: { kind: 'cantera-parent-fee' } } })).reason).toBe('no_subscription');
  });

  it('inscripción I2: snapshotea matrícula + campaña y marca matricula_paid_at', async () => {
    const d = db();
    const session = {
      subscription: 'sub_2', customer: 'cus_2', amount_total: 6500,
      metadata: { kind: 'cantera-parent-fee', card_slug: 'p-9', org_id: 'club-1', parent_email: 't@e.es',
        monthly_fee_cents: '3000', matricula_cents: '3500', enrollment_campaign_id: 'camp-1' },
    };
    const r = await cw.handleParentCheckoutCompleted({ db: d, session });
    expect(r.ok).toBe(true);
    const row = d.ups[0][0];
    expect(row.amount_cents).toBe(3000);            // cuota recurrente, no amount_total
    expect(row.matricula_cents).toBe(3500);
    expect(row.matricula_paid_at).toBeTruthy();
    expect(row.enrollment_campaign_id).toBe('camp-1');
  });

  it('cuota suelta sin matrícula: amount_cents cae a amount_total, sin campos extra', async () => {
    const d = db();
    const session = { subscription: 'sub_3', amount_total: 3000, metadata: { kind: 'cantera-parent-fee', card_slug: 'p-1', org_id: 'c1', parent_email: 'e@e.es' } };
    await cw.handleParentCheckoutCompleted({ db: d, session });
    const row = d.ups[0][0];
    expect(row.amount_cents).toBe(3000);
    expect(row).not.toHaveProperty('matricula_cents');
    expect(row).not.toHaveProperty('matricula_paid_at');
  });
});

describe('handleParentSubscription', () => {
  function db() { const u = []; return { u, from: () => ({ update: (p) => { u.push(p); return { eq: resolve({ error: null }) }; } }) }; }
  const sub = { id: 'sub_1', status: 'active', current_period_end: 1700000000, metadata: { kind: 'cantera-parent-fee' }, items: { data: [{ price: { unit_amount: 3000 } }] } };
  it('actualiza estado/periodo/importe', async () => {
    const d = db();
    const r = await cw.handleParentSubscription({ db: d, subscription: sub });
    expect(r.ok).toBe(true);
    expect(d.u[0].status).toBe('active');
    expect(d.u[0].amount_cents).toBe(3000);
    expect(d.u[0].current_period_end).toMatch(/^20\d\d-/);
  });
  it('deleted marca canceled + canceled_at', async () => {
    const d = db();
    await cw.handleParentSubscription({ db: d, subscription: sub, deleted: true });
    expect(d.u[0].status).toBe('canceled');
    expect(d.u[0].canceled_at).toBeTruthy();
  });
  it('ignora si no es parent-fee', async () => {
    expect((await cw.handleParentSubscription({ db: db(), subscription: { id: 's', metadata: {} } })).ok).toBe(false);
  });
});

describe('handlePrintCheckoutCompleted', () => {
  it('marca card_print_orders paid por session id', async () => {
    const chain = []; let lastEq;
    const db = { from: () => ({ update: (p) => { chain.push(p); return { eq: (c, v) => { lastEq = [c, v]; return { eq: resolve({ error: null }) }; } }; } }) };
    const r = await cw.handlePrintCheckoutCompleted({ db, session: { id: 'cs_1', metadata: { kind: 'cantera-print' } } });
    expect(r.ok).toBe(true);
    expect(chain[0]).toEqual({ status: 'paid' });
    expect(lastEq).toEqual(['stripe_payment_intent_id', 'cs_1']);
  });
});

describe('handlePlanCheckoutCompleted', () => {
  // db que captura los patches y devuelve los cargos 'scheduled'.
  function planDb(scheduled) {
    const calls = { updates: [], paidIds: null };
    const updateChain = (patch) => {
      calls.updates.push(patch);
      const node = {
        eq: () => node,
        in: (_col, ids) => { calls.paidIds = ids; return Promise.resolve({ error: null }); },
        then: (res) => Promise.resolve({ error: null }).then(res),
      };
      return node;
    };
    const selectChain = () => {
      const node = { eq: () => node, then: (res) => Promise.resolve({ data: scheduled, error: null }).then(res) };
      return node;
    };
    return { calls, from: () => ({ update: updateChain, select: selectChain }) };
  }
  const stripe = { paymentIntents: { retrieve: vi.fn().mockResolvedValue({ payment_method: 'pm_x' }) }, setupIntents: { retrieve: vi.fn() } };

  it('guarda customer+mandato en todos y marca pagado lo que vence ya', async () => {
    const scheduled = [
      { id: 'c1', due_date: '2020-01-01' }, // ya vencido → due now
      { id: 'c2', due_date: '2099-01-01' }, // futuro → queda scheduled
    ];
    const db = planDb(scheduled);
    const session = { mode: 'payment', customer: 'cus_1', payment_intent: 'pi_1', metadata: { kind: 'cantera-plan', card_slug: 'p-1' } };
    const r = await cw.handlePlanCheckoutCompleted({ db, stripe, session, account: 'acct_1' });
    expect(r.ok).toBe(true);
    expect(r.card_slug).toBe('p-1');
    expect(r.paid_now).toBe(1);
    expect(db.calls.updates[0]).toMatchObject({ stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_x' });
    expect(db.calls.paidIds).toEqual(['c1']);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { stripeAccount: 'acct_1' });
  });

  it('modo setup: guarda el mandato y no marca nada pagado', async () => {
    const db = planDb([{ id: 'c1', due_date: '2099-01-01' }]);
    const stripeSetup = { paymentIntents: { retrieve: vi.fn() }, setupIntents: { retrieve: vi.fn().mockResolvedValue({ payment_method: 'pm_s' }) } };
    const session = { mode: 'setup', customer: 'cus_2', setup_intent: 'si_1', metadata: { kind: 'cantera-plan', card_slug: 'p-2' } };
    const r = await cw.handlePlanCheckoutCompleted({ db, stripe: stripeSetup, session, account: 'acct_1' });
    expect(r.ok).toBe(true);
    expect(r.paid_now).toBe(0);
    expect(db.calls.paidIds).toBeNull();
    expect(stripeSetup.setupIntents.retrieve).toHaveBeenCalled();
  });

  it('carnet embebido: crea card_print_orders paid e idempotente por session', async () => {
    const orders = [];
    let existing = null;
    const db = {
      from: (t) => {
        if (t === 'card_print_orders') return {
          select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }) }),
          insert: (row) => { orders.push(row); return Promise.resolve({ error: null }); },
        };
        const node = { eq: () => node, in: () => Promise.resolve({ error: null }), then: (res) => Promise.resolve({ data: [], error: null }).then(res) };
        return { update: () => node, select: () => node };
      },
    };
    const session = { mode: 'payment', id: 'cs_123', customer: 'cus_1', payment_intent: 'pi_1', metadata: { kind: 'cantera-plan', card_slug: 'p-9', org_id: 'club-1', carnet_fee_cents: '1200' } };
    const r = await cw.handlePlanCheckoutCompleted({ db, stripe, session, account: 'acct_1' });
    expect(r.carnet_order).toBe(true);
    expect(orders[0]).toMatchObject({ card_slug: 'p-9', kind: 'setup', status: 'paid', amount_cents: 1200, stripe_payment_intent_id: 'cs_123' });
    // Replay: pedido ya existe → no duplica.
    existing = { id: 'o1' }; orders.length = 0;
    const r2 = await cw.handlePlanCheckoutCompleted({ db, stripe, session, account: 'acct_1' });
    expect(r2.carnet_order).toBe(false);
    expect(orders).toHaveLength(0);
  });

  it('ignora sesiones de otro kind', async () => {
    const r = await cw.handlePlanCheckoutCompleted({ db: planDb([]), stripe, session: { metadata: { kind: 'other' } } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_plan');
  });
});

describe('handlePlanPaymentIntent', () => {
  function db() { const ups = []; return { ups, from: () => ({ update: (p) => { ups.push(p); return { eq: (_c, id) => { ups[ups.length - 1]._id = id; return Promise.resolve({ error: null }); } }; } }) }; }

  it('succeeded con charge_id → marca el cargo paid', async () => {
    const d = db();
    const pi = { id: 'pi_9', metadata: { kind: 'cantera-plan', charge_id: 'c1' } };
    const r = await cw.handlePlanPaymentIntent({ db: d, paymentIntent: pi, failed: false });
    expect(r.ok).toBe(true);
    expect(d.ups[0]).toMatchObject({ status: 'paid', stripe_payment_intent_id: 'pi_9', _id: 'c1' });
  });

  it('payment_failed → marca failed con last_error', async () => {
    const d = db();
    const pi = { id: 'pi_9', metadata: { kind: 'cantera-plan', charge_id: 'c1' }, last_payment_error: { message: 'insufficient_funds' } };
    const r = await cw.handlePlanPaymentIntent({ db: d, paymentIntent: pi, failed: true });
    expect(r.ok).toBe(true);
    expect(d.ups[0]).toMatchObject({ status: 'failed', last_error: 'insufficient_funds' });
  });

  it('ignora el PI combinado del checkout (sin charge_id)', async () => {
    const r = await cw.handlePlanPaymentIntent({ db: db(), paymentIntent: { metadata: { kind: 'cantera-plan' } } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_charge_id');
  });

  it('isPlanPaymentIntent discrimina por kind + charge_id', () => {
    expect(cw.isPlanPaymentIntent({ metadata: { kind: 'cantera-plan', charge_id: 'c1' } })).toBe(true);
    expect(cw.isPlanPaymentIntent({ metadata: { kind: 'cantera-plan' } })).toBe(false);
    expect(cw.isPlanPaymentIntent({ metadata: { kind: 'other', charge_id: 'c1' } })).toBe(false);
  });
});

describe('discriminadores', () => {
  it('isParentFeeSubscription / isParentFeeInvoice', () => {
    expect(cw.isParentFeeSubscription({ metadata: { kind: 'cantera-parent-fee' } })).toBe(true);
    expect(cw.isParentFeeSubscription({ metadata: { kind: 'org-subscription' } })).toBe(false);
    expect(cw.isParentFeeInvoice({ subscription_details: { metadata: { kind: 'cantera-parent-fee' } } })).toBe(true);
    expect(cw.isParentFeeInvoice({})).toBe(false);
  });
});

// ──────────────── stripe-webhook routing ────────────────

function stripeWith(eventObj) {
  return { webhooks: { constructEvent: vi.fn(() => eventObj) } };
}
function ev() { return { httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }; }

describe('stripe-webhook · enrutado Cantera', () => {
  beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = 'whsec'; });
  afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });

  it('account.updated → refresca flags del club', async () => {
    const updates = [];
    const db = { from: () => ({ update: (p) => { updates.push(p); return { eq: resolve({ error: null }) }; } }) };
    const stripe = stripeWith({ type: 'account.updated', data: { object: { id: 'acct_1', charges_enabled: true, payouts_enabled: true } } });
    const res = await makeHandler(stripe, db)(ev());
    expect(res.statusCode).toBe(200);
    expect(updates[0]).toEqual({ stripe_connect_charges_enabled: true, stripe_connect_payouts_enabled: true });
  });

  it('checkout.session.completed kind=cantera-parent-fee → upsert parent_subscriptions', async () => {
    const ups = [];
    const db = { from: (t) => t === 'parent_subscriptions' ? { upsert: (r, o) => { ups.push(r); return Promise.resolve({ error: null }); } } : {} };
    const stripe = stripeWith({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_9', customer: 'cus', amount_total: 2500, metadata: { kind: 'cantera-parent-fee', card_slug: 'p-1', org_id: 'c1', parent_email: 'e@e.es' } } } });
    const res = await makeHandler(stripe, db)(ev());
    expect(res.statusCode).toBe(200);
    expect(ups[0].stripe_subscription_id).toBe('sub_9');
  });

  it('checkout.session.completed kind=cantera-print → carnets paid', async () => {
    const updated = [];
    const db = { from: (t) => t === 'card_print_orders' ? { update: (p) => { updated.push(p); return { eq: () => ({ eq: resolve({ error: null }) }) }; } } : {} };
    const stripe = stripeWith({ type: 'checkout.session.completed', data: { object: { id: 'cs_5', metadata: { kind: 'cantera-print' } } } });
    const res = await makeHandler(stripe, db)(ev());
    expect(res.statusCode).toBe(200);
    expect(updated[0]).toEqual({ status: 'paid' });
  });

  it('customer.subscription.updated parent-fee → handleParentSubscription', async () => {
    const u = [];
    const db = { from: () => ({ update: (p) => { u.push(p); return { eq: resolve({ error: null }) }; } }) };
    const stripe = stripeWith({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: 1700000000, metadata: { kind: 'cantera-parent-fee' }, items: { data: [{ price: { unit_amount: 3000 } }] } } } });
    const res = await makeHandler(stripe, db)(ev());
    expect(res.statusCode).toBe(200);
    expect(u[0].status).toBe('active');
  });

  it('firma inválida → 400', async () => {
    const stripe = { webhooks: { constructEvent: vi.fn(() => { throw new Error('bad sig'); }) } };
    const res = await makeHandler(stripe, {})(ev());
    expect(res.statusCode).toBe(400);
  });
});
