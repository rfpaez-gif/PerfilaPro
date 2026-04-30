'use strict';

const { getDb } = require('./lib/supabase-client');

const DEFAULT_LIMIT_PER_SECTOR = 8;

async function fetchShowcase(db, { limitPerSector = DEFAULT_LIMIT_PER_SECTOR } = {}) {
  const { data: cards, error: cardsErr } = await db
    .from('cards')
    .select('slug, nombre, tagline, foto_url, plan, profile_views, profession_label, city_slug, category_id')
    .eq('is_seed', true)
    .eq('status', 'active')
    .order('profile_views', { ascending: false });

  if (cardsErr) throw cardsErr;
  if (!cards || cards.length === 0) return [];

  const categoryIds = [...new Set(cards.map(c => c.category_id).filter(Boolean))];
  const categoriesById = {};
  if (categoryIds.length) {
    const { data: cats, error: catsErr } = await db
      .from('categories')
      .select('id, sector, sector_label, sort_order')
      .in('id', categoryIds);
    if (catsErr) throw catsErr;
    for (const c of cats || []) categoriesById[c.id] = c;
  }

  // Agrupa por sector y aplica el límite por carril
  const bySector = new Map();
  for (const card of cards) {
    const cat = card.category_id ? categoriesById[card.category_id] : null;
    if (!cat) continue;
    let bucket = bySector.get(cat.sector);
    if (!bucket) {
      bucket = { sector: cat.sector, sector_label: cat.sector_label, sort_order: cat.sort_order ?? 999, profiles: [] };
      bySector.set(cat.sector, bucket);
    }
    if (bucket.profiles.length < limitPerSector) {
      bucket.profiles.push({
        slug:             card.slug,
        nombre:           card.nombre,
        tagline:          card.tagline,
        foto_url:         card.foto_url,
        plan:             card.plan,
        profile_views:    card.profile_views,
        profession_label: card.profession_label,
        city_slug:        card.city_slug,
      });
    }
  }

  return Array.from(bySector.values()).sort((a, b) => a.sort_order - b.sort_order);
}

function makeHandler(deps) {
  const _getDb = deps.getDb;
  const _fetchShowcase = deps.fetchShowcase;

  return async (event) => {
    const qs = event.queryStringParameters || {};
    const parsed = parseInt(qs.limit, 10);
    const limitPerSector = Number.isFinite(parsed) && parsed > 0 && parsed <= 24 ? parsed : DEFAULT_LIMIT_PER_SECTOR;

    try {
      const db = _getDb();
      const sectors = await _fetchShowcase(db, { limitPerSector });
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
        },
        body: JSON.stringify({ sectors }),
      };
    } catch (err) {
      console.error('showcase error:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'showcase_unavailable' }),
      };
    }
  };
}

exports.handler = makeHandler({ getDb, fetchShowcase });
exports.makeHandler = makeHandler;
exports.fetchShowcase = fetchShowcase;
