// Re-descarga del QR PNG en alta resolución. Auth por token (mismo edit_token
// que edit-card), TTL 7 días. Disponible para Base y Pro: ambos pagaron y
// ambos reciben el QR adjunto en el email post-pago.
//
// Diferencia con qr-download.js: aquel es público (cualquiera con el slug
// puede descargar el QR de un perfil Pro, lo usa el banner de la tarjeta
// pública). Éste exige token y sirve a los OWNERS para re-descargar desde el
// editor si pierden el email original.

const { createClient } = require('@supabase/supabase-js');
const { generateQrPngBuffer } = require('./printable-card-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PNG_DEFAULT_SIZE = 1024;
const PNG_MAX_SIZE     = 2048;

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'download-qr', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, token, size: rawSize } = event.queryStringParameters || {};
    if (!slug || !token) {
      return { statusCode: 400, body: 'Missing slug or token' };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, edit_token_expires_at')
      .eq('slug', slug)
      .eq('edit_token', token)
      .in('status', ['active', 'free'])
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return { statusCode: 401, body: 'Enlace inválido o expirado' };
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return { statusCode: 401, body: 'El enlace ha expirado. Solicita uno nuevo desde el editor.' };
    }

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const cardUrl = `${proto}://${host}/c/${card.slug}`;

    const requested = parseInt(rawSize, 10);
    const size = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, PNG_MAX_SIZE)
      : PNG_DEFAULT_SIZE;

    let buffer;
    try {
      buffer = await generateQrPngBuffer(cardUrl, size);
    } catch (err) {
      console.error('Error generando QR PNG:', err.message);
      return { statusCode: 500, body: 'Error generando QR' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'image/png',
        'Content-Disposition': `attachment; filename="perfilapro-${card.slug}-qr.png"`,
        'Cache-Control':       'private, no-store',
      },
      body:            buffer.toString('base64'),
      isBase64Encoded: true,
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
