import { vi, describe, it, expect } from 'vitest';
import { teardownPlayerBilling } from '../netlify/functions/lib/cantera-billing-teardown.js';

// Mock db: cadenas para enrollment_charges (update→eq→eq→eq→select) y
// parent_subscriptions (select→eq→eq→in  +  update→eq).
function makeDb({ charges = [], subs = [], chargesErr = null, subsErr = null } = {}) {
  const subsUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
  const chargesSelect = vi.fn(() => Promise.resolve({ data: charges, error: chargesErr }));
  const db = {
    from: vi.fn((t) => {
      if (t === 'enrollment_charges') {
        return { update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: chargesSelect }) }) }) }) };
      }
      if (t === 'parent_subscriptions') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: subs, error: subsErr }) }) }) }),
          update: () => ({ eq: subsUpdateEq }),
        };
      }
      return {};
    }),
  };
  db._subsUpdateEq = subsUpdateEq;
  db._chargesSelect = chargesSelect;
  return db;
}

const makeStripe = (cancelImpl) => ({ subscriptions: { cancel: vi.fn(cancelImpl || (() => Promise.resolve({ status: 'canceled' }))) } });

const ARGS = { cardSlug: 'p-1', orgId: 'org-1', connectAccountId: 'acct_club' };

describe('teardownPlayerBilling', () => {
  it('no hace nada sin cardSlug/orgId', async () => {
    const db = makeDb();
    const r = await teardownPlayerBilling(db, makeStripe(), { cardSlug: '', orgId: '' });
    expect(r).toEqual({ charges_canceled: 0, subs_canceled: 0, sub_errors: 0 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('cancela los cargos programados y la cuota Stripe activa', async () => {
    const stripe = makeStripe();
    const db = makeDb({
      charges: [{ id: 'c1' }, { id: 'c2' }],
      subs: [{ id: 's1', stripe_subscription_id: 'sub_123', status: 'active' }],
    });
    const r = await teardownPlayerBilling(db, stripe, ARGS);
    expect(r.charges_canceled).toBe(2);
    expect(r.subs_canceled).toBe(1);
    expect(r.sub_errors).toBe(0);
    // Canceló en Stripe sobre la cuenta Connect del club...
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123', { stripeAccount: 'acct_club' });
    // ...y marcó la sub como canceled en BD.
    expect(db._subsUpdateEq).toHaveBeenCalledWith('id', 's1');
  });

  it('si Stripe falla, NO marca la sub como canceled (Stripe seguiría cobrando)', async () => {
    const stripe = makeStripe(() => Promise.reject(new Error('stripe down')));
    const db = makeDb({ subs: [{ id: 's1', stripe_subscription_id: 'sub_123', status: 'active' }] });
    const r = await teardownPlayerBilling(db, stripe, ARGS);
    expect(r.subs_canceled).toBe(0);
    expect(r.sub_errors).toBe(1);
    expect(db._subsUpdateEq).not.toHaveBeenCalled();
  });

  it('sub con stripe_subscription_id pero sin cliente Stripe → error, no marca canceled', async () => {
    const db = makeDb({ subs: [{ id: 's1', stripe_subscription_id: 'sub_123', status: 'active' }] });
    const r = await teardownPlayerBilling(db, null, ARGS);
    expect(r.subs_canceled).toBe(0);
    expect(r.sub_errors).toBe(1);
    expect(db._subsUpdateEq).not.toHaveBeenCalled();
  });

  it('sub sin stripe_subscription_id (incompleta) → se marca canceled sin llamar a Stripe', async () => {
    const stripe = makeStripe();
    const db = makeDb({ subs: [{ id: 's1', stripe_subscription_id: null, status: 'incomplete' }] });
    const r = await teardownPlayerBilling(db, stripe, ARGS);
    expect(r.subs_canceled).toBe(1);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(db._subsUpdateEq).toHaveBeenCalledWith('id', 's1');
  });

  it('sin cargos ni subs → ceros, sin tocar Stripe', async () => {
    const stripe = makeStripe();
    const r = await teardownPlayerBilling(makeDb(), stripe, ARGS);
    expect(r).toEqual({ charges_canceled: 0, subs_canceled: 0, sub_errors: 0 });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});
