'use strict';

// POST /api/parent-data { action }   ·   carril Cantera (capa 6c)
//
// Endpoint de lectura del panel del padre/tutor. Auth = JWT parent-panel
// (lib/panel-auth.parentAuthFromEvent), scoped al EMAIL del tutor: devuelve
// TODAS las cards donde ese email aparece como card_admins activo (un tutor
// con varios hijos las ve todas).
//
// Acción única `get_children`: por cada card devuelve datos básicos, club
// actual, membresía activa (dorsal/categoría/equipo/stats), histórico de
// clubes (member_club_seasons cerradas), estado de cuota del mes, el rol
// del propio tutor sobre la card, y cualquier traspaso pendiente que
// requiera su aprobación.
//
// NO expone PII sensible del menor (birth_date_encrypted nunca sale; el
// segundo factor LOPD lo verifican accept-transfer / parent-consent con la
// fecha que escribe el tutor, no con lo que devuelve este endpoint).
//
// Gateado por isCanteraActive() (410 si el carril está off). Rate-limit
// 60 req / 10 min por IP (holgado para cargar el panel varias veces).

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { parentAuthFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { listSportsCategories, currentSeasonStartYear, formatSeason } = require('./lib/sports-categories');
const { listPaymentsByCard } = require('./lib/external-payments');
const { readPlan } = require('./lib/enrollment-campaign');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Roles del tutor que entran por este panel. club_admin NO (ése gestiona
// desde el Studio B2B, no aquí) — espejo de parent-auth.PARENT_ROLES.
const PARENT_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self'];
const PAYING_SUB_STATUSES = ['active', 'trialing'];

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(payload),
  };
}

function formatPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Estado de cuota de un mes: cuota Stripe activa o pago manual del periodo.
function paymentStatus(subs, manualPayments, period) {
  const activeSub = (subs || []).find((s) => PAYING_SUB_STATUSES.includes(s.status));
  if (activeSub) {
    return {
      source: 'stripe',
      status: 'active',
      amount_cents: activeSub.amount_cents ?? null,
      current_period_end: activeSub.current_period_end ?? null,
    };
  }
  const manual = (manualPayments || []).find((p) => p.period === period);
  if (manual) {
    return { source: 'manual', status: 'paid', method: manual.method, amount_cents: manual.amount_cents ?? null, period: manual.period };
  }
  const anySub = (subs || [])[0];
  if (anySub) return { source: 'stripe', status: anySub.status || 'inactive', amount_cents: anySub.amount_cents ?? null };
  return { status: 'unpaid' };
}

function makeHandler(db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'parent-data', limit: 60, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = parentAuthFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const action = body.action || 'get_children';
    if (action !== 'get_children') return jsonResponse(400, { error: `Acción desconocida: ${action}` });

    // 1. Cards donde el email del JWT es admin activo (con su rol).
    const { data: adminRows, error: aErr } = await db
      .from('card_admins')
      .select('card_slug, role')
      .eq('email', session.email)
      .is('revoked_at', null);
    if (aErr) return jsonResponse(500, { error: aErr.message });

    const roleBySlug = new Map();
    for (const r of adminRows || []) {
      if (!PARENT_ROLES.includes(r.role)) continue; // club_admin no entra aquí
      // tutor_legal manda sobre tutor_secundario/player_self si hay varios.
      const prev = roleBySlug.get(r.card_slug);
      if (!prev || r.role === 'tutor_legal') roleBySlug.set(r.card_slug, r.role);
    }
    const slugs = [...roleBySlug.keys()];
    if (!slugs.length) {
      return jsonResponse(200, { ok: true, email: session.email, children: [] });
    }

    // 2. Cards (sin PII cifrada). Filtramos soft-deleted.
    const { data: cards, error: cErr } = await db
      .from('cards')
      .select('slug, nombre, foto_url, card_kind, idioma, organization_id, public_card, birth_year, gender, status, deleted_at')
      .in('slug', slugs);
    if (cErr) return jsonResponse(500, { error: cErr.message });
    const liveCards = (cards || []).filter((c) => !c.deleted_at);

    // 3. Membresías de esas cards (activas + histórico).
    const { data: seasons } = await db
      .from('member_club_seasons')
      .select('card_slug, organization_id, season, role, category_id, team_name, dorsal, position, joined_at, left_at, exit_reason, stats_jsonb, closed_snapshot_jsonb, previous_club_name')
      .in('card_slug', slugs)
      .order('joined_at', { ascending: false });
    const seasonsBySlug = new Map();
    for (const s of seasons || []) {
      if (!seasonsBySlug.has(s.card_slug)) seasonsBySlug.set(s.card_slug, []);
      seasonsBySlug.get(s.card_slug).push(s);
    }

    // 4. Clubes implicados → nombre + branding para mostrar.
    const orgIds = [...new Set([
      ...liveCards.map((c) => c.organization_id).filter(Boolean),
      ...(seasons || []).map((s) => s.organization_id).filter(Boolean),
    ])];
    const orgById = new Map();
    let catalogBySport = new Map();
    if (orgIds.length) {
      const { data: orgs } = await db
        .from('organizations')
        .select('id, slug, name, logo_url, color_primary, sport, kind, cantera_monthly_fee_cents, stripe_connect_charges_enabled, payment_iban, payment_bizum, payment_instructions, deleted_at')
        .in('id', orgIds);
      for (const o of orgs || []) orgById.set(o.id, o);
      // Catálogo de categorías por deporte (para nombrar category_id).
      const sports = [...new Set((orgs || []).map((o) => o.sport).filter(Boolean))];
      for (const sp of sports) {
        const cat = await listSportsCategories(db, sp);
        catalogBySport.set(sp, new Map(cat.map((c) => [c.id, c])));
      }
    }

    // 5. Cuotas Stripe + pagos manuales por card.
    const { data: subs } = await db
      .from('parent_subscriptions')
      .select('card_slug, status, amount_cents, current_period_end')
      .in('card_slug', slugs);
    const subsBySlug = new Map();
    for (const s of subs || []) {
      if (!subsBySlug.has(s.card_slug)) subsBySlug.set(s.card_slug, []);
      subsBySlug.get(s.card_slug).push(s);
    }

    // 6. Traspasos pendientes que requieren aprobación del tutor.
    const { data: transfers } = await db
      .from('club_transfers')
      .select('id, card_slug, from_org_id, to_org_id, status, season, dorsal, position, team_name, created_at')
      .in('card_slug', slugs)
      .eq('status', 'pending');
    const pendingBySlug = new Map();
    for (const t of transfers || []) pendingBySlug.set(t.card_slug, t);

    // 6b. Plan de pagos a medida (enrollment_charges) + campaña abierta con
    //     plan. Define qué modelo de cobro tiene cada hijo: si hay cargos
    //     materializados o el club tiene una campaña con conceptos, es plan
    //     (no cuota mensual). Try/catch defensivo: la migración 039 puede no
    //     estar aplicada en algún entorno.
    const chargesBySlug = new Map();
    try {
      const { data: charges } = await db
        .from('enrollment_charges')
        .select('card_slug, concepto, amount_cents, due_date, status, paid_at')
        .in('card_slug', slugs)
        .order('due_date', { ascending: true });
      for (const ch of charges || []) {
        if (ch.status === 'canceled') continue;
        if (!chargesBySlug.has(ch.card_slug)) chargesBySlug.set(ch.card_slug, []);
        chargesBySlug.get(ch.card_slug).push(ch);
      }
    } catch { /* tabla puede no existir */ }

    const planByOrg = new Map();
    if (orgIds.length) {
      try {
        const { data: camps } = await db
          .from('enrollment_campaigns')
          .select('id, organization_id, status, concepts_jsonb')
          .in('organization_id', orgIds)
          .eq('status', 'open');
        for (const camp of camps || []) {
          const plan = readPlan(camp.concepts_jsonb);
          if (plan.length) planByOrg.set(camp.organization_id, { id: camp.id, plan });
        }
      } catch { /* tabla puede no existir */ }
    }

    // Compone el bloque de plan de un hijo (o null si va por cuota mensual).
    const planBlockFor = (cardSlug, clubLive) => {
      const charges = chargesBySlug.get(cardSlug) || [];
      if (charges.length) {
        const total = charges.reduce((s, c) => s + (c.amount_cents || 0), 0);
        const paid = charges.filter((c) => c.status === 'paid').reduce((s, c) => s + (c.amount_cents || 0), 0);
        return {
          has_charges: true,
          payable: false, // mandato ya guardado; el cron cobra los plazos futuros
          campaign_id: null,
          concepts: charges.map((c) => ({ concepto: c.concepto, amount_cents: c.amount_cents, due_date: c.due_date, status: c.status })),
          total_cents: total,
          paid_cents: paid,
        };
      }
      const camp = clubLive ? planByOrg.get(clubLive.id) : null;
      if (camp) {
        const total = camp.plan.reduce((s, c) => s + (Number(c.amount_cents) || 0), 0);
        return {
          has_charges: false,
          payable: true, // aún sin pagar: el tutor puede iniciar el checkout
          campaign_id: camp.id,
          concepts: camp.plan.map((c) => ({ concepto: c.concepto, amount_cents: Number(c.amount_cents) || 0, due_date: c.due_date, status: 'scheduled' })),
          total_cents: total,
          paid_cents: 0,
        };
      }
      return null;
    };

    const period = formatPeriod();
    const orgName = (id) => { const o = orgById.get(id); return o && !o.deleted_at ? o.name : null; };
    const categoryName = (org, categoryId) => {
      if (!org || !categoryId) return null;
      const cat = catalogBySport.get(org.sport);
      const meta = cat && cat.get(categoryId);
      return meta ? meta.display_name_es : null;
    };

    // 7. Componemos cada hijo/a.
    const children = [];
    for (const card of liveCards) {
      const mss = seasonsBySlug.get(card.slug) || [];
      const active = mss.find((m) => !m.left_at && m.role === 'jugador') || mss.find((m) => !m.left_at) || null;
      const history = mss.filter((m) => m.left_at).map((m) => {
        const org = orgById.get(m.organization_id);
        return {
          season: m.season,
          club_name: orgName(m.organization_id) || m.previous_club_name || null,
          role: m.role,
          category: categoryName(org, m.category_id),
          team_name: m.team_name || null,
          dorsal: m.dorsal ?? null,
          exit_reason: m.exit_reason || null,
          left_at: m.left_at,
        };
      });

      const club = card.organization_id ? orgById.get(card.organization_id) : null;
      const clubLive = club && !club.deleted_at ? club : null;

      // Pagos manuales de esta card para el periodo actual.
      let manualPayments = [];
      try {
        const { payments } = await listPaymentsByCard(db, card.slug);
        manualPayments = payments || [];
      } catch { /* tabla puede no existir si la migración no se aplicó */ }

      const pending = pendingBySlug.get(card.slug);
      const pendingTransfer = pending ? {
        transfer_id: pending.id,
        to_club_name: orgName(pending.to_org_id),
        from_club_name: orgName(pending.from_org_id) || (active ? null : null),
        season: pending.season,
        dorsal: pending.dorsal ?? null,
        position: pending.position || null,
        team_name: pending.team_name || null,
        created_at: pending.created_at,
      } : null;

      children.push({
        slug: card.slug,
        nombre: card.nombre || null,
        foto_url: card.foto_url || null,
        card_kind: card.card_kind || 'player',
        idioma: card.idioma || 'es',
        public_card: card.public_card ?? false,
        birth_year: card.birth_year ?? null,
        gender: card.gender || null,
        my_role: roleBySlug.get(card.slug) || null,
        club: clubLive ? {
          id: clubLive.id,
          slug: clubLive.slug,
          name: clubLive.name,
          logo_url: clubLive.logo_url || null,
          color_primary: clubLive.color_primary || null,
          sport: clubLive.sport || null,
          monthly_fee_cents: clubLive.cantera_monthly_fee_cents ?? null,
          // Pago online solo si el club tiene Stripe Connect listo. Si no,
          // el padre paga por transferencia/Bizum con estos datos.
          pay_online: !!clubLive.stripe_connect_charges_enabled,
          pay_instructions: {
            iban: clubLive.payment_iban || null,
            bizum: clubLive.payment_bizum || null,
            text: clubLive.payment_instructions || null,
          },
        } : null,
        membership: active ? {
          season: active.season,
          role: active.role,
          category: categoryName(clubLive, active.category_id),
          team_name: active.team_name || null,
          dorsal: active.dorsal ?? null,
          position: active.position || null,
          stats: active.stats_jsonb || {},
          joined_at: active.joined_at,
          previous_club_name: active.previous_club_name || null,
        } : null,
        payment: paymentStatus(subsBySlug.get(card.slug), manualPayments, period),
        plan: planBlockFor(card.slug, clubLive),
        history,
        pending_transfer: pendingTransfer,
      });
    }

    return jsonResponse(200, {
      ok: true,
      email: session.email,
      season: formatSeason(currentSeasonStartYear()),
      period,
      children,
    });
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
exports.PARENT_ROLES = PARENT_ROLES;
