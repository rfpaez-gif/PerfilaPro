'use strict';

// Mismo whitelist que cards.foto_url en edit-card.js.
// Cualquier cambio aquí debe aplicarse también allí.
const ALLOWED_LOGO_HOSTS = [
  'supabase.co/storage',
  'supabase.in/storage',
];

const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Discriminador de carril (migración 033). NULL = business legacy.
// El CHECK de BD permite NULL | 'business' | 'sports_club'.
const ORG_KINDS = ['business', 'sports_club'];
// Deporte: sin CHECK en BD (el catálogo vivo es sports_categories).
// Token corto en minúsculas (futbol, baloncesto, futbol_sala…).
const SPORT_RE = /^[a-z][a-z0-9_]{1,29}$/;

function isValidOrgKind(kind) {
  // null/undefined/'' se tratan como "business legacy" → válidos.
  if (kind === null || kind === undefined || kind === '') return true;
  return ORG_KINDS.includes(kind);
}

function isValidSport(sport) {
  if (sport === null || sport === undefined || sport === '') return true;
  return typeof sport === 'string' && SPORT_RE.test(sport);
}

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

function isValidDescription(description) {
  return typeof description === 'string' && description.length <= 500;
}

// http(s) parseable y dentro de 200 chars. javascript:, data:, file: → false.
function isSafeWebsite(url) {
  if (typeof url !== 'string' || !url || url.length > 200) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

// Campos persistidos que consume el render público y la tarjeta de visita.
// Cualquier campo que use card.js / org.js / printable-card-utils.js debe
// listarse aquí o el SELECT lo devuelve undefined silenciosamente.
const ORG_PUBLIC_COLUMNS = 'id, slug, name, tagline, description, website, email, address, phone, logo_url, color_primary, hide_branding, deleted_at';

async function getOrgBySlug(db, slug) {
  if (!isValidOrgSlug(slug)) return null;
  const { data, error } = await db
    .from('organizations')
    .select(ORG_PUBLIC_COLUMNS)
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
    .select(ORG_PUBLIC_COLUMNS)
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
  ORG_KINDS,
  isValidOrgKind,
  isValidSport,
  isValidHex,
  isSafeLogoUrl,
  isValidOrgSlug,
  isValidTagline,
  isValidDescription,
  isSafeWebsite,
  getOrgBySlug,
  getOrgById,
  listCardsByOrg,
};
