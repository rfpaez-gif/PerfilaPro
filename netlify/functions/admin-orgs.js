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
        .select('id, slug, name, tagline, logo_url, color_primary, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, orgs: data || [] });
    }

    // ── create: alta de una nueva organización ──
    if (action === 'create') {
      const { slug, name, tagline, logo_url, color_primary, nif, email } = body;

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
        })
        .select('id, slug, name, tagline, logo_url, color_primary')
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
      const { slug, name, tagline, logo_url, color_primary } = body;

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

    // ── leads_resend: reenviar el magic-link al lead ──
    // Idempotente: NO regeneramos el invite_token. Si el lead ya está
    // redeemed_at, devolvemos 409 sin enviar (el link no vale para nada).
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
        .select('id, name, company, email, idioma, invite_token, redeemed_at')
        .eq('id', lead_id)
        .maybeSingle();
      if (error) return jsonResponse(500, { error: error.message });
      if (!lead) return jsonResponse(404, { error: 'lead no encontrado' });
      if (lead.redeemed_at) {
        return jsonResponse(409, { error: 'Este lead ya redimió su enlace' });
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const { subject, html } = buildLeadEmail({
        name: lead.name,
        company: lead.company,
        inviteToken: lead.invite_token,
        idioma: lead.idioma,
        siteUrl,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: lead.email,
          subject: '[Reenvío] ' + subject,
          html,
        });
      } catch (err) {
        console.error('admin-orgs leads_resend: error enviando email:', err.message);
        return jsonResponse(500, { error: 'No se pudo reenviar el email' });
      }

      return jsonResponse(200, { ok: true });
    }

    // ── invite_agent: crea una card B2B vacía + magic-link para el agente ──
    // El admin invita a un email; el backend pre-crea la card con plan='b2b'
    // ya asignada a la org y manda un email con un edit_token de 7 días.
    // El agente abre el link y completa su perfil desde /es/editar.
    if (action === 'invite_agent') {
      const { org_slug, email: rawEmail, nombre: rawNombre } = body;

      if (!isValidOrgSlug(org_slug)) {
        return jsonResponse(400, { error: 'org_slug inválido' });
      }
      const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email)) {
        return jsonResponse(400, { error: 'email inválido' });
      }
      if (rawNombre != null && typeof rawNombre !== 'string') {
        return jsonResponse(400, { error: 'nombre debe ser string' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      // Resolvemos la org primero para tener nombre/logo/color para el email
      // y el id para la FK. Una org soft-deleted no debe poder recibir invitados.
      const { data: org, error: orgErr } = await db
        .from('organizations')
        .select('id, slug, name, logo_url, color_primary')
        .eq('slug', org_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (orgErr) return jsonResponse(500, { error: orgErr.message });
      if (!org)   return jsonResponse(404, { error: 'organization no encontrada' });

      // Slug: si el admin pasa nombre, derivamos; si no, "agente-{timestamp36}-{rnd}".
      // El nombre visible en la card (que el agente verá y editará en /editar)
      // sigue el mismo principio: nombre limpio si lo hay, placeholder si no.
      const cleanNombre = rawNombre ? stripTagsInline(rawNombre).substring(0, 100) : '';
      const displayName = cleanNombre || 'Nuevo profesional';
      let slug = cleanNombre ? toSlug(cleanNombre) : '';
      if (!slug) {
        slug = `agente-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
      }

      // Slug uniqueness — incluye soft-deleted para no colisionar con la PK.
      // Mismo patrón que register-b2b.
      const { data: existing } = await db
        .from('cards')
        .select('slug')
        .eq('slug', slug)
        .maybeSingle();
      if (existing) {
        slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}`;
      }

      const editToken = crypto.randomBytes(32).toString('hex');
      const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const row = {
        slug,
        nombre:                displayName,
        email,
        plan:                  'b2b',
        status:                'active',
        organization_id:       org.id,
        edit_token:            editToken,
        edit_token_expires_at: editTokenExpiresAt,
        whatsapp:              '',
        servicios:             [],
        idioma:                'es',
      };

      const { error: insErr } = await db.from('cards').insert(row);
      if (insErr) {
        console.error('admin-orgs invite_agent: error insertando card:', insErr.message);
        return jsonResponse(500, { error: 'No se pudo crear la card: ' + insErr.message });
      }

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const editUrl = `${siteUrl}/es/editar?slug=${slug}&token=${editToken}`;
      const { subject, html } = buildInviteEmail({
        orgName:    org.name,
        orgLogoUrl: org.logo_url,
        orgColor:   org.color_primary,
        nombre:     cleanNombre,
        editUrl,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: email,
          subject,
          html,
        });
      } catch (err) {
        // Card creada pero email falló: devolvemos 500 con info útil para que
        // el admin sepa que tiene que reenviar (o eliminar la card huérfana).
        console.error('admin-orgs invite_agent: error enviando email:', err.message);
        return jsonResponse(500, { error: 'Card creada pero el email falló. Slug: ' + slug });
      }

      return jsonResponse(200, {
        ok: true,
        slug,
        edit_url: editUrl,
        org: { slug: org.slug, name: org.name },
      });
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
        .select('id, slug, name, logo_url, color_primary')
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

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const ok = [];
      const failed = [];

      for (const raw of team) {
        const rawEmail  = raw && typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const rawNombre = raw && typeof raw.nombre === 'string' ? raw.nombre : '';

        if (!EMAIL_RE.test(rawEmail)) {
          failed.push({ email: rawEmail || '(sin email)', error: 'email inválido' });
          continue;
        }

        const cleanNombre = rawNombre ? stripTagsInline(rawNombre).substring(0, 100) : '';
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
        if (tplTagline)     row.tagline     = tplTagline;
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

        try {
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: rawEmail,
            subject,
            html,
          });
          ok.push({ email: rawEmail, slug });
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
