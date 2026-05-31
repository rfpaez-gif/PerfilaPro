import { describe, it, expect } from 'vitest';
import { PARENT_FEE_KIND, buildEnrollmentSessionParams } from '../netlify/functions/lib/enrollment-checkout.js';

const ORG = { id: 'club-1', name: 'EF Universal', stripe_connect_account_id: 'acct_1' };
const CARD = { slug: 'p-abc', nombre: 'Leo Pérez' };
const BASE = { org: ORG, card: CARD, parentEmail: 'madre@e.es', monthlyFeeCents: 3000, siteUrl: 'https://pp.es' };

describe('buildEnrollmentSessionParams', () => {
  it('modo subscription, SEPA+tarjeta, direct charge en la cuenta del club', () => {
    const { params, options } = buildEnrollmentSessionParams(BASE);
    expect(params.mode).toBe('subscription');
    expect(params.payment_method_types).toEqual(['card', 'sepa_debit']);
    expect(options.stripeAccount).toBe('acct_1');
    expect(params.line_items[0].price_data.unit_amount).toBe(3000);
    expect(params.line_items[0].price_data.recurring).toEqual({ interval: 'month' });
    expect(params.customer_email).toBe('madre@e.es');
  });

  it('reusa kind cantera-parent-fee y propaga metadata clave', () => {
    const { params } = buildEnrollmentSessionParams(BASE);
    expect(params.metadata.kind).toBe(PARENT_FEE_KIND);
    expect(params.metadata.card_slug).toBe('p-abc');
    expect(params.metadata.org_id).toBe('club-1');
    expect(params.metadata.parent_email).toBe('madre@e.es');
    expect(params.metadata.monthly_fee_cents).toBe('3000');
    expect(params.subscription_data.metadata.kind).toBe(PARENT_FEE_KIND);
  });

  it('matrícula one-shot va como add_invoice_items y en metadata', () => {
    const { params } = buildEnrollmentSessionParams({ ...BASE, matriculaCents: 3500 });
    const items = params.subscription_data.add_invoice_items;
    expect(items).toHaveLength(1);
    expect(items[0].price_data.unit_amount).toBe(3500);
    expect(items[0].quantity).toBe(1);
    expect(params.metadata.matricula_cents).toBe('3500');
  });

  it('sin matrícula: no añade add_invoice_items ni metadata.matricula', () => {
    const { params } = buildEnrollmentSessionParams({ ...BASE, matriculaCents: 0 });
    expect(params.subscription_data.add_invoice_items).toBeUndefined();
    expect(params.metadata.matricula_cents).toBeUndefined();
  });

  it('application_fee_percent = feeBps/100 cuando feeBps>0; ausente si 0', () => {
    expect(buildEnrollmentSessionParams({ ...BASE, feeBps: 300 }).params.subscription_data.application_fee_percent).toBe(3);
    expect(buildEnrollmentSessionParams({ ...BASE, feeBps: 0 }).params.subscription_data.application_fee_percent).toBeUndefined();
  });

  it('enrollment_campaign_id se propaga si viene', () => {
    expect(buildEnrollmentSessionParams({ ...BASE, campaignId: 'camp-7' }).params.metadata.enrollment_campaign_id).toBe('camp-7');
    expect(buildEnrollmentSessionParams(BASE).params.metadata.enrollment_campaign_id).toBeUndefined();
  });
});
