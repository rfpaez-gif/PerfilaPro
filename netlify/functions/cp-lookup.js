'use strict';

/**
 * GET /api/cp-lookup?cp=28820
 *
 * Resuelve un código postal contra la tabla postal_codes (migración 013) y
 * devuelve el municipio + capital de provincia. Se usa desde el formulario
 * de alta y del editor para mostrar al usuario, en cuanto teclea su CP,
 * el municipio que va a quedar persistido en la tarjeta — caza erratas y
 * refuerza la confianza en que el sistema sabe dónde está.
 *
 * Respuestas:
 *   200 { ok: true,  cp, municipality_name, province_slug }   CP válido y resuelto
 *   200 { ok: false, reason: 'invalid' }                       CP con formato malo o fuera de rango (01-52)
 *   200 { ok: false, reason: 'not_found' }                     CP con formato bueno pero ausente del catálogo
 *
 * Nunca devuelve 4xx para una entrada vacía o malformada — el cliente debe
 * poder llamar mientras el usuario sigue tecleando sin colorear de error
 * inputs aún incompletos. La validación dura está en register-free / edit-card.
 */

const { getDb } = require('./lib/supabase-client');
const { isValidCp, lookupCp, normalizeCp } = require('./lib/cp-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

function makeHandler(deps = {}) {
  const _getDb = deps.getDb || getDb;

  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'cp-lookup', limit: 60, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const cpRaw = (event.queryStringParameters || {}).cp || '';
    const cpNormalized = normalizeCp(cpRaw);

    if (!cpNormalized || !isValidCp(cpNormalized)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
        body: JSON.stringify({ ok: false, reason: 'invalid' }),
      };
    }

    const db = _getDb();
    const row = await lookupCp(db, cpNormalized);

    if (!row) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        body: JSON.stringify({ ok: false, reason: 'not_found', cp: cpNormalized }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache largo: el catálogo postal_codes es estático.
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
      body: JSON.stringify({
        ok: true,
        cp: row.cp,
        municipality_name: row.municipality_name,
        province_slug: row.province_slug,
      }),
    };
  };
}

exports.handler = makeHandler({});
exports.makeHandler = makeHandler;
