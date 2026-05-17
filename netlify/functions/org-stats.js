'use strict';

const { createClient } = require('@supabase/supabase-js');
const { isValidOrgSlug } = require('./lib/org-utils');
const { authenticateOrgStats, computeOrgStats } = require('./lib/org-stats-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Privacidad: el JSON contiene datos agregados de la org. Aunque
      // el token actúa de auth, no queremos que ningún CDN intermedio
      // cachee la respuesta.
      'Cache-Control': 'private, no-store',
    },
    body: JSON.stringify(payload),
  };
}

function makeHandler(deps) {
  const { db } = deps;

  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, {
      bucket: 'org-stats',
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const slug  = event.queryStringParameters?.slug;
    const token = event.queryStringParameters?.token;

    if (!slug || !token) {
      return jsonResponse(400, { error: 'Faltan slug o token' });
    }
    if (!isValidOrgSlug(slug)) {
      return jsonResponse(400, { error: 'slug inválido' });
    }

    const org = await authenticateOrgStats(db, slug, token);
    if (!org) {
      return jsonResponse(404, { error: 'No encontrado' });
    }

    const stats = await computeOrgStats(db, org.id);
    return jsonResponse(200, {
      ok: true,
      org: {
        slug: org.slug,
        name: org.name,
        tagline: org.tagline || null,
        logo_url: org.logo_url || null,
        color_primary: org.color_primary || null,
      },
      ...stats,
    });
  };
}

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = makeHandler({ db: defaultDb });
exports.makeHandler = makeHandler;
