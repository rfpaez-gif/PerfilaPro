'use strict';

/**
 * PerfilaPro · QR endpoint · GET /api/qr/:slug
 *
 * Sirve el QR con la estética de marca (módulos circulares en Tinta,
 * finders con cápsula+hueco+punto). Dos formatos:
 *   · SVG (default): vectorial, escalable, infinito.
 *   · PNG (?format=png&size=N): rasterizado vía @resvg/resvg-js,
 *     pensado para Instagram bio, vinilos, escaparates.
 *
 * Tiers · gating de descargas (alineado con la promesa del landing):
 *   · Free        → PNG con marca de agua "Creado con perfilapro.es" en pie.
 *                   SVG no disponible (404).
 *   · Trimestral  → PNG limpio sin marca. SVG no disponible.
 *   · Anual       → PNG limpio + SVG vectorial.
 *
 * El sello P NO va embebido en el SVG — es overlay HTML añadido por
 * el componente .pp-qr en components.css. En el PNG tampoco va, por
 * la misma razón: el sello vive en la capa de presentación, no en
 * el dato.
 *
 * Cache: clean → max-age 1 año immutable. Watermarked → max-age 5 min
 * (porque el usuario puede pasar a paid en cualquier momento y debe
 * ver el QR limpio sin esperar a que expire la cache).
 *
 * Tamaños SVG: 120, 160, 200, 280 (display).
 * Tamaños PNG: 256, 512, 1024, 2048 (descarga).
 *
 * Generador SVG: netlify/functions/lib/qr-svg.js
 * Demo:         public/_dev/qr.html
 */

const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { createClient } = require('@supabase/supabase-js');
const { buildQrSvg, buildCardUrl, VALID_SIZES } = require('./lib/qr-svg.js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const VALID_PNG_SIZES = [256, 512, 1024, 2048];
const FONTS_DIR = path.join(__dirname, 'lib/fonts');

const defaultSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Envuelve el SVG del QR (cuadrado) añadiendo una banda inferior con
// el texto "Creado con perfilapro.es" en gris-400. Mantiene la zona del
// QR intacta para no romper la legibilidad/escaneo. Usa Inter (cargada
// en Resvg vía fontDirs).
function wrapWithWatermark(qrSvg, qrSize) {
  const FOOTER_H = Math.round(qrSize * 0.13); // ≈ 36 si qrSize=280
  const totalH   = qrSize + FOOTER_H;
  const fontSize = Math.round(qrSize * 0.045); // ≈ 13 si qrSize=280

  const innerQr = qrSvg.replace(
    /^<svg[^>]*>/,
    `<svg x="0" y="0" width="${qrSize}" height="${qrSize}" viewBox="0 0 ${qrSize} ${qrSize}" xmlns="http://www.w3.org/2000/svg">`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${qrSize}" height="${totalH}" viewBox="0 0 ${qrSize} ${totalH}">
<rect width="${qrSize}" height="${totalH}" fill="#FFFFFF"/>
${innerQr}
<text x="${qrSize / 2}" y="${qrSize + FOOTER_H * 0.65}" text-anchor="middle" font-family="Inter" font-size="${fontSize}" fill="#9CA3AF">Creado con perfilapro.es</text>
</svg>`;
}

function makeHandler(deps = {}) {
  const db = deps.db || defaultSupabase;

  return async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Slug por query (?slug=) o por path (/api/qr/:slug)
  const slugFromQuery = event.queryStringParameters?.slug;
  const slugFromPath = event.path
    .replace('/.netlify/functions/qr', '')
    .replace(/^\/api\/qr\//, '')
    .replace(/^\/+|\/+$/g, '');
  const slug = slugFromQuery || slugFromPath;

  if (!slug) {
    return { statusCode: 400, body: 'Missing slug' };
  }

  // Sanitización mínima: el slug solo es a-z, 0-9, guión.
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { statusCode: 400, body: 'Invalid slug' };
  }

  const format = event.queryStringParameters?.format === 'png' ? 'png' : 'svg';
  const sizeRaw = parseInt(event.queryStringParameters?.size, 10);
  const allowedSizes = format === 'png' ? VALID_PNG_SIZES : VALID_SIZES;
  const defaultSize  = format === 'png' ? 1024 : 200;
  const size = allowedSizes.includes(sizeRaw) ? sizeRaw : defaultSize;

  // Rate-limit solo PNG: rasterizar consume CPU; SVG es cacheado al instante.
  if (format === 'png') {
    const rl = checkRateLimit(event, { bucket: 'qr-png', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);
  }

  // Lookup tier por slug. Esto define si añadimos marca de agua (free) o
  // bloqueamos el SVG (free + Trimestral). Si el slug no existe, devuelve
  // 404. Si la BD falla, abrimos la mano y servimos como Free para no
  // romper la descarga del lado del usuario; el log queda en CloudWatch.
  let plan = null;
  let isPaid = false;
  try {
    const { data: card, error } = await db
      .from('cards')
      .select('plan, stripe_session_id, kit_email_sent_at, deleted_at')
      .eq('slug', slug)
      .is('deleted_at', null)
      .single();
    if (error || !card) {
      return { statusCode: 404, body: 'Card not found' };
    }
    plan   = card.plan;
    // Promo redimida (kit_email_sent_at sin stripe_session_id) cuenta como
    // paid: el usuario activó su plan completo. Mismo gate que card.js y
    // claim-launch-promo.
    isPaid = !!card.stripe_session_id || !!card.kit_email_sent_at;
  } catch (err) {
    console.error('[qr] error lookup card:', err.message);
    // Defensivo: tratamos como Free (con marca de agua) en lugar de 500.
    plan = null;
    isPaid = false;
  }

  const isAnual = isPaid && plan === 'pro';
  const isFree  = !isPaid;

  // SVG vectorial: solo Anual.
  if (format === 'svg' && !isAnual) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/plain' },
      body: 'SVG download requires Anual plan',
    };
  }

  // Determina baseUrl desde headers (preview/prod tienen dominio distinto).
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const host  = (event.headers && event.headers.host) || 'perfilapro.es';
  const baseUrl = `${proto}://${host}`;

  // Genera siempre el SVG fuente. Para PNG, lo rasterizamos al tamaño pedido.
  let svg;
  try {
    // Para PNG el SVG fuente se genera al tamaño máximo (280) y resvg escala
    // al destino. Para SVG, respetamos el tamaño solicitado del display.
    const svgSize = format === 'png' ? 280 : size;
    svg = buildQrSvg(buildCardUrl(slug, baseUrl), { size: svgSize });
    if (isFree) {
      svg = wrapWithWatermark(svg, svgSize);
    }
  } catch (err) {
    console.error('[qr] error generando SVG:', err.message);
    return { statusCode: 500, body: 'Error generando QR' };
  }

  // Cache: clean → 1 año; watermarked → 5 min (al pasar a paid debe refrescar).
  const cacheControl = isFree
    ? 'public, max-age=300'
    : 'public, max-age=31536000, immutable';

  if (format === 'svg') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'image/svg+xml; charset=utf-8',
        'Cache-Control': cacheControl,
      },
      body: svg,
    };
  }

  // PNG: rasterizar el SVG vía resvg al tamaño pedido. Si free, el SVG ya trae
  // banda inferior con texto, así que cargamos fonts (Inter) en Resvg.
  let pngBuffer;
  try {
    const resvgOpts = { fitTo: { mode: 'width', value: size } };
    if (isFree) {
      resvgOpts.font = {
        fontDirs: [FONTS_DIR],
        loadSystemFonts: false,
        defaultFontFamily: 'Inter',
      };
    }
    const resvg = new Resvg(svg, resvgOpts);
    pngBuffer = resvg.render().asPng();
  } catch (err) {
    console.error('[qr] error rasterizando PNG:', err.message);
    return { statusCode: 500, body: 'Error generando QR PNG' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type':        'image/png',
      'Content-Disposition': `inline; filename="perfilapro-${slug}-${size}.png"`,
      'Cache-Control':       cacheControl,
    },
    body: pngBuffer.toString('base64'),
    isBase64Encoded: true,
  };
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
