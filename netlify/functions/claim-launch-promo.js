// Activación de plan en modo "Promo de lanzamiento — 100% bonificado".
// Sustituye al checkout de Stripe SOLO cuando LAUNCH_PROMO_ACTIVE=1.
// El usuario completa el flujo desde /editar (mismo gesto que pagar),
// recibe el kit + un comprobante PDF (no factura) con la bonificación
// explícita, y pasa de Free a Base|Pro durante 90|365 días.
//
// Auth: slug + edit_token (mismo mecanismo que edit-card).
// Idempotente: si la card ya está activa, devuelve 409 sin reenviar.
// Sin Stripe, sin webhook, sin factura — flujo paralelo limpio.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { calcIva, getNextInvoiceNumber, buildPDF, PLAN_INFO } = require('./invoice-utils');
const { buildPrintableCardPDF, buildEscaparateQrPng } = require('./printable-card-utils');
const { sendConfirmationEmail } = require('./stripe-webhook');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { capture: phCapture } = require('./lib/posthog-server');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const PLAN_DAYS = { base: 90, pro: 365 };

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function makeHandler(db, emailClient = resend) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Kill switch principal: si la env var no está, el endpoint
    // responde 410 Gone. Sirve para apagar la promo sin tocar código.
    if (process.env.LAUNCH_PROMO_ACTIVE !== '1') {
      return jsonResponse(410, { error: 'Promoción no disponible' });
    }

    const rl = checkRateLimit(event, { bucket: 'claim-launch-promo', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { slug, token, plan } = body;
    if (!slug || !token || !['base', 'pro'].includes(plan)) {
      return jsonResponse(400, { error: 'Parámetros inválidos' });
    }

    const { data: card, error: cardError } = await db
      .from('cards')
      .select('slug, nombre, tagline, whatsapp, direccion, zona, email, plan, status, edit_token_expires_at, edit_token, idioma, stripe_session_id, categories(specialty_label)')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .single();

    if (cardError || !card) {
      return jsonResponse(401, { error: 'Enlace inválido o expirado' });
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return jsonResponse(401, { error: 'El enlace de edición ha expirado. Solicita uno nuevo.' });
    }

    // Idempotencia: si ya está activa con plan pagado (Stripe o promo
    // anterior), no permitimos doble redención. El frontend debería no
    // mostrar el botón en ese caso, pero defendemos también en el back.
    if (card.status === 'active' && card.plan && card.plan !== 'free') {
      return jsonResponse(409, { error: 'Tu perfil ya tiene plan activo' });
    }

    if (!card.email) {
      return jsonResponse(400, { error: 'Falta email en el perfil para enviar el kit' });
    }

    const expiresAt = new Date(Date.now() + PLAN_DAYS[plan] * 24 * 60 * 60 * 1000).toISOString();
    const claimedAt = new Date().toISOString();

    const { error: upErr } = await db
      .from('cards')
      .update({
        plan,
        status: 'active',
        expires_at: expiresAt,
        kit_email_sent_at: claimedAt,
      })
      .eq('slug', slug);

    if (upErr) {
      console.error('Error activando plan promo:', upErr.message);
      return jsonResponse(500, { error: 'No se pudo activar el plan' });
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const cardUrl = `${siteUrl}/c/${card.slug}`;

    let cardPdfBuffer = null;
    let qrPngBuffer = null;
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

    let pdfAttachment = null;
    try {
      const planInfo = PLAN_INFO[plan] || PLAN_INFO.base;
      const { base, iva } = calcIva(planInfo.total);
      const fecha = claimedAt;
      const year = new Date().getFullYear();
      // Numeración aparte de las facturas reales: prefijo PROMO-YYYY-...
      // Así jamás colisiona con la serie FAC-YYYY-... ni cuenta para
      // Verifactu. Si la tabla `facturas` no acepta este formato (CHECK
      // constraint), no insertamos: el PDF se entrega igual.
      const numero = `PROMO-${year}-${Date.now().toString().slice(-6)}`;

      const pdfBuffer = await buildPDF({
        numero, fecha,
        emailCliente:  card.email,
        nombreCliente: card.nombre,
        plan,
        base, iva,
        total: 0,
        promo: true,
        bonificacion: planInfo.total,
      });
      pdfAttachment = { numero, buffer: pdfBuffer };
    } catch (err) {
      console.error('Error generando comprobante PDF (no fatal):', err.message);
    }

    const idioma = card.idioma === 'ca' ? 'ca' : 'es';
    const subjectPrefix = idioma === 'ca' ? '[Promo llançament]' : '[Promo lanzamiento]';
    const emailSent = await sendConfirmationEmail({
      email:        card.email,
      nombre:       card.nombre,
      slug:         card.slug,
      plan,
      expiresAt,
      editToken:    card.edit_token,
      emailClient,
      pdfAttachment,
      cardPdfBuffer,
      qrPngBuffer,
      subjectPrefix,
      idioma,
    });

    if (!emailSent) {
      console.warn('Email no enviado, pero el plan ya está activo:', slug);
    }

    phCapture(card.email || slug, 'launch_promo_redeemed', {
      slug, plan, idioma, source: 'editar',
    }).catch(() => {});

    console.log(`Promo lanzamiento activada: ${slug} → ${plan} (vence ${expiresAt})`);
    return jsonResponse(200, {
      ok: true,
      plan,
      expires_at: expiresAt,
      email_sent: emailSent,
    });
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
