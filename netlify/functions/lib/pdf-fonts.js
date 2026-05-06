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
 * IMPORTANTE — el caller debe pasar el directorio de fuentes:
 *
 *   const path = require('path');
 *   const { registerFonts } = require('./lib/pdf-fonts');
 *   registerFonts(doc, path.join(__dirname, 'lib/fonts'));
 *
 * No usamos __dirname dentro de este helper porque al ser inlineado
 * por esbuild en cada función, su __dirname pierde la referencia al
 * archivo fuente y resuelve al entrypoint (netlify/functions/), donde
 * `fonts/` no existe. El caller siempre vive en netlify/functions/
 * (mismo nivel que share-image.js, que ya usa este patrón con éxito),
 * así que su __dirname sí es estable.
 */

const path = require('path');

const FONTS = {
  'PP-Serif':         'SourceSerif4-Semibold.ttf',
  'PP-Serif-Italic':  'SourceSerif4-SemiboldIt.ttf',
  'PP-Sans':          'Inter-Regular.ttf',
  'PP-Sans-SemiBold': 'Inter-SemiBold.ttf',
  'PP-Sans-Bold':     'Inter-Bold.ttf',
};

/**
 * Registra todas las fuentes de marca en un documento PDFKit.
 *
 * @param {PDFDocument} doc
 * @param {string}      fontsDir  Path absoluto al directorio con los TTFs.
 *                                Típicamente `path.join(__dirname, 'lib/fonts')`
 *                                desde una función en netlify/functions/.
 */
function registerFonts(doc, fontsDir) {
  if (!fontsDir) {
    throw new Error('registerFonts: fontsDir es obligatorio. Pasa path.join(__dirname, "lib/fonts") desde la función caller.');
  }
  for (const [alias, file] of Object.entries(FONTS)) {
    doc.registerFont(alias, path.join(fontsDir, file));
  }
}

module.exports = { registerFonts, FONTS };

