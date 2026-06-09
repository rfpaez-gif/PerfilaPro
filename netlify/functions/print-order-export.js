'use strict';

// POST /api/print-order-export { org_slug?, status?, format }   ·   Cantera 5
//
// Export del lote de carnets para la imprenta. Auth founder (password+TOTP).
//   - format='csv' (default): CSV con los pedidos (PRINT_PROVIDER='manual'
//     → el founder lo manda a la imprenta).
//   - format='pdf': booklet con un carnet PVC por jugador (reusa
//     buildPlayerCardsBookletPDF). Requiere org_slug.
//
// Filtra por status (default 'paid') y opcionalmente por club.

const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');
const { buildPlayerCardsBookletPDF } = require('./printable-card-utils');
const { carnetReadiness } = require('./lib/carnet-ready');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    const status = body.status || 'paid';
    const format = body.format || 'csv';

    // Resolver club si llega org_slug.
    let orgId = null;
    let org = null;
    if (body.org_slug) {
      const { data, error } = await db.from('organizations')
        .select('id, slug, name, color_primary, logo_url').eq('slug', body.org_slug).is('deleted_at', null).maybeSingle();
      if (error) return jsonResponse(500, { error: error.message });
      if (!data) return jsonResponse(404, { error: 'Club no encontrado' });
      org = data; orgId = data.id;
    }

    // Pedidos.
    let q = db.from('card_print_orders')
      .select('id, card_slug, organization_id, kind, status, nfc_uid, ordered_at')
      .eq('status', status).order('ordered_at', { ascending: false });
    if (orgId) q = q.eq('organization_id', orgId);
    const { data: orders, error: ordErr } = await q;
    if (ordErr) return jsonResponse(500, { error: ordErr.message });
    let list = orders || [];

    // Filtro opcional "solo carnets listos" (foto + equipo + dorsal). Por
    // defecto exporta todo el lote; con only_ready el founder no manda a
    // imprenta carnets incompletos (mismo criterio que el chip del roster).
    const onlyReady = body.only_ready === true || body.only_ready === 'true';
    if (onlyReady && list.length) list = await filterCarnetReady(db, list);

    if (format === 'csv') {
      // Nombres de los jugadores para que la imprenta lea algo humano.
      const slugs = [...new Set(list.map(o => o.card_slug))];
      const nameMap = {};
      if (slugs.length) {
        const { data: cards } = await db.from('cards').select('slug, nombre').in('slug', slugs);
        (cards || []).forEach(c => { nameMap[c.slug] = c.nombre; });
      }
      const header = ['order_id', 'card_slug', 'nombre', 'organization_id', 'kind', 'status', 'nfc_uid', 'ordered_at'];
      const rows = list.map(o => [o.id, o.card_slug, nameMap[o.card_slug] || '', o.organization_id, o.kind, o.status, o.nfc_uid || '', o.ordered_at]);
      const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="print-orders-${status}.csv"`,
        },
        body: csv,
      };
    }

    if (format === 'pdf') {
      if (!org) return jsonResponse(400, { error: 'org_slug requerido para PDF' });
      if (!list.length) return jsonResponse(404, { error: 'Sin carnets para ese club/estado' });

      const slugs = [...new Set(list.map(o => o.card_slug))];
      const { data: cards } = await db.from('cards').select('slug, nombre, foto_url').in('slug', slugs);
      const cardMap = {}; (cards || []).forEach(c => { cardMap[c.slug] = c; });

      // Membresía activa (dorsal/categoría/equipo) por jugador.
      const { data: seasons } = await db.from('member_club_seasons')
        .select('card_slug, dorsal, team_name, category_id').in('card_slug', slugs).is('left_at', null);
      const seasonMap = {}; (seasons || []).forEach(s => { seasonMap[s.card_slug] = s; });

      // Nombres de categoría.
      const catIds = [...new Set((seasons || []).map(s => s.category_id).filter(Boolean))];
      const catMap = {};
      if (catIds.length) {
        const { data: cats } = await db.from('sports_categories').select('id, display_name_es').in('id', catIds);
        (cats || []).forEach(c => { catMap[c.id] = c.display_name_es; });
      }

      const players = slugs.filter(sl => cardMap[sl]).map(sl => {
        const s = seasonMap[sl] || {};
        return {
          card: cardMap[sl],
          season: { dorsal: s.dorsal, team_name: s.team_name, category_name: s.category_id ? catMap[s.category_id] : '' },
        };
      });

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      try {
        const pdf = await buildPlayerCardsBookletPDF({ players, club: org, siteUrl });
        return jsonResponse(200, { ok: true, count: players.length, pdf_base64: pdf.toString('base64') });
      } catch (err) {
        console.error('print-order-export pdf:', err.message);
        return jsonResponse(500, { error: 'No se pudo generar el PDF' });
      }
    }

    return jsonResponse(400, { error: 'format debe ser csv o pdf' });
  };
}

// Filtra el lote a los jugadores cuyo carnet está listo (foto + equipo +
// dorsal). Resuelve foto desde cards y dorsal/equipo desde la membresía
// activa; reusa la misma regla que get_roster (lib/carnet-ready).
async function filterCarnetReady(db, list) {
  const slugs = [...new Set(list.map((o) => o.card_slug))];
  const { data: cards } = await db.from('cards').select('slug, foto_url').in('slug', slugs);
  const fotoBySlug = {}; (cards || []).forEach((c) => { fotoBySlug[c.slug] = c.foto_url; });
  const { data: seasons } = await db.from('member_club_seasons')
    .select('card_slug, role, dorsal, team_id, team_name').in('card_slug', slugs).is('left_at', null);
  const seasonBySlug = {};
  (seasons || []).forEach((s) => { if (!seasonBySlug[s.card_slug]) seasonBySlug[s.card_slug] = s; });
  return list.filter((o) => {
    const s = seasonBySlug[o.card_slug] || {};
    return carnetReadiness({
      role: s.role || 'jugador', foto_url: fotoBySlug[o.card_slug],
      team_id: s.team_id, team_name: s.team_name, dorsal: s.dorsal,
    }).ready;
  });
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
