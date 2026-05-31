'use strict';

// Calendario y conciliación de cobros de una temporada de cantera
// (capa I1 de la inscripción · docs/cantera-inscripcion-temporada.md).
//
// Una temporada = MATRÍCULA (one-shot) + N MENSUALIDADES (default 9).
// El centro de cobros del club (pantalla B) pinta una matriz jugador ×
// periodo y concilia dos fuentes:
//   - parent_subscriptions (Stripe Connect: SEPA/tarjeta) → automático.
//   - external_payments    (Bizum/efectivo/transferencia) → manual.
//
// Este lib es PURO: no toca BD ni Stripe. Recibe los datos ya cargados y
// devuelve el estado conciliado. La carga la hace el endpoint (capa I6).

const { parseSeasonStartYear } = require('./sports-categories');

// Mes de arranque por defecto de las mensualidades: septiembre. La
// temporada española entrena de septiembre a mayo (9 cuotas).
const DEFAULT_START_MONTH = 9;
const DEFAULT_INSTALLMENTS = 9;

// Estados de una celda de cobro.
const PAID = 'paid';
const PARTIAL = 'partial';
const PENDING = 'pending';

// Convierte ('YYYY-MM') → entero comparable YYYY*12+MM. null si no parsea.
function periodIndex(period) {
  if (typeof period !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

// Formatea (year, month1-12) → 'YYYY-MM'.
function fmtPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Lista de periodos 'YYYY-MM' de una temporada. Arranca en startMonth del
// año de inicio de la temporada y avanza `count` meses (envolviendo de
// año). Ej: season '2025-26', startMonth 9, count 9 →
//   2025-09 .. 2026-05.
function seasonInstallmentPeriods(season, opts = {}) {
  const startYear = parseSeasonStartYear(season);
  if (!Number.isInteger(startYear)) return [];
  const startMonth = Number.isInteger(opts.startMonth) ? opts.startMonth : DEFAULT_START_MONTH;
  const count = Number.isInteger(opts.count) && opts.count >= 0 ? opts.count : DEFAULT_INSTALLMENTS;
  if (startMonth < 1 || startMonth > 12) return [];

  const periods = [];
  let year = startYear;
  let month = startMonth;
  for (let i = 0; i < count; i++) {
    periods.push(fmtPeriod(year, month));
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return periods;
}

// Periodo (entero) hasta el que cubre una suscripción Stripe activa.
// Una suscripción 'active'/'trialing' cubre hasta el mes de
// current_period_end (incluido). Suscripciones canceladas/impagadas no
// cubren nada de cara a la matriz (lo pendiente se ve pendiente).
function subscriptionCoverageIndex(subscription) {
  if (!subscription) return null;
  const status = subscription.status;
  if (status !== 'active' && status !== 'trialing') return null;
  const cpe = subscription.current_period_end;
  if (!cpe) return null;
  const d = cpe instanceof Date ? cpe : new Date(cpe);
  if (isNaN(d.getTime())) return null;
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// Periodo (entero) desde el que arranca la cobertura de la suscripción:
// el mes de started_at. Antes de ese mes la suscripción no cubre.
function subscriptionStartIndex(subscription) {
  if (!subscription || !subscription.started_at) return null;
  const d = subscription.started_at instanceof Date ? subscription.started_at : new Date(subscription.started_at);
  if (isNaN(d.getTime())) return null;
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// Suma de cobros manuales (external_payments) imputados a un periodo.
function manualPaidForPeriod(externalPayments, period) {
  if (!Array.isArray(externalPayments)) return 0;
  return externalPayments.reduce((sum, p) => {
    if (p && p.period === period && Number.isInteger(p.amount_cents)) return sum + p.amount_cents;
    return sum;
  }, 0);
}

// Concilia el estado de cobro de UN jugador sobre la temporada.
//
// Entradas:
//   campaign         — { season, matricula_cents, monthly_fee_cents,
//                        num_installments, start_month? }
//   subscription     — fila parent_subscriptions (o null si no domicilió):
//                      { status, current_period_end, started_at,
//                        matricula_cents, matricula_paid_at }
//   externalPayments — filas external_payments del jugador (manual).
//
// Salida:
//   { matricula: { expected_cents, paid_cents, status, source },
//     periods: [ { period, expected_cents, paid_cents, status, source } ],
//     pending_count, paid_count }
//
// Reglas por mensualidad (manual gana sobre auto al imputar importe):
//   - manualPaid >= expected            → paid   (source 'manual')
//   - cubierto por suscripción activa   → paid   (source 'auto')
//   - 0 < manualPaid < expected         → partial(source 'manual')
//   - resto                             → pending(source null)
function reconcilePlayerBilling({ campaign, subscription = null, externalPayments = [] } = {}) {
  const c = campaign || {};
  const expectedMonthly = Number.isInteger(c.monthly_fee_cents) ? c.monthly_fee_cents : 0;
  const periods = seasonInstallmentPeriods(c.season, {
    startMonth: Number.isInteger(c.start_month) ? c.start_month : DEFAULT_START_MONTH,
    count: Number.isInteger(c.num_installments) ? c.num_installments : DEFAULT_INSTALLMENTS,
  });

  const covFrom = subscriptionStartIndex(subscription);
  const covTo = subscriptionCoverageIndex(subscription);

  let paidCount = 0;
  let pendingCount = 0;

  const periodRows = periods.map((period) => {
    const idx = periodIndex(period);
    const manualPaid = manualPaidForPeriod(externalPayments, period);
    const autoCovered = covTo != null && idx != null && idx <= covTo &&
      (covFrom == null || idx >= covFrom);

    let status;
    let source;
    let paidCents;
    if (expectedMonthly > 0 && manualPaid >= expectedMonthly) {
      status = PAID; source = 'manual'; paidCents = manualPaid;
    } else if (autoCovered) {
      status = PAID; source = 'auto'; paidCents = Math.max(manualPaid, expectedMonthly);
    } else if (manualPaid > 0) {
      status = PARTIAL; source = 'manual'; paidCents = manualPaid;
    } else {
      status = PENDING; source = null; paidCents = 0;
    }

    if (status === PAID) paidCount += 1; else pendingCount += 1;
    return { period, expected_cents: expectedMonthly, paid_cents: paidCents, status, source };
  });

  // ── Matrícula (one-shot) ──
  const matriculaExpected = Number.isInteger(c.matricula_cents) ? c.matricula_cents
    : (subscription && Number.isInteger(subscription.matricula_cents) ? subscription.matricula_cents : 0);
  const matriculaManual = manualPaidForPeriod(externalPayments, 'matricula');
  let matStatus; let matSource; let matPaid;
  if (subscription && subscription.matricula_paid_at) {
    matStatus = PAID; matSource = 'auto'; matPaid = matriculaExpected;
  } else if (matriculaExpected > 0 && matriculaManual >= matriculaExpected) {
    matStatus = PAID; matSource = 'manual'; matPaid = matriculaManual;
  } else if (matriculaManual > 0) {
    matStatus = PARTIAL; matSource = 'manual'; matPaid = matriculaManual;
  } else if (matriculaExpected === 0) {
    matStatus = PAID; matSource = null; matPaid = 0; // sin matrícula configurada = nada que cobrar
  } else {
    matStatus = PENDING; matSource = null; matPaid = 0;
  }

  return {
    matricula: { expected_cents: matriculaExpected, paid_cents: matPaid, status: matStatus, source: matSource },
    periods: periodRows,
    paid_count: paidCount,
    pending_count: pendingCount,
  };
}

module.exports = {
  DEFAULT_START_MONTH,
  DEFAULT_INSTALLMENTS,
  PAID, PARTIAL, PENDING,
  periodIndex,
  seasonInstallmentPeriods,
  subscriptionCoverageIndex,
  subscriptionStartIndex,
  manualPaidForPeriod,
  reconcilePlayerBilling,
};
