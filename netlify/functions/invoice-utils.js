const path = require('path');
const PDFDocument = require('pdfkit');
const { registerFonts } = require('./lib/pdf-fonts');

// __dirname aquí es netlify/functions/ tanto en local como tras el
// bundle de esbuild (todas las funciones se despliegan al mismo path).
// El helper pdf-fonts.js no puede usar su propio __dirname porque
// al inlinearse pierde la ubicación de su fichero fuente.
const FONTS_DIR = path.join(__dirname, 'lib/fonts');

const ISSUER = {
  name: 'Rafael Páez Manso',
  nif: '72573077G',
  address: 'Orihuela, Alicante, España',
  email: 'hola@perfilapro.es',
  web: 'perfilapro.es',
};

// Etiquetas user-facing alineadas con el copy de landing/alta/editar
// (Gratis / Trimestral / Anual). Las KEYS (`base`, `pro`) se mantienen
// intactas: son contractuales con Stripe (`STRIPE_PRICE_BASE`,
// `STRIPE_PRICE_PRO`), columnas de BD y eventos PostHog. Solo cambia
// el `label` que ven los humanos en facturas, emails y panel admin.
const PLAN_INFO = {
  base:       { label: 'Trimestral', duration: '3 meses',   total: 9.00 },
  pro:        { label: 'Anual',      duration: '1 año',     total: 19.00 },
  renovacion: { label: 'Renovación', duration: '12 meses',  total: 5.00 },
};

function roundTwo(n) { return Math.round(n * 100) / 100; }

function calcIva(total) {
  const base = roundTwo(total / 1.21);
  const iva  = roundTwo(total - base);
  return { base, iva };
}

async function getNextInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const { count, error } = await db
    .from('facturas')
    .select('*', { count: 'exact', head: true })
    .like('numero_factura', `FAC-${year}-%`);
  if (error) throw error;
  const n = (count || 0) + 1;
  return `FAC-${year}-${String(n).padStart(4, '0')}`;
}

async function buildPDF({ numero, fecha, emailCliente, nombreCliente, plan, base, iva, total, promo = false, bonificacion = 0 }) {
  return new Promise((resolve, reject) => {
    const docTitle = promo
      ? `Comprobante ${numero} - PerfilaPro`
      : `Factura ${numero} - PerfilaPro`;
    const doc = new PDFDocument({
      size: 'A4', margin: 60,
      info: { Title: docTitle },
    });
    registerFonts(doc, FONTS_DIR);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const planInfo = PLAN_INFO[plan] || { label: plan, duration: '' };
    const fechaStr = new Date(fecha).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const pageW  = doc.page.width;
    const margin = 60;
    const usableW = pageW - 2 * margin;

    // Header band: Teal Documentos #0F6B6B (uso restringido a factura
    // según brief). Wordmark "Perfila/Pro" en blanco/blanco como manda
    // el brief para fondo verde — aquí teal mantiene la misma regla.
    doc.rect(0, 0, pageW, 96).fill('#0F6B6B');

    // Wordmark izquierdo + tagline
    const charSp = -28 * 0.02;
    doc.font('PP-Serif').fontSize(28).fillColor('#FFFFFF');
    const wPerfila = doc.widthOfString('Perfila', { characterSpacing: charSp });
    doc.text('Perfila', margin, 32, { lineBreak: false, characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(28).fillColor('#FFFFFF')
      .text('Pro', margin + wPerfila, 32, { lineBreak: false, characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(10).fillColor('rgba(255,255,255,0.85)')
      .text('Tu trabajo merece verse.', margin, 68, { lineBreak: false });

    // Etiqueta derecha — "FACTURA SIMPLIFICADA" en modo normal,
    // "COMPROBANTE DE PROMOCIÓN" cuando es bonificación 100%.
    const headerLabel = promo ? 'COMPROBANTE DE PROMOCIÓN' : 'FACTURA SIMPLIFICADA';
    doc.font('PP-Sans-Bold').fontSize(10).fillColor('#FFFFFF')
      .text(headerLabel, 0, 44, { align: 'right', width: pageW - margin, characterSpacing: 0.8 });

    // Número y fecha
    const refY = 116;
    doc.font('PP-Sans-Bold').fontSize(8).fillColor('#6B7280')
      .text('NÚMERO', margin, refY, { characterSpacing: 0.5 });
    doc.font('PP-Sans').fontSize(11).fillColor('#0A1F44').text(numero, margin, refY + 12);
    doc.font('PP-Sans-Bold').fontSize(8).fillColor('#6B7280')
      .text('FECHA', 0, refY, { align: 'right', characterSpacing: 0.5 });
    doc.font('PP-Sans').fontSize(11).fillColor('#0A1F44')
      .text(fechaStr, 0, refY + 12, { align: 'right' });

    // Divider
    doc.moveTo(margin, 154).lineTo(pageW - margin, 154).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

    // Emisor / Cliente
    const colMid = pageW / 2 + 10;
    const blockY = 168;

    doc.font('PP-Sans-Bold').fontSize(7).fillColor('#6B7280')
      .text('EMISOR', margin, blockY, { characterSpacing: 0.6 });
    doc.font('PP-Sans-SemiBold').fontSize(10).fillColor('#0A1F44')
      .text(ISSUER.name, margin, blockY + 12);
    doc.font('PP-Sans').fontSize(9).fillColor('#6B7280')
      .text(`NIF: ${ISSUER.nif}`, margin, blockY + 26)
      .text(ISSUER.address,        margin, blockY + 38)
      .text(ISSUER.email,          margin, blockY + 50)
      .text(ISSUER.web,            margin, blockY + 62);

    doc.font('PP-Sans-Bold').fontSize(7).fillColor('#6B7280')
      .text('CLIENTE', colMid, blockY, { characterSpacing: 0.6 });
    doc.font('PP-Sans-SemiBold').fontSize(10).fillColor('#0A1F44')
      .text(nombreCliente || '—', colMid, blockY + 12, { width: pageW - colMid - margin });
    doc.font('PP-Sans').fontSize(9).fillColor('#6B7280')
      .text(emailCliente || '—',  colMid, blockY + 26, { width: pageW - colMid - margin });

    // Divider
    doc.moveTo(margin, blockY + 82).lineTo(pageW - margin, blockY + 82).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

    // Concepto — card crema con borde lateral teal
    const descY = blockY + 96;
    doc.roundedRect(margin, descY - 4, usableW, 52, 6).fill('#FAF7F0');
    doc.rect(margin, descY - 4, 3, 52).fill('#0F6B6B');
    doc.font('PP-Sans-Bold').fontSize(7).fillColor('#6B7280')
      .text('CONCEPTO', margin + 12, descY + 2, { characterSpacing: 0.6 });
    doc.font('PP-Sans').fontSize(10).fillColor('#0A1F44')
      .text(
        `Activación plan ${planInfo.label} — Perfil profesional PerfilaPro — ${planInfo.duration}`,
        margin + 12, descY + 15, { width: usableW - 16 }
      );

    // Importes
    const totY   = descY + 72;
    const lblX   = pageW - 240;
    const amtX   = pageW - 110;
    const amtW   = 50;

    doc.font('PP-Sans').fontSize(10).fillColor('#6B7280');
    doc.text('Base imponible:', lblX, totY, { width: 120 });
    doc.text(`${base.toFixed(2)} €`, amtX, totY, { width: amtW, align: 'right' });
    doc.text('IVA (21%):', lblX, totY + 20, { width: 120 });
    doc.text(`${iva.toFixed(2)} €`, amtX, totY + 20, { width: amtW, align: 'right' });

    // En modo promo intercalamos una línea con la bonificación negativa
    // antes del total. Visualmente: subtotal con IVA → bonificación →
    // total final 0,00 €. El usuario ve qué se ha bonificado y por cuánto.
    let totalRowY = totY + 44;
    if (promo && bonificacion > 0) {
      doc.font('PP-Sans-Bold').fontSize(10).fillColor('#0F6B6B');
      doc.text('Bonificación lanzamiento:', lblX, totY + 40, { width: 160 });
      doc.text(`-${bonificacion.toFixed(2)} €`, amtX, totY + 40, { width: amtW, align: 'right' });
      totalRowY = totY + 64;
    }

    // Total · pastilla piedra + número en teal documentos
    doc.roundedRect(lblX - 10, totalRowY, pageW - margin - lblX + 10, 32, 6).fill('#F7F8FA');
    doc.font('PP-Sans-Bold').fontSize(13).fillColor('#0F6B6B');
    doc.text('TOTAL:', lblX, totalRowY + 9, { width: 120 });
    doc.text(`${total.toFixed(2)} €`, amtX, totalRowY + 9, { width: amtW, align: 'right' });

    // Footer
    const footY = doc.page.height - 70;
    const footerCopy = promo
      ? 'Documento informativo. No es una factura. Bonificación 100% durante la campaña de lanzamiento.'
      : 'Factura simplificada. IVA incluido en el precio (art. 7.1 RD 1619/2012).';
    doc.font('PP-Sans').fontSize(8).fillColor('#6B7280')
      .text(footerCopy, margin, footY, { align: 'center', width: usableW });
    // Mini-wordmark en el pie
    doc.font('PP-Serif').fontSize(8).fillColor('#6B7280');
    const wPie = doc.widthOfString('Perfila');
    const wPiePro = doc.widthOfString('Pro') ;
    const wTail = doc.widthOfString(` · ${ISSUER.web} · ${ISSUER.email}`);
    const piePosX = (pageW - (wPie + wPiePro + wTail)) / 2;
    doc.text('Perfila', piePosX, footY + 14, { lineBreak: false });
    doc.font('PP-Serif-Italic').fontSize(8).fillColor('#0F6B6B')
      .text('Pro', piePosX + wPie, footY + 14, { lineBreak: false });
    doc.font('PP-Sans').fontSize(8).fillColor('#6B7280')
      .text(` · ${ISSUER.web} · ${ISSUER.email}`, piePosX + wPie + wPiePro, footY + 14, { lineBreak: false });

    doc.end();
  });
}

module.exports = { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO, roundTwo };
