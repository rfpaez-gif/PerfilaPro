// Generador de la tarjeta imprimible (PDF A6 vertical) y del QR PNG en alta
// resolución que viajan adjuntos al email post-pago. La utilidad es shared
// entre stripe-webhook (envío automático) y los endpoints download-card /
// download-qr (re-descarga desde el editor con token).
//
// Diseño:
// - PDF A6 vertical (105×148mm), sin foto. La foto vive en el perfil digital
//   que se abre al escanear el QR; el papel es solo el portal.
// - Tipografías Helvetica nativas de PDFKit — render idéntico en todos los
//   visores, sin coste de carga ni dependencia de fuentes externas.
// - El usuario imprime tal cual (tamaño A6, cabe en un bolsillo) o ampliado
//   al 200% (A5 pared/escaparate) o al 50% (~A7 mano). PDF vectorial salvo
//   por el QR, que se embebe en PNG 1200px (densidad sobrada para imprenta).
//
// Hex codes sincronizados con tokens.css y lib/email-layout.js. Si cambia la
// paleta del producto, este archivo debe tocarse en el MISMO commit.

const path = require('path');
const PDFDocument = require('pdfkit');
const { Resvg } = require('@resvg/resvg-js');
const { buildQrSvg } = require('./lib/qr-svg.js');
const { registerFonts } = require('./lib/pdf-fonts');

// __dirname = netlify/functions/ (tanto local como bundlado por esbuild).
// El helper pdf-fonts.js no puede usar su propio __dirname al inlinearse.
const FONTS_DIR = path.join(__dirname, 'lib/fonts');

const A6_WIDTH  = 297.64; // 105mm en puntos PDF (1pt = 1/72")
const A6_HEIGHT = 419.53; // 148mm

// Paleta del PDF imprimible · alineada con el rebrand.
// Header band en Tinta (la tarjeta es marketing, no documento legal —
// Teal Documentos queda restringido a factura/contrato según brief).
const COLORS = {
  surface:    '#FFFFFF',
  ink:        '#0A1F44', // tinta
  inkSoft:    '#6B7280', // gris-500
  accent:     '#0A1F44', // tinta (header band)
  match:      '#00C277', // verde-match (acentos del wordmark)
  border:     '#E5E7EB', // gris-200
};

function formatSpanishPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  let local;
  if (digits.length === 11 && digits.startsWith('34')) local = digits.substring(2);
  else if (digits.length === 9) local = digits;
  else return String(phone);
  return `+34 ${local.substring(0, 3)} ${local.substring(3, 5)} ${local.substring(5, 7)} ${local.substring(7, 9)}`;
}

// Rasteriza el SVG del QR al PNG del tamaño solicitado.
// El SVG fuente se genera a 280 (max display size) y resvg escala — fitTo
// width preserva proporción y nitidez sub-pixel.
function rasterizeQrSvgToPng(cardUrl, size) {
  const svg = buildQrSvg(cardUrl, { size: 280 });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

async function generateQrPngBuffer(cardUrl, size = 1024) {
  return rasterizeQrSvgToPng(cardUrl, size);
}

async function buildPrintableCardPDF({ nombre, tagline, profesion, whatsapp, direccion, zona, slug, cardUrl }) {
  if (!slug || !cardUrl) {
    throw new Error('buildPrintableCardPDF: slug y cardUrl son obligatorios');
  }

  const qrBuffer = rasterizeQrSvgToPng(cardUrl, 1200);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [A6_WIDTH, A6_HEIGHT],
      margin: 0,
      info: {
        Title: `Tarjeta ${slug} - PerfilaPro`,
        Author: 'PerfilaPro',
        Creator: 'PerfilaPro',
      },
    });
    registerFonts(doc, FONTS_DIR);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Fondo blanco
    doc.rect(0, 0, A6_WIDTH, A6_HEIGHT).fill(COLORS.surface);

    // Header band en Tinta + wordmark "Perfila/Pro" centrado.
    // "Perfila" en blanco, "Pro" italic verde-match (regla on-tinta del brief).
    const headerH = 44;
    doc.rect(0, 0, A6_WIDTH, headerH).fill(COLORS.accent);

    const wmSize = 18;
    const charSp = -wmSize * 0.02;
    doc.font('PP-Serif').fontSize(wmSize);
    const wPerfila = doc.widthOfString('Perfila', { characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(wmSize);
    const wPro = doc.widthOfString('Pro', { characterSpacing: charSp });
    const totalW = wPerfila + wPro;
    const wmX = (A6_WIDTH - totalW) / 2;
    const wmY = (headerH - wmSize) / 2;
    doc.font('PP-Serif').fontSize(wmSize).fillColor('#FFFFFF')
      .text('Perfila', wmX, wmY, { lineBreak: false, characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(wmSize).fillColor(COLORS.match)
      .text('Pro', wmX + wPerfila, wmY, { lineBreak: false, characterSpacing: charSp });

    // Identidad arriba: nombre + profesión canónica + tagline libre.
    let cursorY = headerH + 22;
    doc.fillColor(COLORS.ink).font('PP-Serif').fontSize(17)
      .text(String(nombre || '').trim() || '—', 24, cursorY, { width: A6_WIDTH - 48, align: 'center', lineBreak: false });
    cursorY += 22;

    // Profesión canónica (specialty_label) en chip uppercase verde-match.
    // Se omite si coincide con el tagline (case-insensitive) para no duplicar.
    const profesionTrim = profesion ? String(profesion).trim() : '';
    const taglineTrim = tagline ? String(tagline).trim() : '';
    const sameAsTagline = profesionTrim && taglineTrim &&
      profesionTrim.toLowerCase() === taglineTrim.toLowerCase();
    if (profesionTrim && !sameAsTagline) {
      doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(8.5)
        .text(profesionTrim.toUpperCase().substring(0, 40), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false, characterSpacing: 1.2,
        });
      cursorY += 14;
    }

    if (taglineTrim) {
      doc.fillColor(COLORS.inkSoft).font('PP-Serif-Italic').fontSize(10)
        .text(taglineTrim.substring(0, 80), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 16;
    }

    // Divider fino
    cursorY += 6;
    doc.moveTo(48, cursorY).lineTo(A6_WIDTH - 48, cursorY)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    cursorY += 12;

    // QR centrado — 160pt (≈56mm) sigue siendo holgado para impresión A6.
    // Se reduce 10pt vs revisión anterior para dar aire a los datos físicos
    // bajo el QR (dirección + zona).
    const qrSize = 160;
    const qrX = (A6_WIDTH - qrSize) / 2;
    doc.image(qrBuffer, qrX, cursorY, { width: qrSize, height: qrSize });
    cursorY += qrSize + 10;

    // Etiqueta bajo QR
    doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
      .text('Escanea para abrir mi perfil completo', 0, cursorY, { width: A6_WIDTH, align: 'center' });
    cursorY += 17;

    // WhatsApp (contacto principal, destacado)
    if (whatsapp) {
      doc.fillColor(COLORS.ink).font('PP-Sans-SemiBold').fontSize(11.5)
        .text(formatSpanishPhone(whatsapp), 0, cursorY, { width: A6_WIDTH, align: 'center', lineBreak: false });
      cursorY += 15;
    }

    // Dirección física (calle + CP — campo direccion ya viene libre del usuario)
    if (direccion) {
      doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
        .text(String(direccion).trim().substring(0, 60), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 12;
    }

    // Zona (ciudad / provincia)
    if (zona) {
      doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
        .text(String(zona).trim().substring(0, 60), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 12;
    }

    // URL
    doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(10)
      .text(`perfilapro.es/c/${slug}`, 0, cursorY, { width: A6_WIDTH, align: 'center', lineBreak: false });

    // Footer
    const footerY = A6_HEIGHT - 16;
    doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(7)
      .text('Imprime a cualquier tamaño · perfilapro.es', 0, footerY, { width: A6_WIDTH, align: 'center' });

    doc.end();
  });
}

module.exports = {
  buildPrintableCardPDF,
  generateQrPngBuffer,
  formatSpanishPhone,
  A6_WIDTH,
  A6_HEIGHT,
};
