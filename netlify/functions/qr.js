'use strict';

/**
 * PerfilaPro · QR endpoint · GET /api/qr/:slug
 *
 * Sirve el QR como SVG vectorial con la estética de marca (módulos
 * circulares en Tinta, finders con cápsula+hueco+punto). El sello P
 * NO va embebido aquí — es overlay HTML añadido por el componente
 * .pp-qr en components.css.
 *
 * Cache: max-age 1 año + immutable. Para un mismo slug+size el QR
 * no cambia. Si en el futuro se migra el routing a vanity URL sin
 * /c/, hay que purgar la caché o cambiar el path del endpoint.
 *
 * Tamaños permitidos: 120, 160, 200, 280. Cualquier otro cae a 200.
 *
 * Generador: netlify/functions/lib/qr-svg.js
 * Demo:      public/_dev/qr.html
 */

const { buildQrSvg, buildCardUrl, VALID_SIZES } = require('./lib/qr-svg.js');

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

  const sizeRaw = parseInt(event.queryStringParameters?.size, 10);
  const size = VALID_SIZES.includes(sizeRaw) ? sizeRaw : 200;

  // Determina baseUrl desde headers (preview/prod tienen dominio distinto).
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const host  = (event.headers && event.headers.host) || 'perfilapro.es';
  const baseUrl = `${proto}://${host}`;

  let svg;
  try {
    svg = buildQrSvg(buildCardUrl(slug, baseUrl), { size });
  } catch (err) {
    console.error('[qr] error generando SVG:', err.message);
    return { statusCode: 500, body: 'Error generando QR' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type':  'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: svg,
  };
};
