'use strict';

/**
 * GET /api/ocupaciones-search?q=fonta&limit=10
 *
 * Búsqueda en el catálogo SEPE/SISPE 2011 (~2.200 ocupaciones, mapeadas a
 * sectores PerfilaPro vía migración 014). Alimenta el autocomplete del
 * picker 'No me veo' en alta.html cuando el usuario escribe una profesión
 * que no aparece entre los 17 arquetipos diana.
 *
 * Estrategia: ILIKE '%q_normalizado%' contra name_normalized (lowercase +
 * sin acentos), con índice GIN pg_trgm para latencia <100ms incluso en
 * queries de 2 letras. Devuelve top N ordenado por proximidad: matches
 * que empiezan por el query primero, luego matches en cualquier posición.
 */

const { getDb } = require('./lib/supabase-client');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;
const MIN_QUERY_LENGTH = 2;

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function makeHandler(deps) {
  const _getDb = deps.getDb || getDb;

  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'ocupaciones-search', limit: 60, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const params = event.queryStringParameters || {};
    const qRaw = (params.q || '').trim();
    const qNorm = normalize(qRaw);
    const lang = params.lang === 'ca' ? 'ca' : 'es';

    if (qNorm.length < MIN_QUERY_LENGTH) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
        body: JSON.stringify({ results: [] }),
      };
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.limit, 10) || DEFAULT_LIMIT));
    const db = _getDb();

    // Escape % y _ para evitar wildcard injection en ILIKE.
    const safeQ = qNorm.replace(/[%_\\]/g, c => '\\' + c);

    // Selección de columnas: si lang=ca incluimos name_ca para que el cliente
    // pueda mostrarla. Cuando una fila no tiene name_ca traducido (long-tail
    // todavía sin cubrir), el cliente cae a name castellano.
    const selectCols = lang === 'ca' ? 'code, name, name_ca, sector_slug' : 'code, name, sector_slug';

    // Matcheo: en ES solo name_normalized; en CA buscamos también en
    // lower(name_ca) para que el usuario que teclea "lampista" encuentre
    // el código aunque la fila castellana sea "Fontaneros, en general".
    // Cuando name_ca es NULL, ILIKE devuelve false sin error.
    const startsCaFilter = `name_normalized.ilike.${safeQ}%,name_ca.ilike.${safeQ}%`;
    const containsCaFilter = `name_normalized.ilike.%${safeQ}%,name_ca.ilike.%${safeQ}%`;

    const startsQuery = lang === 'ca'
      ? db.from('ocupaciones').select(selectCols).or(startsCaFilter).order('name', { ascending: true }).limit(limit)
      : db.from('ocupaciones').select(selectCols).ilike('name_normalized', `${safeQ}%`).order('name', { ascending: true }).limit(limit);
    const containsQuery = lang === 'ca'
      ? db.from('ocupaciones').select(selectCols).or(containsCaFilter).order('name', { ascending: true }).limit(limit * 2)
      : db.from('ocupaciones').select(selectCols).ilike('name_normalized', `%${safeQ}%`).order('name', { ascending: true }).limit(limit * 2);

    const [{ data: starts }, { data: contains }] = await Promise.all([startsQuery, containsQuery]);

    const seen = new Set();
    const results = [];
    for (const row of (starts || [])) {
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      results.push(row);
      if (results.length >= limit) break;
    }
    if (results.length < limit) {
      for (const row of (contains || [])) {
        if (seen.has(row.code)) continue;
        seen.add(row.code);
        results.push(row);
        if (results.length >= limit) break;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Caché en CDN edge: queries idénticas se sirven sin tocar Supabase.
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
      body: JSON.stringify({ results }),
    };
  };
}

exports.handler = makeHandler({});
exports.makeHandler = makeHandler;
