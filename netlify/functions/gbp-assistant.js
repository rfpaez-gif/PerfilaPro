// Asistente Google Business Profile (opción A asistido).
//
// Devuelve un JSON con todo el material listo para que el usuario haga
// copy-paste en GBP: nombre, descripción 750 chars, categorías sugeridas,
// 5 posts iniciales, slots de fotos recomendadas y pasos guiados.
//
// Acceso: solo Pro (mismo gating que el resto de features Pro). Autoriza-
// ción por edit_token + slug, igual que profile-stats / edit-card.

const { createClient } = require('@supabase/supabase-js');
const { GBP_CATEGORIES, PHOTO_SLOTS, buildDescription, buildPosts, buildSteps } = require('./lib/gbp-templates');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mapeo sector_slug → label legible (idéntico al de register-free.js;
// duplicado intencional para no acoplar funciones).
const SECTOR_LABELS = {
  oficios: 'Oficios y servicios del hogar', salud: 'Salud y bienestar',
  educacion: 'Educación y formación', comercial: 'Comercial y ventas',
  belleza: 'Belleza y estética', reforma: 'Reforma y construcción',
  hosteleria: 'Hostelería y restauración', tech: 'Tecnología y digital',
  legal: 'Legal y asesoría', jardineria: 'Jardinería y paisajismo',
  transporte: 'Transporte y mudanzas', fotografia: 'Fotografía y vídeo',
  eventos: 'Eventos y celebraciones', automocion: 'Automoción y mecánica',
  seguridad: 'Seguridad y vigilancia', cuidados: 'Cuidados y asistencia',
  fitness: 'Fitness y deporte', turismo: 'Turismo y viajes',
  comercio: 'Comercio y tiendas', otro: 'Otro',
};

// Inferir el sector de la card a partir del tagline (que para los Pro
// suele ser el sector_label completo). Si no encontramos match, fallback
// a 'otro'.
function inferSector(card) {
  const tag = (card.tagline || '').toLowerCase();
  for (const [slug, label] of Object.entries(SECTOR_LABELS)) {
    if (tag.includes(label.toLowerCase())) return slug;
    if (tag.includes(slug)) return slug;
  }
  return 'otro';
}

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'gbp-assistant', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, token } = event.queryStringParameters || {};
    if (!slug || !token) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetros inválidos' }),
      };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, tagline, zona, servicios, foto_url, plan, edit_token_expires_at')
      .eq('slug', slug)
      .eq('edit_token', token)
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Enlace inválido o expirado' }),
      };
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El enlace ha expirado. Solicita uno nuevo.' }),
      };
    }

    if (card.plan !== 'pro') {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Asistente GBP solo disponible en plan Pro' }),
      };
    }

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;

    const sectorSlug  = inferSector(card);
    const categories  = GBP_CATEGORIES[sectorSlug] || GBP_CATEGORIES.otro;

    const payload = {
      card: {
        slug:    card.slug,
        nombre:  card.nombre,
        tagline: card.tagline,
        zona:    card.zona,
      },
      sector:        sectorSlug,
      sector_label:  SECTOR_LABELS[sectorSlug] || 'Servicio profesional',
      categories,
      description:   buildDescription(card),
      website_url:   `${siteUrl}/c/${card.slug}`,
      posts:         buildPosts(card),
      photo_slots:   PHOTO_SLOTS,
      steps:         buildSteps(card, siteUrl),
      assets: {
        cover_image:   `${siteUrl}/api/share-image?slug=${encodeURIComponent(card.slug)}&template=og`,
        qr_svg:        `${siteUrl}/api/qr-download?slug=${encodeURIComponent(card.slug)}&format=svg`,
        qr_png:        `${siteUrl}/api/qr-download?slug=${encodeURIComponent(card.slug)}&format=png&size=1024`,
      },
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
      body: JSON.stringify(payload),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.inferSector = inferSector;
