'use strict';

// POST /api/panel-auth { email, idioma? }
//
// Magic-link passwordless. Dos identidades entran por esta misma puerta:
//
//   1. La DUEÑA del club/org — email en `organizations.email`, permisos
//      totales. Es el flujo de siempre.
//   2. El CUERPO TÉCNICO — email en `org_admins` (migración 049), con
//      alcance acotado por rol y equipo. Fase 1 de la fusión CATORZE:
//      la preparadora física o la fisio entran a ver lo suyo sin que el
//      club tenga que compartir la contraseña de la coordinadora.
//
// El lookup es dueña-primero: si el email es de una org activa, se le
// manda su enlace y no se mira org_admins. Consecuencia conocida y
// aceptada: quien sea dueña de un club Y técnica en otro recibe sólo el
// enlace de dueña. Es un caso raro y se resuelve pidiendo el enlace desde
// el otro club; mantenerlo así deja el camino de la dueña intacto.
//
// Si no coincide con nada, devolvemos 200 igual para no filtrar qué
// emails están registrados (anti-enumeration, mismo patrón que
// send-edit-link).
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
    staffIntro: (orgName) => `Tienes acceso al panel de <strong>${orgName}</strong> como parte del cuerpo técnico. Haz clic en el botón para entrar y ver lo que te corresponde.`,
    staffSubject: (orgName) => `Tu acceso al panel de ${orgName}`,
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
    staffIntro: (orgName) => `Tens accés al panell de <strong>${orgName}</strong> com a part del cos tècnic. Fes clic al botó per entrar i veure el que et correspon.`,
    staffSubject: (orgName) => `El teu accés al panell de ${orgName}`,
  },
};

// `staff: true` cambia sólo el párrafo de entrada: quien recibe esto no
// gestiona la organización, forma parte de su cuerpo técnico, y prometerle
// "branding, profesionales, estadísticas" sería mentirle sobre lo que va a
// encontrar. El resto del email (CTA, validez, aviso) es idéntico.
function buildPanelLoginEmail({ orgName, panelUrl, idioma = 'es', staff = false }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = PANEL_LOGIN_STRINGS[lang];
  const intro = staff && orgName ? T.staffIntro(orgName) : T.intro;

  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${intro}
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

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const T = PANEL_LOGIN_STRINGS[idioma];

    if (org && emailClient) {
      const token = signPanelSession({ orgId: org.id, orgSlug: org.slug });
      const panelUrl = `${siteUrl}/panel.html?session=${token}`;

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
    } else if (!org && emailClient) {
      // No es dueña de ninguna org. ¿Está en el cuerpo técnico de algún
      // club? (org_admins, migración 049). Un mismo email puede cubrir
      // varios clubes — una fisio que trabaja para dos — así que se manda
      // un enlace por club, cada uno con su propia sesión.
      //
      // Todo el bloque va en try/catch: si la 049 aún no está aplicada en
      // un entorno, PostgREST responde con error de tabla inexistente y el
      // flujo de la dueña no debe verse afectado en absoluto.
      try {
        const { data: staffRows } = await db
          .from('org_admins')
          .select('id, organization_id, email')
          .eq('email', email)
          .is('revoked_at', null);

        const rows = Array.isArray(staffRows) ? staffRows : [];
        for (const row of rows) {
          if (!row || !row.organization_id) continue;

          const { data: staffOrg } = await db
            .from('organizations')
            .select('id, slug, name')
            .eq('id', row.organization_id)
            .is('deleted_at', null)
            .maybeSingle();
          if (!staffOrg) continue; // club borrado → acceso muerto, se ignora

          const token = signPanelSession({
            orgId: staffOrg.id,
            orgSlug: staffOrg.slug,
            staffId: row.id,
          });

          try {
            await emailClient.emails.send({
              from: 'PerfilaPro <hola@perfilapro.es>',
              to: email,
              subject: T.staffSubject(staffOrg.name),
              html: buildPanelLoginEmail({
                orgName: staffOrg.name,
                panelUrl: `${siteUrl}/panel.html?session=${token}`,
                idioma,
                staff: true,
              }),
            });
          } catch (err) {
            console.error('panel-auth: error enviando email (staff):', err.message);
          }
        }
      } catch (err) {
        console.warn('panel-auth: lookup de org_admins no disponible:', err.message);
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
