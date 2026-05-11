'use strict';

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const defaultEmailClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
