import { describe, it, expect } from 'vitest';
import {
  makeCampaignToken,
  enrollmentUrl,
  normalizeCents,
  normalizeInstallments,
  normalizePaymentPlan,
  readPlan,
  planTotalCents,
} from '../netlify/functions/lib/enrollment-campaign.js';

describe('makeCampaignToken', () => {
  it('32 chars hex, no-adivinable', () => {
    const t = makeCampaignToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(makeCampaignToken()).not.toBe(t);
  });
});

describe('enrollmentUrl', () => {
  it('compone /es/inscripcion/:token por defecto', () => {
    expect(enrollmentUrl('https://pp.es', 'abc')).toBe('https://pp.es/es/inscripcion/abc');
  });
  it('respeta idioma ca y quita slash final del base', () => {
    expect(enrollmentUrl('https://pp.es/', 'abc', 'ca')).toBe('https://pp.es/ca/inscripcion/abc');
  });
  it('fallback de base si no se pasa', () => {
    expect(enrollmentUrl(null, 'x')).toBe('https://perfilapro.es/es/inscripcion/x');
  });
});

describe('normalizeCents', () => {
  it('null/empty → null sin error', () => {
    expect(normalizeCents(null, 'm')).toEqual({ value: null, error: null });
    expect(normalizeCents('', 'm')).toEqual({ value: null, error: null });
  });
  it('entero >= 0 ok (number o string)', () => {
    expect(normalizeCents(3500, 'm').value).toBe(3500);
    expect(normalizeCents('3000', 'm').value).toBe(3000);
    expect(normalizeCents(0, 'm').value).toBe(0);
  });
  it('rechaza negativo o decimal', () => {
    expect(normalizeCents(-1, 'm').error).toMatch(/m/);
    expect(normalizeCents(12.5, 'm').error).toMatch(/m/);
  });
});

describe('normalizeInstallments', () => {
  it('null → null; 1..24 ok; fuera de rango error', () => {
    expect(normalizeInstallments(null).value).toBeNull();
    expect(normalizeInstallments(9).value).toBe(9);
    expect(normalizeInstallments('12').value).toBe(12);
    expect(normalizeInstallments(0).error).toBeTruthy();
    expect(normalizeInstallments(25).error).toBeTruthy();
  });
});

describe('normalizePaymentPlan', () => {
  it('null/""/[] → plan vacío sin error', () => {
    expect(normalizePaymentPlan(null)).toEqual({ value: [], error: null });
    expect(normalizePaymentPlan('')).toEqual({ value: [], error: null });
    expect(normalizePaymentPlan([])).toEqual({ value: [], error: null });
  });

  it('normaliza un plan tipo Murcia Promesas', () => {
    const r = normalizePaymentPlan([
      { concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' },
      { concepto: 'Ficha federativa', amount_cents: 18000, due_date: '2026-09-15' },
      { concepto: 'Material deportivo', amount_cents: 16000, due_date: '2026-10-01' },
      { concepto: '2º plazo', amount_cents: 10000, due_date: '2027-01-10' },
    ]);
    expect(r.error).toBeNull();
    expect(r.value).toHaveLength(4);
    expect(r.value[3]).toEqual({ concepto: '2º plazo', amount_cents: 10000, due_date: '2027-01-10' });
  });

  it('ignora filas totalmente en blanco', () => {
    const r = normalizePaymentPlan([
      { concepto: '', amount_cents: '', due_date: '' },
      { concepto: 'Matrícula', amount_cents: 5000, due_date: '2026-09-01' },
    ]);
    expect(r.error).toBeNull();
    expect(r.value).toHaveLength(1);
  });

  it('strip de tags en el nombre del concepto', () => {
    const r = normalizePaymentPlan([{ concepto: '<b>Material</b>', amount_cents: 100, due_date: '2026-09-01' }]);
    expect(r.value[0].concepto).toBe('Material');
  });

  it('error si falta el nombre', () => {
    expect(normalizePaymentPlan([{ concepto: '', amount_cents: 100, due_date: '2026-09-01' }]).error).toMatch(/nombre/);
  });

  it('error si el importe no es entero >= 0', () => {
    expect(normalizePaymentPlan([{ concepto: 'X', amount_cents: -5, due_date: '2026-09-01' }]).error).toMatch(/importe/);
    expect(normalizePaymentPlan([{ concepto: 'X', amount_cents: null, due_date: '2026-09-01' }]).error).toMatch(/importe/);
  });

  it('error si la fecha falta o es inexistente', () => {
    expect(normalizePaymentPlan([{ concepto: 'X', amount_cents: 100, due_date: '' }]).error).toMatch(/fecha/);
    expect(normalizePaymentPlan([{ concepto: 'X', amount_cents: 100, due_date: '2026-02-30' }]).error).toMatch(/fecha/);
    expect(normalizePaymentPlan([{ concepto: 'X', amount_cents: 100, due_date: '01/09/2026' }]).error).toMatch(/fecha/);
  });

  it('error si no es una lista', () => {
    expect(normalizePaymentPlan({ concepto: 'X' }).error).toMatch(/lista/);
  });

  it('error si supera el máximo de conceptos', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ concepto: 'C' + i, amount_cents: 100, due_date: '2026-09-01' }));
    expect(normalizePaymentPlan(many).error).toMatch(/máximo/);
  });
});

describe('readPlan / planTotalCents', () => {
  it('readPlan lee { plan: [...] }, array legacy y vacío', () => {
    expect(readPlan({ plan: [{ concepto: 'A', amount_cents: 1, due_date: '2026-09-01' }] })).toHaveLength(1);
    expect(readPlan([{ concepto: 'A', amount_cents: 1, due_date: '2026-09-01' }])).toHaveLength(1);
    expect(readPlan(null)).toEqual([]);
    expect(readPlan({})).toEqual([]);
  });

  it('planTotalCents suma los importes', () => {
    expect(planTotalCents([{ amount_cents: 16000 }, { amount_cents: 18000 }, { amount_cents: 10000 }])).toBe(44000);
    expect(planTotalCents([])).toBe(0);
    expect(planTotalCents(null)).toBe(0);
  });
});
