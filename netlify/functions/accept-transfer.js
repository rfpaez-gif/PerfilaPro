'use strict';

// POST /api/accept-transfer { transfer_id }   ·   Cantera capa 3b
//
// El tutor legal aprueba un traspaso pendiente. Dispara la RPC atómica
// `cantera_execute_transfer` (SECURITY DEFINER): cierra la membresía
// vieja, abre la nueva, actualiza cards.organization_id y graba el
// consentimiento club_handoff, todo en una transacción Postgres.
//
// Solo el tutor_legal aprueba handoffs (un tutor_secundario no puede).
// Auth: JWT parent-panel (scoped al email del tutor).
// Gateado por isCanteraActive().
//
// Doble verificación LOPDGDD (capa 3c): 1er factor = control del email
// (magic-link parent-panel); 2º factor = fecha de nacimiento del menor
// (body.birth_date, verificada en lib/consent.verifySecondFactor). El
// handoff es uno de los actos que la exigen.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { verifySecondFactor } = require('./lib/consent');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// Traduce las excepciones de la RPC a HTTP legibles.
const RPC_ERRORS = {
  transfer_not_found: [404, 'Traspaso no encontrado'],
  transfer_not_pending: [409, 'El traspaso ya no está pendiente'],
};

function makeHandler(db, emailClient) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'accept-transfer', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const transferId = (body.transfer_id || '').trim();
    if (!transferId) return jsonResponse(400, { error: 'transfer_id requerido' });

    // Carga el traspaso para saber sobre qué card opera.
    const { data: transfer, error: tErr } = await db
      .from('club_transfers').select('id, card_slug, status').eq('id', transferId).maybeSingle();
    if (tErr) return jsonResponse(500, { error: tErr.message });
    if (!transfer) return jsonResponse(404, { error: 'Traspaso no encontrado' });
    if (transfer.status !== 'pending') return jsonResponse(409, { error: 'El traspaso ya no está pendiente' });

    // El email de la sesión debe ser tutor_legal ACTIVO de esa card.
    const { data: admin, error: aErr } = await db
      .from('card_admins').select('id')
      .eq('card_slug', transfer.card_slug).eq('email', session.email)
      .eq('role', 'tutor_legal').is('revoked_at', null)
      .limit(1).maybeSingle();
    if (aErr) return jsonResponse(500, { error: aErr.message });
    if (!admin) return jsonResponse(403, { error: 'Solo el tutor legal puede aprobar el traspaso' });

    // 2º factor LOPDGDD: fecha de nacimiento del menor.
    const { data: card, error: cErr } = await db
      .from('cards').select('birth_year, birth_date_encrypted')
      .eq('slug', transfer.card_slug).maybeSingle();
    if (cErr) return jsonResponse(500, { error: cErr.message });
    if (!verifySecondFactor(card, body.birth_date)) {
      return jsonResponse(403, { error: 'Verificación fallida: la fecha de nacimiento no coincide' });
    }

    // Ejecución atómica.
    const { data, error } = await db.rpc('cantera_execute_transfer', {
      p_transfer_id: transferId,
      p_actor_email: session.email,
      p_actor_role: 'tutor_legal',
    });
    if (error) {
      const mapped = RPC_ERRORS[error.message];
      if (mapped) return jsonResponse(mapped[0], { error: mapped[1] });
      console.error('accept-transfer: RPC error:', error.message);
      return jsonResponse(500, { error: 'No se pudo completar el traspaso' });
    }

    // data puede venir como objeto jsonb o array según el driver.
    const result = Array.isArray(data) ? data[0] : data;
    return jsonResponse(200, {
      ok: true,
      new_membership_id: result?.new_membership_id || null,
      category_id: result?.category_id || null,
    });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
