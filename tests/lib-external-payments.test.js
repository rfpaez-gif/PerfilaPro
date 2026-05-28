import { describe, it, expect, vi } from 'vitest';
import {
  PAYMENT_METHODS,
  isValidMethod,
  isValidPeriod,
  buildPaymentRow,
  recordExternalPayment,
  listPaymentsByClub,
  listPaymentsByCard,
} from '../netlify/functions/lib/external-payments.js';

const VALID = {
  cardSlug: 'p-abc123',
  organizationId: 'org-uuid-1',
  amountCents: 4500,
  method: 'bizum',
  recordedBy: 'coordi@club.es',
};

describe('isValidMethod / isValidPeriod', () => {
  it('métodos válidos', () => {
    for (const m of PAYMENT_METHODS) expect(isValidMethod(m)).toBe(true);
    expect(isValidMethod('paypal')).toBe(false);
    expect(isValidMethod('')).toBe(false);
  });
  it('period opcional con formato YYYY-MM', () => {
    expect(isValidPeriod('2026-05')).toBe(true);
    expect(isValidPeriod(null)).toBe(true);
    expect(isValidPeriod(undefined)).toBe(true);
    expect(isValidPeriod('2026-5')).toBe(false);
    expect(isValidPeriod('mayo')).toBe(false);
  });
});

describe('buildPaymentRow · validación', () => {
  it('construye la fila normalizada en el caso feliz', () => {
    const { row, error } = buildPaymentRow({ ...VALID, period: '2026-05', notes: '  pagó en mano  ', currency: 'EUR' });
    expect(error).toBeNull();
    expect(row).toMatchObject({
      card_slug: 'p-abc123',
      organization_id: 'org-uuid-1',
      amount_cents: 4500,
      currency: 'eur',
      method: 'bizum',
      recorded_by: 'coordi@club.es',
      period: '2026-05',
      notes: 'pagó en mano',
    });
  });

  it('default currency eur y campos opcionales omitidos', () => {
    const { row } = buildPaymentRow(VALID);
    expect(row.currency).toBe('eur');
    expect(row).not.toHaveProperty('period');
    expect(row).not.toHaveProperty('notes');
    expect(row).not.toHaveProperty('receipt_number');
  });

  it('rechaza cada campo requerido ausente / inválido', () => {
    expect(buildPaymentRow({ ...VALID, cardSlug: '' }).error).toMatch(/cardSlug/);
    expect(buildPaymentRow({ ...VALID, organizationId: null }).error).toMatch(/organizationId/);
    expect(buildPaymentRow({ ...VALID, amountCents: -1 }).error).toMatch(/amountCents/);
    expect(buildPaymentRow({ ...VALID, amountCents: 12.5 }).error).toMatch(/amountCents/);
    expect(buildPaymentRow({ ...VALID, method: 'paypal' }).error).toMatch(/method/);
    expect(buildPaymentRow({ ...VALID, recordedBy: '  ' }).error).toMatch(/recordedBy/);
    expect(buildPaymentRow({ ...VALID, period: '2026-5' }).error).toMatch(/period/);
  });

  it('amount 0 es válido (registro a 0 / corrección)', () => {
    expect(buildPaymentRow({ ...VALID, amountCents: 0 }).error).toBeNull();
  });
});

describe('recordExternalPayment', () => {
  function makeDb(insertResult) {
    const single = vi.fn().mockResolvedValue(insertResult);
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    return { db: { from: vi.fn(() => ({ insert })) }, insert };
  }

  it('no toca la BD si la validación falla', async () => {
    const { db, insert } = makeDb({ data: null, error: null });
    const out = await recordExternalPayment(db, { ...VALID, method: 'crypto' });
    expect(out.error.message).toMatch(/method/);
    expect(out.data).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserta la fila normalizada y devuelve data en éxito', async () => {
    const inserted = { id: 'pay-1', ...VALID };
    const { db, insert } = makeDb({ data: inserted, error: null });
    const out = await recordExternalPayment(db, VALID);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ card_slug: 'p-abc123', method: 'bizum' }));
    expect(out.data).toBe(inserted);
    expect(out.error).toBeNull();
  });

  it('propaga el error de BD', async () => {
    const { db } = makeDb({ data: null, error: { message: 'duplicate receipt' } });
    const out = await recordExternalPayment(db, { ...VALID, receiptNumber: 'REC-1' });
    expect(out.error.message).toBe('duplicate receipt');
  });
});

describe('listPaymentsByClub / listPaymentsByCard', () => {
  function makeDb(result) {
    const limit = vi.fn().mockResolvedValue(result);
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    return { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) };
  }

  it('club: devuelve payments en éxito', async () => {
    const db = makeDb({ data: [{ id: '1' }, { id: '2' }], error: null });
    const out = await listPaymentsByClub(db, 'org-1');
    expect(out.payments).toHaveLength(2);
    expect(out.error).toBeNull();
  });
  it('club: [] sin organizationId', async () => {
    const out = await listPaymentsByClub(makeDb({ data: [], error: null }), null);
    expect(out.payments).toEqual([]);
  });
  it('card: [] sin cardSlug, payments en éxito', async () => {
    expect((await listPaymentsByCard(makeDb({ data: [], error: null }), '')).payments).toEqual([]);
    const out = await listPaymentsByCard(makeDb({ data: [{ id: '1' }], error: null }), 'p-abc');
    expect(out.payments).toHaveLength(1);
  });
});
