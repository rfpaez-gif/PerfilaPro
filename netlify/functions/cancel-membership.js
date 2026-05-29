'use strict';

// POST /api/cancel-membership { card_slug, exit_reason? }   ·   Cantera 3b
//
// Cierra la membresía de jugador activa y deja la card sin club activo.
// Casos: el jugador se va a un club off-platform (exit_reason='fichaje')
// o causa baja (baja_voluntaria, fin_temporada, etc). Atómico vía RPC
// `cantera_close_membership`.
//
// Auth dual:
//   - JWT org-panel del club  → solo puede cerrar a SU propio jugador.
//   - JWT parent-panel del tutor → solo si es tutor_legal de la card.
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const EXIT_REASONS = ['fichaje', 'baja', 'fin_temporada', 'expulsion', 'baja_voluntaria', 'cese_actividad'];

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'cancel-membership', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const orgSession = authFromEvent(event);
    const parentSession = orgSession ? null : parentAuthFromEvent(event);
    if (!orgSession && !parentSession) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

    const exitReason = body.exit_reason || 'baja_voluntaria';
    if (!EXIT_REASONS.includes(exitReason)) return jsonResponse(400, { error: 'exit_reason inválido' });

    // Membresía activa (también nos da el club dueño para el check org-panel).
    const { data: active, error: msErr } = await db
      .from('member_club_seasons').select('id, organization_id')
      .eq('card_slug', cardSlug).eq('role', 'jugador').is('left_at', null)
      .maybeSingle();
    if (msErr) return jsonResponse(500, { error: msErr.message });
    if (!active) return jsonResponse(409, { error: 'El jugador no tiene membresía activa' });

    let actorEmail;
    if (orgSession) {
      // El club solo puede cerrar a su propio jugador.
      if (active.organization_id !== orgSession.orgId) return unauthorizedResponse();
      actorEmail = `org:${orgSession.orgSlug}`;
    } else {
      // El tutor debe ser tutor_legal activo de la card.
      const { data: admin, error: aErr } = await db
        .from('card_admins').select('id')
        .eq('card_slug', cardSlug).eq('email', parentSession.email)
        .eq('role', 'tutor_legal').is('revoked_at', null)
        .limit(1).maybeSingle();
      if (aErr) return jsonResponse(500, { error: aErr.message });
      if (!admin) return jsonResponse(403, { error: 'Solo el tutor legal puede dar de baja la ficha' });
      actorEmail = parentSession.email;
    }

    const { error } = await db.rpc('cantera_close_membership', {
      p_card_slug: cardSlug,
      p_exit_reason: exitReason,
      p_actor_email: actorEmail,
    });
    if (error) {
      if (error.message === 'no_active_membership') return jsonResponse(409, { error: 'El jugador no tiene membresía activa' });
      console.error('cancel-membership: RPC error:', error.message);
      return jsonResponse(500, { error: 'No se pudo cerrar la membresía' });
    }

    return jsonResponse(200, { ok: true });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
exports.EXIT_REASONS = EXIT_REASONS;
