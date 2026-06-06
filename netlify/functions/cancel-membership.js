'use strict';

// POST /api/cancel-membership { card_slug, exit_reason? }   ·   Cantera 3b
//
// Cierra la membresía activa de un miembro del club (jugador o cuerpo
// técnico) y lo saca de la plantilla del club. Casos: el jugador se va a un
// club off-platform (exit_reason='fichaje'), causa baja (baja_voluntaria,
// fin_temporada, etc) o un staff deja el club.
//
//   - Jugador (role='jugador'): cierre atómico vía RPC
//     `cantera_close_membership` (snapshot inmutable + cancela traspasos
//     pendientes + deja la card sin club activo). La regla federativa de
//     unicidad vive ahí.
//   - Cuerpo técnico (role != 'jugador'): la RPC es player-only, así que el
//     cierre se hace app-side (UPDATE de la fila + card.organization_id=NULL).
//     No hay traspasos de staff ni unicidad federativa que proteger, así que
//     no necesita la transacción de la RPC; el cierre de la membresía (que es
//     lo que saca al staff de getRoster) es un único UPDATE.
//
// Auth: SOLO JWT org-panel del club (el club, o el founder impersonando al
// club, ambos llegan con purpose='org-panel'). El club solo puede cerrar a
// SU propio miembro. El tutor NO puede dar de baja: la baja la tramita el
// club ante la federación, así que el padre no la inicia desde su panel
// (sí conserva sus derechos LOPD —exportar/borrar datos del menor— por la
// vía del edit-token, que es independiente de la membresía).
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { teardownPlayerBilling } = require('./lib/cantera-billing-teardown');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

const EXIT_REASONS = ['fichaje', 'baja', 'fin_temporada', 'expulsion', 'baja_voluntaria', 'cese_actividad'];

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db, stripe = defaultStripe) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'cancel-membership', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const orgSession = authFromEvent(event);
    if (!orgSession) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

    const exitReason = body.exit_reason || 'baja_voluntaria';
    if (!EXIT_REASONS.includes(exitReason)) return jsonResponse(400, { error: 'exit_reason inválido' });

    // Membresía activa del miembro EN ESTE club (jugador o staff). Filtrar
    // por organization_id acota la búsqueda a la plantilla del club; el check
    // explícito de abajo es la salvaguarda real (no nos fiamos solo del filtro).
    const { data: active, error: msErr } = await db
      .from('member_club_seasons')
      .select('id, role, organization_id, dorsal, position, category_id, team_name, stats_jsonb, season')
      .eq('card_slug', cardSlug).eq('organization_id', orgSession.orgId).is('left_at', null)
      .maybeSingle();
    if (msErr) return jsonResponse(500, { error: msErr.message });
    if (!active) return jsonResponse(409, { error: 'El miembro no tiene membresía activa en tu club' });

    // El club solo puede cerrar a su propio miembro.
    if (active.organization_id !== orgSession.orgId) return unauthorizedResponse();
    const actorEmail = `org:${orgSession.orgSlug}`;

    // Jugador → cierre atómico vía RPC (federativo). Staff → cierre app-side.
    if (active.role === 'jugador') {
      const { error } = await db.rpc('cantera_close_membership', {
        p_card_slug: cardSlug,
        p_exit_reason: exitReason,
        p_actor_email: actorEmail,
      });
      if (error) {
        if (error.message === 'no_active_membership') return jsonResponse(409, { error: 'El jugador no tiene membresía activa' });
        console.error('cancel-membership: RPC error:', error.message);
        return jsonResponse(500, { error: 'No se pudo cerrar la membresía' });
      }

      // Baja del club → desconectar el cobro de ESTE club: cancela los plazos
      // futuros del plan + la cuota mensual Stripe. Best-effort: si falla, la
      // baja ya está hecha. Solo en la baja (no en cambio de equipo/traspaso).
      let billing = null;
      try {
        const { data: org } = await db.from('organizations')
          .select('stripe_connect_account_id').eq('id', orgSession.orgId).maybeSingle();
        billing = await teardownPlayerBilling(db, stripe, {
          cardSlug, orgId: orgSession.orgId,
          connectAccountId: org && org.stripe_connect_account_id,
        });
      } catch (e) {
        console.error('cancel-membership: billing teardown error:', e.message);
      }
      return jsonResponse(200, { ok: true, role: active.role, billing });
    }

    // Cuerpo técnico: cerramos la fila con su snapshot (mismo shape que la RPC)
    // y dejamos la card sin club activo. Cerrar la membresía es lo que saca al
    // staff de la plantilla (getRoster filtra por left_at IS NULL).
    const closedSnapshot = {
      dorsal: active.dorsal, position: active.position,
      category_id: active.category_id, team_name: active.team_name,
      stats: active.stats_jsonb, organization_id: active.organization_id,
      season: active.season,
    };
    const { error: closeErr } = await db
      .from('member_club_seasons')
      .update({ left_at: new Date().toISOString(), exit_reason: exitReason, closed_snapshot_jsonb: closedSnapshot })
      .eq('id', active.id);
    if (closeErr) {
      console.error('cancel-membership: staff close error:', closeErr.message);
      return jsonResponse(500, { error: 'No se pudo cerrar la membresía' });
    }
    // Best-effort: el roster ya no lo muestra aunque este UPDATE falle.
    await db.from('cards').update({ organization_id: null }).eq('slug', cardSlug);

    return jsonResponse(200, { ok: true, role: active.role });
  };
}

exports.handler = makeHandler(defaultDb, defaultStripe);
exports.makeHandler = makeHandler;
exports.EXIT_REASONS = EXIT_REASONS;
