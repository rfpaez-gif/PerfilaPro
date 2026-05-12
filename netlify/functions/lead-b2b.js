'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');

const TEAM_SIZES = new Set(['5-20', '20-100', '100-500', '500+']);
const SECTORS    = new Set(['empresa', 'despacho', 'colegio', 'publico', 'ong', 'otro']);

const SECTOR_LABEL = {
  empresa:  'Empresa / red comercial',
  despacho: 'Despacho / consultora / clínica',
  colegio:  'Colegio / asociación / cámara',
  publico:  'Administración / organismo público',
  ong:      'ONG / fundación',
  otro:     'Otro',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ERROR_STRINGS = {
  es: {
    invalidJson:     'JSON inválido',
    missingFields:   'Faltan campos: nombre, empresa, email',
    invalidEmail:    'Email inválido',
    invalidTeamSize: 'Tamaño de equipo no válido',
    invalidSector:   'Sector no válido',
    misconfigured:   'Endpoint mal configurado',
    insertFailed:    'No se pudo registrar el lead',
  },
  ca: {
    invalidJson:     'JSON invàlid',
    missingFields:   'Falten camps: nom, empresa, email',
    invalidEmail:    'Email invàlid',
    invalidTeamSize: 'Mida d\'equip no vàlida',
    invalidSector:   'Sector no vàlid',
    misconfigured:   'Endpoint mal configurat',
    insertFailed:    'No s\'ha pogut registrar el lead',
  },
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildInboxEmailHtml({ name, company, email, team_size, sector, message, inviteToken, siteUrl }) {
  const safeMessage = esc(message || '(sin mensaje adicional)').replace(/\n/g, '<br>');
  const onboardingUrl = `${siteUrl}/es/onboarding?token=${inviteToken}`;
  return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;color:#0A1F44;line-height:1.6">
<h2 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;letter-spacing:-0.01em">Nuevo lead B2B</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#6B7280">Nombre</td><td><strong>${esc(name)}</strong></td></tr>
  <tr><td style="color:#6B7280">Empresa</td><td><strong>${esc(company)}</strong></td></tr>
  <tr><td style="color:#6B7280">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  <tr><td style="color:#6B7280">Equipo</td><td>${esc(team_size)}</td></tr>
  <tr><td style="color:#6B7280">Sector</td><td>${esc(SECTOR_LABEL[sector] || sector)}</td></tr>
</table>
<h3 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;margin-top:1.5rem">Mensaje</h3>
<p style="background:#FAF7F0;padding:1rem;border-radius:8px">${safeMessage}</p>
<p style="font-size:13px;color:#6B7280;margin-top:1.5rem">
  <strong style="color:#0A1F44">Magic-link enviado al lead:</strong><br>
  <a href="${esc(onboardingUrl)}" style="font-family:monospace;font-size:12px;word-break:break-all">${esc(onboardingUrl)}</a>
</p>
<p style="font-size:12px;color:#6B7280;margin-top:1rem">
  Lead persistido en <code>b2b_leads</code>. Desde el Studio puedes asociarlo a una organización antes de que lo redima.
</p>
</body></html>`;
}

const LEAD_EMAIL_STRINGS = {
  es: {
    subjectPrefix: '[PerfilaPro · Onboarding]',
    subject: (name) => `${name}, ya puedes crear tu perfil`,
    preheader: (company) => `Tu enlace personal para crear el primer perfil de ${company} en PerfilaPro.`,
    title: (firstName) => `Hola ${firstName} 👋`,
    intro1: (company) => `Gracias por escribirnos desde el formulario de PerfilaPro para organizaciones. Te dejamos un enlace personal para que creéis el primer perfil de <strong>${company}</strong>.`,
    intro2: 'El enlace está pre-rellenado con tus datos para que el alta sea de 60 segundos. Cuando entres, completas servicios, WhatsApp, foto y zona y queda publicado.',
    ctaText: 'Crear mi perfil →',
    bullets: [
      'Sin app, sin instalación. Funciona en el móvil.',
      'Si quieres asociar más profesionales, respóndenos a este email y te abrimos accesos para el resto del equipo.',
      'Este enlace es de un solo uso y caduca cuando alguien lo redime.',
    ],
    footerNote: '¿No has sido tú? Ignora este email — el enlace queda inactivo si no se usa.',
  },
  ca: {
    subjectPrefix: '[PerfilaPro · Onboarding]',
    subject: (name) => `${name}, ja pots crear el teu perfil`,
    preheader: (company) => `El teu enllaç personal per crear el primer perfil de ${company} a PerfilaPro.`,
    title: (firstName) => `Hola ${firstName} 👋`,
    intro1: (company) => `Gràcies per escriure’ns des del formulari de PerfilaPro per a organitzacions. Et deixem un enllaç personal perquè creeu el primer perfil de <strong>${company}</strong>.`,
    intro2: 'L’enllaç ja porta les teves dades pre-omplertes perquè l’alta sigui de 60 segons. Quan entris, completes serveis, WhatsApp, foto i zona i queda publicat.',
    ctaText: 'Crear el meu perfil →',
    bullets: [
      'Sense app, sense instal·lació. Funciona al mòbil.',
      'Si vols associar més professionals, respon-nos aquest email i obrim accés per a la resta de l’equip.',
      'Aquest enllaç és d’un sol ús i caduca quan algú el redimeix.',
    ],
    footerNote: 'No has estat tu? Ignora aquest email — l’enllaç queda inactiu si no es fa servir.',
  },
};

function buildLeadEmail({ name, company, inviteToken, idioma, siteUrl }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = LEAD_EMAIL_STRINGS[lang];
  const onboardingUrl = `${siteUrl}/${lang}/onboarding?token=${inviteToken}`;
  const firstName = (name || '').split(' ')[0] || name;

  const bulletsHtml = T.bullets.map(b => `
    <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">▸ ${esc(b)}</p>`).join('');

  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro1(esc(company))}
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${esc(T.intro2)}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${esc(onboardingUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${esc(T.ctaText)}</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr><td style="background:${COLORS.bg};border-radius:10px;padding:16px 20px;border-left:3px solid ${COLORS.accent}">
                ${bulletsHtml}
              </td></tr>
            </table>

            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">URL directa</p>
            <p style="margin:0;font-size:12px;color:${COLORS.inkSoft};line-height:1.5;word-break:break-all">
              <a href="${esc(onboardingUrl)}" style="color:${COLORS.accent};text-decoration:none">${esc(onboardingUrl)}</a>
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(company),
    title: T.title(firstName),
    bodyHtml,
    footerNote: T.footerNote,
    siteUrl,
    idioma: lang,
  });

  return {
    subject: `${T.subjectPrefix} ${T.subject(firstName)}`,
    html,
  };
}

function makeHandler(deps) {
  const { db, emailClient } = deps;
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      // Sin body parseado no podemos saber el idioma — default es.
      return jsonResponse(400, { error: ERROR_STRINGS.es.invalidJson });
    }

    // Resolver idioma antes de validar para que los mensajes de error
    // viajen al frontend en el idioma correcto.
    const idioma = body.idioma === 'ca' ? 'ca' : 'es';
    const E = ERROR_STRINGS[idioma];

    // Honeypot: si el campo "website" viene relleno, es bot. Devolvemos
    // 200 sin enviar email para no darle al bot información de que el
    // honeypot fue detectado.
    if (body.website) {
      return jsonResponse(200, { ok: true });
    }

    const name      = (body.name      || '').toString().trim().slice(0, 100);
    const company   = (body.company   || '').toString().trim().slice(0, 120);
    const email     = (body.email     || '').toString().trim().slice(0, 200).toLowerCase();
    const team_size = (body.team_size || '').toString().trim();
    const sector    = (body.sector    || '').toString().trim().toLowerCase();
    const message   = (body.message   || '').toString().trim().slice(0, 2000);

    if (!name || !company || !email) {
      return jsonResponse(400, { error: E.missingFields });
    }
    if (!EMAIL_RE.test(email)) {
      return jsonResponse(400, { error: E.invalidEmail });
    }
    if (!TEAM_SIZES.has(team_size)) {
      return jsonResponse(400, { error: E.invalidTeamSize });
    }
    if (!SECTORS.has(sector)) {
      return jsonResponse(400, { error: E.invalidSector });
    }

    const inbox = process.env.B2B_LEAD_INBOX;
    if (!inbox) {
      console.error('lead-b2b: B2B_LEAD_INBOX no configurada');
      return jsonResponse(500, { error: E.misconfigured });
    }

    // Persistir el lead ANTES de enviar emails — si la BD falla, no
    // contaminamos la bandeja de leads ni mandamos magic-links que no
    // resuelven. invite_token lo genera la BD (DEFAULT encode(...)) y
    // lo devolvemos con select() para usarlo en el email al lead.
    const { data: leadRow, error: insertErr } = await db
      .from('b2b_leads')
      .insert({
        name, company, email,
        team_size, sector, message: message || null,
        idioma,
      })
      .select('id, invite_token')
      .single();

    if (insertErr || !leadRow) {
      console.error('lead-b2b: error persistiendo lead:', insertErr?.message);
      return jsonResponse(500, { error: E.insertFailed });
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const inviteToken = leadRow.invite_token;

    // Email 1 · interno (inbox del founder/sales).
    try {
      await emailClient.emails.send({
        from: 'PerfilaPro <leads@perfilapro.es>',
        to: inbox,
        replyTo: email,
        subject: `[Lead B2B · ${SECTOR_LABEL[sector]}] ${company} · ${name}`,
        html: buildInboxEmailHtml({ name, company, email, team_size, sector, message, inviteToken, siteUrl }),
      });
    } catch (err) {
      // Si el email interno falla, NO bloqueamos al lead — su registro está
      // en BD y el admin lo verá en el Studio. Log para alertar.
      console.error('lead-b2b: error enviando email interno:', err.message);
    }

    // Email 2 · al lead con el magic-link.
    try {
      const { subject, html } = buildLeadEmail({ name, company, inviteToken, idioma, siteUrl });
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: email,
        subject,
        html,
      });
      console.log(`lead-b2b: ${company} (${email}) · magic-link enviado`);
    } catch (err) {
      // Si el magic-link al lead falla, el lead sigue persistido. El admin
      // puede reenviarlo desde el Studio (acción explícita). NO devolvemos
      // 500 para que el form al usuario diga "ok recibido".
      console.error('lead-b2b: error enviando magic-link:', err.message);
    }

    return jsonResponse(200, { ok: true });
  };
}

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = new Resend(process.env.RESEND_API_KEY);

exports.handler = makeHandler({ db: defaultDb, emailClient: defaultEmail });
exports.makeHandler = makeHandler;
exports.buildLeadEmail = buildLeadEmail;
