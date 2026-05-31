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

module.exports = {
  makeCampaignToken,
  enrollmentUrl,
  normalizeCents,
  normalizeInstallments,
};
