import { describe, it, expect } from 'vitest';
import {
  CHARGE_STATUSES,
  DUE_NOW_GRACE_DAYS,
  isDueNow,
  splitPlanByDue,
  sumCents,
  applicationFeeCents,
  buildChargeRows,
} from '../netlify/functions/lib/enrollment-charges.js';

const MURCIA_PLAN = [
  { concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' },
  { concepto: 'Ficha federativa', amount_cents: 18000, due_date: '2026-09-01' },
  { concepto: 'Material deportivo', amount_cents: 16000, due_date: '2026-10-01' },
  { concepto: '2º plazo', amount_cents: 10000, due_date: '2027-01-10' },
];

describe('isDueNow', () => {
  it('vencido o dentro de la ventana de 14 días → true', () => {
    expect(isDueNow('2026-09-01', '2026-09-01')).toBe(true);   // mismo día
    expect(isDueNow('2026-08-20', '2026-09-01')).toBe(true);   // ya pasó
    expect(isDueNow('2026-09-10', '2026-09-01')).toBe(true);   // dentro de 14d
  });
  it('más allá de la ventana → false', () => {
    expect(isDueNow('2026-10-01', '2026-09-01')).toBe(false);
    expect(isDueNow('2027-01-10', '2026-09-01')).toBe(false);
  });
  it('ventana configurable', () => {
    expect(isDueNow('2026-09-20', '2026-09-01', 30)).toBe(true);
    expect(isDueNow('2026-09-20', '2026-09-01', 5)).toBe(false);
  });
  it('fechas no parseables → false', () => {
    expect(isDueNow('', '2026-09-01')).toBe(false);
    expect(isDueNow('2026-09-01', 'nope')).toBe(false);
  });
  it('acepta objetos Date', () => {
    expect(isDueNow(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))).toBe(true);
  });
});

describe('splitPlanByDue', () => {
  it('separa el plan Murcia: inscripción+ficha al firmar, material+2º plazo programados', () => {
    const { dueNow, scheduled } = splitPlanByDue(MURCIA_PLAN, '2026-09-01');
    expect(dueNow.map(c => c.concepto)).toEqual(['Inscripción', 'Ficha federativa']);
    expect(scheduled.map(c => c.concepto)).toEqual(['Material deportivo', '2º plazo']);
  });
  it('plan vacío → ambos vacíos', () => {
    expect(splitPlanByDue([], '2026-09-01')).toEqual({ dueNow: [], scheduled: [] });
    expect(splitPlanByDue(null, '2026-09-01')).toEqual({ dueNow: [], scheduled: [] });
  });
});

describe('sumCents', () => {
  it('suma importes', () => {
    expect(sumCents(MURCIA_PLAN)).toBe(60000);
    expect(sumCents([])).toBe(0);
    expect(sumCents(null)).toBe(0);
  });
});

describe('applicationFeeCents', () => {
  it('calcula la comisión en bps con redondeo a la baja', () => {
    expect(applicationFeeCents(16000, 300)).toBe(480);   // 3% de 160€
    expect(applicationFeeCents(10000, 250)).toBe(250);   // 2.5%
    expect(applicationFeeCents(199, 300)).toBe(5);       // floor(5.97)
  });
  it('0 si importe o bps no positivos', () => {
    expect(applicationFeeCents(16000, 0)).toBe(0);
    expect(applicationFeeCents(0, 300)).toBe(0);
    expect(applicationFeeCents(-5, 300)).toBe(0);
  });
});

describe('buildChargeRows', () => {
  it('una fila por concepto, status scheduled, fee snapshoteada', () => {
    const rows = buildChargeRows({
      plan: MURCIA_PLAN, cardSlug: 'p-abc12345', orgId: 'org-1', campaignId: 'camp-1', feeBps: 300,
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      card_slug: 'p-abc12345', organization_id: 'org-1', enrollment_campaign_id: 'camp-1',
      concepto: 'Inscripción', amount_cents: 16000, currency: 'eur', due_date: '2026-09-01',
      status: 'scheduled', application_fee_cents: 480,
    });
  });
  it('campaignId opcional → null; currency por defecto eur', () => {
    const rows = buildChargeRows({ plan: [{ concepto: 'X', amount_cents: 100, due_date: '2026-09-01' }], cardSlug: 's', orgId: 'o' });
    expect(rows[0].enrollment_campaign_id).toBeNull();
    expect(rows[0].currency).toBe('eur');
    expect(rows[0].application_fee_cents).toBe(0); // feeBps default 0
  });
  it('plan vacío → []', () => {
    expect(buildChargeRows({ plan: [], cardSlug: 's', orgId: 'o' })).toEqual([]);
  });
});

describe('CHARGE_STATUSES / DUE_NOW_GRACE_DAYS', () => {
  it('expone las constantes esperadas', () => {
    expect(CHARGE_STATUSES).toContain('scheduled');
    expect(CHARGE_STATUSES).toContain('paid');
    expect(DUE_NOW_GRACE_DAYS).toBe(14);
  });
});
