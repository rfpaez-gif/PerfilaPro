'use strict';

// POST /api/upload-player-photo   ·   Cantera · foto del jugador (panel padre)
// Header: Authorization: Bearer <jwt-parent-panel>
// Body:   { card_slug, base64, contentType }
//
// Permite al tutor (tutor_legal / tutor_secundario / player_self) subir o
// reemplazar la foto del menor DESPUÉS de la inscripción, desde su panel.
// Cierra el hueco del onboarding: en la inscripción la foto solo se captura
// si el padre marca derechos de imagen; aquí puede añadirla más tarde y el
// carnet deja de usar el placeholder.
//
// La foto va al carnet (uso del club) y a la ficha. NO hace pública la card:
// la visibilidad pública (public_card) sigue gobernada por parent-consent
// (consentimiento de visibilidad), un acto separado. Subir la foto no expone
// al menor.
//
// Auth = JWT parent-panel scoped al EMAIL del tutor. El card_slug del body se
// verifica contra card_admins (el tutor debe ser admin activo de ESA card),
// así un tutor nunca puede tocar la foto de un menor que no administra.
// Gateado por isCanteraActive() (410 si el carril está off).

const { createClient } = require('@supabase/supabase-js');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { isPlayer } = require('./lib/card-kind');
const { uploadPlayerPhoto } = require('./lib/player-photo');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Roles del tutor que entran por el panel del padre — espejo de
// parent-data.PARENT_ROLES. Todos pueden editar foto/datos (el tutor
// secundario también, según el modelo de roles); club_admin no entra aquí.
const PARENT_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self'];

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(payload),
  };
}

function makeHandler(db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Rate-limit: 20 req / 10 min por IP — re-subir la foto unas cuantas
    // veces probando encuadres sin permitir abuso del bucket.
    const rl = checkRateLimit(event, { bucket: 'upload-player-photo', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });
    if (!body.base64 || !body.contentType) {
      return jsonResponse(400, { error: 'Faltan campos: base64, contentType' });
    }

    // Card del jugador.
    const { data: card, error: cardErr } = await db
      .from('cards').select('slug, card_kind, deleted_at')
      .eq('slug', cardSlug).maybeSingle();
    if (cardErr) return jsonResponse(500, { error: cardErr.message });
    if (!card || card.deleted_at || !isPlayer(card)) return jsonResponse(404, { error: 'Jugador no encontrado' });

    // El email de la sesión debe ser tutor activo de la card.
    const { data: admin, error: aErr } = await db
      .from('card_admins').select('id')
      .eq('card_slug', cardSlug).eq('email', session.email).is('revoked_at', null)
      .in('role', PARENT_ROLES).limit(1).maybeSingle();
    if (aErr) return jsonResponse(500, { error: aErr.message });
    if (!admin) return jsonResponse(403, { error: 'No eres tutor de esta ficha' });

    // Sube al bucket Avatars/players/ y devuelve la URL pública.
    const up = await uploadPlayerPhoto(db, cardSlug, {
      base64: body.base64, contentType: body.contentType,
    });
    if (up.error) {
      const map = {
        mime: { code: 400, msg: 'Tipo no permitido (png, jpg, webp)' },
        too_large: { code: 400, msg: 'Imagen demasiado grande (máx 2 MB)' },
        empty: { code: 400, msg: 'Archivo vacío' },
        decode: { code: 400, msg: 'base64 inválido' },
        missing: { code: 400, msg: 'Faltan campos: base64, contentType' },
      };
      const e = map[up.error] || { code: 500, msg: 'No se pudo subir la foto' };
      if (e.code === 500) console.error('upload-player-photo:', up.error);
      return jsonResponse(e.code, { error: e.msg });
    }

    const { error: updErr } = await db.from('cards').update({ foto_url: up.url }).eq('slug', cardSlug);
    if (updErr) {
      console.error('upload-player-photo: db update error:', updErr.message);
      return jsonResponse(500, { error: updErr.message });
    }

    return jsonResponse(200, { ok: true, slug: cardSlug, foto_url: up.url });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
