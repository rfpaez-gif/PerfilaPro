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

const crypto = require('crypto');
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
const {
  buildBusinessCardPDF,
  buildBusinessCardsBookletPDF,
  fetchLogoAsPngBuffer,
} = require('./printable-card-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
// CANTERA · lecturas del Studio deportivo (capa 6a). Estos imports sólo
// se usan dentro de las acciones sports_* gateadas por isCanteraActive(),
// que a su vez sólo se encienden cuando las migraciones 033-036 ya están
// aplicadas — así el carril B2B genérico no toca ninguna columna nueva.
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { listSportsCategories, currentSeasonStartYear, formatSeason } = require('./lib/sports-categories');
const { listPaymentsByClub } = require('./lib/external-payments');
const {
  makeCampaignToken,
  enrollmentUrl,
  normalizeCents,
  normalizeInstallments,
} = require('./lib/enrollment-campaign');
const { buildAssignmentPatch, findDuplicateDorsals } = require('./lib/enrollment-assign');
const { reconcilePlayerBilling, seasonInstallmentPeriods } = require('./lib/season-billing');
const { validateInviteList, buildEnrollInviteEmail } = require('./lib/enrollment-invite');

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

      // CANTERA: el discriminador kind/sport (migración 033) sólo existe en
      // BD cuando el carril está encendido. Lo leemos en una query aparte
      // gateada por el flag para no romper el SELECT compartido en entornos
      // B2B donde la 033 aún no se ha aplicado. El frontend usa org.kind
      // para ramificar al Studio deportivo.
      let kind = null;
      let sport = null;
      if (isCanteraActive()) {
        const { data: k } = await db
          .from('organizations')
          .select('kind, sport')
          .eq('id', org.id)
          .maybeSingle();
        if (k) { kind = k.kind || null; sport = k.sport || null; }
      }

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
          kind,
          sport,
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

    // ── resend_edit_link: reenvía el magic-link de edición a un miembro ──
    // Para cuando el miembro pierde su email original. Reusa edit_token vigente
    // si lo hay; si está caducado o falta, lo regenera (32 bytes hex, 7d).
    // Espejo de admin-orgs.send_edit_link con guard cross-tenant: la card
    // tiene que pertenecer al org del JWT (organization_id === session.orgId).
    // El email va branded con el logo + color de la org (siempre desde el
    // panel — todas las cards de aquí son B2B por definición).
    if (action === 'resend_edit_link') {
      const { card_slug } = body;
      if (typeof card_slug !== 'string' || !card_slug) {
        return jsonResponse(400, { error: 'card_slug requerido' });
      }
      if (!emailClient) {
        return jsonResponse(500, { error: 'Resend no configurado' });
      }

      const { data: card, error: cardErr } = await db
        .from('cards')
        .select('slug, nombre, email, idioma, organization_id, edit_token, edit_token_expires_at')
        .eq('slug', card_slug)
        .is('deleted_at', null)
        .maybeSingle();
      if (cardErr) return jsonResponse(500, { error: cardErr.message });
      if (!card)   return jsonResponse(404, { error: 'card no encontrada' });
      if (card.organization_id !== org.id) {
        return jsonResponse(403, { error: 'esta card no pertenece a tu organización' });
      }
      if (!card.email) {
        return jsonResponse(400, { error: 'la card no tiene email registrado' });
      }

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

      // Branded siempre — el cliente solo opera sobre cards de su propia org.
      const invite = buildInviteEmail({
        orgName:    org.name,
        orgLogoUrl: org.logo_url || null,
        orgColor:   org.color_primary || null,
        nombre:     card.nombre,
        editUrl,
      });
      const prefix = idioma === 'ca' ? '[Reenviament]' : '[Reenvío]';

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: card.email,
          subject: `${prefix} ${invite.subject}`,
          html: invite.html,
        });
      } catch (err) {
        console.error(`org-panel resend_edit_link: email a ${card.email} falló:`, err.message);
        return jsonResponse(500, { error: 'No se pudo enviar el email' });
      }

      const { error: updErr } = await db
        .from('cards')
        .update({ edit_link_sent_at: new Date().toISOString(), ...tokenUpdate })
        .eq('slug', card_slug);
      if (updErr) {
        console.warn('org-panel resend_edit_link: no se pudo marcar edit_link_sent_at:', updErr.message);
      }

      return jsonResponse(200, {
        ok: true,
        card_slug,
        email: card.email,
        sent_at: new Date().toISOString(),
      });
    }

    // ── download_member_card: PDF 85×55mm de UN miembro del equipo ──
    // Mismo render que adjunta el welcome kit B2B (buildBusinessCardPDF
    // con logo + color de la org). Guard cross-tenant: solo cards del
    // org del JWT. base64 dentro de JSON para no romper el dispatcher.
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
      if (card.organization_id !== org.id) {
        return jsonResponse(403, { error: 'esta card no pertenece a tu organización' });
      }

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
        console.error('org-panel download_member_card: render falló:', err.message);
        return jsonResponse(500, { error: 'No se pudo generar el PDF' });
      }
    }

    // ── download_team_cards: PDF booklet con UNA tarjeta 85×55mm por miembro ──
    // Para que el cliente pueda imprimir tarjetas para todo su equipo antes
    // de un evento sin pedirle al founder que se lo prepare. El org slug es
    // el del JWT — el body NO lo lleva (a propósito: prevenir que un cliente
    // pueda intentar descargar booklets de otra org pasando org_slug en body).
    if (action === 'download_team_cards') {
      const { data: cards, error: cardsErr } = await db
        .from('cards')
        .select('slug, nombre, tagline, whatsapp, email, direccion')
        .eq('organization_id', org.id)
        .is('deleted_at', null)
        .eq('status', 'active')
        .order('nombre', { ascending: true });
      if (cardsErr) return jsonResponse(500, { error: cardsErr.message });
      if (!cards || !cards.length) {
        return jsonResponse(400, { error: 'tu equipo no tiene profesionales activos todavía' });
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
        console.error('org-panel download_team_cards: render del booklet falló:', err.message);
        return jsonResponse(500, { error: 'No se pudo generar el PDF' });
      }
    }

    // ── CANTERA · lecturas del Studio deportivo (capa 6a) ──
    // get_roster (plantilla por categoría + cuota/estado de pago),
    // get_club_stats (KPIs agregados), get_transfers (bandeja de fichajes).
    // Gateadas por el flag del carril y restringidas a kind='sports_club'.
    // El org se re-resuelve con SELECT * (incluye kind/sport/connect/fee de
    // las migraciones 033-036) sin tocar el SELECT compartido de arriba.
    if (SPORTS_READ_ACTIONS.has(action)) {
      if (!isCanteraActive()) return canteraDisabledResponse();
      const loaded = await loadSportsOrg(db, org.id);
      if (loaded.error) return loaded.error;
      const sportsOrg = loaded.org;
      if (action === 'get_roster')     return await getRoster(db, sportsOrg);
      if (action === 'get_club_stats') return await getClubStats(db, sportsOrg);
      if (action === 'get_transfers')  return await getTransfers(db, sportsOrg);
    }

    // ── CANTERA · campaña de inscripción de temporada (capa I3) ──
    // enrollment_open / enrollment_close / enrollment_get. El club abre
    // una campaña y reparte el enlace público /inscripcion/:token + QR.
    // Mismo gate (flag + sports_club) que las lecturas del Studio.
    if (ENROLLMENT_ACTIONS.has(action)) {
      if (!isCanteraActive()) return canteraDisabledResponse();
      const loaded = await loadSportsOrg(db, org.id);
      if (loaded.error) return loaded.error;
      const sportsOrg = loaded.org;
      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      if (action === 'enrollment_get')    return await enrollmentGet(db, sportsOrg, siteUrl);
      if (action === 'enrollment_open')   return await enrollmentOpen(db, sportsOrg, body, siteUrl);
      if (action === 'enrollment_close')  return await enrollmentClose(db, sportsOrg, body);
      if (action === 'enrollment_assign') return await enrollmentAssign(db, sportsOrg, body);
      if (action === 'billing_matrix')    return await billingMatrix(db, sportsOrg, body);
      if (action === 'enrollment_invite') return await enrollmentInvite(db, emailClient, sportsOrg, body, siteUrl);
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

// ============================================================
// CANTERA · helpers de lectura del Studio deportivo (capa 6a)
// ============================================================

const SPORTS_READ_ACTIONS = new Set(['get_roster', 'get_club_stats', 'get_transfers']);
const ENROLLMENT_ACTIONS = new Set(['enrollment_get', 'enrollment_open', 'enrollment_close', 'enrollment_assign', 'billing_matrix', 'enrollment_invite']);
const PAYING_SUB_STATUSES = ['active', 'trialing'];
const DEFAULT_INSTALLMENTS = 9;

// Da forma a una fila enrollment_campaigns para el frontend, con el
// enlace público + cuántas inscripciones lleva.
function shapeCampaign(campaign, siteUrl, submitted = null) {
  if (!campaign) return null;
  return {
    id: campaign.id,
    season: campaign.season,
    status: campaign.status,
    public_token: campaign.public_token,
    url: enrollmentUrl(siteUrl, campaign.public_token),
    matricula_cents: campaign.matricula_cents ?? null,
    monthly_fee_cents: campaign.monthly_fee_cents ?? null,
    num_installments: campaign.num_installments ?? DEFAULT_INSTALLMENTS,
    opens_at: campaign.opens_at || null,
    closes_at: campaign.closes_at || null,
    created_at: campaign.created_at || null,
    submitted_count: submitted,
  };
}

// enrollment_get: la campaña abierta del club (si la hay) + nº de fichas
// creadas durante su vigencia (jugadores del club desde created_at).
async function enrollmentGet(db, org, siteUrl) {
  const { data: campaign, error } = await db
    .from('enrollment_campaigns')
    .select('*')
    .eq('organization_id', org.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return jsonResponse(500, { error: error.message });
  if (!campaign) return jsonResponse(200, { ok: true, campaign: null });

  // Nº de membresías del club abiertas desde que arrancó la campaña — una
  // medida honesta de "inscripciones recibidas" sin tabla extra.
  let submitted = null;
  const { data: rows } = await db
    .from('member_club_seasons')
    .select('id', { count: 'exact' })
    .eq('organization_id', org.id)
    .gte('joined_at', campaign.created_at);
  if (Array.isArray(rows)) submitted = rows.length;

  return jsonResponse(200, { ok: true, campaign: shapeCampaign(campaign, siteUrl, submitted) });
}

// enrollment_open: abre una campaña de temporada. Si ya hay una abierta
// para la misma temporada, devuelve 409 (el índice parcial de la 037 lo
// garantiza en BD; lo comprobamos antes para dar un error legible).
async function enrollmentOpen(db, org, body, siteUrl) {
  const season = (body.season && String(body.season).trim()) || formatSeason(currentSeasonStartYear());

  const mat = normalizeCents(body.matricula_cents, 'matricula_cents');
  if (mat.error) return jsonResponse(400, { error: mat.error });
  const fee = normalizeCents(body.monthly_fee_cents, 'monthly_fee_cents');
  if (fee.error) return jsonResponse(400, { error: fee.error });
  const inst = normalizeInstallments(body.num_installments);
  if (inst.error) return jsonResponse(400, { error: inst.error });

  // Ya hay una abierta para esa temporada → no duplicamos enlaces vivos.
  const { data: existing } = await db
    .from('enrollment_campaigns')
    .select('id')
    .eq('organization_id', org.id)
    .eq('season', season)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();
  if (existing) return jsonResponse(409, { error: `Ya hay una campaña abierta para la temporada ${season}` });

  // Cuota: la de la campaña si viene, si no la del club. Sin ninguna,
  // dejamos null y el checkout caerá a la cuota del club en su momento.
  const monthlyFee = fee.value != null ? fee.value : (org.cantera_monthly_fee_cents ?? null);

  const row = {
    organization_id: org.id,
    season,
    public_token: makeCampaignToken(),
    status: 'open',
    matricula_cents: mat.value,
    monthly_fee_cents: monthlyFee,
    num_installments: inst.value != null ? inst.value : DEFAULT_INSTALLMENTS,
  };

  const { data: created, error } = await db
    .from('enrollment_campaigns')
    .insert(row)
    .select()
    .single();
  if (error) return jsonResponse(500, { error: error.message });

  return jsonResponse(200, { ok: true, campaign: shapeCampaign(created, siteUrl, 0) });
}

// enrollment_close: cierra una campaña (deja de aceptar inscripciones).
// El enlace público devolverá "cerrada" en I4. Scoped al org del JWT.
async function enrollmentClose(db, org, body) {
  const campaignId = (body.campaign_id && String(body.campaign_id).trim()) || null;
  if (!campaignId) return jsonResponse(400, { error: 'campaign_id requerido' });

  // Guard cross-tenant: la campaña debe ser de este club.
  const { data: campaign, error: cErr } = await db
    .from('enrollment_campaigns')
    .select('id, organization_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (cErr) return jsonResponse(500, { error: cErr.message });
  if (!campaign || campaign.organization_id !== org.id) {
    return jsonResponse(404, { error: 'Campaña no encontrada' });
  }

  const { error } = await db
    .from('enrollment_campaigns')
    .update({ status: 'closed', closes_at: new Date().toISOString() })
    .eq('id', campaignId);
  if (error) return jsonResponse(500, { error: error.message });

  return jsonResponse(200, { ok: true, campaign_id: campaignId, status: 'closed' });
}

// enrollment_invite: invitación múltiple a inscribirse (Cantera · Opción A).
// El club pega una lista de { email, nombre? } y cada familia recibe el
// enlace de la campaña ABIERTA para rellenar la ficha ellos mismos. NO crea
// cards (LOPD-limpio: los datos del menor los mete el padre al inscribirse).
// Loop ok/failed por email, ≤200. Reusa lib/enrollment-invite.
async function enrollmentInvite(db, emailClient, org, body, siteUrl) {
  if (!emailClient) return jsonResponse(500, { error: 'Resend no configurado' });

  const { rows, errors } = validateInviteList(body.invites);
  if (rows.length === 0) {
    return jsonResponse(400, { error: 'No hay emails válidos en la lista', failed: errors });
  }
  if (rows.length > 200) {
    return jsonResponse(400, { error: 'máximo 200 invitaciones por lote' });
  }

  // Necesita una campaña ABIERTA: el email lleva su enlace público.
  const { data: campaign, error: cErr } = await db
    .from('enrollment_campaigns')
    .select('public_token, season, status')
    .eq('organization_id', org.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cErr) return jsonResponse(500, { error: cErr.message });
  if (!campaign) {
    return jsonResponse(409, { error: 'Abre las inscripciones antes de invitar a las familias' });
  }

  const enrollUrl = enrollmentUrl(siteUrl, campaign.public_token);
  const ok = [];
  const failed = errors.slice(); // arrastra los inválidos de la validación
  for (const r of rows) {
    try {
      const { subject, html } = buildEnrollInviteEmail({ clubName: org.name, nombre: r.nombre, enrollUrl, idioma: 'es' });
      await emailClient.emails.send({ from: 'PerfilaPro <hola@perfilapro.es>', to: r.email, subject, html });
      ok.push(r.email);
    } catch (err) {
      failed.push({ email: r.email, error: 'email no enviado' });
    }
  }

  return jsonResponse(200, {
    ok: true,
    results: { ok, failed },
    summary: `${ok.length} invitaciones enviadas${failed.length ? `, ${failed.length} con error` : ''}`,
  });
}

// enrollment_assign: encuadre en lote. El club asigna equipo/dorsal/
// posición/categoría a varios jugadores de una vez. Body: { assignments:
// [{ card_slug, dorsal?, team_name?, position?, category_id? }] }. Cada
// UPDATE va scoped al club (organization_id) + membresía activa
// (left_at IS NULL) — un slug ajeno o sin membresía activa en este club
// no afecta a ninguna fila. Loop con ok[]/failed[] por jugador, sin
// transacción global (cada asignación es independiente).
async function enrollmentAssign(db, org, body) {
  const assignments = Array.isArray(body.assignments) ? body.assignments : null;
  if (!assignments || assignments.length === 0) {
    return jsonResponse(400, { error: 'assignments debe ser un array no vacío' });
  }
  if (assignments.length > 200) {
    return jsonResponse(400, { error: 'máximo 200 asignaciones por lote' });
  }

  // Validamos todas las filas primero (puro), luego aplicamos.
  const rows = assignments.map(buildAssignmentPatch);
  const duplicates = findDuplicateDorsals(rows);

  const ok = [];
  const failed = [];
  for (let i = 0; i < rows.length; i++) {
    const { slug, patch, error } = rows[i];
    if (error) { failed.push({ index: i, card_slug: slug, error }); continue; }
    const { data: updated, error: updErr } = await db
      .from('member_club_seasons')
      .update(patch)
      .eq('card_slug', slug)
      .eq('organization_id', org.id)
      .is('left_at', null)
      .select('card_slug');
    if (updErr) { failed.push({ index: i, card_slug: slug, error: updErr.message }); continue; }
    if (!updated || updated.length === 0) {
      failed.push({ index: i, card_slug: slug, error: 'sin membresía activa en este club' });
      continue;
    }
    ok.push(slug);
  }

  return jsonResponse(200, {
    ok: true,
    results: { ok, failed },
    duplicate_dorsals: duplicates,
    summary: `${ok.length} de ${assignments.length} asignados${failed.length ? `, ${failed.length} con error` : ''}`,
  });
}

// billing_matrix: el centro de cobros (pantalla B). Devuelve la matriz
// jugador × periodo (matrícula + N mensualidades) conciliando Stripe
// (parent_subscriptions) + manual (external_payments) vía
// lib/season-billing.reconcilePlayerBilling. Una sola foto de "quién pagó".
async function billingMatrix(db, org, body) {
  // Temporada: la de la campaña abierta si la hay, si no la del body o la
  // vigente. Los importes salen de la campaña; sin campaña, de la cuota del
  // club (la matrícula queda 0 — no se cobró por inscripción).
  let campaign = null;
  const reqSeason = body.season && String(body.season).trim();
  {
    const q = db.from('enrollment_campaigns')
      .select('id, season, status, matricula_cents, monthly_fee_cents, num_installments')
      .eq('organization_id', org.id);
    const { data } = reqSeason
      ? await q.eq('season', reqSeason).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : await q.eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle();
    campaign = data || null;
  }

  const season = (campaign && campaign.season) || reqSeason || formatSeason(currentSeasonStartYear());
  const matriculaCents = campaign ? (campaign.matricula_cents ?? 0) : 0;
  const monthlyFeeCents = (campaign && campaign.monthly_fee_cents) || org.cantera_monthly_fee_cents || 0;
  const numInstallments = (campaign && campaign.num_installments) || 9;
  const campaignForCalc = { season, matricula_cents: matriculaCents, monthly_fee_cents: monthlyFeeCents, num_installments: numInstallments };

  // Jugadores activos del club (membresías abiertas, rol jugador).
  const { data: seasons } = await db
    .from('member_club_seasons')
    .select('card_slug, role, dorsal, team_name, category_id')
    .eq('organization_id', org.id)
    .is('left_at', null);
  const playerSeasons = (seasons || []).filter((m) => m.role === 'jugador');
  const slugs = [...new Set(playerSeasons.map((m) => m.card_slug))];

  const cardBySlug = new Map();
  if (slugs.length) {
    const { data: cards } = await db.from('cards').select('slug, nombre').in('slug', slugs);
    for (const c of cards || []) cardBySlug.set(c.slug, c);
  }

  // Suscripciones Stripe del club (una activa preferida por jugador).
  const { data: subs } = await db
    .from('parent_subscriptions')
    .select('card_slug, status, current_period_end, started_at, matricula_cents, matricula_paid_at')
    .eq('organization_id', org.id);
  const subBySlug = new Map();
  for (const s of subs || []) {
    const prev = subBySlug.get(s.card_slug);
    const paying = s.status === 'active' || s.status === 'trialing';
    if (!prev || (paying && !(prev.status === 'active' || prev.status === 'trialing'))) subBySlug.set(s.card_slug, s);
  }

  // Pagos manuales del club, agrupados por jugador.
  const { payments } = await listPaymentsByClub(db, org.id);
  const manualBySlug = new Map();
  for (const p of payments || []) {
    if (!manualBySlug.has(p.card_slug)) manualBySlug.set(p.card_slug, []);
    manualBySlug.get(p.card_slug).push(p);
  }

  const rows = playerSeasons.map((m) => {
    const recon = reconcilePlayerBilling({
      campaign: campaignForCalc,
      subscription: subBySlug.get(m.card_slug) || null,
      externalPayments: manualBySlug.get(m.card_slug) || [],
    });
    return {
      slug: m.card_slug,
      nombre: (cardBySlug.get(m.card_slug) || {}).nombre || null,
      team_name: m.team_name || null,
      category_id: m.category_id || null,
      matricula: recon.matricula,
      periods: recon.periods,
      paid_count: recon.paid_count,
      pending_count: recon.pending_count,
    };
  }).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  return jsonResponse(200, {
    ok: true,
    season,
    periods: seasonInstallmentPeriods(season, { count: numInstallments }),
    amounts: { matricula_cents: matriculaCents, monthly_fee_cents: monthlyFeeCents, num_installments: numInstallments },
    has_matricula: matriculaCents > 0,
    players: rows,
  });
}

function formatPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function sanitizeSportsOrg(org) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    kind: org.kind || null,
    sport: org.sport || null,
    logo_url: org.logo_url || null,
    color_primary: org.color_primary || null,
    monthly_fee_cents: org.cantera_monthly_fee_cents ?? null,
    stripe_connect_charges_enabled: !!org.stripe_connect_charges_enabled,
    stripe_connect_payouts_enabled: !!org.stripe_connect_payouts_enabled,
  };
}

// Re-resuelve la org con todas las columnas Cantera y verifica que es un
// club deportivo. Devuelve { org } o { error: <respuesta> } para early-return.
async function loadSportsOrg(db, orgId) {
  const { data: org, error } = await db
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !org) return { error: jsonResponse(404, { error: 'org no encontrada' }) };
  if (org.kind !== 'sports_club') {
    return { error: jsonResponse(400, { error: 'esta organización no es un club deportivo' }) };
  }
  return { org };
}

// Índice de pago por card para un periodo: cuota Stripe (parent_subscriptions)
// + pago manual Bizum/efectivo (external_payments) registrado para ese mes.
async function buildPaymentIndex(db, orgId, period) {
  const { data: subs } = await db
    .from('parent_subscriptions')
    .select('card_slug, status, amount_cents, current_period_end')
    .eq('organization_id', orgId);
  const subBySlug = new Map();
  for (const s of subs || []) {
    const prev = subBySlug.get(s.card_slug);
    const paying = PAYING_SUB_STATUSES.includes(s.status);
    // Preferimos una cuota activa sobre una cancelada/incompleta.
    if (!prev || (paying && !PAYING_SUB_STATUSES.includes(prev.status))) {
      subBySlug.set(s.card_slug, s);
    }
  }

  const { payments } = await listPaymentsByClub(db, orgId);
  const manualBySlug = new Map();
  for (const p of payments || []) {
    if (p.period !== period) continue; // sólo pagos fechados cuentan para el mes
    if (!manualBySlug.has(p.card_slug)) manualBySlug.set(p.card_slug, p);
  }

  return { subBySlug, manualBySlug };
}

function paymentFor(slug, idx) {
  const sub = idx.subBySlug.get(slug);
  if (sub && PAYING_SUB_STATUSES.includes(sub.status)) {
    return {
      source: 'stripe',
      status: 'active',
      amount_cents: sub.amount_cents ?? null,
      current_period_end: sub.current_period_end ?? null,
    };
  }
  const manual = idx.manualBySlug.get(slug);
  if (manual) {
    return {
      source: 'manual',
      status: 'paid',
      method: manual.method,
      amount_cents: manual.amount_cents ?? null,
      period: manual.period,
    };
  }
  if (sub) {
    return { source: 'stripe', status: sub.status || 'inactive', amount_cents: sub.amount_cents ?? null };
  }
  return { status: 'unpaid' };
}

function isPaid(payment) {
  return payment.status === 'active' || payment.status === 'paid';
}

// get_roster: plantilla activa agrupada por categoría con dorsal + cuota.
async function getRoster(db, org) {
  const { data: seasons } = await db
    .from('member_club_seasons')
    .select('card_slug, role, dorsal, position, category_id, team_name, season, previous_club_name')
    .eq('organization_id', org.id)
    .is('left_at', null);
  const memberships = seasons || [];
  const slugs = [...new Set(memberships.map((m) => m.card_slug))];

  const cardBySlug = new Map();
  if (slugs.length) {
    const { data: cards } = await db
      .from('cards')
      .select('slug, nombre, foto_url, public_card, birth_year, card_kind')
      .in('slug', slugs);
    for (const c of cards || []) cardBySlug.set(c.slug, c);
  }

  const period = formatPeriod();
  const idx = await buildPaymentIndex(db, org.id, period);

  // El catálogo da nombre legible y orden a cada category_id.
  const catalog = org.sport ? await listSportsCategories(db, org.sport) : [];
  const catById = new Map();
  catalog.forEach((c, i) => catById.set(c.id, {
    code: c.code,
    display_name: c.display_name_es,
    display_name_ca: c.display_name_ca || null,
    order: c.sort_order ?? i,
  }));

  const players = [];
  const staff = [];
  for (const m of memberships) {
    const card = cardBySlug.get(m.card_slug) || {};
    const entry = {
      slug: m.card_slug,
      nombre: card.nombre || null,
      foto_url: card.foto_url || null,
      public_card: card.public_card ?? null,
      birth_year: card.birth_year ?? null,
      role: m.role,
      dorsal: m.dorsal ?? null,
      position: m.position || null,
      team_name: m.team_name || null,
      category_id: m.category_id || null,
      season: m.season || null,
      previous_club_name: m.previous_club_name || null,
      payment: paymentFor(m.card_slug, idx),
    };
    if (m.role === 'jugador') players.push(entry); else staff.push(entry);
  }

  const groups = new Map();
  for (const p of players) {
    const key = p.category_id || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const categories = [...groups.entries()].map(([id, members]) => {
    const meta = catById.get(id);
    return {
      category_id: id === '__none__' ? null : id,
      code: meta ? meta.code : null,
      display_name: meta ? meta.display_name : (id === '__none__' ? 'Sin categoría' : id),
      display_name_ca: meta ? meta.display_name_ca : null,
      order: meta ? meta.order : 9999,
      members: members.sort((a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999)),
    };
  }).sort((a, b) => a.order - b.order);

  const paying = players.filter((p) => isPaid(p.payment)).length;

  return jsonResponse(200, {
    ok: true,
    org: sanitizeSportsOrg(org),
    season: formatSeason(currentSeasonStartYear()),
    categories,
    staff: staff.sort((a, b) => (a.role || '').localeCompare(b.role || '')),
    totals: {
      players: players.length,
      staff: staff.length,
      paying,
      unpaid: players.length - paying,
    },
  });
}

// get_club_stats: KPIs agregados (miembros, visitas, cobros, fichajes).
async function getClubStats(db, org) {
  const { data: seasons } = await db
    .from('member_club_seasons')
    .select('card_slug, role')
    .eq('organization_id', org.id)
    .is('left_at', null);
  const memberships = seasons || [];
  const playerSlugs = [...new Set(memberships.filter((m) => m.role === 'jugador').map((m) => m.card_slug))];
  const staffCount = memberships.filter((m) => m.role !== 'jugador').length;

  // Visitas agregadas del club. computeOrgStats ya agrega sobre las cards
  // con organization_id = club (D2: cards.organization_id = club actual).
  let stats = { totals: { visits_7d: 0, visits_30d: 0, visits_all: 0 }, by_day: [] };
  try {
    stats = await computeOrgStats(db, org.id);
  } catch (err) {
    console.warn('org-panel get_club_stats: computeOrgStats falló:', err.message);
  }

  const period = formatPeriod();
  const idx = await buildPaymentIndex(db, org.id, period);
  let stripeActive = 0;
  let manualThisPeriod = 0;
  let mrrCents = 0;
  let paying = 0;
  for (const slug of playerSlugs) {
    const pay = paymentFor(slug, idx);
    if (pay.status === 'active') {
      stripeActive += 1;
      paying += 1;
      mrrCents += pay.amount_cents || org.cantera_monthly_fee_cents || 0;
    } else if (pay.status === 'paid') {
      manualThisPeriod += 1;
      paying += 1;
    }
  }
  const coverage = playerSlugs.length ? Math.round((paying / playerSlugs.length) * 100) : 0;

  const { data: tin } = await db
    .from('club_transfers').select('id').eq('to_org_id', org.id).eq('status', 'pending');
  const { data: tout } = await db
    .from('club_transfers').select('id').eq('from_org_id', org.id).eq('status', 'pending');

  return jsonResponse(200, {
    ok: true,
    org: sanitizeSportsOrg(org),
    season: formatSeason(currentSeasonStartYear()),
    members: { players: playerSlugs.length, staff: staffCount, total: playerSlugs.length + staffCount },
    visits: {
      total: (stats.totals && stats.totals.visits_all) || 0,
      last7: (stats.totals && stats.totals.visits_7d) || 0,
      last30: (stats.totals && stats.totals.visits_30d) || 0,
      by_day: stats.by_day || [],
    },
    payments: {
      paying,
      unpaid: playerSlugs.length - paying,
      coverage_pct: coverage,
      stripe_active: stripeActive,
      manual_this_period: manualThisPeriod,
      mrr_cents: mrrCents,
      period,
    },
    transfers: { pending_in: (tin || []).length, pending_out: (tout || []).length },
    connect: {
      account_id: org.stripe_connect_account_id || null,
      charges_enabled: !!org.stripe_connect_charges_enabled,
      payouts_enabled: !!org.stripe_connect_payouts_enabled,
    },
  });
}

// get_transfers: bandeja de fichajes entrantes + salientes del club.
async function getTransfers(db, org) {
  const { data: inc } = await db
    .from('club_transfers')
    .select('*')
    .eq('to_org_id', org.id)
    .order('created_at', { ascending: false });
  const { data: out } = await db
    .from('club_transfers')
    .select('*')
    .eq('from_org_id', org.id)
    .order('created_at', { ascending: false });
  const incoming = inc || [];
  const outgoing = out || [];

  const slugs = [...new Set([...incoming, ...outgoing].map((t) => t.card_slug))];
  const cardBySlug = new Map();
  if (slugs.length) {
    const { data: cards } = await db.from('cards').select('slug, nombre').in('slug', slugs);
    for (const c of cards || []) cardBySlug.set(c.slug, c);
  }

  const shape = (t, direction) => ({
    id: t.id,
    direction,
    card_slug: t.card_slug,
    nombre: (cardBySlug.get(t.card_slug) || {}).nombre || null,
    from_org_id: t.from_org_id || null,
    to_org_id: t.to_org_id || null,
    status: t.status,
    season: t.season || null,
    dorsal: t.dorsal ?? null,
    position: t.position || null,
    team_name: t.team_name || null,
    requested_by_email: t.requested_by_email || null,
    note: t.note || null,
    created_at: t.created_at || null,
    resolved_at: t.resolved_at || null,
    resolved_by_email: t.resolved_by_email || null,
  });

  return jsonResponse(200, {
    ok: true,
    incoming: incoming.map((t) => shape(t, 'incoming')),
    outgoing: outgoing.map((t) => shape(t, 'outgoing')),
    pending: {
      incoming: incoming.filter((t) => t.status === 'pending').length,
      outgoing: outgoing.filter((t) => t.status === 'pending').length,
    },
  });
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
