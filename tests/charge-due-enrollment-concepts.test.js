import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler, processDueCharges } from '../netlify/functions/charge-due-enrollment-concepts.js';

// db con la cadena exacta que usa el cron.
function cronDb({ charges = [], orgs = [], updates = [] }) {
  return {
    from: (t) => {
      if (t === 'enrollment_charges') {
        return {
          select: () => ({ eq: () => ({ lte: () => ({ not: () => ({ not: () => ({ limit: () => Promise.resolve({ data: charges, error: null }) }) }) }) }) }),
          update: (patch) => ({ eq: (_c, id) => { updates.push({ id, patch }); return Promise.resolve({ error: null }); } }),
        };
      }
      if (t === 'organizations') {
        return { select: () => ({ in: () => Promise.resolve({ data: orgs, error: null }) }) };
      }
      return {};
    },
  };
}

const CHARGE = {
  id: 'c1', card_slug: 'p-1', organization_id: 'club-1', amount_cents: 10000,
  currency: 'eur', application_fee_cents: 250, stripe_customer_id: 'cus_1',
  stripe_payment_method_id: 'pm_1', attempts: 0,
};
const ORGS = [{ id: 'club-1', stripe_connect_account_id: 'acct_1' }];

describe('processDueCharges', () => {
  it('cobra un cargo vencido off-session con application_fee + idempotencyKey y lo marca paid', async () => {
    const stripe = { paymentIntents: { create: vi.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded' }) } };
    const updates = [];
    const res = await processDueCharges(stripe, cronDb({ charges: [CHARGE], orgs: ORGS, updates }), '2026-10-01');
    expect(res.charged).toBe(1);
    const [params, opts] = stripe.paymentIntents.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 10000, currency: 'eur', customer: 'cus_1', payment_method: 'pm_1', off_session: true, confirm: true, application_fee_amount: 250 });
    expect(params.metadata).toMatchObject({ kind: 'cantera-plan', charge_id: 'c1' });
    expect(opts).toEqual({ stripeAccount: 'acct_1', idempotencyKey: 'enrcharge_c1' });
    expect(updates[0].patch).toMatchObject({ status: 'paid', stripe_payment_intent_id: 'pi_1', attempts: 1 });
    expect(updates[0].patch.paid_at).toBeTruthy();
  });

  it('SEPA en diferido (processing) → deja el cargo processing sin paid_at', async () => {
    const stripe = { paymentIntents: { create: vi.fn().mockResolvedValue({ id: 'pi_2', status: 'processing' }) } };
    const updates = [];
    const res = await processDueCharges(stripe, cronDb({ charges: [CHARGE], orgs: ORGS, updates }), '2026-10-01');
    expect(res.charged).toBe(1);
    expect(updates[0].patch.status).toBe('processing');
    expect(updates[0].patch.paid_at).toBeUndefined();
  });

  it('fallo de cobro → marca failed con last_error', async () => {
    const stripe = { paymentIntents: { create: vi.fn().mockRejectedValue(new Error('card_declined')) } };
    const updates = [];
    const res = await processDueCharges(stripe, cronDb({ charges: [CHARGE], orgs: ORGS, updates }), '2026-10-01');
    expect(res.failed).toBe(1);
    expect(updates[0].patch).toMatchObject({ status: 'failed', last_error: 'card_declined', attempts: 1 });
  });

  it('club sin cuenta Connect → no cobra (skipped)', async () => {
    const stripe = { paymentIntents: { create: vi.fn() } };
    const res = await processDueCharges(stripe, cronDb({ charges: [CHARGE], orgs: [] }), '2026-10-01');
    expect(res.charged).toBe(0);
    expect(res.skipped).toBe(1);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('sin cargos vencidos → no hace nada', async () => {
    const stripe = { paymentIntents: { create: vi.fn() } };
    const res = await processDueCharges(stripe, cronDb({ charges: [] }), '2026-10-01');
    expect(res).toEqual({ charged: 0, failed: 0 });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('makeHandler (gating)', () => {
  beforeEach(() => { process.env.CANTERA_VERTICAL_ACTIVE = '1'; });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('410-equivalente: skip silencioso si el carril está off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeHandler({ paymentIntents: { create: vi.fn() } }, cronDb({}))();
    expect(JSON.parse(res.body).skipped).toBe('cantera_off');
  });

  it('skip si no hay Stripe configurado', async () => {
    const res = await makeHandler(null, cronDb({}))();
    expect(JSON.parse(res.body).skipped).toBe('no_stripe');
  });

  it('ejecuta el cobro cuando el carril está activo', async () => {
    const stripe = { paymentIntents: { create: vi.fn().mockResolvedValue({ id: 'pi_9', status: 'succeeded' }) } };
    const res = await makeHandler(stripe, cronDb({ charges: [CHARGE], orgs: ORGS, updates: [] }))();
    expect(JSON.parse(res.body).charged).toBe(1);
  });
});
