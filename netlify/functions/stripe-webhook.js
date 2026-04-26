const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function buildEmail({ nombre, slug, plan, expiresAt, siteUrl, editToken }) {
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = editToken ? `${siteUrl}/editar.html?slug=${slug}&token=${editToken}` : null;
  const planLabel = plan === 'pro' ? 'Premium' : 'Base';
  const planDuration = plan === 'pro' ? '365 días' : '90 días';
  const expiraFecha = new Date(expiresAt).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const firstName = (nombre || '').split(' ')[0];

  return {
    subject: `${firstName}, tu perfil ya está en el mundo 🚀`,
    html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f2ec;font-family:'Helvetica Neue',Arial,sans-serif;color:#1e1b14">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid rgba(30,27,20,.10);overflow:hidden">

        <!-- Header -->
        <tr>
          <td style="background:#01696f;padding:32px 40px;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">PerfilaPro</p>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75)">Tu perfil profesional siempre a mano</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;font-size:24px;font-weight:700">¡Ya eres todo un profesional, ${firstName}! 💪</p>
            <p style="margin:0 0 12px;font-size:15px;color:#6b6458;line-height:1.7">
              Tu perfil profesional está activo y listo para conquistar clientes. A partir de ahora, cuando alguien te pida el contacto, en vez de deletrear tu número o buscar el papel ese que siempre se pierde… les mandas el enlace y listo.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b6458;line-height:1.7">
              Guárdalo en favoritos, ponlo en tu bio de Instagram, compártelo en grupos de WhatsApp. Cuanto más lo uses, más trabaja por ti.
            </p>

            <!-- CTAs -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:#01696f;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px">
                  Ver mi perfil →
                </a>
              </td></tr>
              ${editUrl ? `<tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:#fff;color:#01696f;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:8px;border:2px solid #01696f">
                  Editar mi perfil
                </a>
              </td></tr>` : ''}
            </table>

            <!-- Plan info -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#deeeed;border-radius:8px;margin-bottom:28px">
              <tr>
                <td style="padding:20px 24px">
                  <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#01696f">Lo que has contratado</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#1e1b14;padding-bottom:6px">Plan</td>
                      <td style="font-size:13px;font-weight:700;color:#01696f;text-align:right">${planLabel} · ${planDuration}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e1b14;padding-bottom:6px">Tu enlace</td>
                      <td style="font-size:13px;font-weight:700;text-align:right"><a href="${cardUrl}" style="color:#01696f;text-decoration:none">${cardUrl}</a></td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e1b14">Activa hasta</td>
                      <td style="font-size:13px;font-weight:700;color:#1e1b14;text-align:right">${expiraFecha}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Factura adjunta -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;border:1.5px solid rgba(1,105,111,.2);border-radius:8px;margin-bottom:20px">
              <tr>
                <td style="padding:14px 18px">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="font-size:22px;padding-right:12px;vertical-align:middle">📎</td>
                    <td style="vertical-align:middle">
                      <p style="margin:0;font-size:13px;font-weight:700;color:#1e1b14">Factura en PDF adjunta</p>
                      <p style="margin:2px 0 0;font-size:12px;color:#6b6458">Búscala en los adjuntos de este email o descárgala desde tu gestor de correo.</p>
                    </td>
                  </tr></table>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#6b6458;line-height:1.6">
              ¿Algo no te cuadra o quieres cambiar algo? Responde este email directamente — somos personas reales y te contestamos.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#6b6458;line-height:1.6">
              ¡Mucho éxito, ${firstName}! 🙌
            </p>
            ${editUrl ? `<p style="margin:0;font-size:12px;color:#a89f90;line-height:1.6">
              🔒 El botón "Editar mi perfil" es personal — no compartas este email con nadie.
            </p>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(30,27,20,.08);text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:#a89f90">PerfilaPro · Tu perfil profesional siempre a mano</p>
            <p style="margin:0;font-size:11px;color:#c4bdb2">
              <a href="${siteUrl}/terminos.html" style="color:#a89f90;text-decoration:none">Términos</a> ·
              <a href="${siteUrl}/privacidad.html" style="color:#a89f90;text-decoration:none">Privacidad</a> ·
              <a href="${siteUrl}/legal.html" style="color:#a89f90;text-decoration:none">Aviso legal</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
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
      const { slug, nombre, tagline, whatsapp, zona, servicios, desc, foto, plan, agent_code } =
        session.metadata || {};

      if (!slug) {
        console.error('No slug in metadata');
        return { statusCode: 400, body: 'Missing slug in metadata' };
      }

      const planDays = { base: 90, pro: 365, renovacion: 365 };
      const days = planDays[plan] || 90;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const email = session.customer_details?.email || null;
      // Teléfono capturado por Stripe en el checkout (phone_number_collection)
      const telefono = session.customer_details?.phone || null;
      const editToken = crypto.randomBytes(32).toString('hex');

      const { error } = await db.from('cards').upsert({
        slug,
        nombre,
        tagline,
        whatsapp,
        zona,
        servicios: servicios ? JSON.parse(servicios) : [],
        foto_url: foto || null,
        descripcion: desc || null,
        telefono,
        plan: plan || 'base',
        status: 'active',
        stripe_session_id: session.id,
        expires_at: expiresAt,
        email,
        phone: session.customer_details?.phone || null,
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
