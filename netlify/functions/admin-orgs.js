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
} = require('./lib/org-utils');
const { buildLeadEmail } = require('./lead-b2b');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { buildEditLinkEmail, EDIT_LINK_STRINGS } = require('./send-edit-link');
const {
  buildBusinessCardPDF,
  buildBusinessCardsBookletPDF,
  fetchLogoAsPngBuffer,
} = require('./printable-card-utils');

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

function stripTagsInline(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toSlug(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
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
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, orgs: data || [] });
    }

    // ── create: alta de una nueva organización ──
    if (action === 'create') {
      const { slug, name, tagline, logo_url, color_primary, nif, email, address, phone } = body;

      if (!isValidOrgSlug(slug)) {
        return jsonResponse(400, { error: 'slug inválido (2-40 chars, [a-z0-9-], sin guiones en los extremos)' });
      }
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return jsonResponse(400, { error: 'name requerido (mín. 2 chars)' });
      }
      if (tagline != null && !isValidTagline(tagline)) {
        return jsonResponse(400, { error: 'tagline máx. 140 chars' });
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
          logo_url: logo_url || null,
          color_primary: color_primary || null,
          nif: nif ? String(nif).trim() : null,
          email: email ? String(email).trim() : null,
          address: address ? stripTagsInline(address).substring(0, 200) : null,
          phone:   phone   ? stripTagsInline(phone).substring(0, 40)    : null,
        })
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone')
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
      const { slug, name, tagline, logo_url, color_primary, address, phone } = body;

      if (!isValidOrgSlug(slug)) {
        return jsonResponse(400, { error: 'slug inválido' });
      }
      if (tagline != null && !isValidTagline(tagline)) {
        return jsonResponse(400, { error: 'tagline máx. 140 chars' });
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
      if (logo_url !== undefined)      updates.logo_url      = logo_url || null;
      if (color_primary !== undefined) updates.color_primary = color_primary || null;
      // address / phone son tolerantes: el admin los puede vaciar mandando ''
      // o null. Sanitización idéntica que en `create`. Sin CHECK constraint
      // a nivel DB (ver migración 023): los validamos aquí en backend.
      if (address !== undefined) updates.address = address ? stripTagsInline(address).substring(0, 200) : null;
      if (phone   !== undefined) updates.phone   = phone   ? stripTagsInline(phone).substring(0, 40)    : null;

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

    // ── offboard_card: "Quitar del equipo" con cortesía 90 días ──
    // Diferente de assign_card(null) que solo desvincula seco. Esta acción
    // hace la salida humana del trabajador: organization_id=NULL + plan='base'
    // + expires_at=NOW+90d + reset reminders + email "tienes 90 días de
    // cortesía". El cron remind-expiry ya envía avisos a 30/15/7 días antes
    // del fin del periodo. Si la card tenía un expires_at posterior (caso
    // edge: ya pagó algo previo), preservamos el más generoso.
    if (action === 'offboard_card') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const { data: card, error: selErr } = await db
        .from('cards')
        .select('slug, nombre, email, idioma, organization_id, expires_at, edit_token, edit_token_expires_at')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (selErr) return jsonResponse(500, { error: selErr.message });
      if (!card)  return jsonResponse(404, { error: 'card no encontrada' });
      if (!card.organization_id) {
        return jsonResponse(400, { error: 'la card no está asignada a ninguna organización' });
      }

      // Resolvemos el nombre de la org antes del UPDATE para meterlo en el email.
      const { data: org } = await db
        .from('organizations')
        .select('name')
        .eq('id', card.organization_id)
        .maybeSingle();
      const orgName = org?.name || 'la empresa';

      const courtesyEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const existingExpires = card.expires_at ? new Date(card.expires_at) : null;
      const expiresAt = existingExpires && existingExpires > courtesyEnd
        ? existingExpires.toISOString()
        : courtesyEnd.toISOString();

      // Garantizamos edit_token vigente para que el trabajador pueda editar.
      let editToken = card.edit_token;
      const tokenExpired = !card.edit_token_expires_at || new Date(card.edit_token_expires_at) < new Date();
      const tokenUpdate = {};
      if (!editToken || tokenExpired) {
        editToken = crypto.randomBytes(32).toString('hex');
        tokenUpdate.edit_token = editToken;
        tokenUpdate.edit_token_expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const { error: updErr } = await db
        .from('cards')
        .update({
          organization_id: null,
          plan: 'base',
          expires_at: expiresAt,
          reminder_30_sent: false,
          reminder_15_sent: false,
          reminder_7_sent: false,
          ...tokenUpdate,
        })
        .eq('slug', card_slug);
      if (updErr) return jsonResponse(500, { error: updErr.message });

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
        courtesy_days: 90,
      });
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
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email')
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
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email')
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
        .select('id, invite_token, name, company, email, team_size, sector, message, idioma, organization_id, created_at, redeemed_at, redeemed_card_slug')
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
        .select('id, slug, name, tagline, logo_url, color_primary, address, phone, email')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      // Sanitizamos la plantilla común. Cada campo es opcional — si el
      // founder no rellena tagline, ningún operario lo lleva. Igual para
      // servicios (array) y resto.
      const tpl = template || {};
      const tplTagline     = tpl.tagline ? stripTagsInline(tpl.tagline).substring(0, 140) : null;
      const tplDescripcion = tpl.descripcion ? stripTagsInline(tpl.descripcion).substring(0, 300) : null;
      const tplCp          = tpl.cp ? String(tpl.cp).trim().replace(/\D/g, '').substring(0, 5) : null;
      const tplZona        = tpl.zona ? stripTagsInline(tpl.zona).substring(0, 100) : null;
      const tplServicios   = Array.isArray(tpl.servicios)
        ? tpl.servicios.map(s => stripTagsInline(s).substring(0, 100)).filter(Boolean).slice(0, 20)
        : [];

      // Logo de la org cacheado para adjuntar la tarjeta de visita a cada
      // email del lote. Una sola petición HTTP para los N miembros. Si el
      // fetch falla el booklet sale sin logo, el nombre de la org queda
      // de cabecera y la invitación se manda igual (defensivo).
      const orgLogoBuffer = org.logo_url
        ? await fetchLogoAsPngBuffer(org.logo_url).catch(() => null)
        : null;

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const ok = [];
      const failed = [];

      for (const raw of team) {
        const rawEmail     = raw && typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const rawNombre    = raw && typeof raw.nombre === 'string' ? raw.nombre : '';
        const rawOcupacion = raw && typeof raw.ocupacion === 'string' ? raw.ocupacion : '';

        if (!EMAIL_RE.test(rawEmail)) {
          failed.push({ email: rawEmail || '(sin email)', error: 'email inválido' });
          continue;
        }

        const cleanNombre    = rawNombre    ? stripTagsInline(rawNombre).substring(0, 100)    : '';
        const cleanOcupacion = rawOcupacion ? stripTagsInline(rawOcupacion).substring(0, 140) : '';
        const displayName = cleanNombre || 'Nuevo profesional';
        let slug = cleanNombre ? toSlug(cleanNombre) : '';
        if (!slug) {
          slug = `agente-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
        }

        const { data: existing } = await db
          .from('cards')
          .select('slug')
          .eq('slug', slug)
          .maybeSingle();
        if (existing) {
          slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}-${crypto.randomBytes(1).toString('hex')}`;
        }

        const editToken = crypto.randomBytes(32).toString('hex');
        const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const row = {
          slug,
          nombre:                displayName,
          email:                 rawEmail,
          plan:                  'b2b',
          status:                'active',
          organization_id:       org.id,
          edit_token:            editToken,
          edit_token_expires_at: editTokenExpiresAt,
          whatsapp:              '',
          idioma:                'es',
        };
        // Solo añadimos los campos de la plantilla que el founder rellenó.
        // Sin sobrescribir con null campos que la BD pueda tener con default.
        // El cargo individual (cleanOcupacion) prevalece sobre tplTagline para
        // que cada miembro aparezca en /e/:slug con su rol específico
        // (Entrenadora, Recepcionista, Fisio…) en lugar de un tagline común.
        const memberTagline = cleanOcupacion || tplTagline;
        if (memberTagline)  row.tagline     = memberTagline;
        if (tplDescripcion) row.descripcion = tplDescripcion;
        if (tplCp)          row.cp          = tplCp;
        if (tplZona)        row.zona        = tplZona;
        if (tplServicios.length) row.servicios = tplServicios;

        const { error: insErr } = await db.from('cards').insert(row);
        if (insErr) {
          failed.push({ email: rawEmail, error: insErr.message });
          continue;
        }

        const editUrl = `${siteUrl}/es/editar?slug=${slug}&token=${editToken}`;
        const { subject, html } = buildInviteEmail({
          orgName:    org.name,
          orgLogoUrl: org.logo_url,
          orgColor:   org.color_primary,
          nombre:     cleanNombre,
          editUrl,
        });

        // Generamos tarjeta de visita 85×55mm con branding de la org y la
        // adjuntamos al email. El logo se cachea fuera del loop. Si el render
        // falla por cualquier motivo seguimos enviando la invitación sin
        // adjunto (defensivo: la invitación es lo crítico, la tarjeta es bonus).
        let bizCardAttachment = null;
        try {
          const cardForPdf = {
            slug,
            nombre:    displayName,
            tagline:   memberTagline || null,
            whatsapp:  null,    // el miembro aún no tiene número — campo vacío
            email:     rawEmail,
            direccion: null,    // el miembro aún no editó; cae a org.address
          };
          const pdfBuffer = await buildBusinessCardPDF({
            card: cardForPdf,
            org,
            logoBuffer: orgLogoBuffer,
            siteUrl,
          });
          bizCardAttachment = {
            filename: `tarjeta-${slug}.pdf`,
            content: pdfBuffer,
          };
        } catch (err) {
          console.warn(`invite_team: render de tarjeta de visita para ${slug} falló (no fatal):`, err.message);
        }

        try {
          const sendPayload = {
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: rawEmail,
            subject,
            html,
          };
          if (bizCardAttachment) sendPayload.attachments = [bizCardAttachment];
          await emailClient.emails.send(sendPayload);
          ok.push({ email: rawEmail, slug });
          // Marcamos `edit_link_sent_at` — el email de invitación ES un
          // enlace de edición, no el welcome kit completo. Antes este
          // bloque marcaba `kit_email_sent_at`, pero eso colisionaba
          // semánticamente con el hook B2B post-completación de
          // edit-card.js (que gatea por `kit_email_sent_at IS NULL`
          // para enviar el welcome kit con la tarjeta YA con datos
          // reales). El chip "Invitado hace Xd" del Studio combina
          // ambos campos via pickLastEmailTimestamp, así que sigue
          // funcionando. Best-effort: si falla el UPDATE, la invitación
          // ya está enviada y la consideramos OK.
          try {
            const { error: stampErr } = await db
              .from('cards')
              .update({ edit_link_sent_at: new Date().toISOString() })
              .eq('slug', slug);
            if (stampErr) console.warn(`invite_team: no marqué edit_link_sent_at para ${slug}:`, stampErr.message);
          } catch (stampErr) {
            console.warn(`invite_team: no marqué edit_link_sent_at para ${slug}:`, stampErr.message);
          }
        } catch (err) {
          // Card creada pero email falló — lo apuntamos como fail.
          // El admin puede reenviar desde "Asignar profesionales" si quiere
          // (la card existe, solo le falta llegar el magic-link).
          console.error(`admin-orgs invite_team: email a ${rawEmail} falló:`, err.message);
          failed.push({ email: rawEmail, slug, error: 'card creada pero email falló' });
        }
      }

      return jsonResponse(200, {
        ok: true,
        org: { slug: org.slug, name: org.name },
        results: { ok, failed },
        summary: `${ok.length} de ${team.length} invitaciones enviadas${failed.length ? `, ${failed.length} con error` : ''}`,
      });
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildInviteEmail = buildInviteEmail;
exports.buildOffboardEmail = buildOffboardEmail;
