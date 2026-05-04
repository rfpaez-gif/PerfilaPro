'use strict';

const PAGE_SIZE = 20;

async function getPublicProfile(db, slug) {
  const { data, error } = await db
    .from('cards')
    .select('slug, nombre, tagline, foto_url, whatsapp, email, telefono, zona, descripcion, servicios, plan, stripe_session_id, status, profile_views, directory_featured, directory_visible, category_id, city_slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getSectorMeta(db, sector) {
  const { data } = await db
    .from('categories')
    .select('sector_label, meta_title, meta_desc')
    .eq('sector', sector)
    .limit(1)
    .maybeSingle();
  return data;
}

async function getSpecialtyMeta(db, sector, specialty) {
  const { data } = await db
    .from('categories')
    .select('sector_label, specialty_label, meta_title, meta_desc')
    .eq('sector', sector)
    .eq('specialty', specialty)
    .maybeSingle();
  return data;
}

async function getCategoryByCard(db, categoryId) {
  if (!categoryId) return null;
  const { data } = await db
    .from('categories')
    .select('sector, sector_label, specialty, specialty_label')
    .eq('id', categoryId)
    .maybeSingle();
  return data;
}

async function getCityBySlug(db, citySlug) {
  if (!citySlug) return null;
  const { data } = await db
    .from('cities')
    .select('name, slug, province, region')
    .eq('slug', citySlug)
    .maybeSingle();
  return data;
}

async function getSectorSpecialties(db, sector) {
  const { data } = await db
    .from('categories')
    .select('specialty, specialty_label')
    .eq('sector', sector)
    .order('sort_order', { ascending: true });
  return data || [];
}

async function getSectorCities(db, sector, specialty) {
  let q = db
    .from('directory_public')
    .select('city_name, city_slug, province')
    .eq('sector', sector);
  if (specialty) q = q.eq('specialty', specialty);
  const { data } = await q;
  if (!data) return [];
  const seen = new Set();
  return data.reduce((acc, r) => {
    if (r.city_slug && !seen.has(r.city_slug)) {
      seen.add(r.city_slug);
      acc.push({ city_name: r.city_name, city_slug: r.city_slug, province: r.province });
    }
    return acc;
  }, []).sort((a, b) => (a.city_name || '').localeCompare(b.city_name || '', 'es'));
}

async function listProfiles(db, { sector, specialty, citySlug, page = 1 }) {
  let q = db
    .from('directory_public')
    .select('slug, nombre, tagline, foto_url, plan, profile_views, directory_featured, specialty_label, city_name, city_slug, province', { count: 'exact' })
    .eq('sector', sector);
  if (specialty) q = q.eq('specialty', specialty);
  if (citySlug) q = q.eq('city_slug', citySlug);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await q
    .order('plan', { ascending: false })
    .order('directory_featured', { ascending: false })
    .order('profile_views', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  return { profiles: data || [], total: count || 0, error };
}

async function getVisibleProfileSlugs(db, { page = 1, pageSize = 1000 } = {}) {
  const from = (page - 1) * pageSize;
  const { data, count, error } = await db
    .from('cards')
    .select('slug, created_at', { count: 'exact' })
    .eq('status', 'active')
    .eq('directory_visible', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  const slugs = (data || []).map(r => ({ slug: r.slug, lastmod: (r.created_at || '').split('T')[0] }));
  return { slugs, total: count || 0, error };
}

module.exports = {
  PAGE_SIZE,
  getPublicProfile,
  getSectorMeta,
  getSpecialtyMeta,
  getCategoryByCard,
  getCityBySlug,
  getSectorSpecialties,
  getSectorCities,
  listProfiles,
  getVisibleProfileSlugs,
};
