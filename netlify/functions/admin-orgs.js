'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');
const {
  isValidHex,
  isSafeLogoUrl,
  isValidOrgSlug,
  isValidTagline,
  isValidDescription,
  isSafeWebsite,
} = require('./lib/org-utils');
const { buildLeadEmail } = require('./lead-b2b');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { buildEditLinkEmail, EDIT_LINK_STRINGS } = require('./send-edit-link');
const {
  buildBusinessCardPDF,
  buildBusinessCardsBookletPDF,
  fetchLogoAsPngBuffer,
} = require('./printable-card-utils');
const { inviteTeamMembers } = require('./lib/team-invite');
const { signPanelSession } = require('./lib/panel-auth');
const { offboardCard, restoreCard, COURTESY_DAYS } = require('./lib/card-offboard');
const cantera = require('./lib/cantera-incidents');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const defaultEmailClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// Audit best-effort de las acciones de incidencias Cantera (founder).
// La auth admin no tiene identidad por-usuario, así que el rastro es
// acción + slug + ip + timestamp en admin_audit_log.
function auditIncident(db, ip, action, slug, detail) {
  db.from('admin_audit_log').insert({
    action, entity_slug: slug || null, field: null,
    old_value: null, new_value: detail != null ? String(detail) : null, ip: ip || 'unknown',
  }).then(({ error }) => { if (error) console.error('audit_log error:', error.message); })
    .catch(() => {});
}

function stripTagsInline(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Construye el email de invitación a un agente B2B. El header de
 * email-layout.js mantiene la marca PerfilaPro (consistencia con el
 * resto de emails transaccionales). El branding de la org vive
 * dentro del bodyHtml como un banner que el agente ve en cuanto
 * abre el correo: barra superior con color_primary + logo + nombre
 * de la org, justo encima del título "Te han invitado…".
 */
function buildInviteEmail({ orgName, orgLogoUrl, orgColor, nombre, editUrl }) {
  const firstName = (nombre || '').split(' ')[0] || 'Hola';
  const safeOrgName = esc(orgName);
  const headerColor = orgColor && /^#[0-9a-fA-F]{6}$/.test(orgColor) ? orgColor : COLORS.ink;
  const logoCell = orgLogoUrl
    ? `<img src="${esc(orgLogoUrl)}" alt="${safeOrgName}" style="max-height:40px;max-width:140px;display:block;margin:0 auto 8px">`
    : '';

  const bodyHtml = `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr>
                <td style="background:${headerColor};border-radius:12px;padding:24px 20px;text-align:center">
                  ${logoCell}
                  <p style="margin:0;font-size:13px;font-weight:600;color:#ffffff;letter-spacing:.04em;text-transform:uppercase;opacity:.92">Equipo de</p>
                  <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff">${safeOrgName}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Te han invitado a unirte al equipo de <strong>${safeOrgName}</strong> en PerfilaPro. Tu perfil profesional ya está pre-creado dentro de la organización — solo tienes que completar tus datos (servicios, foto, contacto) para que esté visible online con la marca del equipo.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${esc(editUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">Completar mi perfil →</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              El enlace es válido durante <strong>7 días</strong>. Si no lo esperabas, puedes ignorar este email — nadie ha accedido a tu perfil.
            </p>`;

  const html = buildEmailLayout({
    preheader: `Invitación al equipo de ${orgName} en PerfilaPro · completa tu perfil`,
    title: `Bienvenido, ${firstName}`,
    bodyHtml,
    idioma: 'es',
  });

  return {
    subject: `${firstName}, te han invitado al equipo de ${orgName} en PerfilaPro`,
    html,
  };
}

/**
 * Email de offboarding · "Has salido del equipo, tienes 90 días de cortesía".
 * Respeta cards.idioma (es/ca). El editUrl es el magic-link vigente del
 * trabajador para que pueda seguir editando su tarjeta como autónomo.
 */
function buildOffboardEmail({ orgName, nombre, idioma, cardUrl, editUrl }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const firstName = (nombre || '').split(' ')[0] || (lang === 'ca' ? 'Hola' : 'Hola');
  const safeOrgName = esc(orgName);

  const t = lang === 'ca' ? {
    preheader: `Has sortit de l'equip de ${orgName} · 90 dies de cortesia per al teu perfil`,
    title: `Hola ${firstName}`,
    intro: `Has sortit de l'equip de <strong>${safeOrgName}</strong> a PerfilaPro. La teva targeta segueix activa <strong>com a autònom individual</strong> durant els pròxims <strong>90 dies de cortesia</strong>.`,
    explain: `Durant aquest temps pots seguir editant-la, repartint-la i utilitzant-la amb total normalitat. Si vols mantenir-la més enllà dels 90 dies, podràs activar un pla des de l'editor abans que caduqui.`,
    yourCardLabel: 'La teva targeta:',
    cta: 'Editar el meu perfil →',
    footer: `Si tens dubtes, respon a aquest email i et contestem.`,
    subject: `${firstName}, has sortit de l'equip de ${orgName} · 90 dies de cortesia`,
  } : {
    preheader: `Has salido del equipo de ${orgName} · 90 días de cortesía para tu perfil`,
    title: `Hola ${firstName}`,
    intro: `Has salido del equipo de <strong>${safeOrgName}</strong> en PerfilaPro. Tu tarjeta sigue activa <strong>como autónomo individual</strong> durante los próximos <strong>90 días de cortesía</strong>.`,
    explain: `Durante ese tiempo puedes seguir editándola, repartiéndola y usándola con total normalidad. Si quieres mantenerla más allá de los 90 días, podrás activar un plan desde el editor antes de que caduque.`,
    yourCardLabel: 'Tu tarjeta:',
    cta: 'Editar mi perfil →',
    footer: `Si tienes dudas, responde a este email y te contestamos.`,
    subject: `${firstName}, has salido del equipo de ${orgName} · 90 días de cortesía`,
  };

  const bodyHtml = `
            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${t.intro}
            </p>

            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${t.explain}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr><td style="background:#FAF7F0;border-radius:8px;padding:14px 16px;font-size:13px;color:${COLORS.inkSoft};line-height:1.5">
                <strong>${t.yourCardLabel}</strong> <a href="${esc(cardUrl)}" style="color:${COLORS.accent};text-decoration:none">${esc(cardUrl)}</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${esc(editUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${t.cta}</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${t.footer}
            </p>`;

  const html = buildEmailLayout({
    preheader: t.preheader,
    title: t.title,
    bodyHtml,
    idioma: lang,
  });

  return { subject: t.subject, html };
}

// Email cuando founder restaura a un miembro tras un offboard reciente.
// Avisa al trabajador de que la baja fue revertida (porque fue un error,
// el cliente lo pidió, etc) y que vuelve a estar en el equipo de la org.
// Sin CTA fuerte — la tarjeta sigue activa, solo cambia su "membresía".
function buildRestoreEmail({ orgName, nombre, idioma, cardUrl }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const firstName = (nombre || '').split(' ')[0] || (lang === 'ca' ? 'Hola' : 'Hola');
  const safeOrgName = esc(orgName);

  const t = lang === 'ca' ? {
    preheader: `Tornes a formar part de l'equip de ${orgName}`,
    title: `Hola ${firstName}`,
    intro: `Hem revertit la teva baixa de l'equip de <strong>${safeOrgName}</strong>. Tornes a estar al directori intern de l'organització, amb el seu branding aplicat a la teva targeta.`,
    explain: `Si rebés recentment el correu de "90 dies de cortesia", ja no aplica — el teu pla torna a ser el de l'equip i no caducarà mentre l'organització segueixi activa.`,
    yourCardLabel: 'La teva targeta:',
    footer: `Si tens dubtes, respon a aquest email i et contestem.`,
    subject: `${firstName}, tornes a formar part de l'equip de ${orgName}`,
  } : {
    preheader: `Vuelves a formar parte del equipo de ${orgName}`,
    title: `Hola ${firstName}`,
    intro: `Hemos revertido tu baja del equipo de <strong>${safeOrgName}</strong>. Vuelves a estar en el directorio interno de la organización, con su branding aplicado a tu tarjeta.`,
    explain: `Si recibiste recientemente el email de "90 días de cortesía", ya no aplica — tu plan vuelve a ser el del equipo y no caducará mientras la organización siga activa.`,
    yourCardLabel: 'Tu tarjeta:',
    footer: `Si tienes dudas, responde a este email y te contestamos.`,
    subject: `${firstName}, vuelves a formar parte del equipo de ${orgName}`,
  };

  const bodyHtml = `
            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${t.intro}
            </p>

            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${t.explain}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr><td style="background:#FAF7F0;border-radius:8px;padding:14px 16px;font-size:13px;color:${COLORS.inkSoft};line-height:1.5">
                <strong>${t.yourCardLabel}</strong> <a href="${esc(cardUrl)}" style="color:${COLORS.accent};text-decoration:none">${esc(cardUrl)}</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${t.footer}
            </p>`;

  const html = buildEmailLayout({
    preheader: t.preheader,
    title: t.title,
    bodyHtml,
    idioma: lang,
  });

  return { subject: t.subject, html };
}

// Email de invitación al panel B2B self-serve. Lo dispara el founder
// desde admin-orgs cuando ha cerrado un deal con la org y abre la puerta
// del panel. Distinto tono que panel-auth.buildPanelLoginEmail (que es
// "tú lo pediste, aquí lo tienes"): aquí es "te lo hemos preparado, ya
// está listo, esto es lo que vas a encontrar dentro".
const PANEL_INVITE_STRINGS = {
  es: {
    preheader: (orgName) => `Tu panel de PerfilaPro está listo · ${orgName}`,
    title: (orgName) => `Bienvenida, ${orgName}`,
    subject: (orgName) => `Tu panel de PerfilaPro está listo · ${orgName}`,
    intro: 'Hemos configurado vuestro panel B2B en PerfilaPro. Desde aquí podéis gestionar el equipo y la marca de vuestra organización sin tener que escribirnos para cada cambio.',
    bullets: [
      '<strong>Branding</strong> · logo, color, descripción, datos de contacto que aparecen en vuestra página pública.',
      '<strong>Equipo</strong> · invitar profesionales en lote, ver quién está activo, descargar tarjetas físicas.',
      '<strong>Estadísticas</strong> · visitas a las tarjetas del equipo, evolución y desglose por miembro.',
    ],
    cta: 'Entrar al panel →',
    validity: 'El enlace de acceso es válido <strong>7 días</strong>. Si caduca, basta con abrir <a href="{panelHomeUrl}" style="color:#00A865">{panelHomeUrl}</a> e introducir este mismo email para recibir uno nuevo.',
    publicLine: 'Vuestra página pública sigue activa en <a href="{publicUrl}" style="color:#00A865">{publicUrl}</a>.',
    help: 'Si tenéis cualquier duda, responded a este email y os contestamos.',
  },
  ca: {
    preheader: (orgName) => `El teu panell de PerfilaPro està a punt · ${orgName}`,
    title: (orgName) => `Benvinguda, ${orgName}`,
    subject: (orgName) => `El teu panell de PerfilaPro està a punt · ${orgName}`,
    intro: 'Hem configurat el vostre panell B2B a PerfilaPro. Des d\'aquí podeu gestionar l\'equip i la marca de la vostra organització sense haver d\'escriure\'ns per a cada canvi.',
    bullets: [
      '<strong>Branding</strong> · logo, color, descripció, dades de contacte que apareixen a la vostra pàgina pública.',
      '<strong>Equip</strong> · convidar professionals en lot, veure qui està actiu, descarregar targetes físiques.',
      '<strong>Estadístiques</strong> · visites a les targetes de l\'equip, evolució i desglossament per membre.',
    ],
    cta: 'Entrar al panell →',
    validity: 'L\'enllaç d\'accés és vàlid <strong>7 dies</strong>. Si caduca, només cal obrir <a href="{panelHomeUrl}" style="color:#00A865">{panelHomeUrl}</a> i introduir aquest mateix email per rebre\'n un de nou.',
    publicLine: 'La vostra pàgina pública continua activa a <a href="{publicUrl}" style="color:#00A865">{publicUrl}</a>.',
    help: 'Si teniu qualsevol dubte, responeu a aquest email i us contestem.',
  },
};

function buildPanelInviteEmail({ orgName, orgSlug, panelUrl, panelHomeUrl, publicUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = PANEL_INVITE_STRINGS[lang];

  const bulletsHtml = T.bullets.map(b =>
    `<li style="margin:0 0 8px;font-size:14px;color:${COLORS.inkSoft};line-height:1.55">${b}</li>`
  ).join('');

  const validityHtml = T.validity
    .replace(/\{panelHomeUrl\}/g, panelHomeUrl);

  const publicLineHtml = T.publicLine
    .replace(/\{publicUrl\}/g, publicUrl);

  const bodyHtml = `
            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.65">
              ${T.intro}
            </p>

            <ul style="margin:0 0 24px;padding:0 0 0 20px;list-style:disc">
              ${bulletsHtml}
            </ul>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr><td align="center">
                <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>

            <p style="margin:0 0 14px;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${validityHtml}
            </p>

            <p style="margin:0 0 14px;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${publicLineHtml}
            </p>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.help}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(orgName),
    title: T.title(orgName),
    bodyHtml,
    idioma: lang,
  });

  return { subject: T.subject(orgName), html };
}

function makeHandler(db, emailClient = defaultEmailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { action } = body;

    // ── list: devuelve todas las orgs activas ──
    if (action === 'list') {
      const { data, error } = await db
        .from('organizations')
        .select('id, slug, name, tagline, description, website, email, logo_url, color_primary, address, phone, hide_branding, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, orgs: data || [] });
    }

    // ── create: alta de una nueva organización ──
    if (action === 'create') {
      const { slug, name, tagline, description, website, logo_url, color_primary, nif, email, address, phone, hide_branding } = body;

      if (!isValidOrgSlug(slug)) {
        return jsonResponse(400, { error: 'slug inválido (2-40 chars, [a-z0-9-], sin guiones en los extremos)' });
      }
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return jsonResponse(400, { error: 'name requerido (mín. 2 chars)' });
      }
      if (tagline != null && !isValidTagline(tagline)) {
        return jsonResponse(400, { error: 'tagline máx. 140 chars' });
      }
      if (description != null && !isValidDescription(description)) {
        return jsonResponse(400, { error: 'description máx. 500 chars' });
      }
      if (website && !isSafeWebsite(website)) {
        return jsonResponse(400, { error: 'website inválido (http:// o https://, máx 200 chars)' });
      }
      if (email && !EMAIL_RE.test(String(email).trim())) {
        return jsonResponse(400, { error: 'email inválido' });
      }
      if (color_primary && !isValidHex(color_primary)) {
        return jsonResponse(400, { error: 'color_primary debe ser #RRGGBB' });
      }
      if (logo_url && !isSafeLogoUrl(logo_url)) {
        return jsonResponse(400, { error: 'logo_url debe estar en Supabase storage (https)' });
      }

      const { data, error } = await db
        .from('organizations')
        .insert({
          slug,
          name: name.trim(),
          tagline: tagline ? String(tagline).trim() : null,
          description: description ? stripTagsInline(description).substring(0, 500) : null,
          website: website ? String(website).trim() : null,
          logo_url: logo_url || null,
          color_primary: color_primary || null,
          nif: nif ? String(nif).trim() : null,
          email: email ? String(email).trim() : null,
          address: address ? stripTagsInline(address).substring(0, 200) : null,
          phone:   phone   ? stripTagsInline(phone).substring(0, 40)    : null,
          hide_branding: hide_branding === true,
        })
        .select('id, slug, name, tagline, description, website, email, logo_url, color_primary, address, phone, hide_branding')
        .single();

      if (error) {
        const msg = error.message || '';
        const status = /duplicate|unique/i.test(msg) ? 409 : 500;
        return jsonResponse(status, { error: msg });
      }
      return jsonResponse(200, { ok: true, org: data });
    }

    // ── update: edita branding de una org existente ──
    if (action === 'update') {
      const { slug, name, tagline, description, website, email, logo_url, color_primary, address, phone, hide_branding } = body;

      if (!isValidOrgSlug(slug)) {
        return jsonResponse(400, { error: 'slug inválido' });
      }
      if (tagline != null && !isValidTagline(tagline)) {
        return jsonResponse(400, { error: 'tagline máx. 140 chars' });
      }
      if (description != null && !isValidDescription(description)) {
        return jsonResponse(400, { error: 'description máx. 500 chars' });
      }
      if (website && !isSafeWebsite(website)) {
        return jsonResponse(400, { error: 'website inválido (http:// o https://, máx 200 chars)' });
      }
      if (email && !EMAIL_RE.test(String(email).trim())) {
        return jsonResponse(400, { error: 'email inválido' });
      }
      if (color_primary && !isValidHex(color_primary)) {
        return jsonResponse(400, { error: 'color_primary debe ser #RRGGBB' });
      }
      if (logo_url && !isSafeLogoUrl(logo_url)) {
        return jsonResponse(400, { error: 'logo_url debe estar en Supabase storage (https)' });
      }

      const updates = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length < 2) {
          return jsonResponse(400, { error: 'name inválido' });
        }
        updates.name = name.trim();
      }
      if (tagline !== undefined)       updates.tagline       = tagline ? String(tagline).trim() : null;
      if (description !== undefined)   updates.description   = description ? stripTagsInline(description).substring(0, 500) : null;
      if (website !== undefined)       updates.website       = website ? String(website).trim() : null;
      if (email !== undefined)         updates.email         = email ? String(email).trim() : null;
      if (logo_url !== undefined)      updates.logo_url      = logo_url || null;
      if (color_primary !== undefined) updates.color_primary = color_primary || null;
      // address / phone son tolerantes: el admin los puede vaciar mandando ''
      // o null. Sanitización idéntica que en `create`. Sin CHECK constraint
      // a nivel DB (ver migración 023): los validamos aquí en backend.
      if (address !== undefined) updates.address = address ? stripTagsInline(address).substring(0, 200) : null;
      if (phone   !== undefined) updates.phone   = phone   ? stripTagsInline(phone).substring(0, 40)    : null;
      // hide_branding: white-label flag. Boolean estricto — cualquier
      // valor distinto de true se persiste como false (no toggle accidental).
      if (hide_branding !== undefined) updates.hide_branding = hide_branding === true;

      if (!Object.keys(updates).length) {
        return jsonResponse(400, { error: 'nada para actualizar' });
      }

      const { error } = await db
        .from('organizations')
        .update(updates)
        .eq('slug', slug)
        .is('deleted_at', null);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }

    // ── get_panel_url: firma un JWT corto (1h, actor=founder) y devuelve la
    // URL del panel del cliente para que el founder lo abra "como si fuera
    // el cliente" — soporte / demos / troubleshooting. El claim actor=founder
    // queda en el JWT (no en query string, no manipulable) para que panel.html
    // pinte la franja "operando como founder · [org] · Cerrar". TTL corto
    // porque es una sesión operativa, no persistente: si el founder necesita
    // más, regenera el link en 5 segundos.
    if (action === 'get_panel_url') {
      const { slug } = body;
      if (!isValidOrgSlug(slug)) return jsonResponse(400, { error: 'slug inválido' });

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org) return jsonResponse(404, { error: 'organization no encontrada' });

      const token = signPanelSession({ orgId: org.id, orgSlug: org.slug, actor: 'founder' });
      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      return jsonResponse(200, {
        ok: true,
        url: `${siteUrl}/panel.html?session=${token}`,
        org_name: org.name,
      });
    }

    // ── send_panel_invite: el founder dispara el "te abro la puerta del
    // panel" cuando ha cerrado un deal con la org. Manda un magic-link de
    // bienvenida al organizations.email con TTL 7d (cliente normal, sin
    // claim actor=founder). NO es self-serve — requiere que el founder
    // tenga el contexto comercial de qué cliente está onboardeando.
    //
    // Idempotente: el founder puede reenviar si el cliente pierde el email.
    // Cada envío firma un JWT nuevo (los previos siguen siendo válidos
    // hasta su expiración natural, pero el cliente normalmente usa el
    // último que recibe).
    if (action === 'send_panel_invite') {
      const { slug, idioma } = body;
      const lang = idioma === 'ca' ? 'ca' : 'es';
      if (!isValidOrgSlug(slug)) return jsonResponse(400, { error: 'slug inválido' });

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name, email')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org) return jsonResponse(404, { error: 'organization no encontrada' });
      if (!org.email) {
        return jsonResponse(400, {
          error: 'La org no tiene email registrado. Añádelo en el formulario antes de enviar el acceso al cliente.',
        });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Cliente de email no configurado (falta RESEND_API_KEY)' });
      }

      const token = signPanelSession({ orgId: org.id, orgSlug: org.slug });
      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const panelUrl = `${siteUrl}/panel.html?session=${token}`;
      const panelHomeUrl = `${siteUrl}/panel.html`;
      const publicUrl = `${siteUrl}/e/${org.slug}`;

      const { subject, html } = buildPanelInviteEmail({
        orgName: org.name,
        orgSlug: org.slug,
        panelUrl,
        panelHomeUrl,
        publicUrl,
        idioma: lang,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: org.email,
          subject,
          html,
        });
      } catch (err) {
        console.error('admin-orgs send_panel_invite: email falló:', err.message);
        return jsonResponse(500, { error: 'No se pudo enviar el email: ' + err.message });
      }

      return jsonResponse(200, { ok: true, sent_to: org.email });
    }

    // ── delete_org: soft-delete (setea deleted_at) ──
    if (action === 'delete_org') {
      const { slug } = body;
      if (!isValidOrgSlug(slug)) return jsonResponse(400, { error: 'slug inválido' });

      // Primero desvinculamos las cards para que no queden colgando con
      // un organization_id que apunta a una org borrada.
      const { data: org } = await db
        .from('organizations')
        .select('id')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (!org) return jsonResponse(404, { error: 'organization no encontrada' });

      const { error: cardsErr } = await db
        .from('cards')
        .update({ organization_id: null })
        .eq('organization_id', org.id);
      if (cardsErr) return jsonResponse(500, { error: cardsErr.message });

      const { error: orgErr } = await db
        .from('organizations')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', org.id);
      if (orgErr) return jsonResponse(500, { error: orgErr.message });

      return jsonResponse(200, { ok: true });
    }

    // ── list_cards_for_assignment: cards activas con su org actual ──
    // Lightweight: solo los campos que el studio necesita para mostrar
    // cards en el selector de asignación. No reusa admin-data (que es
    // pesado y devuelve toda la tabla con campos sensibles).
    if (action === 'list_cards_for_assignment') {
      const { data, error } = await db
        .from('cards')
        .select('slug, nombre, organization_id, plan, status')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('nombre', { ascending: true });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, cards: data || [] });
    }

    // ── assign_card: vincula (o desvincula) una card a una org ──
    if (action === 'assign_card') {
      const { card_slug, org_slug } = body;

      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }
      if (org_slug !== null && !isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido (pasa null para desvincular)' });
      }

      let organization_id = null;
      if (org_slug) {
        const { data: org } = await db
          .from('organizations')
          .select('id')
          .eq('slug', org_slug)
          .is('deleted_at', null)
          .maybeSingle();
        if (!org) return jsonResponse(404, { error: 'organization no encontrada' });
        organization_id = org.id;
      }

      const { error } = await db
        .from('cards')
        .update({ organization_id })
        .eq('slug', card_slug);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, card_slug, organization_id });
    }

    // ── offboard_card: founder da de baja a un miembro de su org ──
    // Salida humana: la card queda activa públicamente, sale del equipo,
    // pasa a plan 'base' con 90d de cortesía. Trail de offboard preservado
    // en previous_organization_id + offboarded_at + offboarded_by='founder'
    // para que restore_member pueda revertirlo dentro de los 90d.
    // Lógica compartida con org-panel.js offboard_member en lib/card-offboard.
    if (action === 'offboard_card') {
      const { card_slug } = body;
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const result = await offboardCard(db, { cardSlug: card_slug, actor: 'founder' });
      if (!result.ok) return jsonResponse(result.status, { error: result.error });
      const { card, orgName, editToken, expiresAt } = result;

      // Email al trabajador (no bloqueante: si Resend falla, el offboard
      // ya está aplicado en BD, devolvemos ok igualmente y logueamos).
      if (card.email) {
        const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
        const idioma = card.idioma === 'ca' ? 'ca' : 'es';
        const cardUrl = `${siteUrl}/c/${card.slug}`;
        const editUrl = `${siteUrl}/${idioma}/editar?slug=${card.slug}&token=${editToken}`;
        const { subject, html } = buildOffboardEmail({
          orgName,
          nombre: card.nombre,
          idioma,
          cardUrl,
          editUrl,
        });
        try {
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: card.email,
            subject,
            html,
          });
        } catch (err) {
          console.error(`admin-orgs offboard_card: email a ${card.email} falló:`, err.message);
        }
      }

      return jsonResponse(200, {
        ok: true,
        card_slug,
        expires_at: expiresAt,
        courtesy_days: COURTESY_DAYS,
      });
    }

    // ── list_offboarded_members: cards recientemente offboarded de una org ──
    // Para el drawer "Restaurar miembros" del Studio. Por defecto devuelve
    // los últimos 90d (la ventana de cortesía donde restore_member tiene
    // sentido). Si offboarded_at > 90d, la card ya está expirada o cerca
    // de expirar; restore deja de ser razonable y founder debería usar
    // assign_card si quiere re-vincular manualmente.
    if (action === 'list_offboarded_members') {
      const { slug } = body;
      if (!isValidOrgSlug(slug)) return jsonResponse(400, { error: 'slug inválido' });

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, name')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org) return jsonResponse(404, { error: 'organization no encontrada' });

      const since = new Date(Date.now() - COURTESY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db
        .from('cards')
        .select('slug, nombre, email, offboarded_at, offboarded_by, organization_id, expires_at')
        .eq('previous_organization_id', org.id)
        .gte('offboarded_at', since)
        .is('deleted_at', null)
        .order('offboarded_at', { ascending: false });
      if (error) return jsonResponse(500, { error: error.message });

      // Anotamos cuál ya fue re-asignada a otra org (no se puede restaurar
      // a la org original sin pisar) para que el frontend ofrezca el
      // botón sólo a las que están realmente "huérfanas".
      const members = (data || []).map(c => ({
        slug: c.slug,
        nombre: c.nombre,
        email: c.email,
        offboarded_at: c.offboarded_at,
        offboarded_by: c.offboarded_by,
        expires_at: c.expires_at,
        restorable: c.organization_id == null,
      }));
      return jsonResponse(200, { ok: true, members, org_name: org.name, window_days: COURTESY_DAYS });
    }

    // ── restore_member: devuelve una card offboarded a su org original ──
    // Ventana razonable: 90 días desde el offboard. Sin ventana dura en
    // backend (el lib comprueba que previous_organization_id sigue activa);
    // el UI sí filtra a los últimos 90d para no ofrecer restores absurdos.
    if (action === 'restore_member') {
      const { card_slug } = body;
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const result = await restoreCard(db, { cardSlug: card_slug });
      if (!result.ok) return jsonResponse(result.status, { error: result.error });
      const { card, orgName } = result;

      // Email al trabajador: "ha sido un error, sigues en el equipo".
      // No bloqueante: si Resend falla, el restore ya está aplicado.
      if (card.email) {
        const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
        const idioma = card.idioma === 'ca' ? 'ca' : 'es';
        const cardUrl = `${siteUrl}/c/${card.slug}`;
        const { subject, html } = buildRestoreEmail({
          orgName,
          nombre: card.nombre,
          idioma,
          cardUrl,
        });
        try {
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: card.email,
            subject,
            html,
          });
        } catch (err) {
          console.error(`admin-orgs restore_member: email a ${card.email} falló:`, err.message);
        }
      }

      return jsonResponse(200, { ok: true, card_slug, org_name: orgName });
    }

    // ── get_edit_url: devuelve el magic-link de edición de una card ──
    // Reusa el edit_token vigente si lo hay; si está ausente o expirado lo
    // regenera (32 bytes hex, 7 días). Evita invalidar links que el agente
    // pueda estar usando ya. Solo cards no soft-deleted.
    if (action === 'get_edit_url') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }

      const { data: card, error: selErr } = await db
        .from('cards')
        .select('slug, idioma, edit_token, edit_token_expires_at')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (selErr) return jsonResponse(500, { error: selErr.message });
      if (!card)  return jsonResponse(404, { error: 'card no encontrada' });

      let token = card.edit_token;
      const expires = card.edit_token_expires_at;
      const expired = !expires || new Date(expires) < new Date();
      if (!token || expired) {
        token = crypto.randomBytes(32).toString('hex');
        const newExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: updErr } = await db
          .from('cards')
          .update({ edit_token: token, edit_token_expires_at: newExpires })
          .eq('slug', card_slug);
        if (updErr) return jsonResponse(500, { error: updErr.message });
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const idioma = card.idioma === 'ca' ? 'ca' : 'es';
      return jsonResponse(200, {
        ok: true,
        edit_url: `${siteUrl}/${idioma}/editar?slug=${card.slug}&token=${token}`,
      });
    }

    // ── send_edit_link: reenviar magic-link al miembro del equipo por email ──
    // Pensado para el flujo "el operario perdió su email de invitación / no
    // encuentra el enlace". Detecta el contexto: si la card pertenece a una
    // org, manda el email branded con el banner de la marca (buildInviteEmail).
    // Si no, manda el genérico de edición (buildEditLinkEmail). En ambos casos
    // marca cards.edit_link_sent_at para que el panel muestre "Reenviado hace Xd".
    if (action === 'send_edit_link') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const { data: card, error: selErr } = await db
        .from('cards')
        .select('slug, nombre, email, idioma, organization_id, edit_token, edit_token_expires_at')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (selErr) return jsonResponse(500, { error: selErr.message });
      if (!card)  return jsonResponse(404, { error: 'card no encontrada' });
      if (!card.email) {
        return jsonResponse(400, { error: 'la card no tiene email registrado' });
      }

      // Regenera token si está ausente o expirado (mismo criterio que get_edit_url).
      let token = card.edit_token;
      const expired = !card.edit_token_expires_at || new Date(card.edit_token_expires_at) < new Date();
      const tokenUpdate = {};
      if (!token || expired) {
        token = crypto.randomBytes(32).toString('hex');
        tokenUpdate.edit_token = token;
        tokenUpdate.edit_token_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const idioma = card.idioma === 'ca' ? 'ca' : 'es';
      const editUrl = `${siteUrl}/${idioma}/editar?slug=${card.slug}&token=${token}`;

      // Email branded si hay org, genérico si no. El subject lleva prefix de
      // reenvío para que el destinatario sepa que no es una invitación nueva.
      let subject, html;
      if (card.organization_id) {
        const { data: org } = await db
          .from('organizations')
          .select('name, logo_url, color_primary')
          .eq('id', card.organization_id)
          .maybeSingle();
        const orgName = org?.name || 'tu equipo';
        const invite = buildInviteEmail({
          orgName,
          orgLogoUrl: org?.logo_url || null,
          orgColor:   org?.color_primary || null,
          nombre:     card.nombre,
          editUrl,
        });
        subject = invite.subject;
        html    = invite.html;
      } else {
        const T = EDIT_LINK_STRINGS[idioma];
        const firstName = (card.nombre || '').split(' ')[0];
        subject = T.subject(firstName);
        html = buildEditLinkEmail({ nombre: card.nombre, editUrl, idioma });
      }

      const prefix = idioma === 'ca' ? '[Reenviament]' : '[Reenvío]';
      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: card.email,
          subject: `${prefix} ${subject}`,
          html,
        });
      } catch (err) {
        console.error(`admin-orgs send_edit_link: email a ${card.email} falló:`, err.message);
        return jsonResponse(500, { error: 'No se pudo enviar el email' });
      }

      // Persistimos el timestamp + token nuevo (si lo hubo) en una sola escritura.
      const { error: updErr } = await db
        .from('cards')
        .update({ edit_link_sent_at: new Date().toISOString(), ...tokenUpdate })
        .eq('slug', card_slug);
      if (updErr) {
        console.warn('admin-orgs send_edit_link: no se pudo marcar edit_link_sent_at:', updErr.message);
      }

      return jsonResponse(200, {
        ok: true,
        card_slug,
        email: card.email,
        sent_at: new Date().toISOString(),
        branded: !!card.organization_id,
      });
    }

    // ── download_team_cards: PDF booklet con la tarjeta de visita de cada miembro ──
    // Power-feature para el admin que reparte tarjetas en eventos. Una sola
    // descarga, una página por miembro activo de la org (85×55mm cada una),
    // listo para mandar a imprenta. Si la org no tiene miembros, 400.
    //
    // Devolvemos base64 dentro de JSON (no streaming binario) porque el admin
    // dispatcher ya está en modo JSON-only y el volumen real es bajo (1-50
    // miembros, <500KB el PDF resultante). El frontend hace `atob` + Blob.
    if (action === 'download_team_cards') {
      const { org_slug } = body;
      if (!isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido' });
      }

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email, hide_branding')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      // Solo cards activas (no soft-deleted) del equipo. Ordenadas por nombre
      // para que el booklet salga alfabético — facilita repartir en imprenta.
      const { data: cards, error: cardsErr } = await db
        .from('cards')
        .select('slug, nombre, tagline, whatsapp, email, direccion')
        .eq('organization_id', org.id)
        .is('deleted_at', null)
        .eq('status', 'active')
        .order('nombre', { ascending: true });
      if (cardsErr) return jsonResponse(500, { error: cardsErr.message });
      if (!cards || !cards.length) {
        return jsonResponse(400, { error: 'la org no tiene profesionales activos' });
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      try {
        const pdfBuffer = await buildBusinessCardsBookletPDF({ cards, org, siteUrl });
        return jsonResponse(200, {
          ok: true,
          filename: `tarjetas-${org.slug}.pdf`,
          base64: pdfBuffer.toString('base64'),
          count: cards.length,
        });
      } catch (err) {
        console.error('download_team_cards: render del booklet falló:', err.message);
        return jsonResponse(500, { error: 'No se pudo generar el PDF' });
      }
    }

    // ── download_member_card: PDF de la tarjeta de visita 85×55mm de UN miembro ──
    // Igual que download_team_cards pero para un único miembro. Caso de uso:
    // el admin acaba de invitar a un profesional desde el Studio y quiere ver
    // cómo le ha quedado su tarjeta de visita sin abrir el buzón del miembro
    // ni bajarse el booklet entero del equipo. El render reusa exactamente la
    // misma plantilla que invite_team adjunta al email de invitación, así que
    // lo que el admin ve es lo que el miembro va a recibir.
    if (action === 'download_member_card') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }

      const { data: card, error: cardErr } = await db
        .from('cards')
        .select('slug, nombre, tagline, whatsapp, email, direccion, organization_id, status')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (cardErr) return jsonResponse(500, { error: cardErr.message });
      if (!card)   return jsonResponse(404, { error: 'card no encontrada' });
      if (!card.organization_id) {
        return jsonResponse(400, { error: 'la card no pertenece a ninguna organización' });
      }

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email, hide_branding')
        .eq('id', card.organization_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const logoBuffer = org.logo_url
        ? await fetchLogoAsPngBuffer(org.logo_url).catch(() => null)
        : null;

      try {
        const pdfBuffer = await buildBusinessCardPDF({ card, org, logoBuffer, siteUrl });
        return jsonResponse(200, {
          ok: true,
          filename: `tarjeta-${card.slug}.pdf`,
          base64: pdfBuffer.toString('base64'),
        });
      } catch (err) {
        console.error('download_member_card: render falló:', err.message);
        return jsonResponse(500, { error: 'No se pudo generar el PDF' });
      }
    }

    // ── org_card_stats: visits 30d + timestamps de email por card ──
    // El admin-orgs studio necesita contexto rápido por card en el listado
    // de profesionales asignados: cuántas visitas tuvo en los últimos 30 días
    // y cuándo fue el último email (invitación o reenvío de link). Permite
    // detectar miembros inactivos o que nunca recibieron su email de bienvenida.
    //
    // Scope: solo las cards de UNA org concreta. No es global a propósito —
    // visitar 'visits' globalmente sería caro y no aporta nada al flujo B2B.
    if (action === 'org_card_stats') {
      const { org_slug } = body;
      if (!isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido' });
      }

      const { data: org } = await db
        .from('organizations')
        .select('id')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (!org) return jsonResponse(404, { error: 'organization no encontrada' });

      const { data: cards, error: cardsErr } = await db
        .from('cards')
        .select('slug, kit_email_sent_at, edit_link_sent_at')
        .eq('organization_id', org.id)
        .is('deleted_at', null);
      if (cardsErr) return jsonResponse(500, { error: cardsErr.message });

      const slugs = (cards || []).map(c => c.slug);
      if (!slugs.length) {
        return jsonResponse(200, { ok: true, cards: [] });
      }

      // Visits de los últimos 30 días para todos los slugs en una sola query.
      // Agregamos en JS — cardinalidad realista (<100 cards × <100 visitas/30d)
      // mantiene esto barato y no necesitamos un RPC.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: visits, error: visitsErr } = await db
        .from('visits')
        .select('slug')
        .in('slug', slugs)
        .gte('visited_at', thirtyDaysAgo);
      if (visitsErr) return jsonResponse(500, { error: visitsErr.message });

      const visitsBySlug = {};
      for (const v of (visits || [])) {
        visitsBySlug[v.slug] = (visitsBySlug[v.slug] || 0) + 1;
      }

      const stats = (cards || []).map(c => ({
        slug: c.slug,
        visits_30d: visitsBySlug[c.slug] || 0,
        kit_email_sent_at:  c.kit_email_sent_at  || null,
        edit_link_sent_at:  c.edit_link_sent_at  || null,
      }));

      return jsonResponse(200, { ok: true, cards: stats });
    }

    // ── org_get_stats_link ──
    // Genera (o refresca) un stats_token para que el founder comparta con el
    // cliente B2B un enlace `/e/:slug/stats?token=…` que da acceso al panel
    // de estadísticas agregadas sin login. El token es 32-byte hex (64
    // chars), TTL 90 días, único por org. Si la org ya tiene un token vigente
    // se devuelve el actual; con `force_refresh: true` se invalida el viejo
    // y se emite uno nuevo (rota el enlace si el cliente lo filtró).
    if (action === 'org_get_stats_link') {
      const { org_slug, force_refresh } = body;
      if (!isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido' });
      }

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, stats_token, stats_token_expires_at')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      const now      = new Date();
      const expires  = org.stats_token_expires_at ? new Date(org.stats_token_expires_at) : null;
      const expired  = !expires || expires.getTime() <= now.getTime();
      const needsNew = force_refresh === true || !org.stats_token || expired;

      let token        = org.stats_token;
      let expires_at   = org.stats_token_expires_at;
      let just_created = false;

      if (needsNew) {
        token = crypto.randomBytes(32).toString('hex');
        expires_at = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const { error: updErr } = await db
          .from('organizations')
          .update({ stats_token: token, stats_token_expires_at: expires_at })
          .eq('id', org.id);
        if (updErr) return jsonResponse(500, { error: updErr.message });
        just_created = true;
      }

      const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
      const host  = (event.headers && event.headers.host) || 'perfilapro.es';
      const url   = `${proto}://${host}/e/${org.slug}/stats?token=${token}`;

      return jsonResponse(200, {
        ok: true,
        url,
        token,
        expires_at,
        just_created,
      });
    }

    // ── delete_card: soft-delete (deleted_at = NOW()) de una card ──
    // Mismo patrón que delete-account.js: marca deleted_at y deja que el job
    // purge-deleted haga el hard-delete cascada a los 30 días. Esto preserva
    // facturas (AEAT) y visits hasta la purga, y da un grace period por si
    // el admin se equivoca. 404 si la card no existe o ya está borrada.
    if (action === 'delete_card') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }

      const { data: card, error: selErr } = await db
        .from('cards')
        .select('slug')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (selErr) return jsonResponse(500, { error: selErr.message });
      if (!card)  return jsonResponse(404, { error: 'card no encontrada' });

      const { error: updErr } = await db
        .from('cards')
        .update({ deleted_at: new Date().toISOString() })
        .eq('slug', card_slug);
      if (updErr) return jsonResponse(500, { error: updErr.message });

      return jsonResponse(200, { ok: true, card_slug });
    }

    // ── leads_list: leads B2B persistidos (filtrables) ──
    // Devuelve los leads del form /es/empresas para que el admin los gestione
    // (asociar a org, reenviar magic-link). Por defecto solo pendientes.
    if (action === 'leads_list') {
      const onlyPending = body.only_pending !== false;
      let q = db
        .from('b2b_leads')
        .select('id, invite_token, name, company, email, team_size, sector, message, idioma, organization_id, created_at, redeemed_at, redeemed_card_slug, agent_code')
        .order('created_at', { ascending: false })
        .limit(200);
      if (onlyPending) q = q.is('redeemed_at', null);
      const { data, error } = await q;
      if (error) return jsonResponse(500, { error: error.message });

      // Resolvemos los nombres de org en JS (cardinalidad baja: < 200 leads
      // y < 50 orgs realistas). Evitamos un JOIN complejo y mantenemos el
      // select-builder mockeable en tests.
      const orgIds = Array.from(new Set((data || []).map(l => l.organization_id).filter(Boolean)));
      let orgMap = {};
      if (orgIds.length) {
        const { data: orgs } = await db
          .from('organizations')
          .select('id, slug, name')
          .in('id', orgIds);
        for (const o of (orgs || [])) orgMap[o.id] = { slug: o.slug, name: o.name };
      }
      const leads = (data || []).map(l => ({
        ...l,
        // No exponemos invite_token en bruto a UI más allá de lo necesario;
        // sirve para construir el magic-link en el modal de copy.
        org: l.organization_id ? orgMap[l.organization_id] || null : null,
      }));
      return jsonResponse(200, { ok: true, leads });
    }

    // ── leads_assign: asociar un lead a una organización ──
    if (action === 'leads_assign') {
      const { lead_id, org_slug } = body;
      if (!lead_id || !UUID_RE.test(String(lead_id))) {
        return jsonResponse(400, { error: 'lead_id inválido' });
      }
      if (org_slug !== null && !isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido (pasa null para desvincular)' });
      }

      let organization_id = null;
      if (org_slug) {
        const { data: org } = await db
          .from('organizations')
          .select('id')
          .eq('slug', org_slug)
          .is('deleted_at', null)
          .maybeSingle();
        if (!org) return jsonResponse(404, { error: 'organization no encontrada' });
        organization_id = org.id;
      }

      const { error } = await db
        .from('b2b_leads')
        .update({ organization_id })
        .eq('id', lead_id);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, lead_id, organization_id });
    }

    // ── leads_resend: enviar el magic-link al lead ──
    // Idempotente: NO regeneramos el invite_token. Si el lead ya está
    // redeemed_at, devolvemos 409 sin enviar (el link no vale para nada).
    //
    // Nota histórica: la acción se llama "resend" pero desde el cambio
    // de gating del magic-link (claude/b2b-leads-gate-magic-link), es
    // típicamente la PRIMERA vez que el lead recibe el enlace — el form
    // ya no auto-envía, solo manda acuse de recibo. El nombre del action
    // se conserva por compat con el frontend.
    //
    // Si el lead está asociado a una organización (lead.organization_id),
    // pasamos el branding de la org (logo + color_primary + nombre) a
    // buildLeadEmail para que el email salga con un banner branded —
    // demo personalizada. Sin org asociada, el email va con identidad
    // PerfilaPro genérica.
    if (action === 'leads_resend') {
      const { lead_id } = body;
      if (!lead_id || !UUID_RE.test(String(lead_id))) {
        return jsonResponse(400, { error: 'lead_id inválido' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const { data: lead, error } = await db
        .from('b2b_leads')
        .select('id, name, company, email, idioma, invite_token, redeemed_at, organization_id')
        .eq('id', lead_id)
        .maybeSingle();
      if (error) return jsonResponse(500, { error: error.message });
      if (!lead) return jsonResponse(404, { error: 'lead no encontrado' });
      if (lead.redeemed_at) {
        return jsonResponse(409, { error: 'Este lead ya redimió su enlace' });
      }

      // Branding opcional: si el admin asoció el lead a una org desde
      // Studio antes de mandar el link, el email lleva logo + color de
      // esa org. Si la org está soft-deleted la ignoramos (fallback a
      // identidad PerfilaPro genérica, no rompe el envío).
      let orgBranding = null;
      if (lead.organization_id) {
        const { data: org } = await db
          .from('organizations')
          .select('name, logo_url, color_primary, deleted_at')
          .eq('id', lead.organization_id)
          .maybeSingle();
        if (org && !org.deleted_at) {
          orgBranding = {
            name: org.name,
            logoUrl: org.logo_url,
            color: org.color_primary,
          };
        }
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const { subject, html } = buildLeadEmail({
        name: lead.name,
        company: lead.company,
        inviteToken: lead.invite_token,
        idioma: lead.idioma,
        siteUrl,
        org: orgBranding,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: lead.email,
          subject,
          html,
        });
      } catch (err) {
        console.error('admin-orgs leads_resend: error enviando email:', err.message);
        return jsonResponse(500, { error: 'No se pudo enviar el email' });
      }

      return jsonResponse(200, { ok: true, branded: !!orgBranding });
    }

    // ── invite_team: alta en bloque de varios agentes con datos comunes ──
    // Para empresas que envían 5-30 operarios de golpe. El founder rellena
    // los datos compartidos (tagline, CP, servicios, descripción) una vez,
    // y una lista de {email, nombre}. El backend crea N cards B2B con esos
    // datos prerellenados y envía N emails de invitación en paralelo.
    //
    // El operario después solo añade foto + WhatsApp desde /editar. Los
    // datos comunes (los que mete CCH) quedan bloqueados en edit-card.POST
    // para que el operario no los pueda tocar.
    //
    // Devuelve { ok: [...], failed: [...] } para que el admin vea el
    // resumen y pueda reintentar solo los fallos.
    if (action === 'invite_team') {
      const { org_slug, team, template } = body;

      if (!isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido' });
      }
      if (!Array.isArray(team) || team.length === 0) {
        return jsonResponse(400, { error: 'team debe ser un array no vacío' });
      }
      if (team.length > 100) {
        return jsonResponse(400, { error: 'máximo 100 invitaciones por lote' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email, hide_branding')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const { ok, failed } = await inviteTeamMembers({
        db,
        emailClient,
        buildInviteEmail,
        org,
        team,
        template,
        siteUrl,
      });

      return jsonResponse(200, {
        ok: true,
        org: { slug: org.slug, name: org.name },
        results: { ok, failed },
        summary: `${ok.length} de ${team.length} invitaciones enviadas${failed.length ? `, ${failed.length} con error` : ''}`,
      });
    }

    // ── CANTERA · override de traspaso atascado (founder) ──
    // force_accept: ejecuta la RPC atómica como founder (queda en el audit
    // trail como granted_by_role='founder'). cancel: marca el traspaso
    // cancelado sin mover nada. Desbloquea handoffs en disputa entre clubes.
    if (action === 'transfer_resolve') {
      const { transfer_id, decision } = body;
      if (!transfer_id) return jsonResponse(400, { error: 'transfer_id requerido' });
      if (!['force_accept', 'cancel'].includes(decision)) {
        return jsonResponse(400, { error: 'decision debe ser force_accept o cancel' });
      }

      const { data: transfer, error: tErr } = await db
        .from('club_transfers').select('id, status').eq('id', transfer_id).maybeSingle();
      if (tErr) return jsonResponse(500, { error: tErr.message });
      if (!transfer) return jsonResponse(404, { error: 'Traspaso no encontrado' });
      if (transfer.status !== 'pending') return jsonResponse(409, { error: 'El traspaso ya no está pendiente' });

      if (decision === 'cancel') {
        const { error } = await db.from('club_transfers')
          .update({ status: 'cancelled', resolved_at: new Date().toISOString(), resolved_by_email: 'founder-override' })
          .eq('id', transfer_id);
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { ok: true, status: 'cancelled' });
      }

      // force_accept → RPC atómica con rol founder.
      const { data, error } = await db.rpc('cantera_execute_transfer', {
        p_transfer_id: transfer_id,
        p_actor_email: 'founder-override',
        p_actor_role: 'founder',
      });
      if (error) {
        console.error('admin-orgs transfer_resolve: RPC error:', error.message);
        return jsonResponse(500, { error: 'No se pudo ejecutar el traspaso' });
      }
      const result = Array.isArray(data) ? data[0] : data;
      return jsonResponse(200, { ok: true, status: 'accepted', new_membership_id: result?.new_membership_id || null });
    }

    // ── CANTERA · consola de incidencias del founder ──
    // 4 familias: traspasos+membresías, tutores, consentimiento+visibilidad,
    // PII+borrado LOPD. Auth founder (password+TOTP) ya validada arriba.
    if (action && action.startsWith('cantera_')) {
      const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

      // Familia 1+2+3 (read): vista completa de un jugador.
      if (action === 'cantera_player_overview') {
        if (!body.card_slug) return jsonResponse(400, { error: 'card_slug requerido' });
        const overview = await cantera.playerOverview(db, body.card_slug);
        if (!overview) return jsonResponse(404, { error: 'Jugador no encontrado' });
        return jsonResponse(200, { ok: true, ...overview });
      }

      // Familia 1: editar membresía abierta.
      if (action === 'cantera_edit_membership') {
        if (!body.membership_id) return jsonResponse(400, { error: 'membership_id requerido' });
        const { error } = await cantera.editMembership(db, body.membership_id, {
          dorsal: body.dorsal, position: body.position, team_name: body.team_name, category_id: body.category_id,
        });
        if (error) return jsonResponse(400, { error: error.message });
        auditIncident(db, ip, 'cantera_edit_membership', body.card_slug, body.membership_id);
        return jsonResponse(200, { ok: true });
      }

      // Familia 1: cerrar membresía activa (baja).
      if (action === 'cantera_close_membership') {
        if (!body.card_slug) return jsonResponse(400, { error: 'card_slug requerido' });
        const { error } = await cantera.closeMembership(db, body.card_slug, body.exit_reason || 'baja');
        if (error) {
          if (error.message === 'no_active_membership') return jsonResponse(409, { error: 'Sin membresía activa' });
          return jsonResponse(400, { error: error.message });
        }
        auditIncident(db, ip, 'cantera_close_membership', body.card_slug, body.exit_reason);
        return jsonResponse(200, { ok: true });
      }

      // Familia 1: reasignar de club (transfer atómico founder).
      if (action === 'cantera_reassign_club') {
        if (!body.card_slug || !body.to_org_id || !body.season) {
          return jsonResponse(400, { error: 'card_slug, to_org_id y season requeridos' });
        }
        const { error } = await cantera.reassignClub(db, {
          cardSlug: body.card_slug, toOrgId: body.to_org_id, season: body.season,
          dorsal: body.dorsal ?? null, position: body.position ?? null, teamName: body.team_name ?? null,
        });
        if (error) return jsonResponse(400, { error: error.message });
        auditIncident(db, ip, 'cantera_reassign_club', body.card_slug, body.to_org_id);
        return jsonResponse(200, { ok: true });
      }

      // Familia 2: revocar admin (tutor).
      if (action === 'cantera_revoke_admin') {
        if (!body.admin_id) return jsonResponse(400, { error: 'admin_id requerido' });
        const { error } = await cantera.revokeAdmin(db, body.admin_id);
        if (error) return jsonResponse(500, { error: error.message });
        auditIncident(db, ip, 'cantera_revoke_admin', body.card_slug, body.admin_id);
        return jsonResponse(200, { ok: true });
      }

      // Familia 2: añadir admin (tutor).
      if (action === 'cantera_add_admin') {
        const { data, error } = await cantera.addAdmin(db, { cardSlug: body.card_slug, email: body.email, role: body.role });
        if (error) return jsonResponse(400, { error: error.message });
        auditIncident(db, ip, 'cantera_add_admin', body.card_slug, `${body.role}:${body.email}`);
        return jsonResponse(200, { ok: true, admin_id: data?.id || null });
      }

      // Familia 3: forzar/revocar visibilidad pública.
      if (action === 'cantera_set_visibility') {
        if (!body.card_slug) return jsonResponse(400, { error: 'card_slug requerido' });
        const { error } = await cantera.setVisibility(db, body.card_slug, body.public_card === true);
        if (error) return jsonResponse(500, { error: error.message });
        auditIncident(db, ip, 'cantera_set_visibility', body.card_slug, body.public_card === true);
        return jsonResponse(200, { ok: true, public_card: body.public_card === true });
      }

      // Familia 4: descifrar fecha de nacimiento (soporte, auditado).
      if (action === 'cantera_reveal_birthdate') {
        if (!body.card_slug) return jsonResponse(400, { error: 'card_slug requerido' });
        const { data, error } = await cantera.revealBirthDate(db, body.card_slug);
        if (error) return jsonResponse(404, { error: error.message });
        auditIncident(db, ip, 'cantera_reveal_birthdate', body.card_slug, 'PII access');
        return jsonResponse(200, { ok: true, ...data });
      }

      // Familia 4: borrado LOPD (soft por defecto, hard opcional).
      if (action === 'cantera_delete_player') {
        if (!body.card_slug) return jsonResponse(400, { error: 'card_slug requerido' });
        const { error, mode } = await cantera.deletePlayer(db, body.card_slug, { hard: body.hard === true });
        if (error) return jsonResponse(500, { error: error.message });
        auditIncident(db, ip, 'cantera_delete_player', body.card_slug, mode);
        return jsonResponse(200, { ok: true, mode });
      }
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildInviteEmail = buildInviteEmail;
exports.buildOffboardEmail = buildOffboardEmail;
exports.buildRestoreEmail = buildRestoreEmail;
exports.buildPanelInviteEmail = buildPanelInviteEmail;
exports.PANEL_INVITE_STRINGS = PANEL_INVITE_STRINGS;
