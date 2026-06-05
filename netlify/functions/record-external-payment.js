'use strict';

// POST /api/record-external-payment   ·   Cantera capa 4c
//
// Cobros manuales fuera de Stripe (Bizum del coordinador, efectivo,
// transferencia). NO mueve dinero: solo registra quién pagó, para que
// la pestaña Cobros del Studio una Stripe + manual en una sola vista.
//
// Acciones:
//   - record { card_slug, amount_cents, method, period?, currency?,
//              receipt_number?, notes?, paid_at? } → inserta external_payments.
//   - list   → cobros manuales del club (más recientes primero).
//
// Auth: JWT org-panel del club (el admin apunta los cobros que recibe).
// El cobro queda atado a session.orgId; solo jugadores de ese club.
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { recordExternalPayment, listPaymentsByClub } = require('./lib/external-payments');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'record-external-payment', limit: 60, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }
    const action = body.action || 'record';

    // Club (scoped al JWT).
    const { data: org, error: orgErr } = await db
      .from('organizations').select('id, slug, kind, deleted_at').eq('id', session.orgId).maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return unauthorizedResponse();
    if (org.kind !== 'sports_club') return jsonResponse(403, { error: 'Solo disponible para clubes deportivos' });

    if (action === 'list') {
      const { payments, error } = await listPaymentsByClub(db, org.id, { limit: 200 });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, payments });
    }

    if (action === 'record') {
      const cardSlug = (body.card_slug || '').trim();
      if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

      // El jugador debe pertenecer a este club.
      const { data: card, error: cardErr } = await db
        .from('cards').select('slug, organization_id, card_kind, deleted_at').eq('slug', cardSlug).maybeSingle();
      if (cardErr) return jsonResponse(500, { error: cardErr.message });
      if (!card || card.deleted_at || card.card_kind !== 'player' || card.organization_id !== org.id) {
        return jsonResponse(404, { error: 'Jugador no encontrado en tu club' });
      }

      const { data, error } = await recordExternalPayment(db, {
        cardSlug,
        organizationId: org.id,
        amountCents: body.amount_cents,
        method: body.method,
        period: body.period,
        concepto: body.concepto,
        currency: body.currency,
        receiptNumber: body.receipt_number,
        notes: body.notes,
        paidAt: body.paid_at,
        recordedBy: `org:${org.slug}`,
      });
      if (error) {
        // Validación de buildPaymentRow → 400; error de BD → 500.
        const isValidation = /requerido|debe ser|YYYY-MM/.test(error.message || '');
        return jsonResponse(isValidation ? 400 : 500, { error: error.message });
      }
      return jsonResponse(201, { ok: true, payment: data });
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
