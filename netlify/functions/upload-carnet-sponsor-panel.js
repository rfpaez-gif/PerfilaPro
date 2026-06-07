'use strict';

// POST /api/upload-carnet-sponsor-panel
// Header: Authorization: Bearer <jwt-panel>
// Body:   { base64, contentType }
//
// Espejo de upload-org-logo-panel.js para la imagen de PATROCINADOR de la
// cara B del carnet del jugador. Auth via JWT del panel (org-panel), scoped
// a session.orgId — el club NO puede subir el patrocinador de otra org. Solo
// sports_club. Sube a Avatars/carnet-sponsors/ y escribe
// organizations.carnet_sponsor_url (migración 043). El render del carnet
// (printable-card-utils · renderPlayerCardBack) lo consume.
//
// Gateado por isCanteraActive() (410 si el carril está off).

const { createClient } = require('@supabase/supabase-js');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(payload),
  };
}

function makeHandler(storage, db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'upload-carnet-sponsor-panel', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const { base64, contentType } = body;
    if (!base64 || !contentType) return jsonResponse(400, { error: 'Faltan campos: base64, contentType' });

    const ext = ALLOWED_MIME[String(contentType).toLowerCase()];
    if (!ext) return jsonResponse(400, { error: 'Tipo no permitido (png, jpg, webp, svg)' });

    let buffer;
    try { buffer = Buffer.from(base64, 'base64'); } catch { return jsonResponse(400, { error: 'base64 inválido' }); }
    if (!buffer.length) return jsonResponse(400, { error: 'archivo vacío' });
    if (buffer.length > MAX_BYTES) return jsonResponse(400, { error: 'imagen demasiado grande (máx 2 MB)' });

    // Org resuelta desde el JWT. Solo sports_club (el carnet es del carril cantera).
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug, kind')
      .eq('id', session.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org) return unauthorizedResponse();
    if (org.kind !== 'sports_club') return jsonResponse(409, { error: 'El patrocinador del carnet solo aplica a clubes deportivos' });

    const fileName = `carnet-sponsors/${org.slug}-${Date.now()}.${ext}`;

    const { error: upErr } = await storage.from('Avatars').upload(fileName, buffer, { contentType, upsert: false });
    if (upErr) {
      console.error('upload-carnet-sponsor-panel: upload error:', upErr.message);
      return jsonResponse(500, { error: upErr.message });
    }

    const { data: publicData } = storage.from('Avatars').getPublicUrl(fileName);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) return jsonResponse(500, { error: 'no se pudo obtener la URL pública' });

    const { error: updErr } = await db
      .from('organizations')
      .update({ carnet_sponsor_url: publicUrl })
      .eq('id', org.id);
    if (updErr) {
      console.error('upload-carnet-sponsor-panel: db update error:', updErr.message);
      return jsonResponse(500, { error: updErr.message });
    }

    console.log(`upload-carnet-sponsor-panel: ${org.slug} → ${publicUrl}`);
    return jsonResponse(200, { ok: true, slug: org.slug, carnet_sponsor_url: publicUrl, bytes: buffer.length });
  };
}

exports.handler = makeHandler(supabase.storage, supabase);
exports.makeHandler = makeHandler;
