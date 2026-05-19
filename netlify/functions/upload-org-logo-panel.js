'use strict';

// POST /api/upload-org-logo-panel
// Header: Authorization: Bearer <jwt-panel>
// Body:   { base64, contentType }
//
// Espejo de upload-org-logo.js pero scoped al panel cliente B2B:
// auth via JWT del panel (lib/panel-auth.signPanelSession), NO admin
// password + TOTP. Resuelve el slug desde session.orgSlug — el cliente
// NO puede pasar un slug en el body porque sólo opera sobre su propia
// org. Mismo bucket (Avatars/org-logos/), mismo MAX_BYTES, misma
// whitelist de MIME que la versión admin.

const { createClient } = require('@supabase/supabase-js');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB, mismo límite que upload-org-logo.js
const ALLOWED_MIME = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
    body: JSON.stringify(payload),
  };
}

function makeHandler(storage, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Rate limit defensivo. 20 req / 10 min por IP/sesión cubre re-subir
    // el logo unas cuantas veces (cliente probando con distintas versiones
    // del logo) sin permitir abuso del bucket.
    const rl = checkRateLimit(event, {
      bucket: 'upload-org-logo-panel',
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { base64, contentType } = body;
    if (!base64 || !contentType) {
      return jsonResponse(400, { error: 'Faltan campos: base64, contentType' });
    }

    const ext = ALLOWED_MIME[String(contentType).toLowerCase()];
    if (!ext) {
      return jsonResponse(400, { error: 'Tipo no permitido (png, jpg, webp, svg)' });
    }

    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return jsonResponse(400, { error: 'base64 inválido' });
    }
    if (!buffer.length) {
      return jsonResponse(400, { error: 'archivo vacío' });
    }
    if (buffer.length > MAX_BYTES) {
      return jsonResponse(400, { error: 'imagen demasiado grande (máx 2 MB)' });
    }

    // Org resuelta desde el JWT — el cliente NO puede subir el logo de
    // otra org porque no puede falsificar la sesión.
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug')
      .eq('id', session.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org)   return unauthorizedResponse();

    const fileName = `org-logos/${org.slug}-${Date.now()}.${ext}`;

    const { error: upErr } = await storage
      .from('Avatars')
      .upload(fileName, buffer, { contentType, upsert: false });
    if (upErr) {
      console.error('upload-org-logo-panel: upload error:', upErr.message);
      return jsonResponse(500, { error: upErr.message });
    }

    const { data: publicData } = storage.from('Avatars').getPublicUrl(fileName);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      return jsonResponse(500, { error: 'no se pudo obtener la URL pública' });
    }

    const { error: updErr } = await db
      .from('organizations')
      .update({ logo_url: publicUrl })
      .eq('id', org.id);
    if (updErr) {
      console.error('upload-org-logo-panel: db update error:', updErr.message);
      return jsonResponse(500, { error: updErr.message });
    }

    console.log(`upload-org-logo-panel: ${org.slug} → ${publicUrl}`);

    return jsonResponse(200, {
      ok: true,
      slug: org.slug,
      logo_url: publicUrl,
      bytes: buffer.length,
    });
  };
}

exports.handler = makeHandler(supabase.storage, supabase);
exports.makeHandler = makeHandler;
