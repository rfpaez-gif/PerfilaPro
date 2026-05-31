'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');

const TEAM_SIZES   = new Set(['5-20', '20-100', '100-500', '500+']);
const SECTORS      = new Set(['empresa', 'despacho', 'colegio', 'publico', 'ong', 'red_comercial', 'club_deportivo', 'otro']);
const PLAN_INTERES = new Set(['equipo', 'organizacion', 'enterprise', 'no_se']);

const PLAN_LABEL = {
  equipo:       'Equipo (4-5 €/mes)',
  organizacion: 'Organización (5-6 €/mes)',
  enterprise:   'Enterprise (desde 6 €/mes)',
  no_se:        'Sin preferencia',
};

const SECTOR_LABEL = {
  empresa:        'Empresa / red comercial',
  despacho:       'Despacho / consultora / clínica',
  colegio:        'Colegio / asociación / cámara',
  publico:        'Administración / organismo público',
  ong:            'ONG / fundación',
  red_comercial:  'Red comercial autónoma (comercializadora, seguros, telefonía)',
  club_deportivo: 'Club / escuela deportiva',
  otro:           'Otro',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// agent_code: mismo formato que admite create-org-checkout.js. Si llega
// malformado (URL forjada en un share roto), se silencia — el lead se
// persiste con agent_code=NULL para no perderlo.
const AGENT_CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;

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

function buildInboxEmailHtml({ name, company, email, team_size, sector, plan_interes, agent_code, message, inviteToken, siteUrl }) {
  const safeMessage = esc(message || '(sin mensaje adicional)').replace(/\n/g, '<br>');
  const onboardingUrl = `${siteUrl}/es/onboarding?token=${inviteToken}`;
  const planRow = plan_interes
    ? `<tr><td style="color:#6B7280">Plan de interés</td><td><strong>${esc(PLAN_LABEL[plan_interes] || plan_interes)}</strong></td></tr>`
    : '';
  const agentRow = agent_code
    ? `<tr><td style="color:#6B7280">Referido por</td><td><strong style="font-family:monospace">${esc(agent_code)}</strong> <span style="color:#6B7280;font-size:12px">· asigna este código a la org cuando la crees</span></td></tr>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;color:#0A1F44;line-height:1.6">
<h2 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;letter-spacing:-0.01em">Nuevo lead B2B</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#6B7280">Nombre</td><td><strong>${esc(name)}</strong></td></tr>
  <tr><td style="color:#6B7280">Empresa</td><td><strong>${esc(company)}</strong></td></tr>
  <tr><td style="color:#6B7280">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  <tr><td style="color:#6B7280">Equipo</td><td>${esc(team_size)}</td></tr>
  <tr><td style="color:#6B7280">Sector</td><td>${esc(SECTOR_LABEL[sector] || sector)}</td></tr>
  ${planRow}
  ${agentRow}
</table>
<h3 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;margin-top:1.5rem">Mensaje</h3>
<p style="background:#FAF7F0;padding:1rem;border-radius:8px">${safeMessage}</p>
<p style="font-size:13px;color:#6B7280;margin-top:1.5rem">
  <strong style="color:#0A1F44">Magic-link reservado (no enviado al lead todavía):</strong><br>
  <a href="${esc(onboardingUrl)}" style="font-family:monospace;font-size:12px;word-break:break-all">${esc(onboardingUrl)}</a>
</p>
<p style="font-size:12px;color:#6B7280;margin-top:1rem">
  Lead persistido en <code>b2b_leads</code>. Al lead se le ha enviado un acuse de recibo neutral (sin magic-link). Asocia el lead a una org en el Studio y luego pulsa <em>"Enviar magic-link"</em> para mandarle el enlace personalizado con branding.
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
    brandedLabel: 'Demo personalizada',
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
    brandedLabel: 'Demo personalitzada',
  },
};

// Email-2 que se manda automáticamente al lead nada más enviar el form.
// NO contiene magic-link — solo confirma la recepción y le dice que el
// equipo de PerfilaPro le contactará en 24-48h. El magic-link sale más
// tarde desde admin-orgs (acción manual del founder), una vez se ha
// hablado con el lead y, si aplica, se ha creado la org con branding.
const LEAD_ACK_STRINGS = {
  es: {
    subjectPrefix: '[PerfilaPro]',
    subject: (firstName) => `${firstName}, hemos recibido tu solicitud`,
    preheader: (company) => `Te contactaremos en 24-48h para enseñarte la demo de PerfilaPro aplicada a ${company}.`,
    title: (firstName) => `Gracias por escribirnos, ${firstName}`,
    intro1: (company) => `Hemos recibido tu solicitud para conocer PerfilaPro aplicado a <strong>${company}</strong>.`,
    intro2: 'En las próximas <strong>24-48 horas laborables</strong> te escribiremos personalmente para entender vuestro caso y prepararte una demo a medida con el branding y los profesionales de vuestro equipo.',
    intro3: 'Mientras tanto, si quieres adelantar trabajo, puedes responder a este email con cualquier detalle que creas relevante (logo, paleta corporativa, listado de profesionales, dudas).',
    footerNote: 'Si no has sido tú quien envió el formulario, ignora este email — tu dirección no quedará registrada para más contactos.',
  },
  ca: {
    subjectPrefix: '[PerfilaPro]',
    subject: (firstName) => `${firstName}, hem rebut la teva sol·licitud`,
    preheader: (company) => `Et contactarem en 24-48h per ensenyar-te la demo de PerfilaPro aplicada a ${company}.`,
    title: (firstName) => `Gràcies per escriure’ns, ${firstName}`,
    intro1: (company) => `Hem rebut la teva sol·licitud per conèixer PerfilaPro aplicat a <strong>${company}</strong>.`,
    intro2: 'En les properes <strong>24-48 hores laborables</strong> t’escriurem personalment per entendre el vostre cas i preparar-te una demo a mida amb el branding i els professionals del vostre equip.',
    intro3: 'Mentrestant, si vols avançar feina, pots respondre aquest email amb qualsevol detall que creguis rellevant (logo, paleta corporativa, llistat de professionals, dubtes).',
    footerNote: 'Si no has estat tu qui ha enviat el formulari, ignora aquest email — la teva adreça no quedarà registrada per a més contactes.',
  },
};

/**
 * Email con el magic-link de onboarding. NO se envía automáticamente
 * desde el handler del form — lo dispara el admin desde admin-orgs
 * (acción `leads_resend`) una vez ha hablado con el lead.
 *
 * Si `org` viene resuelto (lead ya asociado a una org en Studio), el
 * email pinta un banner con logo + color_primary + nombre de la org
 * arriba del CTA, igual que `buildInviteEmail` hace para los agentes.
 * Sin `org`, render genérico de PerfilaPro.
 */
function buildLeadEmail({ name, company, inviteToken, idioma, siteUrl, org }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = LEAD_EMAIL_STRINGS[lang];
  const onboardingUrl = `${siteUrl}/${lang}/onboarding?token=${inviteToken}`;
  const firstName = (name || '').split(' ')[0] || name;

  const bulletsHtml = T.bullets.map(b => `
    <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">▸ ${esc(b)}</p>`).join('');

  const headerColor = org && org.color && /^#[0-9a-fA-F]{6}$/.test(org.color) ? org.color : null;
  const orgName = org && org.name ? esc(org.name) : '';
  const logoCell = org && org.logoUrl
    ? `<img src="${esc(org.logoUrl)}" alt="${orgName}" style="max-height:40px;max-width:140px;display:block;margin:0 auto 8px">`
    : '';
  const orgBanner = (headerColor && orgName) ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr>
                <td style="background:${headerColor};border-radius:12px;padding:24px 20px;text-align:center">
                  ${logoCell}
                  <p style="margin:0;font-size:13px;font-weight:600;color:#ffffff;letter-spacing:.04em;text-transform:uppercase;opacity:.92">${esc(T.brandedLabel)}</p>
                  <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff">${orgName}</p>
                </td>
              </tr>
            </table>` : '';

  const bodyHtml = `${orgBanner}
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

/**
 * Acuse de recibo automático que el lead recibe nada más enviar el form.
 * NO contiene magic-link — solo confirma la recepción y anuncia que el
 * equipo contactará en 24-48h. El magic-link real lo dispara el admin
 * desde el Studio (acción `leads_resend`), opcionalmente con branding
 * de la org si para entonces ya está creada.
 */
function buildLeadAckEmail({ name, company, idioma, siteUrl }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = LEAD_ACK_STRINGS[lang];
  const firstName = (name || '').split(' ')[0] || name;

  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro1(esc(company))}
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro2}
            </p>
            <p style="margin:0 0 4px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${esc(T.intro3)}
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
    // plan_interes es opcional. Si llega con valor pero no está en el enum,
    // lo ignoramos (defensivo). Vale vacío/undefined cuando el lead llega
    // por el form sin pulsar el CTA de pricing.
    const rawPlan    = (body.plan_interes || '').toString().trim().toLowerCase();
    const plan_interes = PLAN_INTERES.has(rawPlan) ? rawPlan : null;

    // Atribución comercial. El landing acepta ?via= en la URL y lo inyecta
    // como hidden input. Aceptamos también el alias `agent_code` por si en
    // el futuro algún flow no usa `via`. Silencioso si llega malformado —
    // el lead se persiste sin attribution (bolsa founder), no se devuelve
    // 400 para no romper conversiones por un share link roto.
    const rawAgent = (body.via || body.agent_code || '').toString().trim();
    const agent_code = AGENT_CODE_RE.test(rawAgent) ? rawAgent : null;

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
        plan_interes,
        agent_code,
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
        html: buildInboxEmailHtml({ name, company, email, team_size, sector, plan_interes, agent_code, message, inviteToken, siteUrl }),
      });
    } catch (err) {
      // Si el email interno falla, NO bloqueamos al lead — su registro está
      // en BD y el admin lo verá en el Studio. Log para alertar.
      console.error('lead-b2b: error enviando email interno:', err.message);
    }

    // Email 2 · acuse de recibo al lead. NO incluye magic-link — solo
    // confirma la recepción del form y anuncia contacto en 24-48h. El
    // magic-link real lo dispara el admin desde admin-orgs.leads_resend
    // una vez ha hablado con el lead (y, si aplica, ha creado la org
    // con branding para que el email salga personalizado).
    try {
      const { subject, html } = buildLeadAckEmail({ name, company, idioma, siteUrl });
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: email,
        subject,
        html,
      });
      console.log(`lead-b2b: ${company} (${email}) · acuse de recibo enviado`);
    } catch (err) {
      // Si el acuse falla, el lead sigue persistido. NO devolvemos 500
      // para que el form al usuario diga "ok recibido".
      console.error('lead-b2b: error enviando acuse:', err.message);
    }

    return jsonResponse(200, { ok: true });
  };
}

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = new Resend(process.env.RESEND_API_KEY);

exports.handler = makeHandler({ db: defaultDb, emailClient: defaultEmail });
exports.makeHandler = makeHandler;
exports.buildLeadEmail = buildLeadEmail;
exports.buildLeadAckEmail = buildLeadAckEmail;
