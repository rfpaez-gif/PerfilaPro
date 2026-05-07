// Re-envío del email post-pago completo (kit físico + factura) desde el
// panel admin. Soporte post-compra: cuando el usuario pierde el email
// original, cambia de furgo, o simplemente pide ayuda y no quiere/puede
// manejarlo desde el editor. Patrón paralelo a resend-invoice.
//
// Auth: ADMIN_PASSWORD + ADMIN_TOTP (mismo patrón que resend-invoice).
// Marca cards.kit_email_sent_at en éxito para visibilidad en el panel.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');
const { buildPrintableCardPDF, buildEscaparateQrPng } = require('./printable-card-utils');
const { sendConfirmationEmail } = require('./stripe-webhook');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

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

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

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

    const { data: card, error: cardError } = await db
      .from('cards')
      .select('slug, nombre, tagline, whatsapp, direccion, zona, email, plan, expires_at, stripe_session_id, edit_token, categories(specialty_label)')
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

    if (!card.stripe_session_id) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Solo perfiles pagados tienen kit. Este perfil aún es Free.' }),
      };
    }

    if (!emailClient) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email no configurado (RESEND_API_KEY)' }),
      };
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const cardUrl = `${siteUrl}/c/${card.slug}`;

    // Regenera tarjeta + QR. La factura se reusa si existe en BD.
    let cardPdfBuffer = null;
    let qrPngBuffer   = null;
    try {
      cardPdfBuffer = await buildPrintableCardPDF({
        nombre:    card.nombre,
        tagline:   card.tagline,
        profesion: card.categories?.specialty_label || null,
        whatsapp:  card.whatsapp,
        direccion: card.direccion,
        zona:      card.zona,
        slug:      card.slug,
        cardUrl,
      });
    } catch (err) {
      console.error('Error generando tarjeta PDF (no fatal):', err.message);
    }
    try {
      qrPngBuffer = await buildEscaparateQrPng({
        nombre:    card.nombre,
        profesion: card.categories?.specialty_label || null,
        slug:      card.slug,
        cardUrl,
        size:      1024,
      });
    } catch (err) {
      console.error('Error generando QR PNG (no fatal):', err.message);
    }

    // Factura: prefiere la existente; si no, regenera con el plan actual.
    let pdfAttachment = null;
    try {
      const { data: factura } = await db
        .from('facturas')
        .select('numero_factura, fecha, base_imponible, iva, total, plan')
        .eq('stripe_session_id', card.stripe_session_id)
        .single();

      const planKey = card.plan || 'base';
      let numero, fecha, base, iva, total;
      if (factura) {
        numero = factura.numero_factura;
        fecha  = factura.fecha;
        base   = factura.base_imponible;
        iva    = factura.iva;
        total  = factura.total;
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
      console.error('Error preparando factura para reenvío (no fatal):', err.message);
    }

    const emailSent = await sendConfirmationEmail({
      email:        card.email,
      nombre:       card.nombre,
      slug:         card.slug,
      plan:         card.plan || 'base',
      expiresAt:    card.expires_at || new Date().toISOString(),
      editToken:    card.edit_token,
      emailClient,
      pdfAttachment,
      cardPdfBuffer,
      qrPngBuffer,
      subjectPrefix: '[Reenvío]',
    });

    if (!emailSent) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error enviando email' }),
      };
    }

    const { error: tsErr } = await db
      .from('cards')
      .update({ kit_email_sent_at: new Date().toISOString() })
      .eq('slug', slug);
    if (tsErr) console.warn('No se pudo marcar kit_email_sent_at (no fatal):', tsErr.message);

    console.log(`Kit reenviado: ${slug} → ${card.email}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        email: card.email,
        sent_at: new Date().toISOString(),
      }),
    };
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
