'use strict';

// Cargos del plan de pagos a medida (enrollment_charges · migración 039).
//
// Helpers PUROS (sin BD ni Stripe): a partir del plan de la campaña
// (conceptos con importe + fecha) y de la fecha de inscripción, deciden qué
// se cobra en el acto ("vence ya") y qué queda programado, y construyen las
// filas listas para insertar. La lógica de BD/Stripe vive en los endpoints
// (capa 2) y en el cron (capa 3); aquí solo decisiones deterministas y
// testeables offline.

const CHARGE_STATUSES = ['scheduled', 'processing', 'paid', 'failed', 'canceled', 'manual'];

// Un concepto se cobra "en el acto" al inscribirse si su fecha ya pasó o
// cae dentro de esta ventana desde la inscripción. Cubre el caso típico:
// el club fecha la inscripción/ficha al inicio de temporada y las familias
// se apuntan unos días antes — igualmente se cobra al firmar.
const DUE_NOW_GRACE_DAYS = 14;

// Normaliza una fecha (Date | 'YYYY-MM-DD') a medianoche UTC. Devuelve null
// si no es parseable.
function toUtcDate(d) {
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + 'T00:00:00Z');
  return isNaN(dt.getTime()) ? null : dt;
}

// ¿Se cobra este concepto al inscribirse? (vencido o dentro de la ventana).
function isDueNow(dueDate, asOf, graceDays = DUE_NOW_GRACE_DAYS) {
  const due = toUtcDate(dueDate);
  const ref = toUtcDate(asOf);
  if (!due || !ref) return false;
  const limit = new Date(ref.getTime() + graceDays * 24 * 60 * 60 * 1000);
  return due.getTime() <= limit.getTime();
}

// Parte el plan en { dueNow, scheduled } según la fecha de inscripción.
function splitPlanByDue(plan, asOf, graceDays = DUE_NOW_GRACE_DAYS) {
  const dueNow = [];
  const scheduled = [];
  (plan || []).forEach((c) => {
    (isDueNow(c.due_date, asOf, graceDays) ? dueNow : scheduled).push(c);
  });
  return { dueNow, scheduled };
}

// Suma de importes (céntimos) de una lista de conceptos/cargos.
function sumCents(items) {
  return (items || []).reduce((s, c) => s + (Number(c && c.amount_cents) || 0), 0);
}

// Comisión de plataforma (céntimos) para un importe dado, en puntos básicos.
// 0 bps → 0. Redondeo hacia abajo (no cobramos de más al club).
function applicationFeeCents(amountCents, bps) {
  const a = Number(amountCents) || 0;
  const b = Number(bps) || 0;
  if (a <= 0 || b <= 0) return 0;
  return Math.floor((a * b) / 10000);
}

// Construye las filas enrollment_charges a insertar para un jugador a partir
// del plan. Todas arrancan 'scheduled'; la capa 2 marcará 'processing'/'paid'
// las que cobre en el acto. feeBps se snapshotea por fila (la comisión a la
// que se cerró el cargo, estable aunque cambie el env var después).
function buildChargeRows({ plan, cardSlug, orgId, campaignId = null, currency = 'eur', feeBps = 0 }) {
  return (plan || []).map((c) => ({
    card_slug: cardSlug,
    organization_id: orgId,
    enrollment_campaign_id: campaignId,
    concepto: c.concepto,
    amount_cents: Number(c.amount_cents) || 0,
    currency,
    due_date: c.due_date,
    status: 'scheduled',
    application_fee_cents: applicationFeeCents(c.amount_cents, feeBps),
  }));
}

module.exports = {
  CHARGE_STATUSES,
  DUE_NOW_GRACE_DAYS,
  isDueNow,
  splitPlanByDue,
  sumCents,
  applicationFeeCents,
  buildChargeRows,
};
