'use strict';

/**
 * PerfilaPro · QR SVG generator
 *
 * Genera el QR como SVG vectorial con tratamiento de marca:
 *   · Módulos circulares en --color-tinta (#0A1F44), no negro.
 *   · Finder patterns (esquinas) con cápsula redondeada exterior +
 *     hueco blanco + punto central redondeado.
 *   · Sin sello P incrustado: el sello se añade como overlay HTML
 *     sobre la imagen (clase .pp-qr__seal en components.css).
 *
 * Tolerancia: corrección H (~30%) para permitir que el sello tape
 * el centro sin romper el escaneo.
 *
 * Endpoint: netlify/functions/qr.js  (GET /api/qr/:slug)
 * Demo:     public/_dev/qr.html
 */

const QRCode = require('qrcode');

const TINTA = '#0A1F44';
const WHITE = '#FFFFFF';
const FINDER_SIZE = 7; // módulos
const VALID_SIZES = [120, 160, 200, 280];

/**
 * Genera el SVG del QR para una URL dada.
 *
 * @param {string} url           URL completa a codificar.
 * @param {Object} [opts]
 * @param {number} [opts.size=200]  Lado en px del SVG raíz (debe estar en VALID_SIZES).
 * @returns {string} SVG completo, listo para servir o embeber.
 */
function buildQrSvg(url, opts = {}) {
  const size = VALID_SIZES.includes(opts.size) ? opts.size : 200;

  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const matrix = qr.modules.data;
  const matrixSize = qr.modules.size;
  const moduleSize = size / matrixSize;
  const radius = moduleSize * 0.45;

  const finders = [
    { row: 0,                          col: 0 },
    { row: 0,                          col: matrixSize - FINDER_SIZE },
    { row: matrixSize - FINDER_SIZE,   col: 0 },
  ];

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">`,
    `<rect width="${size}" height="${size}" fill="${WHITE}"/>`,
  ];

  // Finder patterns (3 esquinas) con tratamiento especial.
  for (const f of finders) {
    const x = f.col * moduleSize;
    const y = f.row * moduleSize;
    const s = FINDER_SIZE * moduleSize;

    // Capa 1: cápsula redondeada exterior en Tinta
    const outerR = moduleSize * 1.5;
    parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${outerR}" ry="${outerR}" fill="${TINTA}"/>`);

    // Capa 2: hueco blanco (inset 1 módulo)
    const inset = moduleSize;
    const innerS = s - 2 * inset;
    const innerR = moduleSize;
    parts.push(`<rect x="${x + inset}" y="${y + inset}" width="${innerS}" height="${innerS}" rx="${innerR}" ry="${innerR}" fill="${WHITE}"/>`);

    // Capa 3: punto central redondeado en Tinta (inset 2 módulos)
    const dotInset = moduleSize * 2;
    const dotS = s - 2 * dotInset;
    const dotR = moduleSize * 0.75;
    parts.push(`<rect x="${x + dotInset}" y="${y + dotInset}" width="${dotS}" height="${dotS}" rx="${dotR}" ry="${dotR}" fill="${TINTA}"/>`);
  }

  // Módulos circulares (saltando los rectángulos de finder).
  for (let row = 0; row < matrixSize; row++) {
    for (let col = 0; col < matrixSize; col++) {
      const inFinder = finders.some(f =>
        row >= f.row && row < f.row + FINDER_SIZE &&
        col >= f.col && col < f.col + FINDER_SIZE
      );
      if (inFinder) continue;
      const isDark = matrix[row * matrixSize + col];
      if (!isDark) continue;
      const cx = col * moduleSize + moduleSize / 2;
      const cy = row * moduleSize + moduleSize / 2;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${TINTA}"/>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Construye la URL canónica que codifica el QR para un handle/slug.
 * TODO: migrar a vanity URL sin /c/ cuando se decida el routing.
 *
 * @param {string} slug
 * @param {string} [baseUrl='https://perfilapro.es']
 * @returns {string}
 */
function buildCardUrl(slug, baseUrl = 'https://perfilapro.es') {
  return `${baseUrl}/c/${slug}`;
}

module.exports = { buildQrSvg, buildCardUrl, VALID_SIZES };
