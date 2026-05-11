'use strict';

// Mismo whitelist que cards.foto_url en edit-card.js.
// Cualquier cambio aquí debe aplicarse también allí.
const ALLOWED_LOGO_HOSTS = [
  'supabase.co/storage',
  'supabase.in/storage',
];

const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidHex(color) {
  return typeof color === 'string' && HEX_RE.test(color);
}

function isSafeLogoUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (!/^https:\/\//i.test(url)) return false;
  return ALLOWED_LOGO_HOSTS.some(h => url.includes(h));
}

function isValidOrgSlug(slug) {
  return typeof slug === 'string' && ORG_SLUG_RE.test(slug);
}

function isValidTagline(tagline) {
  return typeof tagline === 'string' && tagline.length <= 140;
}

async function getOrgBySlug(db, slug) {
  if (!isValidOrgSlug(slug)) return null;
  const { data, error } = await db
    .from('organizations')
    .select('id, slug, name, tagline, logo_url, color_primary, deleted_at')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getOrgById(db, id) {
  if (!id) return null;
  const { data } = await db
    .from('organizations')
    .select('id, slug, name, tagline, logo_url, color_primary, deleted_at')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return data || null;
}

async function listCardsByOrg(db, orgId) {
  if (!orgId) return { cards: [], error: null };
  const { data, error } = await db
    .from('cards')
    .select('slug, nombre, tagline, foto_url, plan, stripe_session_id, kit_email_sent_at, zona, city_slug, directory_featured')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('directory_featured', { ascending: false })
    .order('nombre', { ascending: true });
  return { cards: data || [], error };
}

module.exports = {
  ALLOWED_LOGO_HOSTS,
  isValidHex,
  isSafeLogoUrl,
  isValidOrgSlug,
  isValidTagline,
  getOrgBySlug,
  getOrgById,
  listCardsByOrg,
};
