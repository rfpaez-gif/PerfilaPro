'use strict';

// POST /api/panel-auth { email, idioma? }
//
// Magic-link al email registrado en `organizations.email`. Si el email
// coincide con una org activa, le mandamos un email con un enlace
// `${SITE_URL}/panel.html?session=<jwt-7d>` que el cliente abre y le
// loguea en su panel B2B. Si no coincide con nada, devolvemos 200 igual
// para no filtrar qué emails están registrados (anti-enumeration, mismo
// patrón que send-edit-link).
//
// Rate-limited a 5 req / 10 min por IP — suficiente para abrir el link
// en distintos dispositivos pero corta el envío masivo.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { signPanelSession } = require('./lib/panel-auth');

const defaultDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PANEL_LOGIN_STRINGS = {
  es: {
    preheader: 'Tu enlace para entrar al panel de PerfilaPro · válido 7 días',
    title: (orgName) => `Hola${orgName ? ', ' + orgName : ''}`,
    intro: 'Has solicitado entrar a tu panel de PerfilaPro para gestionar tu organización (branding, profesionales, estadísticas). Haz clic en el botón para acceder.',
    cta: 'Entrar al panel →',
    validity: 'El enlace es válido durante <strong>7 días</strong>. Una vez dentro, no necesitarás volver a pedirlo hasta que la sesión expire.',
    ignore: 'Si no has solicitado este enlace, puedes ignorar este email — nadie ha accedido a tu cuenta.',
    subject: (orgName) => orgName
      ? `Tu enlace para entrar al panel de ${orgName}`
      : 'Tu enlace para entrar al panel de PerfilaPro',
  },
  ca: {
    preheader: 'El teu enllaç per entrar al panell de PerfilaPro · vàlid 7 dies',
    title: (orgName) => `Hola${orgName ? ', ' + orgName : ''}`,
    intro: 'Has demanat entrar al teu panell de PerfilaPro per gestionar la teva organització (branding, professionals, estadístiques). Fes clic al botó per accedir.',
    cta: 'Entrar al panell →',
    validity: 'L\'enllaç és vàlid durant <strong>7 dies</strong>. Un cop dins, no caldrà tornar a demanar-lo fins que la sessió expiri.',
    ignore: 'Si no has demanat aquest enllaç, pots ignorar aquest email — ningú ha accedit al teu compte.',
    subject: (orgName) => orgName
      ? `El teu enllaç per entrar al panell de ${orgName}`
      : 'El teu enllaç per entrar al panell de PerfilaPro',
  },
};

function buildPanelLoginEmail({ orgName, panelUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = PANEL_LOGIN_STRINGS[lang];

  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>

            <p style="margin:0 0 16px;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.validity}
            </p>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.ignore}
            </p>`;

  return buildEmailLayout({
    preheader: T.preheader,
    title: T.title(orgName),
    bodyHtml,
    idioma: lang,
  });
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, {
      bucket: 'panel-auth',
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const email = (body.email || '').toLowerCase().trim();
    const idioma = body.idioma === 'ca' ? 'ca' : 'es';

    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse(400, { error: 'Email inválido' });
    }

    // Lookup org por email. Si no hay match, devolvemos 200 sin enviar
    // para no filtrar qué emails están registrados.
    const { data: org } = await db
      .from('organizations')
      .select('id, slug, name')
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (org && emailClient) {
      const token = signPanelSession({ orgId: org.id, orgSlug: org.slug });
      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const panelUrl = `${siteUrl}/panel.html?session=${token}`;
      const T = PANEL_LOGIN_STRINGS[idioma];

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: email,
          subject: T.subject(org.name),
          html: buildPanelLoginEmail({ orgName: org.name, panelUrl, idioma }),
        });
      } catch (err) {
        console.error('panel-auth: error enviando email:', err.message);
        // No revelamos el fallo al cliente — devolvemos 200 igualmente.
      }
    }

    // Siempre 200 (anti-enumeration)
    return jsonResponse(200, { ok: true });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
exports.buildPanelLoginEmail = buildPanelLoginEmail;
exports.PANEL_LOGIN_STRINGS = PANEL_LOGIN_STRINGS;
