'use strict';

// Cobros manuales fuera de Stripe Connect — Bizum/efectivo/transferencia
// (migración 034 · external_payments).
//
// En clubes de cantera el Bizum personal del coordinador y el efectivo
// son DOMINANTES. La pestaña Cobros del Studio une parent_subscriptions
// (Stripe) + external_payments (manual) en una sola vista de "quién
// pagó". Esto NO es registro fiscal: la factura/recibo SEPA legal la
// emite el club fuera de PerfilaPro. receipt_number es para el recibo
// informativo si un padre lo pide.

const PAYMENT_METHODS = Object.freeze(['bizum', 'efectivo', 'transferencia', 'otro']);

// 'YYYY-MM' (mes facturado). Opcional: un pago suelto (equipación,
// matrícula) puede no tener periodo.
const PERIOD_RE = /^\d{4}-\d{2}$/;

function isValidMethod(method) {
  return PAYMENT_METHODS.includes(method);
}

function isValidPeriod(period) {
  return period == null || (typeof period === 'string' && PERIOD_RE.test(period));
}

// Valida y normaliza el payload de un cobro manual. Devuelve
// { row, error }: si error no es null, row es null y no se debe insertar.
function buildPaymentRow(input) {
  const i = input || {};

  if (typeof i.cardSlug !== 'string' || !i.cardSlug.trim()) {
    return { row: null, error: 'cardSlug requerido' };
  }
  if (!i.organizationId) {
    return { row: null, error: 'organizationId requerido' };
  }
  if (!Number.isInteger(i.amountCents) || i.amountCents < 0) {
    return { row: null, error: 'amountCents debe ser entero >= 0' };
  }
  if (!isValidMethod(i.method)) {
    return { row: null, error: `method debe ser uno de: ${PAYMENT_METHODS.join(', ')}` };
  }
  if (typeof i.recordedBy !== 'string' || !i.recordedBy.trim()) {
    return { row: null, error: 'recordedBy requerido' };
  }
  if (!isValidPeriod(i.period)) {
    return { row: null, error: 'period debe ser YYYY-MM' };
  }

  const row = {
    card_slug: i.cardSlug.trim(),
    organization_id: i.organizationId,
    amount_cents: i.amountCents,
    currency: (typeof i.currency === 'string' && i.currency.trim()) ? i.currency.trim().toLowerCase() : 'eur',
    method: i.method,
    recorded_by: i.recordedBy.trim(),
  };
  if (i.period) row.period = i.period;
  if (i.receiptNumber) row.receipt_number = String(i.receiptNumber).trim();
  if (typeof i.notes === 'string' && i.notes.trim()) row.notes = i.notes.trim();
  // Concepto del plan de pagos que cubre el cobro (modelo a medida). Texto
  // libre (espejo del nombre del concepto), sin tags, máx 80. Opcional.
  if (typeof i.concepto === 'string' && i.concepto.trim()) {
    row.concepto = i.concepto.replace(/<[^>]*>/g, '').trim().slice(0, 80);
  }
  if (i.paidAt) row.paid_at = i.paidAt; // ISO string; default now() en BD si se omite

  return { row, error: null };
}

// Inserta un cobro manual. Valida primero; si la validación falla
// devuelve { data: null, error } sin tocar la BD. En éxito devuelve la
// fila insertada.
async function recordExternalPayment(db, input) {
  const { row, error } = buildPaymentRow(input);
  if (error) return { data: null, error: { message: error } };

  const { data, error: dbError } = await db
    .from('external_payments')
    .insert(row)
    .select()
    .single();
  return { data: data || null, error: dbError || null };
}

// Cobros de un club, más recientes primero. Nunca lanza.
async function listPaymentsByClub(db, organizationId, { limit = 200 } = {}) {
  if (!organizationId) return { payments: [], error: null };
  const { data, error } = await db
    .from('external_payments')
    .select('id, card_slug, organization_id, period, amount_cents, currency, method, recorded_by, paid_at, receipt_number, notes, concepto')
    .eq('organization_id', organizationId)
    .order('paid_at', { ascending: false })
    .limit(limit);
  return { payments: data || [], error: error || null };
}

// Cobros de una card (un jugador), más recientes primero. Nunca lanza.
async function listPaymentsByCard(db, cardSlug, { limit = 200 } = {}) {
  if (!cardSlug) return { payments: [], error: null };
  const { data, error } = await db
    .from('external_payments')
    .select('id, card_slug, organization_id, period, amount_cents, currency, method, recorded_by, paid_at, receipt_number, notes, concepto')
    .eq('card_slug', cardSlug)
    .order('paid_at', { ascending: false })
    .limit(limit);
  return { payments: data || [], error: error || null };
}

module.exports = {
  PAYMENT_METHODS,
  isValidMethod,
  isValidPeriod,
  buildPaymentRow,
  recordExternalPayment,
  listPaymentsByClub,
  listPaymentsByCard,
};
