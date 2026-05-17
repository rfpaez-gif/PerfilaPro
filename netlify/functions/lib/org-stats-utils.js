'use strict';

const crypto = require('crypto');

const STATS_TOKEN_RE = /^[0-9a-f]{64}$/;

function isValidStatsToken(token) {
  return typeof token === 'string' && STATS_TOKEN_RE.test(token);
}

/**
 * Verifica slug + token contra organizations. Devuelve la org si el token
 * coincide y no ha expirado; null en cualquier otro caso. Comparación
 * timing-safe para no filtrar info sobre prefijos válidos.
 *
 * El caller debe haber validado el slug con isValidOrgSlug antes de
 * llamar (esta función NO valida formato del slug).
 */
async function authenticateOrgStats(db, slug, token) {
  if (!isValidStatsToken(token)) return null;

  const { data: org } = await db
    .from('organizations')
    .select('id, slug, name, tagline, logo_url, color_primary, stats_token, stats_token_expires_at')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org || !org.stats_token) return null;

  const a = Buffer.from(org.stats_token);
  const b = Buffer.from(token);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  if (org.stats_token_expires_at) {
    if (new Date(org.stats_token_expires_at).getTime() < Date.now()) return null;
  }

  return org;
}

/**
 * Agrega visitas de todos los miembros activos de una org. Una sola query
 * a `visits` filtrada por `slug IN (...)`. La cardinalidad realista (<200
 * miembros × <1000 visitas/mes/miembro) mantiene esto barato sin RPC.
 *
 * Devuelve:
 *   {
 *     members: number,
 *     totals: { visits_7d, visits_30d, visits_all },
 *     by_member: [{ slug, nombre, foto_url, visits_7d, visits_30d, visits_all }],
 *     by_day:    [{ date: 'YYYY-MM-DD', count }]  // últimos 30 días
 *   }
 */
async function computeOrgStats(db, orgId) {
  const empty = {
    members: 0,
    totals: { visits_7d: 0, visits_30d: 0, visits_all: 0 },
    by_member: [],
    by_day: buildEmptyDays(30),
  };
  if (!orgId) return empty;

  const { data: cards, error: cardsErr } = await db
    .from('cards')
    .select('slug, nombre, foto_url')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (cardsErr || !cards || !cards.length) return empty;

  const slugs = cards.map(c => c.slug);

  const { data: visits, error: visitsErr } = await db
    .from('visits')
    .select('slug, visited_at')
    .in('slug', slugs);
  if (visitsErr) return empty;

  const now = Date.now();
  const D7  = now - 7  * 86400000;
  const D30 = now - 30 * 86400000;

  const bySlug = {};
  for (const c of cards) bySlug[c.slug] = { v7: 0, v30: 0, vall: 0 };

  const byDay = {};
  let totals7 = 0, totals30 = 0, totalsAll = 0;

  for (const v of (visits || [])) {
    const ts = new Date(v.visited_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const s = bySlug[v.slug];
    if (!s) continue;

    s.vall++; totalsAll++;
    if (ts >= D30) {
      s.v30++; totals30++;
      const key = new Date(ts).toISOString().slice(0, 10);
      byDay[key] = (byDay[key] || 0) + 1;
    }
    if (ts >= D7) { s.v7++; totals7++; }
  }

  const by_member = cards
    .map(c => ({
      slug: c.slug,
      nombre: c.nombre,
      foto_url: c.foto_url || null,
      visits_7d:  bySlug[c.slug].v7,
      visits_30d: bySlug[c.slug].v30,
      visits_all: bySlug[c.slug].vall,
    }))
    .sort((a, b) => b.visits_30d - a.visits_30d || b.visits_all - a.visits_all);

  const by_day = buildEmptyDays(30).map(({ date }) => ({
    date,
    count: byDay[date] || 0,
  }));

  return {
    members: cards.length,
    totals: { visits_7d: totals7, visits_30d: totals30, visits_all: totalsAll },
    by_member,
    by_day,
  };
}

function buildEmptyDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push({
      date: new Date(now - i * 86400000).toISOString().slice(0, 10),
      count: 0,
    });
  }
  return out;
}

module.exports = {
  isValidStatsToken,
  authenticateOrgStats,
  computeOrgStats,
};
