'use strict';

// POST /api/parent-auth { email, idioma? }   ·   carril Cantera (capa 2)
//
// Magic-link al email de un tutor registrado en `card_admins`. Si el
// email coincide con al menos un admin activo de rol tutor/jugador
// (no club_admin — ése entra por el Studio B2B, no por el panel del
// padre), le mandamos `${SITE_URL}/panel.html?session=<jwt-7d>` que le
// loguea en el panel del padre. Si no coincide con nada, devolvemos 200
// igual (anti-enumeration, mismo patrón que panel-auth / send-edit-link).
//
// El JWT está scoped al EMAIL: un tutor con varios hijos administra
// todas sus cards. El gate isCanteraActive() apaga el endpoint (410)
// cuando el carril está dormido.
//
// Rate-limited a 5 req / 10 min por IP.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { signParentSession } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');

const defaultDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles que entran por el panel del padre. club_admin gestiona desde el
// Studio B2B (org-panel), no aquí.
const PARENT_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self'];

const PARENT_LOGIN_STRINGS = {
  es: {
    preheader: 'Tu enlace para entrar al panel de PerfilaPro · válido 7 días',
    title: 'Hola',
    intro: 'Has solicitado entrar a tu panel de PerfilaPro para gestionar la ficha de tu hijo/a (datos, estadísticas, cuota, club). Haz clic en el botón para acceder.',
    cta: 'Entrar al panel →',
    validity: 'El enlace es válido durante <strong>7 días</strong>. Una vez dentro, no necesitarás volver a pedirlo hasta que la sesión expire.',
    ignore: 'Si no has solicitado este enlace, puedes ignorar este email — nadie ha accedido a la cuenta.',
    subject: 'Tu enlace para entrar al panel de PerfilaPro',
  },
  ca: {
    preheader: 'El teu enllaç per entrar al panell de PerfilaPro · vàlid 7 dies',
    title: 'Hola',
    intro: 'Has demanat entrar al teu panell de PerfilaPro per gestionar la fitxa del teu fill/a (dades, estadístiques, quota, club). Fes clic al botó per accedir.',
    cta: 'Entrar al panell →',
    validity: 'L\'enllaç és vàlid durant <strong>7 dies</strong>. Un cop dins, no caldrà tornar a demanar-lo fins que la sessió expiri.',
    ignore: 'Si no has demanat aquest enllaç, pots ignorar aquest email — ningú ha accedit al compte.',
    subject: 'El teu enllaç per entrar al panell de PerfilaPro',
  },
};

function buildParentLoginEmail({ panelUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = PARENT_LOGIN_STRINGS[lang];

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
    title: T.title,
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
    if (!isCanteraActive()) return canteraDisabledResponse();

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, {
      bucket: 'parent-auth',
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

    // ¿Hay algún admin tutor/jugador activo con este email? Si no,
    // devolvemos 200 sin enviar para no filtrar qué emails están dados
    // de alta.
    const { data: admins } = await db
      .from('card_admins')
      .select('id')
      .eq('email', email)
      .is('revoked_at', null)
      .in('role', PARENT_ROLES)
      .limit(1);

    const isRegistered = Array.isArray(admins) && admins.length > 0;

    if (isRegistered && emailClient) {
      const token = signParentSession({ email });
      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const panelUrl = `${siteUrl}/panel.html?session=${token}`;
      const T = PARENT_LOGIN_STRINGS[idioma];

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: email,
          subject: T.subject,
          html: buildParentLoginEmail({ panelUrl, idioma }),
        });
      } catch (err) {
        console.error('parent-auth: error enviando email:', err.message);
        // No revelamos el fallo — 200 igualmente.
      }
    }

    // Siempre 200 (anti-enumeration)
    return jsonResponse(200, { ok: true });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
exports.buildParentLoginEmail = buildParentLoginEmail;
exports.PARENT_LOGIN_STRINGS = PARENT_LOGIN_STRINGS;
exports.PARENT_ROLES = PARENT_ROLES;
