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

import { PLAN_KIND, buildPlanCheckoutSessionParams } from '../netlify/functions/lib/enrollment-checkout.js';

describe('buildPlanCheckoutSessionParams', () => {
  const DUE_NOW = [
    { concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' },
    { concepto: 'Ficha federativa', amount_cents: 18000, due_date: '2026-09-01' },
  ];

  it('con conceptos que vencen ya y plazos futuros (hasScheduled): modo payment + setup_future_usage + application_fee, sin Bizum', () => {
    const { params, options } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'madre@e.es',
      dueNowConcepts: DUE_NOW, dueNowFeeCents: 1020, hasScheduled: true, campaignId: 'camp-1', siteUrl: 'https://pp.es',
    });
    expect(params.mode).toBe('payment');
    expect(params.payment_method_types).toEqual(['card', 'sepa_debit']);
    expect(params.line_items).toHaveLength(2);
    expect(params.line_items[0].price_data.unit_amount).toBe(16000);
    expect(params.payment_intent_data.setup_future_usage).toBe('off_session');
    expect(params.customer_creation).toBe('always');
    expect(params.payment_intent_data.application_fee_amount).toBe(1020);
    expect(params.metadata.kind).toBe(PLAN_KIND);
    expect(params.metadata.card_slug).toBe('p-abc');
    expect(params.metadata.enrollment_campaign_id).toBe('camp-1');
    expect(options.stripeAccount).toBe('acct_1');
  });

  it('default conservador (hasScheduled omitido): guarda mandato y NO ofrece Bizum', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'madre@e.es',
      dueNowConcepts: DUE_NOW, dueNowFeeCents: 1020, siteUrl: 'https://pp.es',
    });
    expect(params.payment_intent_data.setup_future_usage).toBe('off_session');
    expect(params.payment_method_types).toEqual(['card', 'sepa_debit']);
  });

  it('one-shot puro (todo vence ya, hasScheduled:false): ofrece Bizum, sin setup_future_usage ni customer_creation', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'madre@e.es',
      dueNowConcepts: DUE_NOW, dueNowFeeCents: 1020, hasScheduled: false, siteUrl: 'https://pp.es',
    });
    expect(params.mode).toBe('payment');
    expect(params.payment_method_types).toEqual(['card', 'sepa_debit', 'bizum']);
    expect(params.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(params.customer_creation).toBeUndefined();
    expect(params.payment_intent_data.application_fee_amount).toBe(1020);
  });

  it('one-shot puro: el carnet embebido se sigue skimando vía application_fee', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es',
      dueNowConcepts: DUE_NOW, dueNowFeeCents: 1020, carnetFeeCents: 1200, hasScheduled: false, siteUrl: 'https://pp.es',
    });
    expect(params.payment_method_types).toContain('bizum');
    expect(params.payment_intent_data.application_fee_amount).toBe(2220);
    expect(params.metadata.carnet_fee_cents).toBe('1200');
  });

  it('modo setup (nada vence ya) nunca ofrece Bizum aunque hasScheduled sea false', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es',
      dueNowConcepts: [], hasScheduled: false, siteUrl: 'https://pp.es',
    });
    expect(params.mode).toBe('setup');
    expect(params.payment_method_types).toEqual(['card', 'sepa_debit']);
  });

  it('sin conceptos que vencen ya: modo setup (solo guarda el mandato)', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'madre@e.es', dueNowConcepts: [], siteUrl: 'https://pp.es',
    });
    expect(params.mode).toBe('setup');
    expect(params.line_items).toBeUndefined();
    expect(params.setup_intent_data.metadata.kind).toBe(PLAN_KIND);
  });

  it('omite application_fee_amount si la comisión es 0', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es', dueNowConcepts: DUE_NOW, dueNowFeeCents: 0, siteUrl: 'https://pp.es',
    });
    expect(params.payment_intent_data.application_fee_amount).toBeUndefined();
  });

  it('carnet embebido: suma carnetFeeCents al application_fee + metadata', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es',
      dueNowConcepts: DUE_NOW, dueNowFeeCents: 1020, carnetFeeCents: 1200, siteUrl: 'https://pp.es',
    });
    // 1020 comisión + 1200 carnet (cabe de sobra en 34000) = 2220
    expect(params.payment_intent_data.application_fee_amount).toBe(2220);
    expect(params.metadata.carnet_fee_cents).toBe('1200');
  });

  it('carnet embebido: capa el skim para no exceder el total cobrado', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es',
      dueNowConcepts: [{ concepto: 'Matrícula', amount_cents: 1500, due_date: '2026-09-01' }],
      dueNowFeeCents: 500, carnetFeeCents: 1200, siteUrl: 'https://pp.es',
    });
    // 500 comisión + min(1200, 1500-500=1000) = 500 + 1000 = 1500 (todo el cargo)
    expect(params.payment_intent_data.application_fee_amount).toBe(1500);
    expect(params.metadata.carnet_fee_cents).toBe('1000');
  });

  it('carnet embebido: en modo setup (nada vence ya) NO se skimea', () => {
    const { params } = buildPlanCheckoutSessionParams({
      org: ORG, card: CARD, parentEmail: 'm@e.es',
      dueNowConcepts: [], carnetFeeCents: 1200, siteUrl: 'https://pp.es',
    });
    expect(params.mode).toBe('setup');
    expect(params.metadata.carnet_fee_cents).toBeUndefined();
  });
});
