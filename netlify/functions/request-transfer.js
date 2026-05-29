'use strict';

// POST /api/request-transfer   ·   Cantera capa 3b (handoff, camino 2)
//
// El club que quiere fichar (to_org) solicita el traspaso de un jugador
// que YA tiene una card en PerfilaPro con membresía activa en OTRO club.
// Crea una fila `club_transfers` en estado 'pending' y avisa al tutor
// legal (que es quien aprueba el handoff con accept-transfer).
//
// No mueve nada todavía: la ejecución atómica ocurre cuando el tutor
// acepta. Aquí solo se registra la intención.
//
// Auth: JWT org-panel del club que ficha (to_org = session.orgId).
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse, signParentSession } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { isPlayer } = require('./lib/card-kind');
const { parseSeasonStartYear, currentSeasonStartYear, formatSeason } = require('./lib/sports-categories');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function stripTags(str) { return String(str || '').replace(/<[^>]*>/g, '').trim(); }
function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

const REQ_STRINGS = {
  es: {
    preheader: 'Un club quiere fichar a tu hijo/a · necesita tu aprobación',
    title: (club) => `${club} quiere fichar a tu hijo/a`,
    intro: (to, from) => `El club <strong>${to}</strong> ha solicitado el traspaso de tu hijo/a desde <strong>${from || 'su club actual'}</strong>. El cambio NO se hará efectivo hasta que tú lo apruebes desde tu panel.`,
    cta: 'Revisar y aprobar →',
    note: 'Al aprobar, la ficha se moverá al nuevo club conservando todo el historial. Si no reconoces esta solicitud, ignórala: nada cambiará.',
    subject: (club) => `${club} solicita el traspaso de tu hijo/a`,
  },
  ca: {
    preheader: 'Un club vol fitxar el teu fill/a · necessita la teva aprovació',
    title: (club) => `${club} vol fitxar el teu fill/a`,
    intro: (to, from) => `El club <strong>${to}</strong> ha sol·licitat el traspàs del teu fill/a des de <strong>${from || 'el seu club actual'}</strong>. El canvi NO es farà efectiu fins que tu l'aprovis des del teu panell.`,
    cta: 'Revisar i aprovar →',
    note: 'En aprovar, la fitxa es mourà al nou club conservant tot l\'historial. Si no reconeixes aquesta sol·licitud, ignora-la: no canviarà res.',
    subject: (club) => `${club} sol·licita el traspàs del teu fill/a`,
  },
};

function buildTransferRequestEmail({ toClub, fromClub, panelUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = REQ_STRINGS[lang];
  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">${T.intro(toClub, fromClub)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">${T.note}</p>`;
  return buildEmailLayout({ preheader: T.preheader, title: T.title(toClub), bodyHtml, idioma: lang });
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'request-transfer', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const cardSlug = (body.card_slug || '').trim();
    if (!cardSlug) return jsonResponse(400, { error: 'card_slug requerido' });

    // Club que ficha (scoped al JWT).
    const { data: toOrg, error: toErr } = await db
      .from('organizations').select('id, slug, name, kind, sport, deleted_at')
      .eq('id', session.orgId).maybeSingle();
    if (toErr) return jsonResponse(500, { error: toErr.message });
    if (!toOrg || toOrg.deleted_at) return unauthorizedResponse();
    if (toOrg.kind !== 'sports_club') return jsonResponse(403, { error: 'Solo clubes deportivos pueden solicitar traspasos' });

    // Card del jugador.
    const { data: card, error: cardErr } = await db
      .from('cards').select('slug, nombre, card_kind, idioma, organization_id, deleted_at')
      .eq('slug', cardSlug).maybeSingle();
    if (cardErr) return jsonResponse(500, { error: cardErr.message });
    if (!card || card.deleted_at || !isPlayer(card)) {
      return jsonResponse(404, { error: 'Jugador no encontrado' });
    }

    // Membresía de jugador activa (de quién viene).
    const { data: active, error: msErr } = await db
      .from('member_club_seasons')
      .select('id, organization_id')
      .eq('card_slug', cardSlug).eq('role', 'jugador').is('left_at', null)
      .maybeSingle();
    if (msErr) return jsonResponse(500, { error: msErr.message });
    if (!active) {
      // Sin club activo no es un traspaso: el club debe dar de alta nueva.
      return jsonResponse(409, { error: 'El jugador no tiene club activo. Usa el alta de jugador.' });
    }
    if (active.organization_id === toOrg.id) {
      return jsonResponse(409, { error: 'El jugador ya pertenece a tu club' });
    }

    // Un solo traspaso pendiente por jugador.
    const { data: pending } = await db
      .from('club_transfers').select('id').eq('card_slug', cardSlug).eq('status', 'pending').maybeSingle();
    if (pending) return jsonResponse(409, { error: 'Ya hay un traspaso pendiente para este jugador' });

    // Temporada destino.
    const seasonStartYear = parseSeasonStartYear(body.season) ?? currentSeasonStartYear();
    const season = formatSeason(seasonStartYear);

    let dorsal = null;
    if (body.dorsal != null && body.dorsal !== '') {
      dorsal = Number(body.dorsal);
      if (!Number.isInteger(dorsal) || dorsal < 0 || dorsal > 999) return jsonResponse(400, { error: 'Dorsal inválido' });
    }

    const { data: created, error: insErr } = await db
      .from('club_transfers')
      .insert({
        card_slug: cardSlug,
        from_org_id: active.organization_id,
        to_org_id: toOrg.id,
        requested_by_email: toOrg.email || 'club',
        status: 'pending',
        season,
        dorsal,
        position: body.position ? stripTags(body.position).substring(0, 40) : null,
        team_name: body.team_name ? stripTags(body.team_name).substring(0, 80) : null,
        note: body.note ? stripTags(body.note).substring(0, 280) : null,
      })
      .select('id')
      .single();
    if (insErr) return jsonResponse(500, { error: 'No se pudo crear la solicitud de traspaso' });

    // Avisa al tutor legal con un magic-link al panel para aprobar.
    if (emailClient) {
      const { data: tutor } = await db
        .from('card_admins').select('email')
        .eq('card_slug', cardSlug).eq('role', 'tutor_legal').is('revoked_at', null)
        .limit(1).maybeSingle();
      if (tutor && tutor.email) {
        try {
          const { data: fromOrg } = await db
            .from('organizations').select('name').eq('id', active.organization_id).maybeSingle();
          const idioma = card.idioma === 'ca' ? 'ca' : 'es';
          const token = signParentSession({ email: tutor.email });
          const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
          const panelUrl = `${siteUrl}/panel.html?session=${token}`;
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: tutor.email,
            subject: REQ_STRINGS[idioma].subject(toOrg.name),
            html: buildTransferRequestEmail({ toClub: toOrg.name, fromClub: fromOrg?.name, panelUrl, idioma }),
          });
        } catch (err) {
          console.error('request-transfer: error avisando al tutor:', err.message);
        }
      }
    }

    return jsonResponse(201, { ok: true, transfer_id: created.id, status: 'pending', season });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
exports.buildTransferRequestEmail = buildTransferRequestEmail;
exports.REQ_STRINGS = REQ_STRINGS;
