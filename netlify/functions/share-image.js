// Generación server-side de imágenes shareables del perfil con Satori + resvg.
//
// Endpoint público (sin token): los datos que renderiza son los mismos que
// /c/:slug ya expone — nombre, tagline, zona, foto. Si la card está
// soft-deleted o no es activa, devolvemos 404.
//
// Caché agresivo (24 h) porque el contenido cambia poco y el render cuesta
// ~150-300 ms. La invalidación natural ocurre al cambiar slug.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const satori = require('satori').default || require('satori');
const { Resvg } = require('@resvg/resvg-js');
const { TEMPLATES, buildTemplate } = require('./lib/share-templates');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _interRegular, _interBold;
function loadFonts() {
  if (!_interRegular) {
    _interRegular = fs.readFileSync(path.join(__dirname, 'lib/fonts/Inter-Regular.ttf'));
  }
  if (!_interBold) {
    _interBold = fs.readFileSync(path.join(__dirname, 'lib/fonts/Inter-Bold.ttf'));
  }
  return [
    { name: 'Inter', data: _interRegular, weight: 400, style: 'normal' },
    { name: 'Inter', data: _interBold,    weight: 700, style: 'normal' },
  ];
}

async function renderTemplate({ template, card, siteUrl }) {
  const config = TEMPLATES[template];
  if (!config) throw new Error('template_invalid');
  const tree = buildTemplate(template, { card, siteUrl });
  const svg = await satori(tree, {
    width:  config.width,
    height: config.height,
    fonts:  loadFonts(),
  });
  const png = new Resvg(svg).render().asPng();
  return png;
}

function makeHandler(db, render = renderTemplate) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'share-image', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, template: rawTemplate } = event.queryStringParameters || {};
    if (!slug) {
      return { statusCode: 400, body: 'Missing slug' };
    }

    const template = TEMPLATES[rawTemplate] ? rawTemplate : 'og';

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, tagline, zona, foto_url, status, plan')
      .eq('slug', slug)
      .in('status', ['active', 'free'])
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return { statusCode: 404, body: 'Not Found' };
    }

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;

    let png;
    try {
      png = await render({ template, card, siteUrl });
    } catch (err) {
      console.error('share-image render error:', err.message);
      return { statusCode: 500, body: 'Error generando imagen' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
      body:            png.toString('base64'),
      isBase64Encoded: true,
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.renderTemplate = renderTemplate;
