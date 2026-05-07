const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');
const { buildPrintableCardPDF, generateQrPngBuffer } = require('./printable-card-utils');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { capture: captureEvent } = require('./lib/posthog-server');
const { isValidCp, lookupCp, normalizeCp } = require('./lib/cp-utils');

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
  const dlCardUrl = editToken ? `${siteUrl}/api/download-card?slug=${slug}&token=${editToken}` : null;
  // dlQrUrl no requiere token (endpoint público), pero lo agrupamos con
  // dlCardUrl bajo el editToken para mostrar/ocultar la sección "kit físico"
  // como una unidad: si el token no llega, no hay sección de re-descargas.
  const dlQrUrl   = editToken ? `${siteUrl}/api/qr/${slug}?format=png&size=1024` : null;
  const planLabel = plan === 'pro' ? 'Premium' : 'Base';
  const planDuration = plan === 'pro' ? '365 días' : '90 días';
  const expiraFecha = new Date(expiresAt).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const firstName = (nombre || '').split(' ')[0];

  // Estructura "caja de entrega": el email se lee como abrir el paquete del
  // producto, no como un albarán. Compartimentos visuales claros, jerarquía
  // que pone el activo (URL viva) primero y los assets descargables segundo.
  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Tu perfil ya está vivo. Cuando alguien te pida el contacto, en vez de deletrear tu número, les mandas tu enlace y listo.
            </p>

            <!-- HERO · URL como objeto físico -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">
              <tr>
                <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;padding:18px 20px;text-align:center">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">Tu enlace</p>
                  <a href="${cardUrl}" style="font-size:16px;font-weight:700;color:${COLORS.accent};text-decoration:none;word-break:break-all">${cardUrl}</a>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">Ver mi perfil →</a>
              </td></tr>
            </table>

            <!-- KIT FÍSICO · descargas tangibles -->
            ${dlCardUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:24px 22px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">📦 Tu kit físico</p>
                  <p style="margin:0 0 18px;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">Para imprimir, pegar en la furgo o compartir en redes. También los tienes adjuntos en este email.</p>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">
                    <tr>
                      <td style="padding:12px 14px;background:${COLORS.bg};border-radius:8px;border-left:3px solid ${COLORS.accent}">
                        <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:${COLORS.ink}">🃏 Tarjeta imprimible (PDF)</p>
                        <p style="margin:0 0 10px;font-size:12px;color:${COLORS.inkSoft};line-height:1.5">Imprímela tal cual o ampliada para escaparate, furgo o cartel.</p>
                        <a href="${dlCardUrl}" style="display:inline-block;font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;padding:6px 14px;border:1.5px solid ${COLORS.accent};border-radius:100px">Descargar tarjeta ↓</a>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:12px 14px;background:${COLORS.bg};border-radius:8px;border-left:3px solid ${COLORS.accent}">
                        <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:${COLORS.ink}">📱 Código QR (PNG alta resolución)</p>
                        <p style="margin:0 0 10px;font-size:12px;color:${COLORS.inkSoft};line-height:1.5">Para Instagram, perfil de WhatsApp, vinilos, escaparate.</p>
                        <a href="${dlQrUrl}" style="display:inline-block;font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;padding:6px 14px;border:1.5px solid ${COLORS.accent};border-radius:100px">Descargar QR ↓</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>` : ''}

            <!-- LO QUE HAS CONTRATADO -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td style="background:${COLORS.accentSoft};border-radius:10px 10px 0 0;padding:14px 20px;border-left:3px solid ${COLORS.accent}">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">Lo que has contratado</p>
                </td>
              </tr>
              <tr>
                <td style="background:${COLORS.bg};border-radius:0 0 10px 10px;padding:16px 20px">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.inkSoft};width:90px">Plan</td>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.ink};font-weight:600">${planLabel} · ${planDuration}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.inkSoft};vertical-align:top">Activa hasta</td>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.ink};font-weight:600">${expiraFecha}</td>
                    </tr>
                  </table>
                  ${editUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
                    <tr><td>
                      <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:13px;font-weight:700;text-decoration:none;padding:8px 18px;border-radius:100px;border:1.5px solid ${COLORS.accent}">Editar mi perfil</a>
                    </td></tr>
                  </table>` : ''}
                </td>
              </tr>
            </table>

            <!-- DÓNDE PONERLO -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td>
                  <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">💡 Dónde ponerlo</p>
                  <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">▸ Tu bio de Instagram, TikTok o LinkedIn</p>
                  <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">▸ Conversaciones y grupos de WhatsApp</p>
                  <p style="margin:0;font-size:14px;color:${COLORS.ink};line-height:1.6">▸ Pegado en tu furgo, escaparate o cartel de obra</p>
                </td>
              </tr>
            </table>

            <!-- PIE -->
            <p style="margin:0 0 8px;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              📎 Adjuntamos la factura en PDF para tus registros.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ¿Algo no te cuadra o quieres cambiar algo? Responde este email directamente — somos personas reales y te contestamos.
            </p>
            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ¡Mucho éxito, ${firstName}! 🙌
            </p>`;

  const html = buildEmailLayout({
    preheader: `Tu perfil ${planLabel} ya está activo. Tarjeta imprimible y QR adjuntos.`,
    title: `¡Ya eres todo un profesional, ${firstName}! 💪`,
    bodyHtml,
    cta: null,
    footerNote: editUrl ? '🔒 Los enlaces de descarga y edición son personales — no compartas este email con nadie.' : '',
    siteUrl,
  });

  return {
    subject: `${firstName}, tu perfil ya está en el mundo 🚀`,
    html,
  };
}

async function sendConfirmationEmail({
  email, nombre, slug, plan, expiresAt, editToken, emailClient,
  pdfAttachment, cardPdfBuffer, qrPngBuffer, subjectPrefix,
}) {
  if (!email || !emailClient) return false;

  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
  const { subject, html } = buildEmail({ nombre, slug, plan, expiresAt, siteUrl, editToken });

  const payload = {
    from: 'PerfilaPro <hola@perfilapro.es>',
    to: email,
    subject: subjectPrefix ? `${subjectPrefix} ${subject}` : subject,
    html,
  };

  const attachments = [];
  if (cardPdfBuffer) {
    attachments.push({
      filename: `perfilapro-${slug}.pdf`,
      content: cardPdfBuffer.toString('base64'),
    });
  }
  if (qrPngBuffer) {
    attachments.push({
      filename: `perfilapro-${slug}-qr.png`,
      content: qrPngBuffer.toString('base64'),
    });
  }
  if (pdfAttachment) {
    attachments.push({
      filename: `factura-${pdfAttachment.numero}.pdf`,
      content: pdfAttachment.buffer.toString('base64'),
    });
  }
  if (attachments.length) payload.attachments = attachments;

  try {
    await emailClient.emails.send(payload);
    console.log(`Email enviado a: ${email}`);
    return true;
  } catch (err) {
    console.error('Error enviando email:', err.message);
    return false;
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
      const { slug, nombre, tagline, whatsapp, cp, servicios, desc, direccion, foto, plan, agent_code, ocupacion_code } =
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

      // CP llega siempre desde create-checkout (validado allí). Si por algún
      // legacy pasa null o inválido, persistimos el perfil pero sin city_slug
      // y sin directory_visible — el admin puede arreglar a mano más tarde.
      const cpNormalized = isValidCp(cp) ? normalizeCp(cp) : null;
      const cpRow = cpNormalized ? await lookupCp(db, cpNormalized) : null;
      const zonaResolved = cpRow?.municipality_name || '';
      const citySlugResolved = cpRow?.province_slug || null;

      // Catálogo SEPE: si el alta usó el autocomplete del picker 'No me veo',
      // la metadata trae ocupacion_code. Resolvemos a name para guardarlo
      // como specialty_custom (lenguaje natural en la tarjeta y en el page
      // público). El sector_slug del catálogo no se usa aún para
      // category_id — se queda dormido hasta sprint de directorio sectorial.
      let ocupacionCodeClean = null;
      let ocupacionName = null;
      if (ocupacion_code && /^\d{8}$/.test(String(ocupacion_code))) {
        const { data: ocup } = await db
          .from('ocupaciones')
          .select('code, name')
          .eq('code', String(ocupacion_code))
          .maybeSingle();
        if (ocup) {
          ocupacionCodeClean = ocup.code;
          ocupacionName = ocup.name;
        }
      }

      // Auto-publicación en directorio: el perfil pagado entra al directorio
      // si tenemos los dos pilares (categoría + ubicación). category_id se
      // resuelve después con un SELECT, pero llegamos al webhook ya sabiendo
      // si city_slug existe; el segundo flag se setea en el UPDATE post-upsert
      // si efectivamente hay categoría asociada.
      const upsertRow = {
        slug,
        nombre:      stripTags(nombre).substring(0, 100),
        tagline:     stripTags(tagline).substring(0, 100),
        whatsapp,
        cp:          cpNormalized,
        zona:        zonaResolved.substring(0, 100),
        city_slug:   citySlugResolved,
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
        ocupacion_code: ocupacionCodeClean,
      };
      if (ocupacionName) upsertRow.specialty_custom = ocupacionName.substring(0, 60);

      const { error } = await db.from('cards').upsert(upsertRow, { onConflict: 'slug' });

      if (error) {
        console.error('Supabase error:', error.message);
        return { statusCode: 500, body: 'Database error' };
      }

      console.log(`Perfil activado: ${slug}`);

      captureEvent(slug, 'signup_completed_paid', { plan: plan || 'base', agent_code: agent_code || null })
        .catch(() => {});

      // Tarjeta imprimible + QR PNG (no bloquean el webhook si fallan; el
      // usuario siempre puede re-descargarlos desde el editor)
      const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
      const host  = (event.headers && event.headers.host) || (process.env.SITE_URL || 'https://perfilapro.es').replace(/^https?:\/\//, '');
      const cardUrl = `${proto}://${host}/c/${slug}`;

      // Profesión canónica para la tarjeta imprimible + auto-publicación en
      // directorio: leemos category_id en el mismo SELECT para decidir si el
      // perfil entra al directorio público (necesita category_id + city_slug
      // simultáneamente; sin uno de los dos, el JOIN del view no encuentra fila).
      let profesion = null;
      let categoryId = null;
      try {
        const { data: cardWithCat } = await db
          .from('cards')
          .select('category_id, categories(specialty_label)')
          .eq('slug', slug)
          .single();
        profesion = cardWithCat?.categories?.specialty_label || null;
        categoryId = cardWithCat?.category_id || null;
      } catch {
        // No es fatal — el PDF se renderiza sin profesión.
      }

      if (categoryId && citySlugResolved) {
        const { error: dvErr } = await db
          .from('cards')
          .update({ directory_visible: true })
          .eq('slug', slug);
        if (dvErr) console.error('directory_visible update failed (no fatal):', dvErr.message);
      }

      let cardPdfBuffer = null;
      let qrPngBuffer = null;
      try {
        cardPdfBuffer = await buildPrintableCardPDF({
          nombre, tagline, profesion, whatsapp, direccion, zona: zonaResolved, slug, cardUrl,
        });
        console.log(`Tarjeta PDF generada: ${cardPdfBuffer.length} bytes`);
      } catch (err) {
        console.error('Error generando tarjeta PDF (no fatal):', err.message);
      }
      try {
        qrPngBuffer = await generateQrPngBuffer(cardUrl, 1024);
        console.log(`QR PNG generado: ${qrPngBuffer.length} bytes`);
      } catch (err) {
        console.error('Error generando QR PNG (no fatal):', err.message);
      }

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

      const emailSent = await sendConfirmationEmail({
        email, nombre, slug,
        plan: plan || 'base',
        expiresAt, editToken, emailClient, pdfAttachment,
        cardPdfBuffer, qrPngBuffer,
      });

      if (emailSent) {
        const { error: tsErr } = await db
          .from('cards')
          .update({ kit_email_sent_at: new Date().toISOString() })
          .eq('slug', slug);
        if (tsErr) console.warn('No se pudo marcar kit_email_sent_at (no fatal):', tsErr.message);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  };
}

exports.handler = makeHandler(stripe, supabase);
exports.makeHandler = makeHandler;
exports.buildEmail = buildEmail;
exports.sendConfirmationEmail = sendConfirmationEmail;
