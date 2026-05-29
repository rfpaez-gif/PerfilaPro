'use strict';

// POST /api/nfc-register { order_id?, card_slug?, nfc_uid }   ·   Cantera 5
//
// Al impresionar el carnet, el operario escanea el chip NFC y registra su
// UID en el pedido (card_print_orders.nfc_uid) y avanza el estado a
// 'sent_to_printer'. Auth founder (password+TOTP) — el founder media con
// la imprenta. Un UID no puede asignarse a dos cards (índice único parcial
// de la 033) → colisión devuelve 409.

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const nfcUid = (body.nfc_uid || '').trim();
    if (!nfcUid) return jsonResponse(400, { error: 'nfc_uid requerido' });

    // Localiza el pedido: por order_id, o el más reciente del jugador.
    let order;
    if (body.order_id) {
      const { data, error } = await db.from('card_print_orders')
        .select('id, card_slug, status').eq('id', body.order_id).maybeSingle();
      if (error) return jsonResponse(500, { error: error.message });
      order = data;
    } else if (body.card_slug) {
      const { data, error } = await db.from('card_print_orders')
        .select('id, card_slug, status').eq('card_slug', body.card_slug)
        .order('ordered_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return jsonResponse(500, { error: error.message });
      order = data;
    } else {
      return jsonResponse(400, { error: 'order_id o card_slug requerido' });
    }
    if (!order) return jsonResponse(404, { error: 'Pedido no encontrado' });

    const { error } = await db.from('card_print_orders')
      .update({ nfc_uid: nfcUid, status: 'sent_to_printer' })
      .eq('id', order.id);
    if (error) {
      // Índice único parcial sobre nfc_uid → UID ya asignado a otra card.
      if (/duplicate|unique/i.test(error.message || '')) {
        return jsonResponse(409, { error: 'Ese NFC UID ya está asignado a otro carnet' });
      }
      return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { ok: true, order_id: order.id, card_slug: order.card_slug, nfc_uid: nfcUid });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
