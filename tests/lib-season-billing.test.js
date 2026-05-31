import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTALLMENTS,
  PAID, PARTIAL, PENDING,
  periodIndex,
  seasonInstallmentPeriods,
  subscriptionCoverageIndex,
  reconcilePlayerBilling,
} from '../netlify/functions/lib/season-billing.js';

describe('periodIndex', () => {
  it('convierte YYYY-MM a entero comparable', () => {
    expect(periodIndex('2025-09')).toBe(2025 * 12 + 8);
    expect(periodIndex('2026-01')).toBe(2026 * 12 + 0);
    expect(periodIndex('2025-09') < periodIndex('2025-10')).toBe(true);
    expect(periodIndex('2025-12') < periodIndex('2026-01')).toBe(true);
  });
  it('rechaza formatos inválidos', () => {
    expect(periodIndex('2025-13')).toBeNull();
    expect(periodIndex('2025-9')).toBeNull();
    expect(periodIndex('mayo')).toBeNull();
    expect(periodIndex(null)).toBeNull();
  });
});

describe('seasonInstallmentPeriods', () => {
  it('temporada 2025-26: 9 cuotas de sep a may envolviendo el año', () => {
    const p = seasonInstallmentPeriods('2025-26');
    expect(p).toHaveLength(9);
    expect(p[0]).toBe('2025-09');
    expect(p[3]).toBe('2025-12');
    expect(p[4]).toBe('2026-01');
    expect(p[8]).toBe('2026-05');
  });
  it('respeta count y startMonth custom', () => {
    const p = seasonInstallmentPeriods('2025-26', { startMonth: 10, count: 3 });
    expect(p).toEqual(['2025-10', '2025-11', '2025-12']);
  });
  it('default = 9 mensualidades', () => {
    expect(seasonInstallmentPeriods('2025-26')).toHaveLength(DEFAULT_INSTALLMENTS);
  });
  it('season inválida → []', () => {
    expect(seasonInstallmentPeriods('basura')).toEqual([]);
  });
});

describe('subscriptionCoverageIndex', () => {
  it('cubre hasta current_period_end si está activa', () => {
    const idx = subscriptionCoverageIndex({ status: 'active', current_period_end: '2025-12-15T00:00:00Z' });
    expect(idx).toBe(2025 * 12 + 11); // diciembre
  });
  it('null si cancelada/impagada o sin cpe', () => {
    expect(subscriptionCoverageIndex({ status: 'canceled', current_period_end: '2025-12-15T00:00:00Z' })).toBeNull();
    expect(subscriptionCoverageIndex({ status: 'active', current_period_end: null })).toBeNull();
    expect(subscriptionCoverageIndex(null)).toBeNull();
  });
});

const CAMPAIGN = { season: '2025-26', matricula_cents: 3500, monthly_fee_cents: 3000, num_installments: 9 };

describe('reconcilePlayerBilling · matrícula', () => {
  it('matrícula pagada por Stripe (matricula_paid_at)', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      subscription: { status: 'active', current_period_end: '2025-09-30T00:00:00Z', started_at: '2025-09-01T00:00:00Z', matricula_paid_at: '2025-09-01T00:00:00Z' },
    });
    expect(r.matricula.status).toBe(PAID);
    expect(r.matricula.source).toBe('auto');
  });
  it('matrícula pagada en efectivo (external period="matricula")', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      externalPayments: [{ period: 'matricula', amount_cents: 3500 }],
    });
    expect(r.matricula.status).toBe(PAID);
    expect(r.matricula.source).toBe('manual');
  });
  it('matrícula pendiente si nadie la pagó', () => {
    const r = reconcilePlayerBilling({ campaign: CAMPAIGN });
    expect(r.matricula.status).toBe(PENDING);
  });
  it('sin matrícula configurada → no se debe nada', () => {
    const r = reconcilePlayerBilling({ campaign: { ...CAMPAIGN, matricula_cents: 0 } });
    expect(r.matricula.status).toBe(PAID);
    expect(r.matricula.expected_cents).toBe(0);
  });
});

describe('reconcilePlayerBilling · mensualidades', () => {
  it('suscripción activa cubre meses hasta current_period_end', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      subscription: { status: 'active', current_period_end: '2025-12-15T00:00:00Z', started_at: '2025-09-01T00:00:00Z', matricula_paid_at: '2025-09-01T00:00:00Z' },
    });
    // sep, oct, nov, dic pagadas (auto); ene-may pendientes
    const byPeriod = Object.fromEntries(r.periods.map(p => [p.period, p]));
    expect(byPeriod['2025-09'].status).toBe(PAID);
    expect(byPeriod['2025-09'].source).toBe('auto');
    expect(byPeriod['2025-12'].status).toBe(PAID);
    expect(byPeriod['2026-01'].status).toBe(PENDING);
    expect(r.paid_count).toBe(4);
    expect(r.pending_count).toBe(5);
  });

  it('pago manual completo de un mes → paid (manual)', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      externalPayments: [{ period: '2025-09', amount_cents: 3000 }],
    });
    const sep = r.periods.find(p => p.period === '2025-09');
    expect(sep.status).toBe(PAID);
    expect(sep.source).toBe('manual');
  });

  it('pago manual parcial → partial', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      externalPayments: [{ period: '2025-09', amount_cents: 1500 }],
    });
    expect(r.periods.find(p => p.period === '2025-09').status).toBe(PARTIAL);
  });

  it('sin suscripción ni manual → todo pendiente', () => {
    const r = reconcilePlayerBilling({ campaign: CAMPAIGN });
    expect(r.pending_count).toBe(9);
    expect(r.paid_count).toBe(0);
    expect(r.periods.every(p => p.status === PENDING)).toBe(true);
  });

  it('suscripción cancelada no cubre nada', () => {
    const r = reconcilePlayerBilling({
      campaign: CAMPAIGN,
      subscription: { status: 'canceled', current_period_end: '2026-05-15T00:00:00Z', started_at: '2025-09-01T00:00:00Z' },
    });
    expect(r.pending_count).toBe(9);
  });
});
