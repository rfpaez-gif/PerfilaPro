'use strict';

/**
 * CP español → city_slug + municipio.
 *
 * Reglas:
 * - 5 dígitos numéricos (string).
 * - Prefijo 01-52 corresponde a las 50 provincias + Ceuta (51) + Melilla (52).
 * - Lookup en tabla postal_codes (migración 013) devuelve municipality_name
 *   y province_slug. El province_slug es el slug de la CAPITAL DE PROVINCIA
 *   (ej. CP 28820 / Coslada → province_slug = 'madrid').
 *
 * Si el CP es válido en formato pero no existe en la tabla (CPs nuevos
 * o erratas), devolvemos null y el llamador decide qué hacer (típicamente:
 * persistir el CP pero dejar city_slug=null para no contaminar el directorio).
 */

const CP_REGEX = /^\d{5}$/;

function normalizeCp(input) {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // Acepta entrada con o sin padding zero. Pad-left a 5 dígitos si es numérico.
  if (/^\d{1,5}$/.test(trimmed)) return trimmed.padStart(5, '0');
  return null;
}

function isValidCp(input) {
  const cp = normalizeCp(input);
  if (!cp || !CP_REGEX.test(cp)) return false;
  const prefix = parseInt(cp.slice(0, 2), 10);
  return prefix >= 1 && prefix <= 52;
}

async function lookupCp(db, input) {
  const cp = normalizeCp(input);
  if (!cp || !isValidCp(cp)) return null;
  const { data } = await db
    .from('postal_codes')
    .select('cp, municipality_name, province_slug')
    .eq('cp', cp)
    .maybeSingle();
  return data || null;
}

module.exports = { normalizeCp, isValidCp, lookupCp, CP_REGEX };
