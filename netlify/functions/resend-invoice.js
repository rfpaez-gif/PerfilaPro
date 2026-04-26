const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');
const { buildEmail } = require('./stripe-webhook');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function makeHandler(db, emailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const pwd = event.headers['x-admin-password'];
    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No autorizado' }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'JSON inválido' }),
      };
    }

    const { slug } = body;
    if (!slug) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'slug requerido' }),
      };
    }

    // 1. Cargar tarjeta
    const { data: card, error: cardError } = await db
      .from('cards')
      .select('slug, nombre, email, plan, expires_at, stripe_session_id, edit_token')
      .eq('slug', slug)
      .single();

    if (cardError || !card) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tarjeta no encontrada' }),
      };
    }

    if (!card.email) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Este perfil no tiene email registrado' }),
      };
    }

    // 2. Buscar factura existente
    let invoiceData = null;
    if (card.stripe_session_id) {
      const { data: factura } = await db
        .from('facturas')
        .select('*')
        .eq('stripe_session_id', card.stripe_session_id)
        .single();
      if (factura) invoiceData = factura;
    }

    // 3. Generar PDF
    let pdfAttachment = null;
    try {
      const planKey = card.plan || 'base';
      let numero, fecha, base, iva, total;

      if (invoiceData) {
        numero = invoiceData.numero_factura;
        fecha  = invoiceData.fecha;
        base   = invoiceData.base_imponible;
        iva    = invoiceData.iva;
        total  = invoiceData.total;
      } else {
        const planInfo = PLAN_INFO[planKey] || PLAN_INFO.base;
        const calc = calcIva(planInfo.total);
        base  = calc.base;
        iva   = calc.iva;
        total = planInfo.total;
        fecha = new Date().toISOString();
        try {
          numero = await getNextInvoiceNumber(db);
        } catch {
          const year = new Date().getFullYear();
          numero = `FAC-${year}-${Date.now().toString().slice(-6)}`;
        }
      }

      const pdfBuffer = await buildPDF({
        numero, fecha,
        emailCliente: card.email,
        nombreCliente: card.nombre,
        plan: planKey, base, iva, total,
      });

      pdfAttachment = { numero, buffer: pdfBuffer };
    } catch (err) {
      console.error('Error generando PDF:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error generando PDF' }),
      };
    }

    // 4. Enviar email
    if (!emailClient) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email no configurado (RESEND_API_KEY)' }),
      };
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const { subject, html } = buildEmail({
      nombre: card.nombre,
      slug: card.slug,
      plan: card.plan || 'base',
      expiresAt: card.expires_at || new Date().toISOString(),
      siteUrl,
      editToken: card.edit_token,
    });

    try {
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: card.email,
        subject: `[Reenvío] ${subject}`,
        html,
        attachments: [{
          filename: `factura-${pdfAttachment.numero}.pdf`,
          content: pdfAttachment.buffer.toString('base64'),
        }],
      });
    } catch (err) {
      console.error('Error enviando email:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error enviando email: ' + err.message }),
      };
    }

    console.log(`Factura reenviada: ${pdfAttachment.numero} → ${card.email}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, email: card.email, numero: pdfAttachment.numero }),
    };
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
