// Endpoint de descarga de QR alta calidad para perfiles Pro.
//
// El card.js inline ya genera un QR 200x200 PNG visible en el perfil; ese es
// suficiente para escanear desde móvil. Para imprenta (tarjetas de visita,
// escaparate, vinilos) hace falta vector SVG o PNG ≥1024px.
//
// Acceso: solo Pro (los Base no tienen QR de descarga). Demos/seeds cuentan
// como Pro para mantener la pantalla de marketing.
//
// Output:
// - format=svg (default): SVG vectorial, escala infinita, ~1.5 KB
// - format=png:           PNG 1024x1024 por defecto, configurable hasta 2048

const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const QR_OPTS = {
  margin: 2,
  color: { dark: '#01696F', light: '#FFFFFF' },
};

const PNG_DEFAULT_SIZE = 1024;
const PNG_MAX_SIZE     = 2048;

// Whitelist de demos que se tratan como Pro a efectos de descarga (paridad con card.js).
const DEMO_SLUGS = ['paco-fontanero-alicante'];

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'qr-download', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, format: rawFormat, size: rawSize } = event.queryStringParameters || {};

    if (!slug) {
      return { statusCode: 400, body: 'Missing slug' };
    }

    const format = rawFormat === 'png' ? 'png' : 'svg';

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, plan, status')
      .eq('slug', slug)
      .in('status', ['active', 'free'])
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return { statusCode: 404, body: 'Not Found' };
    }

    const isDemo = DEMO_SLUGS.includes(card.slug);
    const isPro  = isDemo || card.plan === 'pro';
    if (!isPro) {
      return { statusCode: 403, body: 'QR alta calidad solo disponible en plan Pro' };
    }

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const cardUrl = `${proto}://${host}/c/${card.slug}`;

    if (format === 'svg') {
      let svg;
      try {
        svg = await QRCode.toString(cardUrl, { ...QR_OPTS, type: 'svg' });
      } catch (err) {
        console.error('QR SVG error:', err.message);
        return { statusCode: 500, body: 'Error generando QR' };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type':        'image/svg+xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="perfilapro-${card.slug}.svg"`,
          'Cache-Control':       'public, max-age=86400',
        },
        body: svg,
      };
    }

    // PNG
    const requested = parseInt(rawSize, 10);
    const size = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, PNG_MAX_SIZE)
      : PNG_DEFAULT_SIZE;

    let buffer;
    try {
      buffer = await QRCode.toBuffer(cardUrl, { ...QR_OPTS, type: 'png', width: size });
    } catch (err) {
      console.error('QR PNG error:', err.message);
      return { statusCode: 500, body: 'Error generando QR' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'image/png',
        'Content-Disposition': `attachment; filename="perfilapro-${card.slug}-${size}.png"`,
        'Cache-Control':       'public, max-age=86400',
      },
      body:            buffer.toString('base64'),
      isBase64Encoded: true,
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
