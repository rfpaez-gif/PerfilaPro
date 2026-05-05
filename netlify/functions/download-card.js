// Re-descarga del PDF imprimible de la tarjeta. Auth por token (mismo
// edit_token que edit-card / send-edit-link), TTL 7 días. Sirve para que el
// usuario pueda re-descargar la tarjeta desde el editor si pierde el email
// post-pago original.
//
// El asset original se genera y se adjunta automáticamente en stripe-webhook;
// este endpoint solo regenera bajo demanda con la última identidad guardada.

const { createClient } = require('@supabase/supabase-js');
const { buildPrintableCardPDF } = require('./printable-card-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'download-card', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, token } = event.queryStringParameters || {};
    if (!slug || !token) {
      return { statusCode: 400, body: 'Missing slug or token' };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, tagline, whatsapp, edit_token_expires_at')
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

    let pdfBuffer;
    try {
      pdfBuffer = await buildPrintableCardPDF({
        nombre:   card.nombre,
        tagline:  card.tagline,
        whatsapp: card.whatsapp,
        slug:     card.slug,
        cardUrl,
      });
    } catch (err) {
      console.error('Error generando PDF tarjeta:', err.message);
      return { statusCode: 500, body: 'Error generando PDF' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="perfilapro-${card.slug}.pdf"`,
        'Cache-Control':       'private, no-store',
      },
      body:            pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
