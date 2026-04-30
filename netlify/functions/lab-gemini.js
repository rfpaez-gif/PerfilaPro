'use strict';

// Lab para iterar prompts con Gemini 2.5 Flash Image (Nano Banana).
// Uso interno: protegido por ADMIN_PASSWORD. Devuelve la imagen como
// data: URL para que el iPhone la pueda guardar con tap-largo.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function makeHandler(deps) {
  const _fetch = deps.fetch;
  const _getEnv = deps.getEnv;

  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return jsonResponse(400, { error: 'invalid_json' }); }

    const password = (body.password || '').toString();
    const expected = _getEnv('ADMIN_PASSWORD');
    if (!expected) return jsonResponse(500, { error: 'admin_password_not_configured' });
    if (password !== expected) return jsonResponse(401, { error: 'unauthorized' });

    const prompt = (body.prompt || '').toString().trim();
    if (!prompt) return jsonResponse(400, { error: 'empty_prompt' });
    if (prompt.length > 4000) return jsonResponse(400, { error: 'prompt_too_long' });

    const apiKey = _getEnv('GEMINI_API_KEY');
    if (!apiKey) return jsonResponse(500, { error: 'no_api_key' });

    const t0 = Date.now();
    let res;
    try {
      res = await _fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
    } catch (err) {
      return jsonResponse(502, { error: 'network_error', details: err.message });
    }

    let data;
    try { data = await res.json(); }
    catch { return jsonResponse(502, { error: 'invalid_gemini_response' }); }

    if (!res.ok) {
      return jsonResponse(502, {
        error: 'gemini_http_' + res.status,
        details: data?.error?.message || null,
      });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.data);
    const textPart = parts.find(p => p.text);

    if (!imagePart) {
      return jsonResponse(502, {
        error: 'no_image_returned',
        modelText: textPart?.text || null,
      });
    }

    const mime = imagePart.inlineData.mimeType || 'image/png';
    const b64 = imagePart.inlineData.data;
    return jsonResponse(200, {
      dataUrl: `data:${mime};base64,${b64}`,
      elapsedMs: Date.now() - t0,
      bytes: Math.round(b64.length * 0.75),
    });
  };
}

exports.handler = makeHandler({
  fetch: (...args) => fetch(...args),
  getEnv: (k) => process.env[k],
});
exports.makeHandler = makeHandler;
