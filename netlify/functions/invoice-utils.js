const PDFDocument = require('pdfkit');

const ISSUER = {
  name: 'Rafael Páez Manso',
  nif: '72573077G',
  address: 'Orihuela, Alicante, España',
  email: 'hola@perfilapro.es',
  web: 'perfilapro.es',
};

const PLAN_INFO = {
  base:       { label: 'Base',       duration: '90 días',   total: 9.00 },
  pro:        { label: 'Pro',        duration: '365 días',  total: 19.00 },
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

async function buildPDF({ numero, fecha, emailCliente, nombreCliente, plan, base, iva, total }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 60,
      info: { Title: `Factura ${numero} - PerfilaPro` },
    });
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

    // Header band
    doc.rect(0, 0, pageW, 80).fill('#01696f');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('PerfilaPro', margin, 22);
    doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.75)')
      .text('Tu perfil profesional siempre a mano', margin, 46);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
      .text('FACTURA SIMPLIFICADA', 0, 32, { align: 'right', width: pageW - margin });

    // Número y fecha
    const refY = 100;
    doc.fillColor('#1e1b14');
    doc.font('Helvetica-Bold').fontSize(9).text('NÚMERO', margin, refY);
    doc.font('Helvetica').fontSize(11).text(numero, margin, refY + 12);
    doc.font('Helvetica-Bold').fontSize(9).text('FECHA', 0, refY, { align: 'right' });
    doc.font('Helvetica').fontSize(11).text(fechaStr, 0, refY + 12, { align: 'right' });

    // Divider
    doc.moveTo(margin, 138).lineTo(pageW - margin, 138).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Emisor / Cliente
    const colMid = pageW / 2 + 10;
    const blockY = 152;

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text('EMISOR', margin, blockY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e1b14').text(ISSUER.name, margin, blockY + 12);
    doc.font('Helvetica').fontSize(9).fillColor('#6b6458')
      .text(`NIF: ${ISSUER.nif}`, margin, blockY + 26)
      .text(ISSUER.address, margin, blockY + 38)
      .text(ISSUER.email, margin, blockY + 50)
      .text(ISSUER.web, margin, blockY + 62);

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text('CLIENTE', colMid, blockY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e1b14')
      .text(nombreCliente || '—', colMid, blockY + 12, { width: pageW - colMid - margin });
    doc.font('Helvetica').fontSize(9).fillColor('#6b6458')
      .text(emailCliente || '—', colMid, blockY + 26, { width: pageW - colMid - margin });

    // Divider
    doc.moveTo(margin, blockY + 82).lineTo(pageW - margin, blockY + 82).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Concepto
    const descY = blockY + 96;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text('CONCEPTO', margin, descY);
    doc.font('Helvetica').fontSize(10).fillColor('#1e1b14')
      .text(
        `Activación plan ${planInfo.label} — Perfil profesional PerfilaPro — ${planInfo.duration}`,
        margin, descY + 12, { width: usableW }
      );

    // Importes
    const totY   = descY + 60;
    const lblX   = pageW - 240;
    const amtX   = pageW - 110;
    const amtW   = 50;

    doc.font('Helvetica').fontSize(10).fillColor('#6b6458');
    doc.text('Base imponible:', lblX, totY, { width: 120 });
    doc.text(`${base.toFixed(2)} €`, amtX, totY, { width: amtW, align: 'right' });
    doc.text('IVA (21%):', lblX, totY + 20, { width: 120 });
    doc.text(`${iva.toFixed(2)} €`, amtX, totY + 20, { width: amtW, align: 'right' });

    doc.moveTo(lblX, totY + 42).lineTo(pageW - margin, totY + 42).strokeColor('#01696f').lineWidth(1).stroke();

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#01696f');
    doc.text('TOTAL:', lblX, totY + 50, { width: 120 });
    doc.text(`${total.toFixed(2)} €`, amtX, totY + 50, { width: amtW, align: 'right' });

    // Footer
    const footY = doc.page.height - 70;
    doc.font('Helvetica').fontSize(8).fillColor('#a89f90')
      .text('Factura simplificada. IVA incluido en el precio (art. 7.1 RD 1619/2012).', margin, footY, { align: 'center', width: usableW })
      .text(`PerfilaPro · ${ISSUER.web} · ${ISSUER.email}`, margin, footY + 14, { align: 'center', width: usableW });

    doc.end();
  });
}

module.exports = { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO, roundTwo };
