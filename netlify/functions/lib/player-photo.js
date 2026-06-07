'use strict';

// Foto del jugador en la inscripción (capa carnet · foto en onboarding).
//
// El padre sube la foto del menor EN LA INSCRIPCIÓN, en el mismo acto en que
// concede los derechos de imagen (consent_image). Como el slug opaco `p-xxxx`
// se genera al crear la card, la foto se sube DESPUÉS de la creación (necesita
// el slug para la key de storage) y se escribe en `cards.foto_url`.
//
// `validatePlayerPhoto` es puro (no toca IO): valida MIME + tamaño y devuelve
// el buffer + extensión. `uploadPlayerPhoto` sube al bucket `Avatars` bajo
// `players/{slug}-{ts}.{ext}` y devuelve la URL pública. Best-effort en el
// caller: si falla, la card queda sin foto y el padre la sube luego desde el
// panel (vía de re-subida, follow-up).

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

// Valida { base64, contentType }. Devuelve { buffer, ext } o { error }.
function validatePlayerPhoto({ base64, contentType } = {}) {
  if (!base64 || !contentType) return { error: 'missing' };
  const ext = ALLOWED_MIME[String(contentType).toLowerCase()];
  if (!ext) return { error: 'mime' };
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return { error: 'decode' };
  }
  if (!buffer.length) return { error: 'empty' };
  if (buffer.length > MAX_PHOTO_BYTES) return { error: 'too_large' };
  return { buffer, ext };
}

// Sube la foto y devuelve { url } o { error }. Defensivo ante db sin storage.
async function uploadPlayerPhoto(db, slug, { base64, contentType } = {}) {
  const v = validatePlayerPhoto({ base64, contentType });
  if (v.error) return { error: v.error };
  if (!db || !db.storage) return { error: 'no_storage' };

  const fileName = `players/${slug}-${Date.now()}.${v.ext}`;
  const { error: upErr } = await db.storage
    .from('Avatars')
    .upload(fileName, v.buffer, { contentType, upsert: true });
  if (upErr) return { error: upErr.message || 'upload_failed' };

  const { data } = db.storage.from('Avatars').getPublicUrl(fileName);
  const url = data && data.publicUrl ? data.publicUrl : null;
  if (!url) return { error: 'no_url' };
  return { url };
}

module.exports = {
  MAX_PHOTO_BYTES,
  ALLOWED_MIME,
  validatePlayerPhoto,
  uploadPlayerPhoto,
};
