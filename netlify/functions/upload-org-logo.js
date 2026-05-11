'use strict';

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');
const { isValidOrgSlug } = require('./lib/org-utils');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB, mismo límite que upload-avatar
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function makeHandler(storage, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { slug, base64, contentType } = body;

    if (!slug || !base64 || !contentType) {
      return jsonResponse(400, { error: 'Faltan campos: slug, base64, contentType' });
    }
    if (!isValidOrgSlug(slug)) {
      return jsonResponse(400, { error: 'slug inválido' });
    }

    const ext = ALLOWED_MIME[contentType.toLowerCase()];
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

    // Verificar que la org existe y no está borrada antes de subir.
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug, logo_url')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();

    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org)   return jsonResponse(404, { error: 'organización no encontrada' });

    const fileName = `org-logos/${slug}-${Date.now()}.${ext}`;

    const { error: upErr } = await storage
      .from('Avatars')
      .upload(fileName, buffer, { contentType, upsert: false });

    if (upErr) {
      console.error('upload-org-logo: upload error:', upErr.message);
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
      console.error('upload-org-logo: db update error:', updErr.message);
      return jsonResponse(500, { error: updErr.message });
    }

    console.log(`upload-org-logo: ${slug} → ${publicUrl}`);

    return jsonResponse(200, {
      ok: true,
      slug,
      logo_url: publicUrl,
      bytes: buffer.length,
    });
  };
}

exports.handler = makeHandler(supabase.storage, supabase);
exports.makeHandler = makeHandler;
