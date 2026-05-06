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
 * El sello P NO va embebido en el SVG — es overlay HTML añadido por
 * el componente .pp-qr en components.css. En el PNG tampoco va, por
 * la misma razón: el sello vive en la capa de presentación, no en
 * el dato.
 *
 * Cache: max-age 1 año + immutable. Para un mismo slug+format+size
 * el QR no cambia.
 *
 * Tamaños SVG: 120, 160, 200, 280 (display).
 * Tamaños PNG: 256, 512, 1024, 2048 (descarga).
 *
 * Generador SVG: netlify/functions/lib/qr-svg.js
 * Demo:         public/_dev/qr.html
 */

const { Resvg } = require('@resvg/resvg-js');
const { buildQrSvg, buildCardUrl, VALID_SIZES } = require('./lib/qr-svg.js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const VALID_PNG_SIZES = [256, 512, 1024, 2048];

exports.handler = async (event) => {
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
  } catch (err) {
    console.error('[qr] error generando SVG:', err.message);
    return { statusCode: 500, body: 'Error generando QR' };
  }

  if (format === 'svg') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: svg,
    };
  }

  // PNG: rasterizar el SVG vía resvg al tamaño pedido.
  let pngBuffer;
  try {
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
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
      'Cache-Control':       'public, max-age=31536000, immutable',
    },
    body: pngBuffer.toString('base64'),
    isBase64Encoded: true,
  };
};
