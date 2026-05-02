const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function buildEmail({ nombre, slug, plan, expiresAt, siteUrl, editToken }) {
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = editToken ? `${siteUrl}/editar.html?slug=${slug}&token=${editToken}` : null;
  const planLabel = plan === 'pro' ? 'Premium' : 'Base';
  const planDuration = plan === 'pro' ? '365 días' : '90 días';
  const expiraFecha = new Date(expiresAt).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Tu perfil profesional está activo y listo para conquistar clientes. A partir de ahora, cuando alguien te pida el contacto, en vez de deletrear tu número o buscar el papel ese que siempre se pierde… les mandas el enlace y listo.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Guárdalo en favoritos, ponlo en tu bio de Instagram, compártelo en grupos de WhatsApp. Cuanto más lo uses, más trabaja por ti.
            </p>

            ${editUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">Editar mi perfil</a>
              </td></tr>
            </table>` : ''}

            <!-- Plan info -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:${COLORS.accentSoft};border-radius:10px 10px 0 0;padding:12px 20px;border-left:3px solid ${COLORS.accent}">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">Plan activo · ${planLabel}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:${COLORS.ink};font-weight:600">${planDuration} · hasta el ${expiraFecha}</p>
                </td>
              </tr>
              <tr>
                <td style="background:${COLORS.bg};border-radius:0 0 10px 10px;padding:12px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">Tu enlace</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:${COLORS.accent};text-decoration:none">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <!-- Factura adjunta -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};border-left:3px solid ${COLORS.accent};border-radius:0 8px 8px 0;margin-bottom:20px">
              <tr>
                <td style="padding:14px 18px">
                  <p style="margin:0;font-size:13px;font-weight:700;color:${COLORS.ink}">📎 Factura en PDF adjunta</p>
                  <p style="margin:4px 0 0;font-size:12px;color:${COLORS.inkSoft}">Búscala en los adjuntos de este email o descárgala desde tu gestor de correo.</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ¿Algo no te cuadra o quieres cambiar algo? Responde este email directamente — somos personas reales y te contestamos.
            </p>
            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ¡Mucho éxito, ${firstName}! 🙌
            </p>`;

  const html = buildEmailLayout({
    preheader: `Tu perfil ${planLabel} ya está activo. Compártelo donde quieras.`,
    title: `¡Ya eres todo un profesional, ${firstName}! 💪`,
    bodyHtml,
    cta: { text: 'Ver mi perfil →', url: cardUrl },
    footerNote: editUrl ? '🔒 El botón "Editar mi perfil" es personal — no compartas este email con nadie.' : '',
    siteUrl,
  });

  return {
    subject: `${firstName}, tu perfil ya está en el mundo 🚀`,
    html,
  };
}

async function sendConfirmationEmail({ email, nombre, slug, plan, expiresAt, editToken, emailClient, pdfAttachment }) {
  if (!email || !emailClient) return;

  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
  const { subject, html } = buildEmail({ nombre, slug, plan, expiresAt, siteUrl, editToken });

  const payload = {
    from: 'PerfilaPro <hola@perfilapro.es>',
    to: email,
    subject,
    html,
  };

  if (pdfAttachment) {
    payload.attachments = [{
      filename: `factura-${pdfAttachment.numero}.pdf`,
      content: pdfAttachment.buffer.toString('base64'),
    }];
  }

  try {
    await emailClient.emails.send(payload);
    console.log(`Email enviado a: ${email}`);
  } catch (err) {
    console.error('Error enviando email:', err.message);
  }
}

function makeHandler(stripeClient, db, emailClient = resend) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
      stripeEvent = stripeClient.webhooks.constructEvent(
        event.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const { slug, nombre, tagline, whatsapp, zona, servicios, desc, direccion, foto, plan, agent_code } =
        session.metadata || {};

      if (!slug) {
        console.error('No slug in metadata');
        return { statusCode: 400, body: 'Missing slug in metadata' };
      }

      const planDays = { base: 90, pro: 365, renovacion: 365 };
      const days = planDays[plan] || 90;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const email = session.customer_details?.email || null;
      const editToken = crypto.randomBytes(32).toString('hex');

      const serviciosParsed = servicios ? JSON.parse(servicios).map(s => stripTags(s).substring(0, 100)) : [];

      const { error } = await db.from('cards').upsert({
        slug,
        nombre:      stripTags(nombre).substring(0, 100),
        tagline:     stripTags(tagline).substring(0, 100),
        whatsapp,
        zona:        stripTags(zona).substring(0, 100),
        servicios:   serviciosParsed,
        foto_url:    foto || null,
        descripcion: desc ? stripTags(desc).substring(0, 200) : null,
        direccion:   direccion ? stripTags(direccion).substring(0, 200) : null,
        plan: plan || 'base',
        status: 'active',
        stripe_session_id: session.id,
        expires_at: expiresAt,
        email,
        edit_token: editToken,
        agent_code: agent_code || null,
      }, { onConflict: 'slug' });

      if (error) {
        console.error('Supabase error:', error.message);
        return { statusCode: 500, body: 'Database error' };
      }

      console.log(`Perfil activado: ${slug}`);

      // Generación de factura (no bloquea el webhook si falla)
      let pdfAttachment = null;
      try {
        const planKey = plan || 'base';
        const planInfo = PLAN_INFO[planKey] || PLAN_INFO.base;
        const { base, iva } = calcIva(planInfo.total);
        const fecha = new Date().toISOString();

        // Número de factura — fallback timestamp si la tabla no existe aún
        let numero;
        try {
          numero = await getNextInvoiceNumber(db);
        } catch (numErr) {
          const year = new Date().getFullYear();
          numero = `FAC-${year}-${Date.now().toString().slice(-6)}`;
          console.warn('getNextInvoiceNumber falló, usando fallback:', numErr.message);
        }

        // Generar PDF (siempre, independiente de la BD)
        console.log(`Generando PDF factura ${numero}…`);
        const pdfBuffer = await buildPDF({
          numero, fecha,
          emailCliente: email,
          nombreCliente: nombre,
          plan: planKey, base, iva,
          total: planInfo.total,
        });
        console.log(`PDF generado: ${pdfBuffer.length} bytes`);

        // Guardar registro en BD (no fatal)
        const { error: factError } = await db.from('facturas').insert({
          numero_factura: numero,
          fecha,
          email_cliente: email,
          nombre_cliente: nombre || null,
          plan: planKey,
          base_imponible: base,
          iva,
          total: planInfo.total,
          stripe_session_id: session.id,
          stripe_payment_id: session.payment_intent || null,
        });
        if (factError) console.warn('Error guardando factura en BD (no fatal):', factError.message);

        pdfAttachment = { numero, buffer: pdfBuffer };
        console.log(`Factura lista para adjuntar: ${numero}`);
      } catch (err) {
        console.error('Error generando factura (no fatal):', err.message, err.stack);
      }

      await sendConfirmationEmail({
        email, nombre, slug,
        plan: plan || 'base',
        expiresAt, editToken, emailClient, pdfAttachment,
      });
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  };
}

exports.handler = makeHandler(stripe, supabase);
exports.makeHandler = makeHandler;
exports.buildEmail = buildEmail;
