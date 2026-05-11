'use strict';

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');
const {
  isValidHex,
  isSafeLogoUrl,
  isValidOrgSlug,
  isValidTagline,
} = require('./lib/org-utils');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function makeHandler(db) {
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

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
