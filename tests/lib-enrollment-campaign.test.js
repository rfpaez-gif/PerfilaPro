import { describe, it, expect } from 'vitest';
import {
  makeCampaignToken,
  enrollmentUrl,
  normalizeCents,
  normalizeInstallments,
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
