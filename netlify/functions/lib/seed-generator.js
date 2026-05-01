'use strict';

// Generador de retratos para perfiles semilla (is_seed = true).
// Reutilizable desde scripts CLI y desde Netlify Functions admin.
//
// Exporta:
//   generateImage(prompt, opts)   → { buffer, mimeType }
//   buildPromptFromCard(card)     → string
//   regenerateSeedCard(db, slug, opts) → { slug, foto_url }
//
// Patrón makeHandler(deps): los consumidores inyectan { fetch, apiKey } para tests.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

const BASE_PROMPT =
  'Portrait photo, professional, warm natural light, subject in upper third of frame, ' +
  'neutral or soft background. 600x800px, vertical format. Realistic, approachable, no text.';

const STORAGE_BUCKET = 'Avatars';
const STORAGE_FOLDER = 'seeds';

async function generateImage(prompt, opts = {}) {
  const _fetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const apiKey = opts.apiKey;

  if (!_fetch) throw new Error('no_fetch');
  if (!apiKey) throw new Error('no_api_key');
  if (!prompt || !String(prompt).trim()) throw new Error('empty_prompt');

  let res;
  try {
    res = await _fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: String(prompt) }] }],
      }),
    });
  } catch (err) {
    throw new Error('network_error: ' + (err.message || 'unknown'));
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error('invalid_gemini_response'); }

  if (!res.ok) {
    const detail = data && data.error && data.error.message ? data.error.message : '';
    throw new Error('gemini_http_' + res.status + (detail ? ': ' + detail : ''));
  }

  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const imagePart = parts.find(p => p && p.inlineData && p.inlineData.data);
  if (!imagePart) {
    const textPart = parts.find(p => p && p.text);
    const tail = textPart && textPart.text ? ': ' + String(textPart.text).slice(0, 120) : '';
    throw new Error('no_image_returned' + tail);
  }

  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  return { buffer, mimeType };
}

function buildPromptFromCard(card) {
  const role = (card && (card.profession_label || card.tagline)) || 'professional';
  return `${BASE_PROMPT} A ${role} at work.`;
}

async function regenerateSeedCard(db, slug, opts = {}) {
  if (!slug) throw new Error('missing_slug');

  const apiKey = opts.apiKey;
  const _fetch = opts.fetch;
  const promptBuilder = opts.buildPrompt || buildPromptFromCard;
  const _generateImage = opts.generateImage || generateImage;
  const now = opts.now || Date.now;

  const { data: card, error: fetchErr } = await db
    .from('cards')
    .select('slug, nombre, tagline, profession_label, foto_url, is_seed')
    .eq('slug', slug)
    .maybeSingle();

  if (fetchErr) throw new Error('db_fetch_error: ' + (fetchErr.message || 'unknown'));
  if (!card) throw new Error('card_not_found');

  const prompt = promptBuilder(card);
  const { buffer, mimeType } = await _generateImage(prompt, { fetch: _fetch, apiKey });

  // Path estable (.jpg) para evitar orphans entre regeneraciones; el contentType
  // real lo dicta Gemini y los navegadores lo respetan vía cabecera HTTP.
  const storagePath = `${STORAGE_FOLDER}/${slug}.jpg`;

  const { error: uploadErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
  if (uploadErr) throw new Error('upload_error: ' + (uploadErr.message || 'unknown'));

  const pub = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const baseUrl = pub && pub.data && pub.data.publicUrl;
  if (!baseUrl) throw new Error('no_public_url');

  const fotoUrl = `${baseUrl}?v=${now()}`;

  const { error: updateErr } = await db
    .from('cards')
    .update({ foto_url: fotoUrl })
    .eq('slug', slug);
  if (updateErr) throw new Error('update_error: ' + (updateErr.message || 'unknown'));

  return { slug, foto_url: fotoUrl };
}

module.exports = {
  generateImage,
  buildPromptFromCard,
  regenerateSeedCard,
  BASE_PROMPT,
  STORAGE_BUCKET,
  STORAGE_FOLDER,
};
