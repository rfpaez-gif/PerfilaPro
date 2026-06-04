'use strict';

// Campaña de inscripción de temporada (capa I3 · enrollment_campaigns).
//
// Helpers puros para abrir/gestionar la campaña que el club comparte como
// enlace + QR. La lógica de BD vive en org-panel (acciones enrollment_*);
// aquí solo la generación del token, la URL pública y la validación de
// importes. Sin tocar BD ni Stripe.

const crypto = require('crypto');

// Token público de la campaña: 16 bytes hex (32 chars). Va en la URL
// /inscripcion/:token, no es secreto de seguridad (la inscripción es
// pública) pero sí no-adivinable para que solo quien tiene el enlace
// del club entre en su campaña.
function makeCampaignToken() {
  return crypto.randomBytes(16).toString('hex');
}

// URL pública de inscripción que el club reparte (QR/WhatsApp/cartel).
function enrollmentUrl(siteUrl, token, idioma = 'es') {
  const base = (siteUrl || 'https://perfilapro.es').replace(/\/+$/, '');
  const lang = idioma === 'ca' ? 'ca' : 'es';
  return `${base}/${lang}/inscripcion/${token}`;
}

// Valida/normaliza los importes de la campaña. Devuelve { value, error }.
// Acepta number (céntimos) o null/'' (no configurado → null). Enteros >= 0.
function normalizeCents(input, label) {
  if (input == null || input === '') return { value: null, error: null };
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isInteger(n) || n < 0) return { value: null, error: `${label} debe ser un entero de céntimos >= 0` };
  return { value: n, error: null };
}

// Valida num_installments: entero 1..24 (default lo pone el caller a 9).
function normalizeInstallments(input) {
  if (input == null || input === '') return { value: null, error: null };
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isInteger(n) || n < 1 || n > 24) return { value: null, error: 'num_installments debe ser un entero entre 1 y 24' };
  return { value: n, error: null };
}

// ── Plan de pagos a medida (concepts_jsonb) ──────────────────────
//
// Cada club diseña su propia estructura de cobro: una lista de conceptos
// con nombre libre, importe y fecha definida (p.ej. Murcia Promesas:
// Inscripción 160€ · Ficha federativa 180€ · Material 160€ · 2º plazo 100€
// en enero). Reemplaza el modelo rígido "matrícula + N mensualidades
// iguales" cuando el club lo necesita. El cobro es manual en esta fase
// (el club lo registra en la pestaña Cobros); aquí solo se diseña y muestra.
//
// Se guarda en enrollment_campaigns.concepts_jsonb como { plan: [...] }.

const MAX_CONCEPTS = 24;
const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Valida/normaliza el plan que llega del panel. Devuelve { value, error }.
// - input null/'' o [] → plan vacío (sin error).
// - filas totalmente en blanco se ignoran (el editor deja filas vacías).
// - cada concepto: nombre (1-80, sin tags), importe entero céntimos >= 0,
//   fecha AAAA-MM-DD existente.
function normalizePaymentPlan(input) {
  if (input == null || input === '') return { value: [], error: null };
  if (!Array.isArray(input)) return { value: null, error: 'concepts debe ser una lista' };

  const out = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] || {};
    const concepto = String(raw.concepto == null ? '' : raw.concepto).replace(/<[^>]*>/g, '').trim();
    const amount = raw.amount_cents;
    const due = raw.due_date == null ? '' : String(raw.due_date).trim();

    // Fila en blanco → se ignora.
    if (!concepto && (amount == null || amount === '') && !due) continue;

    const label = `Concepto #${i + 1}`;
    if (!concepto) return { value: null, error: `${label}: falta el nombre del concepto` };
    if (concepto.length > 80) return { value: null, error: `${label}: el nombre no puede superar 80 caracteres` };

    // Importe ausente en una fila no-vacía = incompleta → error (no la
    // convertimos en 0€ silenciosamente). amount === 0 sí es válido.
    const cents = (amount == null || amount === '') ? NaN : (typeof amount === 'number' ? amount : Number(amount));
    if (!Number.isInteger(cents) || cents < 0) return { value: null, error: `${label}: importe inválido (céntimos enteros >= 0)` };

    if (!PLAN_DATE_RE.test(due)) return { value: null, error: `${label}: falta la fecha (AAAA-MM-DD)` };
    const d = new Date(due + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== due) return { value: null, error: `${label}: fecha inexistente` };

    out.push({ concepto, amount_cents: cents, due_date: due });
  }
  if (out.length > MAX_CONCEPTS) return { value: null, error: `máximo ${MAX_CONCEPTS} conceptos por campaña` };
  return { value: out, error: null };
}

// Lee el plan de un valor concepts_jsonb (objeto { plan } o array legacy).
function readPlan(conceptsJsonb) {
  if (!conceptsJsonb) return [];
  if (Array.isArray(conceptsJsonb)) return conceptsJsonb;
  if (Array.isArray(conceptsJsonb.plan)) return conceptsJsonb.plan;
  return [];
}

// Suma de importes del plan en céntimos.
function planTotalCents(plan) {
  return (plan || []).reduce((sum, c) => sum + (Number(c && c.amount_cents) || 0), 0);
}

module.exports = {
  makeCampaignToken,
  enrollmentUrl,
  normalizeCents,
  normalizeInstallments,
  normalizePaymentPlan,
  readPlan,
  planTotalCents,
};
