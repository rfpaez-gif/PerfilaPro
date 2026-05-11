'use strict';

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const TOKEN_RE = /^[a-f0-9]{48}$/;

function jsonResponse(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      extraHeaders || {},
    ),
    body: JSON.stringify(payload),
  };
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 30 requests / 10 min por IP. Suficiente para que un humano refresque la
    // página varias veces; bloquea scraping de tokens incluso si el atacante
    // los rotara (que no puede, son 24 bytes random).
    const rl = checkRateLimit(event, { bucket: 'onboarding-prefill', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const token = (event.queryStringParameters?.token || '').toLowerCase();
    if (!TOKEN_RE.test(token)) {
      return jsonResponse(400, { error: 'Token inválido' });
    }

    const { data: lead, error } = await db
      .from('b2b_leads')
      .select('id, name, company, email, sector, idioma, organization_id, redeemed_at')
      .eq('invite_token', token)
      .maybeSingle();

    if (error) {
      console.error('onboarding-prefill: error BD:', error.message);
      return jsonResponse(500, { error: 'Error consultando lead' });
    }
    if (!lead) {
      return jsonResponse(404, { error: 'Token no encontrado o caducado' });
    }
    if (lead.redeemed_at) {
      // Idempotencia: un token consumido no se vuelve a servir. El usuario
      // debe pedir uno nuevo al admin si quiere crear otro perfil.
      return jsonResponse(410, { error: 'Este enlace ya se ha usado' });
    }

    // Si el admin asoció el lead a una org en Studio, devolvemos su branding
    // para que la página onboarding pinte el header con logo + color. Sin
    // org, el onboarding se renderiza neutro (sin branding) pero funcional.
    let org = null;
    if (lead.organization_id) {
      const { data: orgRow } = await db
        .from('organizations')
        .select('id, slug, name, tagline, logo_url, color_primary')
        .eq('id', lead.organization_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgRow) {
        org = {
          id: orgRow.id,
          slug: orgRow.slug,
          name: orgRow.name,
          tagline: orgRow.tagline,
          logo_url: orgRow.logo_url,
          color_primary: orgRow.color_primary,
        };
      }
    }

    return jsonResponse(200, {
      ok: true,
      lead: {
        name: lead.name,
        company: lead.company,
        email: lead.email,
        sector: lead.sector,
        idioma: lead.idioma || 'es',
      },
      org,
    });
  };
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
