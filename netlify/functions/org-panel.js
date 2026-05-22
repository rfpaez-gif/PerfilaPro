'use strict';

// POST /api/org-panel { action, ... }
// Header: Authorization: Bearer <jwt>
//
// Panel cliente B2B self-serve. El JWT (emitido por panel-auth.js) trae
// `orgId` + `orgSlug`. Toda query queda forzosamente scoped a esa org —
// NO existe `org_slug` en el body: el cliente sólo puede operar sobre
// su propia organización.
//
// MVP mínimo (Bloque 2 #1): branding + invite + stats.
//   - get_org        — datos de la org + lista de miembros + stats agregadas.
//   - update_branding — tagline, description, website, address, phone, color_primary.
//                       Excluye name, slug, email (cambian la URL pública o la
//                       puerta de entrada del propio panel — solo founder).
//   - invite_team    — alta en lote de miembros. Reusa lib/team-invite.js.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const {
  isValidHex,
  isValidTagline,
  isValidDescription,
  isSafeWebsite,
} = require('./lib/org-utils');
const { computeOrgStats } = require('./lib/org-stats-utils');
const { inviteTeamMembers } = require('./lib/team-invite');
const { buildInviteEmail, buildOffboardEmail } = require('./admin-orgs');
const { offboardCard, COURTESY_DAYS } = require('./lib/card-offboard');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const defaultDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // No cacheamos respuestas autenticadas. El JWT no debería viajar a
      // ningún CDN intermedio pero blindamos por si acaso.
      'Cache-Control': 'private, no-store',
    },
    body: JSON.stringify(payload),
  };
}

function stripTagsInline(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Rate limit por IP+sesión. 120 req / 10 min cubre operaciones normales
    // (cargar panel + editar branding + invitar lote) con holgura.
    const rl = checkRateLimit(event, {
      bucket: 'org-panel',
      limit: 120,
      windowMs: 10 * 60 * 1000,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    const { action } = body;

    // Resolvemos la org una vez por request — todas las acciones la necesitan.
    // El SELECT está pinchado a session.orgId (UUID del JWT). Aunque el
    // cliente manipulara cualquier campo del body, NUNCA puede operar
    // sobre otra org porque no podemos falsificar el JWT.
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug, name, tagline, description, website, email, address, phone, logo_url, color_primary, hide_branding, created_at, deleted_at, panel_last_login_at')
      .eq('id', session.orgId)
      .maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) {
      // Org soft-deleted o ya no existe — la sesión queda inservible.
      return unauthorizedResponse();
    }

    // ── get_org: snapshot completo del panel ──
    if (action === 'get_org') {
      // Best-effort: persistimos cuándo entró por última vez (no bloquea).
      // Sirve para que el founder vea desde admin-orgs si el cliente usa el panel.
      db.from('organizations')
        .update({ panel_last_login_at: new Date().toISOString() })
        .eq('id', org.id)
        .then(({ error }) => {
          if (error) console.warn('org-panel get_org: panel_last_login_at no marcado:', error.message);
        })
        .catch(err => console.warn('org-panel get_org: panel_last_login_at no marcado:', err.message));

      // Miembros activos para la lista del panel. No incluimos email/phone
      // del miembro — el cliente solo necesita ver quién está y qué tráfico
      // tiene. Sus datos de contacto pertenecen al propio miembro.
      const { data: cards, error: cardsErr } = await db
        .from('cards')
        .select('slug, nombre, tagline, foto_url, plan, status, created_at')
        .eq('organization_id', org.id)
        .is('deleted_at', null)
        .order('nombre', { ascending: true });
      if (cardsErr) return jsonResponse(500, { error: cardsErr.message });

      const stats = await computeOrgStats(db, org.id);

      // Componemos la lista de miembros con stats por slug. computeOrgStats
      // ya devuelve by_member, pero solo de cards activas y sin algunos
      // campos (plan, created_at). Hacemos merge.
      const statsBySlug = {};
      for (const m of stats.by_member) statsBySlug[m.slug] = m;
      const members = (cards || []).map(c => ({
        slug: c.slug,
        nombre: c.nombre,
        tagline: c.tagline,
        foto_url: c.foto_url,
        plan: c.plan,
        status: c.status,
        created_at: c.created_at,
        visits_7d:  statsBySlug[c.slug]?.visits_7d  || 0,
        visits_30d: statsBySlug[c.slug]?.visits_30d || 0,
        visits_all: statsBySlug[c.slug]?.visits_all || 0,
      }));

      return jsonResponse(200, {
        ok: true,
        org: {
          slug: org.slug,
          name: org.name,
          tagline: org.tagline,
          description: org.description,
          website: org.website,
          email: org.email,
          address: org.address,
          phone: org.phone,
          logo_url: org.logo_url,
          color_primary: org.color_primary,
          created_at: org.created_at,
        },
        members,
        stats: {
          totals: stats.totals,
          by_day: stats.by_day,
        },
      });
    }

    // ── update_branding: editar campos branding del propio cliente ──
    // Subset deliberadamente reducido vs admin-orgs.update:
    //   - NO permitimos cambiar `name` (alteraría el render público de manera
    //     drástica y un cliente puede romper SEO sin querer; founder-only).
    //   - NO permitimos cambiar `slug` (rompería URLs ya compartidas).
    //   - NO permitimos cambiar `email` (es la puerta del panel; cambiarlo
    //     y perderlo deja al cliente bloqueado fuera de su propia cuenta).
    //   - NO permitimos cambiar `logo_url` directamente (upload-org-logo.js
    //     requiere auth admin; se añade en sprint siguiente con su propio
    //     endpoint scoped al panel).
    //
    // Sí editables: tagline, description, website, address, phone,
    // color_primary. Validación idéntica a admin-orgs.update.
    if (action === 'update_branding') {
      const { tagline, description, website, address, phone, color_primary } = body;

      if (tagline !== undefined && tagline !== null && !isValidTagline(tagline)) {
        return jsonResponse(400, { error: 'tagline máx. 140 chars' });
      }
      if (description !== undefined && description !== null && !isValidDescription(description)) {
        return jsonResponse(400, { error: 'description máx. 500 chars' });
      }
      if (website && !isSafeWebsite(website)) {
        return jsonResponse(400, { error: 'website inválido (http:// o https://, máx 200 chars)' });
      }
      if (color_primary && !isValidHex(color_primary)) {
        return jsonResponse(400, { error: 'color_primary debe ser #RRGGBB' });
      }

      const updates = {};
      if (tagline !== undefined)       updates.tagline       = tagline ? String(tagline).trim() : null;
      if (description !== undefined)   updates.description   = description ? stripTagsInline(description).substring(0, 500) : null;
      if (website !== undefined)       updates.website       = website ? String(website).trim() : null;
      if (color_primary !== undefined) updates.color_primary = color_primary || null;
      if (address !== undefined)       updates.address       = address ? stripTagsInline(address).substring(0, 200) : null;
      if (phone !== undefined)         updates.phone         = phone   ? stripTagsInline(phone).substring(0, 40)    : null;

      if (!Object.keys(updates).length) {
        return jsonResponse(400, { error: 'nada para actualizar' });
      }

      const { error: updErr } = await db
        .from('organizations')
        .update(updates)
        .eq('id', org.id);
      if (updErr) return jsonResponse(500, { error: updErr.message });

      return jsonResponse(200, { ok: true });
    }

    // ── invite_team: alta en lote (reusa lib/team-invite) ──
    if (action === 'invite_team') {
      const { team, template } = body;

      if (!Array.isArray(team) || team.length === 0) {
        return jsonResponse(400, { error: 'team debe ser un array no vacío' });
      }
      if (team.length > 100) {
        return jsonResponse(400, { error: 'máximo 100 invitaciones por lote' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

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

    // ── offboard_member: el cliente saca a un miembro de su equipo ──
    // SCOPED al org del JWT: antes del UPDATE comprobamos que la card
    // pertenece a esta org (organization_id === session.orgId). Aunque
    // el cliente manipulara el body con un slug de otra org, fall.
    //
    // Semántica del offboard (compartida con admin-orgs.offboard_card):
    // la card NO se borra ni se oculta. Sale del equipo, queda como
    // autónomo individual 90d gratis. URL pública sigue activa para
    // que sus contactos no la pierdan. Trail (previous_organization_id
    // + offboarded_at + offboarded_by='client') permite restore desde
    // admin-orgs si el cliente lo pidió por error.
    if (action === 'offboard_member') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      // Verificamos pertenencia ANTES de invocar el helper, sin esto un
      // JWT del panel cliente podría offboardear cards de otras orgs.
      const { data: card, error: cardErr } = await db
        .from('cards')
        .select('slug, organization_id')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (cardErr) return jsonResponse(500, { error: cardErr.message });
      if (!card)   return jsonResponse(404, { error: 'card no encontrada' });
      if (card.organization_id !== org.id) {
        return jsonResponse(403, { error: 'esta card no pertenece a tu organización' });
      }

      const result = await offboardCard(db, { cardSlug: card_slug, actor: 'client' });
      if (!result.ok) return jsonResponse(result.status, { error: result.error });
      const { card: full, orgName, editToken, expiresAt } = result;

      // Email al trabajador (best-effort, mismo patrón que admin-orgs).
      if (full.email) {
        const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
        const idioma = full.idioma === 'ca' ? 'ca' : 'es';
        const cardUrl = `${siteUrl}/c/${full.slug}`;
        const editUrl = `${siteUrl}/${idioma}/editar?slug=${full.slug}&token=${editToken}`;
        const { subject, html } = buildOffboardEmail({
          orgName,
          nombre: full.nombre,
          idioma,
          cardUrl,
          editUrl,
        });
        try {
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: full.email,
            subject,
            html,
          });
        } catch (err) {
          console.error(`org-panel offboard_member: email a ${full.email} falló:`, err.message);
        }
      }

      return jsonResponse(200, {
        ok: true,
        card_slug,
        expires_at: expiresAt,
        courtesy_days: COURTESY_DAYS,
      });
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
