'use strict';

// POST /api/parent-consent   ·   Cantera capa 3c (consentimiento parental)
//
// El tutor legal otorga un consentimiento LOPDGDD sobre la ficha del
// menor con doble verificación:
//   1er factor → JWT parent-panel (control del email, magic-link).
//   2º factor  → fecha de nacimiento del menor (dato registrado por el
//                club al fichar; ver lib/consent.verifySecondFactor).
//
// Tipos: parental_initial, data_processing, public_visibility, image_rights.
// public_visibility además pone cards.public_card=true (habilita /c/:slug
// del jugador). Inserta card_consents con evidence_jsonb (hash del
// documento + ip + user_agent). Append-only por RLS.
//
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { isPlayer } = require('./lib/card-kind');
const {
  CONSENT_TYPES, verifySecondFactor, clientIp, userAgentOf, buildConsentEvidence, recordConsent,
} = require('./lib/consent');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'parent-consent', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    const consentType = body.consent_type;
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });
    if (!CONSENT_TYPES.includes(consentType)) return jsonResponse(400, { error: 'consent_type inválido' });
    if (body.accepted !== true) return jsonResponse(400, { error: 'Debes aceptar explícitamente el consentimiento' });

    // Card del menor.
    const { data: card, error: cardErr } = await db
      .from('cards')
      .select('slug, card_kind, birth_year, birth_date_encrypted, public_card, deleted_at')
      .eq('slug', cardSlug).maybeSingle();
    if (cardErr) return jsonResponse(500, { error: cardErr.message });
    if (!card || card.deleted_at || !isPlayer(card)) return jsonResponse(404, { error: 'Jugador no encontrado' });

    // El email de la sesión debe ser tutor_legal ACTIVO de la card.
    const { data: admin, error: aErr } = await db
      .from('card_admins').select('id')
      .eq('card_slug', cardSlug).eq('email', session.email)
      .eq('role', 'tutor_legal').is('revoked_at', null)
      .limit(1).maybeSingle();
    if (aErr) return jsonResponse(500, { error: aErr.message });
    if (!admin) return jsonResponse(403, { error: 'Solo el tutor legal puede otorgar este consentimiento' });

    // 2º factor.
    if (!verifySecondFactor(card, body.birth_date)) {
      return jsonResponse(403, { error: 'Verificación fallida: la fecha de nacimiento no coincide' });
    }

    // Registra el consentimiento (append-only).
    const ip = clientIp(event);
    const ua = userAgentOf(event);
    const evidence = buildConsentEvidence({ consentType, documentVersion: body.document_version, ip, userAgent: ua });
    const { error: consErr } = await recordConsent(db, {
      cardSlug, consentType,
      grantedByEmail: session.email, grantedByRole: 'tutor_legal',
      ip, userAgent: ua, evidence,
    });
    if (consErr) {
      console.error('parent-consent: error grabando consentimiento:', consErr.message);
      return jsonResponse(500, { error: 'No se pudo registrar el consentimiento' });
    }

    // Efecto: public_visibility habilita la card pública del jugador.
    if (consentType === 'public_visibility' && !card.public_card) {
      const { error: upErr } = await db.from('cards').update({ public_card: true }).eq('slug', cardSlug);
      if (upErr) {
        // El consentimiento ya quedó registrado; informamos pero no lo perdemos.
        console.error('parent-consent: consentimiento ok pero public_card no actualizado:', upErr.message);
        return jsonResponse(200, { ok: true, consent_type: consentType, public_card: false, warning: 'public_card no actualizado' });
      }
    }

    return jsonResponse(200, {
      ok: true,
      consent_type: consentType,
      public_card: consentType === 'public_visibility' ? true : card.public_card,
    });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
