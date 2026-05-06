'use strict';

/**
 * PerfilaPro · PDF font registration helper
 *
 * Las fuentes de marca (Source Serif 4 + Inter) se embeben en cada
 * PDF generado vía PDFKit. PDFKit subsetea automáticamente cada
 * fuente al conjunto de glifos usado, así que el peso final del
 * PDF crece poco (~30-50KB típico) aunque los TTFs originales sean
 * grandes.
 *
 * Las TTFs viven en `netlify/functions/lib/fonts/` y se distribuyen
 * con cada Lambda gracias a `included_files` en netlify.toml.
 *
 * Aliases de fuente registrados:
 *   - 'PP-Serif'        · Source Serif 4 Semibold (weight 600 normal)
 *   - 'PP-Serif-Italic' · Source Serif 4 Semibold Italic
 *   - 'PP-Sans'         · Inter Regular
 *   - 'PP-Sans-Bold'    · Inter Bold
 *   - 'PP-Sans-SemiBold'· Inter SemiBold
 *
 * Tras `registerFonts(doc)`, llamar `doc.font('PP-Serif').text(...)`
 * etcétera. Si por alguna razón fallase la carga, PDFKit conservará
 * sus fuentes nativas Helvetica como fallback (no rompe la generación).
 */

const path = require('path');

const FONTS_DIR = path.join(__dirname, 'fonts');

const FONTS = {
  'PP-Serif':         'SourceSerif4-Semibold.ttf',
  'PP-Serif-Italic':  'SourceSerif4-SemiboldIt.ttf',
  'PP-Sans':          'Inter-Regular.ttf',
  'PP-Sans-SemiBold': 'Inter-SemiBold.ttf',
  'PP-Sans-Bold':     'Inter-Bold.ttf',
};

/**
 * Registra todas las fuentes de marca en un documento PDFKit.
 * Idempotente — llamarlo varias veces es seguro pero superfluo.
 *
 * @param {PDFDocument} doc
 */
function registerFonts(doc) {
  for (const [alias, file] of Object.entries(FONTS)) {
    try {
      doc.registerFont(alias, path.join(FONTS_DIR, file));
    } catch (err) {
      // No relanza: PDFKit deja Helvetica como fallback si una fuente falla.
      console.error(`[pdf-fonts] No se pudo registrar ${alias} (${file}):`, err.message);
    }
  }
}

/**
 * Dibuja el wordmark "Perfila" + "Pro" italic verde como texto PDFKit.
 * Centrado horizontalmente en el ancho dado.
 *
 * @param {PDFDocument} doc
 * @param {Object}  opts
 * @param {number}  opts.x            Coordenada X del bloque (origen izquierdo)
 * @param {number}  opts.y            Coordenada Y del bloque
 * @param {number}  opts.width        Ancho del bloque (para centrar)
 * @param {number}  [opts.size=24]    Tamaño en puntos PDF
 * @param {string}  [opts.colorBase='#0A1F44']  Color de "Perfila"
 * @param {string}  [opts.colorPro='#00C277']   Color de "Pro"
 * @returns {number} Y final tras el wordmark (para encadenar el cursor)
 */
function drawWordmark(doc, opts) {
  const { x, y, width } = opts;
  const size       = opts.size       || 24;
  const colorBase  = opts.colorBase  || '#0A1F44';
  const colorPro   = opts.colorPro   || '#00C277';
  const charSp     = -size * 0.02; // letter-spacing -0.02em

  // Mide ambas piezas para centrar el conjunto.
  doc.font('PP-Serif').fontSize(size);
  const wPerfila = doc.widthOfString('Perfila', { characterSpacing: charSp });
  doc.font('PP-Serif-Italic').fontSize(size);
  const wPro = doc.widthOfString('Pro', { characterSpacing: charSp });

  const totalW = wPerfila + wPro;
  const startX = x + (width - totalW) / 2;

  doc.font('PP-Serif').fontSize(size).fillColor(colorBase)
    .text('Perfila', startX, y, { lineBreak: false, characterSpacing: charSp });
  doc.font('PP-Serif-Italic').fontSize(size).fillColor(colorPro)
    .text('Pro', startX + wPerfila, y, { lineBreak: false, characterSpacing: charSp });

  return y + size * 1.05;
}

module.exports = { registerFonts, drawWordmark, FONTS };
