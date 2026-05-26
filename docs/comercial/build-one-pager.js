#!/usr/bin/env node
/**
 * Genera docs/comercial/one-pager-b2b.pdf a partir del copy del .md.
 *
 * Uso:  node docs/comercial/build-one-pager.js
 *
 * Fuentes y paleta sincronizadas con netlify/functions/printable-card-utils.js
 * y lib/email-layout.js. Si cambia el rebrand, este archivo se toca en el
 * mismo commit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', '..', 'netlify', 'functions', 'lib', 'fonts');
const OUT_PATH = path.join(__dirname, 'one-pager-b2b.pdf');

// ── A4 portrait ──────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 32;                       // margen exterior
const CW = PAGE_W - M * 2;          // ancho útil

const C = {
  ink:      '#0A1F44',
  inkSoft:  '#6B7280',
  match:    '#00C277',
  matchDk:  '#00A865',
  matchLt:  '#E6F9F0',
  crema:    '#FAF7F0',
  border:   '#E5E7EB',
  white:    '#FFFFFF',
};

const FONTS = {
  serif:        'SourceSerif4-Semibold.ttf',
  serifIt:      'SourceSerif4-SemiboldIt.ttf',
  sans:         'Inter-Regular.ttf',
  sansBold:     'Inter-Bold.ttf',
  sansSemi:     'Inter-SemiBold.ttf',
};

function registerFonts(doc) {
  doc.registerFont('serif',    path.join(FONTS_DIR, FONTS.serif));
  doc.registerFont('serif-it', path.join(FONTS_DIR, FONTS.serifIt));
  doc.registerFont('sans',     path.join(FONTS_DIR, FONTS.sans));
  doc.registerFont('sans-b',   path.join(FONTS_DIR, FONTS.sansBold));
  doc.registerFont('sans-s',   path.join(FONTS_DIR, FONTS.sansSemi));
}

// ── helpers ──────────────────────────────────────────────────────
function rect(doc, x, y, w, h, fill, stroke) {
  doc.save();
  if (fill)   doc.rect(x, y, w, h).fill(fill);
  if (stroke) doc.rect(x, y, w, h).lineWidth(0.75).stroke(stroke);
  doc.restore();
}

function roundRect(doc, x, y, w, h, r, fill, stroke) {
  doc.save();
  if (fill)   doc.roundedRect(x, y, w, h, r).fill(fill);
  if (stroke) doc.roundedRect(x, y, w, h, r).lineWidth(0.75).stroke(stroke);
  doc.restore();
}

function text(doc, str, x, y, opts = {}) {
  const { font = 'sans', size = 9, color = C.ink, ...rest } = opts;
  doc.font(font).fontSize(size).fillColor(color).text(str, x, y, rest);
}

// ── secciones ────────────────────────────────────────────────────
function drawHeader(doc) {
  const h = 50;
  rect(doc, 0, 0, PAGE_W, h, C.ink);
  // Wordmark
  doc.font('serif').fontSize(20).fillColor(C.white).text('Perfila', M, 16, { continued: true, lineBreak: false });
  doc.font('serif-it').fontSize(20).fillColor(C.match).text('Pro', { lineBreak: false });
  // Tagline derecha
  doc.font('sans-s').fontSize(9).fillColor('#B8C5D6')
    .text('Tarjetas digitales con tu marca · es / ca', M, 22, { width: CW, align: 'right' });
  return h;
}

function drawHero(doc, y0) {
  let y = y0 + 22;

  // Eyebrow mono-style
  doc.font('sans-s').fontSize(8).fillColor(C.matchDk)
    .text('PARA EQUIPOS, DESPACHOS Y COLEGIOS PROFESIONALES', M, y, {
      width: CW, align: 'center', characterSpacing: 1.3,
    });
  y += 18;

  // H1 serif
  doc.font('serif').fontSize(30).fillColor(C.ink)
    .text('Lista esta tarde, no en un trimestre.', M, y, {
      width: CW, align: 'center', lineGap: -2,
    });
  y += 40;

  // Subtítulo
  doc.font('sans').fontSize(10.5).fillColor(C.inkSoft)
    .text(
      'Una página web del equipo en perfilapro.es/e/tu-marca, un perfil digital por profesional, '
      + 'QR personal y tarjeta de visita física en PDF — todo bajo tu logo y tu color. '
      + 'Sin desarrollo, sin CMS, sin contraseñas para tus empleados.',
      M + 40, y,
      { width: CW - 80, align: 'center', lineGap: 2 }
    );
  y += 50;

  // Pill de precio
  const pillTxt = 'Desde 4 €/profesional/mes  ·  Sin permanencia  ·  Reembolso 30 días';
  const pillW = doc.font('sans-b').fontSize(10).widthOfString(pillTxt) + 28;
  const pillH = 24;
  const pillX = (PAGE_W - pillW) / 2;
  roundRect(doc, pillX, y, pillW, pillH, 12, C.matchLt, C.match);
  doc.font('sans-b').fontSize(10).fillColor(C.matchDk)
    .text(pillTxt, pillX, y + 7, { width: pillW, align: 'center' });
  y += pillH + 8;

  return y;
}

function drawTiers(doc, y0) {
  const gap = 10;
  const colW = (CW - gap * 2) / 3;
  const colH = 232;
  const y = y0;

  const tiers = [
    {
      name: 'Equipo',
      price: '4',
      unit: '€/profesional/mes',
      audience: '5 a 30 profesionales',
      heading: 'Incluye',
      bullets: [
        'Página del equipo con tu logo y color',
        'Perfil digital + QR por miembro',
        'Tarjeta de visita PDF (imprenta-ready)',
        'Onboarding por invitación, sin contraseñas',
        'Bilingüe ES / CA nativo',
        'Soporte por email (<48 h)',
      ],
      featured: false,
    },
    {
      name: 'Organización',
      price: '5',
      unit: '€/profesional/mes',
      audience: '30 a 100 profesionales',
      heading: 'Todo lo de Equipo, más',
      bullets: [
        'Branding completo: tagline, web, dirección',
        'Sección "Acerca de" en la página pública',
        'Estadísticas agregadas por miembro',
        'Booklet PDF del equipo entero',
        'Reenvío del kit por admin',
        'Soporte prioritario (<24 h)',
      ],
      featured: true,
    },
    {
      name: 'Enterprise',
      price: 'desde 6',
      unit: '€/profesional/mes',
      audience: 'Despachos multi-oficina · +100',
      heading: 'Todo lo de Organización, más',
      bullets: [
        'White-label (sin marca PerfilaPro)',
        'Multi-sede (cada miembro su dirección)',
        'Onboarding asistido por videollamada',
        'Plantillas de invitación personalizadas',
        'Atención dedicada',
      ],
      featured: false,
    },
  ];

  tiers.forEach((t, i) => {
    const x = M + i * (colW + gap);
    const stroke = t.featured ? C.match : C.border;
    const lineW = t.featured ? 1.6 : 0.75;

    doc.save();
    doc.roundedRect(x, y, colW, colH, 10).lineWidth(lineW).stroke(stroke);
    doc.restore();

    let cy = y + 14;

    if (t.featured) {
      const badge = 'MÁS POPULAR';
      const bw = doc.font('sans-b').fontSize(7.5).widthOfString(badge) + 14;
      const bh = 14;
      const bx = x + (colW - bw) / 2;
      const by = y - bh / 2;
      roundRect(doc, bx, by, bw, bh, 7, C.match);
      doc.font('sans-b').fontSize(7.5).fillColor(C.white)
        .text(badge, bx, by + 3.5, { width: bw, align: 'center', characterSpacing: 0.8 });
    }

    // Nombre
    doc.font('serif').fontSize(15).fillColor(C.ink)
      .text(t.name, x + 14, cy, { width: colW - 28 });
    cy += 20;

    // Audience
    doc.font('sans').fontSize(8.5).fillColor(C.inkSoft)
      .text(t.audience, x + 14, cy, { width: colW - 28 });
    cy += 16;

    // Precio
    doc.font('serif').fontSize(26).fillColor(C.ink)
      .text(t.price, x + 14, cy, { width: colW - 28, lineBreak: false });
    cy += 28;
    doc.font('sans').fontSize(8.5).fillColor(C.inkSoft)
      .text(t.unit, x + 14, cy, { width: colW - 28 });
    cy += 14;

    // Separador
    doc.save();
    doc.moveTo(x + 14, cy).lineTo(x + colW - 14, cy).lineWidth(0.5).stroke(C.border);
    doc.restore();
    cy += 8;

    // Heading
    doc.font('sans-b').fontSize(8).fillColor(C.ink)
      .text(t.heading, x + 14, cy, { width: colW - 28 });
    cy += 12;

    // Bullets
    t.bullets.forEach((b) => {
      doc.font('sans-b').fontSize(8).fillColor(C.matchDk)
        .text('✓', x + 14, cy, { lineBreak: false });
      doc.font('sans').fontSize(8).fillColor(C.ink)
        .text(b, x + 26, cy, { width: colW - 40, lineGap: 1 });
      const h = doc.heightOfString(b, { width: colW - 40, lineGap: 1 });
      cy += Math.max(h, 10) + 2;
    });
  });

  // Nota legal precios
  const noteY = y + colH + 6;
  doc.font('sans').fontSize(7.5).fillColor(C.inkSoft)
    .text(
      'Precios anuales con 2 meses gratis. Versión mensual +1 €/profesional.',
      M, noteY, { width: CW, align: 'center' }
    );

  return noteY + 14;
}

function drawSectorsTitle(doc, y) {
  doc.font('sans-s').fontSize(8).fillColor(C.matchDk)
    .text('PARA QUIÉN', M, y, { width: CW, align: 'center', characterSpacing: 1.3 });
  return y + 14;
}

function drawSectors(doc, y0) {
  const sectors = [
    {
      t: 'Empresas y redes profesionales',
      b: 'Tu marca viaja con cada empleado. Cuando alguien se va, su tarjeta se desactiva en un clic — la atribución y el contacto se quedan en casa.',
    },
    {
      t: 'Despachos y consultoras',
      b: 'Imagen homogénea para todos los socios y asociados. Mismo color, mismo logo, misma tipografía. Cero variación entre tarjetas, control central.',
    },
    {
      t: 'Colegios profesionales y asociaciones',
      b: 'La pertenencia como activo digital. Tus colegiados aparecen bajo tu marca; tú decides quién entra y quién sale del directorio público.',
    },
    {
      t: 'Sector público y ONGs',
      b: 'Identidad institucional sin CMS interno ni desarrollo a medida. Requisitos específicos (ENS, accesibilidad, contratación) se evalúan caso por caso.',
    },
  ];

  const gap = 10;
  const colW = (CW - gap) / 2;
  const rowH = 72;

  sectors.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * (colW + gap);
    const y = y0 + row * (rowH + gap);

    roundRect(doc, x, y, colW, rowH, 8, null, C.border);

    // Cuadrado verde
    rect(doc, x + 14, y + 16, 6, 6, C.match);

    doc.font('serif').fontSize(12).fillColor(C.ink)
      .text(s.t, x + 26, y + 12, { width: colW - 38 });

    doc.font('sans').fontSize(8.5).fillColor(C.inkSoft)
      .text(s.b, x + 14, y + 34, { width: colW - 28, lineGap: 1.5 });
  });

  return y0 + rowH * 2 + gap + 4;
}

function drawTrust(doc, y0) {
  const chips = [
    'Reembolso 30 días',
    'Sin permanencia',
    'Datos exportables (RGPD)',
    'Founding partner: −50% el primer año',
  ];

  let x = M;
  const y = y0;
  const hChip = 22;
  const gap = 8;

  // Calculo ancho total para centrar
  doc.font('sans-s').fontSize(8.5);
  const widths = chips.map((c) => doc.widthOfString(c) + 24);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
  x = (PAGE_W - totalW) / 2;

  chips.forEach((c, i) => {
    const w = widths[i];
    roundRect(doc, x, y, w, hChip, 11, C.crema, C.border);
    doc.font('sans-s').fontSize(8.5).fillColor(C.ink)
      .text(c, x, y + 6.5, { width: w, align: 'center' });
    x += w + gap;
  });

  return y + hChip + 10;
}

function drawCta(doc, y0) {
  const h = 78;
  const x = M;
  const w = CW;
  roundRect(doc, x, y0, w, h, 10, C.ink);

  doc.font('serif').fontSize(16).fillColor(C.white)
    .text('¿Lo vemos en 15 minutos?', x + 20, y0 + 14, { width: w - 40 });

  doc.font('sans').fontSize(9).fillColor('#B8C5D6')
    .text(
      'Demo en directo. Sin compromiso. Te monto una organización con tu marca, tu logo y tu color durante la propia llamada.',
      x + 20, y0 + 36, { width: w - 220, lineGap: 1.5 }
    );

  // Caja contacto derecha
  doc.font('sans-s').fontSize(8.5).fillColor(C.match)
    .text('WEB', x + w - 200, y0 + 18, { width: 60 });
  doc.font('sans-s').fontSize(10).fillColor(C.white)
    .text('perfilapro.es/es/empresas', x + w - 160, y0 + 17, { width: 160 });

  doc.font('sans-s').fontSize(8.5).fillColor(C.match)
    .text('EMAIL', x + w - 200, y0 + 42, { width: 60 });
  doc.font('sans-s').fontSize(10).fillColor(C.white)
    .text('hola@perfilapro.es', x + w - 160, y0 + 41, { width: 160 });

  return y0 + h;
}

function drawFooter(doc) {
  const y = PAGE_H - 22;
  doc.font('sans').fontSize(7).fillColor(C.inkSoft)
    .text(
      'PerfilaPro · Tarjetas digitales profesionales · Operación piloto 2026 · perfilapro.es',
      M, y, { width: CW, align: 'center' }
    );
}

// ── main ─────────────────────────────────────────────────────────
function build() {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: {
    Title:    'PerfilaPro · One-pager comercial B2B',
    Author:   'PerfilaPro',
    Subject:  'Tarjetas digitales para equipos, despachos y colegios',
    Keywords: 'tarjeta digital, equipos, despachos, colegios, B2B, white-label',
  } });

  registerFonts(doc);

  const stream = fs.createWriteStream(OUT_PATH);
  doc.pipe(stream);

  let y = 0;
  y = drawHeader(doc);
  y = drawHero(doc, y);
  y = drawTiers(doc, y + 4);
  y = drawSectorsTitle(doc, y + 2);
  y = drawSectors(doc, y);
  y = drawTrust(doc, y);
  drawCta(doc, y);
  drawFooter(doc);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

build()
  .then(() => {
    const stat = fs.statSync(OUT_PATH);
    console.log(`✓ Generado ${OUT_PATH} (${(stat.size / 1024).toFixed(1)} KB)`);
  })
  .catch((err) => {
    console.error('✗ Error:', err);
    process.exit(1);
  });
