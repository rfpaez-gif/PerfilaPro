'use strict';

/**
 * Normaliza un teléfono español (móvil 6/7 o fijo 8/9).
 *
 * Acepta cualquier mezcla de dígitos, espacios, guiones, paréntesis y +.
 * Quita prefijo internacional 34 con o sin 00 / +.
 *
 * Devuelve { ok: true, local, e164 } si valida (9 dígitos comenzando por 6-9),
 * o { ok: false, error } con el motivo del fallo.
 */
function normalizeSpanishPhone(input) {
  if (input === null || input === undefined || typeof input !== 'string') {
    return { ok: false, error: 'phone_required' };
  }
  let digits = input.replace(/\D/g, '');
  if (!digits) {
    return { ok: false, error: 'phone_required' };
  }
  if (digits.length === 13 && digits.startsWith('0034')) {
    digits = digits.substring(4);
  } else if (digits.length === 11 && digits.startsWith('34')) {
    digits = digits.substring(2);
  }
  if (!/^[6-9]\d{8}$/.test(digits)) {
    return { ok: false, error: 'phone_invalid_format' };
  }
  return { ok: true, local: digits, e164: '34' + digits };
}

module.exports = { normalizeSpanishPhone };
