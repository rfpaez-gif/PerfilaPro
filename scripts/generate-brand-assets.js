#!/usr/bin/env node
'use strict';

/**
 * PerfilaPro · Brand asset generator
 *
 * Input:  netlify/functions/lib/fonts/{SourceSerif4-Semibold,SourceSerif4-SemiboldIt}.ttf
 * Output: public/assets/brand/{svg,png}/...
 *
 * Pipeline:
 *   1. opentype.js parsea las TTF y convierte cada glifo a paths SVG
 *      (rendering POR GLIFO en (0,0) + transform="translate" — el
 *      render combinado de opentype produce NaN con offsets
 *      decimales, conocido bug de toPathData).
 *   2. @resvg/resvg-js rasteriza cada SVG a PNG @1x/@2x/@3x.
 *
 * Uso: node scripts/generate-brand-assets.js
 */

const fs       = require('fs');
const path     = require('path');
const opentype = require('opentype.js');
const { Resvg } = require('@resvg/resvg-js');

const FONTS_DIR = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'fonts');
const OUT_SVG   = path.join(__dirname, '..', 'public', 'assets', 'brand', 'svg');
const OUT_PNG   = path.join(__dirname, '..', 'public', 'assets', 'brand', 'png');

const COLORS = {
  tinta:  '#0A1F44',
  verde:  '#00C277',
  crema:  '#FAF7F0',
  white:  '#FFFFFF',
};

// --- Font loading -------------------------------------------------

function loadFont(filename) {
  const buf = fs.readFileSync(path.join(FONTS_DIR, filename));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fontRoman  = loadFont('SourceSerif4-Semibold.ttf');
const fontItalic = loadFont('SourceSerif4-SemiboldIt.ttf');

// --- Glyph layout primitives --------------------------------------

/**
 * Renderiza una palabra como secuencia de <path transform="translate(x 0)" d="..."/>
 * dentro de un <g> wrapper. Cada glifo se dibuja en (0, 0) con baseline en y=0
 * — el caller se encarga de posicionar el grupo entero.
 *
 * Devuelve { paths, width } donde paths es un array de { d, x, ch } y width
 * es el advance acumulado.
 */
function renderWord(text, font, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  const paths = [];
  let x = 0;
  let prevGlyph = null;

  for (const ch of text) {
    const glyph = font.charToGlyph(ch);

    // Aplicar kerning manual entre el glifo previo y éste
    if (prevGlyph) {
      const kern = font.getKerningValue(prevGlyph, glyph) || 0;
      x += kern * scale;
    }

    // Render del glifo en (0, 0) — NUNCA con offset, para evitar
    // el bug de NaN en toPathData con coordenadas decimales largas.
    const p = glyph.getPath(0, 0, fontSize);
    const d = p.toPathData(3);

    paths.push({ d, x, ch });

    x += glyph.advanceWidth * scale;
    prevGlyph = glyph;
  }

  return { paths, width: x };
}

/**
 * Construye el wordmark "Perfila" + "Pro" (Pro en italic).
 *
 * Devuelve estructura completa con los paths y métricas para que
 * los renderers de SVG la posicionen.
 */
function buildWordmark({ fontSize = 200 }) {
  const perfila = renderWord('Perfila', fontRoman, fontSize);

  // Gap óptico entre romana y italica: con 0 quedan demasiado pegadas
  // porque la italica tiene menos sidebearing izquierdo. -0.5% del fontSize
  // separa lo justo para igualar el render CSS de referencia.
  const proGap = fontSize * -0.005;
  const proX   = perfila.width + proGap;
  const pro    = renderWord('Pro', fontItalic, fontSize);

  const totalWidth  = proX + pro.width;
  const ascender    = (fontRoman.ascender  / fontRoman.unitsPerEm)  * fontSize;
  const descender   = (fontRoman.descender / fontRoman.unitsPerEm)  * fontSize;
  const totalHeight = ascender - descender; // descender negativo

  return {
    perfilaPaths: perfila.paths,
    perfilaWidth: perfila.width,
    proPaths:     pro.paths,
    proX,
    width:  totalWidth,
    height: totalHeight,
    ascender,
    descender,
  };
}

function pathsToSvg(paths, color) {
  return paths
    .map(p => `<path d="${p.d}" fill="${color}" transform="translate(${p.x.toFixed(3)} 0)"/>`)
    .join('');
}

// --- SVG composition ----------------------------------------------

function wordmarkSvg({ fontSize = 200, perfilaColor, proColor, bgColor = null }) {
  const wm = buildWordmark({ fontSize });

  // Clearance ≈ x-height (≈ 0.5 cap height)
  const pad = fontSize * 0.5;
  const svgW = wm.width + pad * 2;
  const svgH = wm.height + pad * 2;

  const bg = bgColor
    ? `<rect width="${svgW.toFixed(2)}" height="${svgH.toFixed(2)}" fill="${bgColor}"/>`
    : '';

  // Origen del grupo: padding + ascender (los paths tienen baseline en y=0,
  // y los glifos crecen "hacia arriba" en coordenadas SVG porque opentype
  // mete la y del baseline en el último argumento de getPath).
  const dxPerfila = pad;
  const dxPro     = pad + wm.proX;
  const dy        = pad + wm.ascender;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW.toFixed(2)} ${svgH.toFixed(2)}" width="${svgW.toFixed(0)}" height="${svgH.toFixed(0)}" role="img" aria-label="PerfilaPro">
  <title>PerfilaPro</title>
  ${bg}
  <g transform="translate(${dxPerfila.toFixed(2)} ${dy.toFixed(2)})">${pathsToSvg(wm.perfilaPaths, perfilaColor)}</g>
  <g transform="translate(${dxPro.toFixed(2)} ${dy.toFixed(2)})">${pathsToSvg(wm.proPaths, proColor)}</g>
</svg>
`;
}

/**
 * Isotipo: cuadrado redondeado con la "P" italic centrada.
 * Radio del rectángulo replicando el favicon real (rx ≈ 22% del lado).
 */
function isotypeSvg({ size = 256, bgColor, pColor }) {
  const radius = size * 0.22;
  // Tamaño de la P ≈ 78% del cuadrado para que respire
  const fontSize = size * 0.78;

  // Render del glifo P italic en (0, 0)
  const glyph = fontItalic.charToGlyph('P');
  const p = glyph.getPath(0, 0, fontSize);
  const d = p.toPathData(3);

  // BBox para centrar ópticamente
  const scale = fontSize / fontItalic.unitsPerEm;
  const bb = glyph.getBoundingBox();
  const glyphW = (bb.x2 - bb.x1) * scale;
  const glyphH = (bb.y2 - bb.y1) * scale;
  const glyphMinX = bb.x1 * scale;
  // y2 es máximo del glyph en coords font (positivo arriba); en SVG
  // los glifos rendereados con baseline=0 dibujan en y NEGATIVO
  // (hacia arriba de la baseline), así que el top del glifo está
  // en y = -y2*scale = -glyphMaxY.
  const glyphMaxY = bb.y2 * scale;

  // Centrado: x al centro - minX (alinea el "left bearing" al borde calculado)
  const dx = (size - glyphW) / 2 - glyphMinX;
  // Para y, queremos que la mitad vertical del glifo coincida con
  // la mitad del cuadrado. Glifo top está en -glyphMaxY; bottom en
  // -glyphMaxY + glyphH. Centro = -glyphMaxY + glyphH/2. Queremos
  // ese centro en size/2 → desplazar dy = size/2 - (-glyphMaxY + glyphH/2)
  //                                     = size/2 + glyphMaxY - glyphH/2
  // Compensamos +2% size hacia abajo por inclinación visual italica.
  const dy = size / 2 + glyphMaxY - glyphH / 2 + size * 0.02;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="PerfilaPro">
  <title>PerfilaPro</title>
  <rect width="${size}" height="${size}" rx="${radius.toFixed(2)}" ry="${radius.toFixed(2)}" fill="${bgColor}"/>
  <path d="${d}" fill="${pColor}" transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})"/>
</svg>
`;
}

/**
 * Lockup vertical: wordmark + tagline "Tu trabajo merece verse." debajo.
 */
function lockupSvg({ fontSize = 200, perfilaColor, proColor, taglineColor, bgColor = null, tagline = 'Tu trabajo merece verse.' }) {
  const wm = buildWordmark({ fontSize });

  // Tagline en italic, ≈ 22% del wordmark
  const tagSize = fontSize * 0.22;
  const tag = renderWord(tagline, fontItalic, tagSize);

  // Distancia logo→tagline ≈ 0.55 × cap height del wordmark
  const gap = fontSize * 0.55;
  const pad = fontSize * 0.5;

  const totalWidth  = pad * 2 + Math.max(wm.width, tag.width);
  const totalHeight = pad * 2 + wm.height + gap + tagSize * 1.2;

  // Centramos horizontalmente cada bloque dentro del ancho total
  const wmDx  = (totalWidth  - wm.width)  / 2;
  const tagDx = (totalWidth  - tag.width) / 2;
  const wmDy  = pad + wm.ascender;
  const tagDy = pad + wm.height + gap + tagSize;

  const bg = bgColor
    ? `<rect width="${totalWidth.toFixed(2)}" height="${totalHeight.toFixed(2)}" fill="${bgColor}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth.toFixed(2)} ${totalHeight.toFixed(2)}" width="${totalWidth.toFixed(0)}" height="${totalHeight.toFixed(0)}" role="img" aria-label="PerfilaPro · ${tagline}">
  <title>PerfilaPro · ${tagline}</title>
  ${bg}
  <g transform="translate(${wmDx.toFixed(2)} ${wmDy.toFixed(2)})">${pathsToSvg(wm.perfilaPaths, perfilaColor)}</g>
  <g transform="translate(${(wmDx + wm.proX).toFixed(2)} ${wmDy.toFixed(2)})">${pathsToSvg(wm.proPaths, proColor)}</g>
  <g transform="translate(${tagDx.toFixed(2)} ${tagDy.toFixed(2)})">${pathsToSvg(tag.paths, taglineColor)}</g>
</svg>
`;
}

// --- Variant catalog ----------------------------------------------

const WORDMARK_VARIANTS = [
  { name: 'wordmark-default',     perfilaColor: COLORS.tinta, proColor: COLORS.verde, bgColor: null,         desc: 'Sobre crema o blanco · uso por defecto' },
  { name: 'wordmark-on-tinta',    perfilaColor: COLORS.white, proColor: COLORS.verde, bgColor: COLORS.tinta, desc: 'Sobre fondo tinta · header oscuro' },
  { name: 'wordmark-on-verde',    perfilaColor: COLORS.white, proColor: COLORS.white, bgColor: COLORS.verde, desc: 'Sobre fondo verde · banderines, hero' },
  { name: 'wordmark-mono-tinta',  perfilaColor: COLORS.tinta, proColor: COLORS.tinta, bgColor: null,         desc: 'Monocromo tinta · impresión B/N, fotocopia, grabado' },
  { name: 'wordmark-mono-blanco', perfilaColor: COLORS.white, proColor: COLORS.white, bgColor: COLORS.tinta, desc: 'Monocromo blanco sobre tinta · merchandising oscuro' },
  { name: 'wordmark-mono-verde',  perfilaColor: COLORS.verde, proColor: COLORS.verde, bgColor: null,         desc: 'Monocromo verde · merchandising vibrante' },
];

const ISOTYPE_VARIANTS = [
  { name: 'isotype-tinta', bgColor: COLORS.tinta, pColor: COLORS.verde, desc: 'Cuadrado tinta · favicon, sello QR (default)' },
  { name: 'isotype-verde', bgColor: COLORS.verde, pColor: COLORS.white, desc: 'Cuadrado verde · app icon redes' },
  { name: 'isotype-white', bgColor: COLORS.white, pColor: COLORS.tinta, desc: 'Cuadrado blanco · watermark, fondo claro (añadir borde si va sobre crema)' },
];

const LOCKUP_VARIANTS = [
  { name: 'lockup-default', perfilaColor: COLORS.tinta, proColor: COLORS.verde, taglineColor: COLORS.tinta, bgColor: null, desc: 'Lockup wordmark + tagline · hero, deck, factura' },
];

// --- Generation ---------------------------------------------------

const PNG_SCALES = [1, 2, 3];
const PNG_BASE_WIDTH = {
  wordmark: 480,
  isotype:  256,
  lockup:   600,
};

function pickPngBaseWidth(variantName) {
  if (variantName.startsWith('isotype'))  return PNG_BASE_WIDTH.isotype;
  if (variantName.startsWith('lockup'))   return PNG_BASE_WIDTH.lockup;
  return PNG_BASE_WIDTH.wordmark;
}

function rasterize(svgString, baseWidth, scale) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: baseWidth * scale },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

function generateAll() {
  const all = [
    ...WORDMARK_VARIANTS.map(v => ({ ...v, svg: wordmarkSvg(v) })),
    ...ISOTYPE_VARIANTS.map(v => ({ ...v, svg: isotypeSvg(v) })),
    ...LOCKUP_VARIANTS.map(v => ({ ...v, svg: lockupSvg(v) })),
  ];

  const generated = [];

  for (const v of all) {
    if (v.svg.includes('NaN')) {
      throw new Error(`SVG inválido (NaN) en variante ${v.name}`);
    }

    const svgFile = `perfilapro-${v.name}.svg`;
    const svgPath = path.join(OUT_SVG, svgFile);
    fs.writeFileSync(svgPath, v.svg);
    console.log(`SVG  ${svgFile}`);

    const baseW = pickPngBaseWidth(v.name);
    const pngFiles = [];
    for (const scale of PNG_SCALES) {
      const pngFile = `perfilapro-${v.name}@${scale}x.png`;
      const pngPath = path.join(OUT_PNG, pngFile);
      const buffer = rasterize(v.svg, baseW, scale);
      fs.writeFileSync(pngPath, buffer);
      pngFiles.push({ file: pngFile, width: baseW * scale });
      console.log(`PNG  ${pngFile} (${baseW * scale}px)`);
    }

    generated.push({
      name: v.name,
      desc: v.desc,
      svgFile,
      pngFiles,
    });
  }

  return generated;
}

if (require.main === module) {
  console.log('Generando assets de marca PerfilaPro…\n');
  const generated = generateAll();
  console.log(`\n✓ ${generated.length} variantes · ${generated.length * (1 + PNG_SCALES.length)} archivos en public/assets/brand/`);
}

module.exports = { generateAll, WORDMARK_VARIANTS, ISOTYPE_VARIANTS, LOCKUP_VARIANTS, COLORS };
