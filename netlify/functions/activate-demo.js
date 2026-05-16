// Activación gratuita para cards de demostración (slug 'demo-*').
//
// Paralelo a claim-launch-promo pero recortado: cambia plan y marca
// kit_email_sent_at para que la card renderice como Pro (QR + stats) en
// /c/:slug, y envía un email breve con la tarjeta imprimible A6 adjunta.
// Sin factura, sin QR PNG suelto, sin comprobante — los demos no son
// una transacción, son material de marketing.
//
// Auth: slug + edit_token (mismo mecanismo que edit-card y claim-launch-promo).
// Gate por prefijo: solo activa cards cuyo slug empieza por 'demo-' para que
// el endpoint no pueda elevar cards reales aunque alguien tenga el token.
// Idempotente: si la card ya tiene kit_email_sent_at, devuelve 200 sin
// re-activar.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildPrintableCardPDF } = require('./printable-card-utils');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { capture: phCapture } = require('./lib/posthog-server');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const DEMO_DAYS = 365;

const DEMO_EMAIL_STRINGS = {
  es: {
    subject: (n) => `Tu tarjeta demo está lista, ${n}`,
    preheader: () => 'Adjuntamos tu tarjeta de mano A6, lista para imprimir o compartir.',
    title: (n) => `Hola ${n} 👋`,
    intro1: 'Tu tarjeta demo está activada. Adjunto te mandamos la <strong>tarjeta de mano A6</strong> en PDF — lista para imprimir, repartir o pegar donde quieras.',
    intro2: 'Es un PDF vectorial: imprime tal cual a tamaño A6, o ampliada a A5 / A4 sin perder nitidez.',
    seeProfile: 'Ver mi tarjeta →',
    editProfile: 'Editar mi perfil',
    yourLink: 'Tu URL pública',
    closing: 'Si necesitas algo, responde a este email.',
    footerNote: 'Demo · Sin valor fiscal · PerfilaPro',
  },
  ca: {
    subject: (n) => `La teva targeta demo està llesta, ${n}`,
    preheader: () => 'Adjuntem la teva targeta de mà A6, llesta per imprimir o compartir.',
    title: (n) => `Hola ${n} 👋`,
    intro1: 'La teva targeta demo està activada. Adjunt et fem arribar la <strong>targeta de mà A6</strong> en PDF — llesta per imprimir, repartir o enganxar on vulguis.',
    intro2: 'És un PDF vectorial: imprimeix tal qual a mida A6, o ampliada a A5 / A4 sense perdre nitidesa.',
    seeProfile: 'Veure la meva targeta →',
    editProfile: 'Editar el meu perfil',
    yourLink: 'La teva URL pública',
    closing: 'Si necessites res, respon a aquest email.',
    footerNote: 'Demo · Sense valor fiscal · PerfilaPro',
  },
};

function buildDemoActivationEmail({ nombre, slug, siteUrl, editToken, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = DEMO_EMAIL_STRINGS[lang];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = `${siteUrl}/${lang}/editar?slug=${slug}&token=${editToken}`;
  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro1}
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro2}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.seeProfile}</a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">${T.editProfile}</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr>
                <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:10px;padding:14px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${T.yourLink}</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:${COLORS.accent};text-decoration:none;word-break:break-all">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.closing}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(firstName),
    title: T.title(firstName),
    bodyHtml,
    footerNote: T.footerNote,
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName),
    html,
  };
}

async function sendDemoActivationEmail({ email, nombre, slug, editToken, cardPdfBuffer, emailClient, idioma }) {
  if (!email || !emailClient) return false;
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
  const { subject, html } = buildDemoActivationEmail({ nombre, slug, siteUrl, editToken, idioma });

  const payload = {
    from: 'PerfilaPro <hola@perfilapro.es>',
    to: email,
    subject: `[Demo] ${subject}`,
    html,
  };
  if (cardPdfBuffer) {
    payload.attachments = [{
      filename: `perfilapro-${slug}.pdf`,
      content: cardPdfBuffer.toString('base64'),
    }];
  }

  try {
    await emailClient.emails.send(payload);
    console.log(`Email demo enviado a: ${email}`);
    return true;
  } catch (err) {
    console.error('Error enviando email demo:', err.message);
    return false;
  }
}

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

    const rl = checkRateLimit(event, { bucket: 'activate-demo', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { slug, token } = body;
    if (!slug || !token) {
      return jsonResponse(400, { error: 'Parámetros inválidos' });
    }

    // Sólo cards demo. Sin esto, cualquiera con un edit_token válido
    // podría saltarse el checkout de Stripe en cards reales.
    if (typeof slug !== 'string' || !slug.startsWith('demo-')) {
      return jsonResponse(403, { error: 'Endpoint reservado a cards demo' });
    }

    const { data: card, error: cardError } = await db
      .from('cards')
      .select('slug, nombre, tagline, whatsapp, direccion, zona, email, plan, status, edit_token, edit_token_expires_at, stripe_session_id, kit_email_sent_at, idioma, categories(specialty_label)')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .single();

    if (cardError || !card) {
      return jsonResponse(401, { error: 'Enlace inválido o expirado' });
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return jsonResponse(401, { error: 'El enlace de edición ha expirado.' });
    }

    // Idempotencia: si ya está activada, devolvemos 200 sin re-tocar
    // ni re-enviar email.
    if (card.kit_email_sent_at || card.stripe_session_id) {
      return jsonResponse(200, { ok: true, already_active: true, plan: card.plan });
    }

    const expiresAt = new Date(Date.now() + DEMO_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const activatedAt = new Date().toISOString();

    const { error: upErr } = await db
      .from('cards')
      .update({
        plan: 'pro',
        status: 'active',
        expires_at: expiresAt,
        kit_email_sent_at: activatedAt,
      })
      .eq('slug', slug);

    if (upErr) {
      console.error('Error activando demo:', upErr.message);
      return jsonResponse(500, { error: 'No se pudo activar la demo' });
    }

    // Generar tarjeta A6 y enviar email — no bloquea la respuesta si falla.
    // El usuario ya tiene la card activada; el email es un nice-to-have.
    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const cardUrl = `${siteUrl}/c/${card.slug}`;
    let emailSent = false;
    let cardPdfBuffer = null;
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
      console.error('Error generando tarjeta PDF demo (no fatal):', err.message);
    }

    if (card.email && emailClient) {
      emailSent = await sendDemoActivationEmail({
        email: card.email,
        nombre: card.nombre,
        slug: card.slug,
        editToken: card.edit_token,
        cardPdfBuffer,
        emailClient,
        idioma: card.idioma,
      });
    }

    phCapture(slug, 'demo_activated', {
      slug,
      idioma: card.idioma || 'es',
      email_sent: emailSent,
    }).catch(() => {});

    console.log(`Demo activada: ${slug} → pro (vence ${expiresAt}, email: ${emailSent})`);
    return jsonResponse(200, {
      ok: true,
      plan: 'pro',
      expires_at: expiresAt,
      email_sent: emailSent,
    });
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
exports.buildDemoActivationEmail = buildDemoActivationEmail;
