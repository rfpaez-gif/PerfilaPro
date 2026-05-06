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

const PDFDocument = require('pdfkit');
const { Resvg } = require('@resvg/resvg-js');
const { buildQrSvg } = require('./lib/qr-svg.js');

const A6_WIDTH  = 297.64; // 105mm en puntos PDF (1pt = 1/72")
const A6_HEIGHT = 419.53; // 148mm

// Paleta del PDF imprimible. El header band conserva el teal por decisión
// editorial pendiente: el rebrand restringe Teal Documentos a factura/contrato,
// y este artefacto es marketing — toca rediseño de cabecera (TODO: brand pass).
// El QR ya migrado al SVG nuevo (módulos circulares Tinta + finders especiales)
// vía lib/qr-svg.js + resvg para rasterización en el embed PDF.
const COLORS = {
  surface: '#FFFFFF',
  ink:     '#1E1B14',
  inkSoft: '#5C5246',
  accent:  '#01696F',
  border:  '#D9D2C4',
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

async function buildPrintableCardPDF({ nombre, tagline, whatsapp, slug, cardUrl }) {
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
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Fondo blanco
    doc.rect(0, 0, A6_WIDTH, A6_HEIGHT).fill(COLORS.surface);

    // Header band con marca
    const headerH = 36;
    doc.rect(0, 0, A6_WIDTH, headerH).fill(COLORS.accent);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
      .text('PerfilaPro', 0, 12, { width: A6_WIDTH, align: 'center', characterSpacing: 0.4 });

    // Identidad arriba
    let cursorY = headerH + 22;
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(17)
      .text(String(nombre || '').trim() || '—', 24, cursorY, { width: A6_WIDTH - 48, align: 'center' });
    cursorY += 22;

    if (tagline) {
      doc.fillColor(COLORS.inkSoft).font('Helvetica').fontSize(10.5)
        .text(String(tagline).trim(), 24, cursorY, { width: A6_WIDTH - 48, align: 'center' });
      cursorY += 18;
    }

    // Divider fino
    cursorY += 8;
    doc.moveTo(48, cursorY).lineTo(A6_WIDTH - 48, cursorY)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    cursorY += 14;

    // QR centrado
    const qrSize = 170;
    const qrX = (A6_WIDTH - qrSize) / 2;
    doc.image(qrBuffer, qrX, cursorY, { width: qrSize, height: qrSize });
    cursorY += qrSize + 12;

    // Etiqueta bajo QR
    doc.fillColor(COLORS.inkSoft).font('Helvetica').fontSize(9)
      .text('Escanea para abrir mi perfil completo', 0, cursorY, { width: A6_WIDTH, align: 'center' });
    cursorY += 22;

    // WhatsApp
    if (whatsapp) {
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11.5)
        .text(formatSpanishPhone(whatsapp), 0, cursorY, { width: A6_WIDTH, align: 'center' });
      cursorY += 17;
    }

    // URL
    doc.fillColor(COLORS.accent).font('Helvetica').fontSize(10)
      .text(`perfilapro.es/c/${slug}`, 0, cursorY, { width: A6_WIDTH, align: 'center' });

    // Footer
    const footerY = A6_HEIGHT - 16;
    doc.fillColor('#A89F90').font('Helvetica').fontSize(7)
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
